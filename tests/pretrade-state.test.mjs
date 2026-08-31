import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-")), "state.json");
}

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-08-28-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS",
    sourceDate: "2026-08-28",
    generatedAt: "2026-08-28T12:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Liquidity sweep reclaim continuation",
    timeframe: "2m",
    thesis: "Sweep and reclaim at structural support",
    trigger: { type: "RECLAIM_AND_HOLD", level: 225.4 },
    structuralInvalidation: {
      price: 224.85,
      rule: "break below sweep low",
      referenceType: "SWEEP_LOW",
      reason: "long thesis invalid below the swept structural low",
    },
    plannedEntryReference: 225.45,
    targets: [226.4, 227.1],
    managementPlan: "Manage against structure",
    armPolicy: { requestedMode: "AUTO" },
    ...overrides,
  };
}

test("valid candidate imports into WAITING and survives reload", () => {
  const filePath = tempStatePath();
  const store = new PreTradeStore({ filePath, clock: () => "2026-08-28T12:05:00.000Z" });
  store.load();

  const result = store.importBundle({ source: "SOD", bundleId: "morning", candidates: [candidate()] });
  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(result.outcomes[0].lifecycleState, "WAITING");

  const reloaded = new PreTradeStore({ filePath });
  const state = reloaded.load();
  assert.equal(state.candidates.length, 1);
  assert.equal(state.candidates[0].lifecycleState, "WAITING");
  assert.equal(state.candidates[0].symbol, "NVDA");
});

test("legacy TRIGGER_EVALUATING state loads and saves using canonical Phase 3 lifecycle name", () => {
  const filePath = tempStatePath();
  fs.writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 1,
    updatedAt: "2026-08-28T12:05:00.000Z",
    candidates: [{ candidateId: "legacy-1", lifecycleState: "TRIGGER_EVALUATING" }],
    importLog: [],
  }, null, 2)}\n`, "utf8");

  const store = new PreTradeStore({ filePath });
  const loaded = store.load();
  assert.equal(loaded.candidates[0].lifecycleState, "PRETRADE_TRIGGER_EVALUATING");

  store.save();
  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(persisted.candidates[0].lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
});

test("exact same candidate version and content is idempotent", () => {
  const store = new PreTradeStore({ filePath: tempStatePath(), clock: () => "2026-08-28T12:05:00.000Z" });
  store.load();
  store.importBundle({ candidates: [candidate()] });
  const result = store.importBundle({ candidates: [candidate()] });

  assert.equal(result.outcomes[0].status, "DUPLICATE");
  assert.equal(store.snapshot().candidates.length, 1);
});

test("same candidateId and version with different content is a conflict", () => {
  const store = new PreTradeStore({ filePath: tempStatePath(), clock: () => "2026-08-28T12:05:00.000Z" });
  store.load();
  store.importBundle({ candidates: [candidate()] });
  const result = store.importBundle({ candidates: [candidate({ thesis: "Different thesis" })] });

  assert.equal(result.outcomes[0].status, "CONFLICT");
  assert.equal(store.snapshot().candidates.length, 1);
});

test("higher contractVersion supersedes active lower version", () => {
  let time = "2026-08-28T12:05:00.000Z";
  const store = new PreTradeStore({ filePath: tempStatePath(), clock: () => time });
  store.load();
  store.importBundle({ candidates: [candidate()] });

  time = "2026-08-28T12:10:00.000Z";
  const result = store.importBundle({ candidates: [candidate({ contractVersion: 2, thesis: "Updated thesis" })] });
  const state = store.snapshot();

  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(state.candidates.length, 2);
  assert.equal(state.candidates.find((item) => item.contractVersion === 1).lifecycleState, "SUPERSEDED");
  assert.equal(state.candidates.find((item) => item.contractVersion === 2).lifecycleState, "WAITING");
});

test("older contractVersion is rejected as stale", () => {
  const store = new PreTradeStore({ filePath: tempStatePath(), clock: () => "2026-08-28T12:05:00.000Z" });
  store.load();
  store.importBundle({ candidates: [candidate({ contractVersion: 2 })] });
  const result = store.importBundle({ candidates: [candidate({ contractVersion: 1 })] });

  assert.equal(result.outcomes[0].status, "STALE");
  assert.equal(store.snapshot().candidates.length, 1);
});

test("invalid candidate is rejected without rejecting valid peers", () => {
  const store = new PreTradeStore({ filePath: tempStatePath(), clock: () => "2026-08-28T12:05:00.000Z" });
  store.load();
  const invalid = candidate({ candidateId: "", symbol: "" });
  const result = store.importBundle({ candidates: [invalid, candidate()] });

  assert.equal(result.outcomes[0].status, "REJECTED");
  assert.equal(result.outcomes[1].status, "ACCEPTED");
  assert.equal(store.snapshot().candidates.length, 1);
});

test("malformed bundle fails closed", () => {
  const store = new PreTradeStore({ filePath: tempStatePath() });
  store.load();
  assert.throws(() => store.importBundle({ nope: [] }), (error) => error.code === "INVALID_BUNDLE");
  assert.equal(store.snapshot().candidates.length, 0);
});
