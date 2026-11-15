import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  groupOrderExecutions,
  printAnalyticsSummary,
  summarizeReferenceImpact,
} from "../schwab-bridge/slippage.mjs";

const account = { accountNumber: "test-account" };

function order(id, overrides = {}) {
  return {
    orderId: id,
    orderType: "MARKET",
    status: "FILLED",
    orderLegCollection: [{ legId: 1, instruction: "BUY", quantity: 1, instrument: { symbol: "TEST" } }],
    orderActivityCollection: [{
      activityType: "EXECUTION",
      executionType: "FILL",
      executionLegs: [{ legId: 1, quantity: 1, price: 100 }],
    }],
    ...overrides,
  };
}

// Synthetic reproduction of the user's observed counts/totals, not broker data.
function observedOrders() {
  return Array.from({ length: 197 }, (_, index) => {
    const fragments = index < 12 ? 3 : index < 19 ? 2 : 1;
    return order(index, {
      ...(index < 52
        ? { orderType: "LIMIT", price: index === 51 ? 100.05 : 100.50 }
        : index < 87
          ? { orderType: "STOP", stopPrice: index === 86 ? 99.86 : 99.93 }
          : {}),
      orderActivityCollection: [{
        activityType: "EXECUTION",
        executionType: "FILL",
        executionLegs: Array.from({ length: fragments }, () => ({ legId: 1, quantity: 1 / fragments, price: 100 })),
      }],
    });
  });
}

function captureSummary(rows) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try { printAnalyticsSummary(rows); } finally { console.log = originalLog; }
  return lines.join("\n");
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}

test("disjoint measured legs reproduce the observed net, coverage, and detailed metrics", () => {
  const rows = groupOrderExecutions(account, observedOrders());
  const result = summarizeReferenceImpact(rows);
  assert.equal(result.analyzedCount, 197);
  assert.equal(result.limitSummary.count, 52);
  assert.equal(result.stopSummary.count, 35);
  close(result.limitSummary.dollars, -25.55);
  close(result.stopSummary.dollars, 2.52);
  close(result.netDollars, -23.03);
  assert.equal(result.measuredCount, 87);
  assert.equal(result.overlapCount, 0);
  assert.equal(result.unmeasuredCount, 110);
  close(result.coveragePercent, 87 / 197 * 100);
  const output = captureSummary(rows);
  assert.match(output, /Executed order legs analyzed:\s+197/);
  assert.match(output, /Individual execution fragments:\s+228/);
  assert.match(output, /Fragmented executed orders:\s+19/);
  assert.match(output, /Unique reference-measured legs:\s+87 \/ 197 \(44\.16%\)/);
  assert.match(output, /Net reference-price impact:\s+-\$23\.03/);
  assert.match(output, /Weighted adverse\/share vs limit:/);
  assert.match(output, /Weighted adverse\/share vs stop:/);
  assert.match(output, /Aggregate reference impact:\s+-\$25\.55/);
  assert.match(output, /Aggregate reference impact:\s+\+\$2\.52/);
});

test("stop-limit overlap counts once for coverage and prevents an additive net", () => {
  const rows = groupOrderExecutions(account, [
    order(1, { orderType: "STOP_LIMIT", price: 101, stopPrice: 99 }),
    order(2, { orderType: "LIMIT", price: 100.5 }),
    order(3),
  ]);
  const result = summarizeReferenceImpact(rows);
  assert.equal(result.limitSummary.count, 2);
  assert.equal(result.stopSummary.count, 1);
  assert.equal(result.measuredCount, 2);
  assert.equal(result.overlapCount, 1);
  assert.equal(result.unmeasuredCount, 1);
  close(result.coveragePercent, 200 / 3);
  assert.equal(result.netDollars, null);
  const output = captureSummary(rows);
  assert.match(output, /Unique reference-measured legs:\s+2 \/ 3 \(66\.67%\)/);
  assert.match(output, /Legs measured vs both limit\/stop:\s+1/);
  assert.match(output, /Net reference-price impact:\s+N\/A — overlapping/);
  assert.match(output, /Aggregate reference impact:\s+-\$1\.50/);
  assert.match(output, /Aggregate reference impact:\s+\+\$1\.00/);
});

test("fragment VWAP, quantity weighting, and buy/sell sign conventions are preserved", () => {
  for (const instruction of ["BUY", "BUY_TO_COVER", "SELL", "SELL_SHORT"]) {
    const rows = groupOrderExecutions(account, [order(1, {
      price: 100,
      orderLegCollection: [{ legId: 1, instruction, instrument: { symbol: "TEST" } }],
      orderActivityCollection: [{
        activityType: "EXECUTION", executionType: "FILL",
        executionLegs: [{ legId: 1, quantity: 3, price: 99 }, { legId: 1, quantity: 7, price: 101 }],
      }],
    })]);
    close(rows[0].vwap, 100.4);
    assert.equal(rows[0].fragmentCount, 2);
    assert.equal(rows[0].fillRange, 2);
    const sign = instruction.startsWith("BUY") ? 1 : -1;
    close(rows[0].limitSlipPerShare, sign * 0.4);
    close(summarizeReferenceImpact(rows).netDollars, sign * 4);
  }
});

test("missing, blank, and invalid references do not become zero-price measurements", () => {
  for (const value of [undefined, null, "", "  ", "invalid", Infinity, NaN]) {
    const rows = groupOrderExecutions(account, [order(1, { price: value, stopPrice: value })]);
    assert.equal(rows[0].limitReference, null);
    assert.equal(rows[0].stopReference, null);
    assert.equal(summarizeReferenceImpact(rows).measuredCount, 0);
  }
});

test("multi-leg order prices and unknown instructions are excluded from measurement", () => {
  const rows = groupOrderExecutions(account, [order(1, {
    price: 100, stopPrice: 99,
    orderLegCollection: [
      { legId: 1, instruction: "BUY", instrument: { symbol: "TEST" } },
      { legId: 2, instruction: "SELL", instrument: { symbol: "OTHER" } },
    ],
    orderActivityCollection: [{
      activityType: "EXECUTION", executionType: "FILL",
      executionLegs: [{ legId: 1, quantity: 1, price: 100 }, { legId: 2, quantity: 1, price: 100 }],
    }],
  }), order(2, {
    price: 100,
    orderLegCollection: [{ legId: 1, instruction: "UNKNOWN", instrument: { symbol: "TEST" } }],
  })]);
  const result = summarizeReferenceImpact(rows);
  assert.equal(result.analyzedCount, 3);
  assert.equal(result.unmeasuredCount, 3);
  assert.equal(result.measuredCount, 0);
  assert.equal(result.netDollars, null);
});

test("exact fills are measured zero impact; no references and empty samples show N/A net", () => {
  const exact = groupOrderExecutions(account, [order(1, { price: 100 })]);
  assert.equal(summarizeReferenceImpact(exact).netDollars, 0);
  assert.equal(summarizeReferenceImpact(exact).coveragePercent, 100);
  assert.match(captureSummary(exact), /Net reference-price impact:\s+\$0\.00/);
  const unmeasured = groupOrderExecutions(account, [order(1)]);
  assert.equal(summarizeReferenceImpact(unmeasured).coveragePercent, 0);
  assert.match(captureSummary(unmeasured), /1 \(0\.00%\)/);
  assert.match(captureSummary(unmeasured), /Net reference-price impact:\s+N\/A — no measured/);
  assert.equal(summarizeReferenceImpact([]).coveragePercent, null);
  assert.match(captureSummary([]), /0 \/ 0 \(N\/A\)/);
});

test("unique identity includes account, order, and leg; repeated rows do not inflate net or coverage", () => {
  const [row] = groupOrderExecutions(account, [order(1, { price: 100.5 })]);
  const result = summarizeReferenceImpact([
    row, { ...row }, { ...row, accountNumber: "second-account" },
    { ...row, orderId: 2 }, { ...row, legId: "2" },
  ]);
  assert.equal(result.analyzedCount, 4);
  assert.equal(result.measuredCount, 4);
  assert.equal(result.limitSummary.count, 4);
  assert.equal(result.netDollars, -2);
});

test("CLI fragmented-only display retains full-sample summary and coverage without broker access", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schwab-slippage-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, ".schwab-tokens.json"), JSON.stringify({
    accessToken: "synthetic-test-token",
    accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  }));
  const preload = path.join(dir, "mock-fetch.mjs");
  fs.writeFileSync(preload, `
    import assert from "node:assert/strict";
    const orders = ${JSON.stringify(observedOrders())};
    globalThis.fetch = async (url, options) => {
      assert.equal(options.method || "GET", "GET");
      let payload;
      if (url.endsWith("/accounts/accountNumbers")) payload = [{ accountNumber: "test-account", hashValue: "synthetic-hash" }];
      else if (url.includes("/accounts/synthetic-hash/orders?")) payload = orders;
      else throw new Error("Unexpected request: " + url);
      return { ok: true, text: async () => JSON.stringify(payload) };
    };
  `);
  const script = fileURLToPath(new URL("../schwab-bridge/slippage.mjs", import.meta.url));
  const run = spawnSync(process.execPath, ["--import", preload, script, "--fragmented-only"], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal((run.stdout.match(/^Order /gm) || []).length, 19);
  assert.match(run.stdout, /Executed order legs analyzed:\s+197/);
  assert.match(run.stdout, /Individual execution fragments:\s+228/);
  assert.match(run.stdout, /Unique reference-measured legs:\s+87 \/ 197 \(44\.16%\)/);
  assert.match(run.stdout, /Net reference-price impact:\s+-\$23\.03/);
  assert.match(run.stdout, /WIDEST FRAGMENT PRICE RANGES/);
});
