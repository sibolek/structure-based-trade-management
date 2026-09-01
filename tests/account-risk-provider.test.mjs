import assert from "node:assert/strict";
import test from "node:test";

import {
  SchwabAccountRiskProvider,
  assessAccountRiskSnapshot,
  normalizeSchwabAccountRiskSnapshot,
} from "../schwab-bridge/account-risk-provider.mjs";

const NOW = Date.parse("2026-09-01T17:00:00.000Z");

function payload(overrides = {}) {
  return {
    securitiesAccount: {
      accountNumber: "12345678",
      currentBalances: {
        liquidationValue: 13_537.37,
        equity: 12_000,
        buyingPower: 30_000,
        ...overrides,
      },
      initialBalances: {
        liquidationValue: 99_999,
      },
    },
  };
}

test("Schwab normalization uses current liquidationValue as account equity", () => {
  const result = normalizeSchwabAccountRiskSnapshot(payload(), {
    accountId: "HASH-ABC",
    observedAt: NOW,
  });
  assert.equal(result.status, "VALID");
  assert.equal(result.snapshot.accountEquity, 13_537.37);
  assert.equal(result.snapshot.equityField, "currentBalances.liquidationValue");
});

test("Schwab normalization does not use currentBalances.equity when liquidationValue is missing", () => {
  const result = normalizeSchwabAccountRiskSnapshot(payload({ liquidationValue: undefined, equity: 50_000 }), {
    accountId: "HASH-ABC",
    observedAt: NOW,
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_EQUITY_INVALID"]);
});

test("Schwab normalization does not fall back to initial balances", () => {
  const source = payload({ liquidationValue: undefined });
  source.securitiesAccount.currentBalances.equity = undefined;
  source.securitiesAccount.initialBalances.liquidationValue = 88_000;
  const result = normalizeSchwabAccountRiskSnapshot(source, {
    accountId: "HASH-ABC",
    observedAt: NOW,
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_EQUITY_INVALID"]);
});

test("zero and negative liquidation values block", () => {
  for (const liquidationValue of [0, -1]) {
    const result = normalizeSchwabAccountRiskSnapshot(payload({ liquidationValue }), {
      accountId: "HASH-ABC",
      observedAt: NOW,
    });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.reasonCodes, ["ACCOUNT_EQUITY_INVALID"]);
  }
});

test("missing exact account id blocks before normalization", () => {
  const result = normalizeSchwabAccountRiskSnapshot(payload(), { observedAt: NOW });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_NOT_RESOLVED"]);
});

test("USD is the only supported Schwab account-risk currency in V2.4", () => {
  const result = normalizeSchwabAccountRiskSnapshot(payload(), {
    accountId: "HASH-ABC",
    observedAt: NOW,
    currency: "EUR",
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_CURRENCY_UNSUPPORTED"]);
});

test("snapshot exactly 15 seconds old remains valid", () => {
  const result = assessAccountRiskSnapshot({
    accountId: "HASH-ABC",
    accountEquity: 13_500,
    currency: "USD",
    observedAt: NOW - 15_000,
    source: "SCHWAB",
  }, { nowMs: NOW });
  assert.equal(result.status, "VALID");
  assert.equal(result.snapshot.ageMs, 15_000);
});

test("snapshot older than 15 seconds blocks", () => {
  const result = assessAccountRiskSnapshot({
    accountId: "HASH-ABC",
    accountEquity: 13_500,
    currency: "USD",
    observedAt: NOW - 15_001,
    source: "SCHWAB",
  }, { nowMs: NOW });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_SNAPSHOT_STALE"]);
  assert.equal(result.snapshot.ageMs, 15_001);
});

test("future-dated snapshot within clock skew is treated as age zero", () => {
  const result = assessAccountRiskSnapshot({
    accountId: "HASH-ABC",
    accountEquity: 13_500,
    currency: "USD",
    observedAt: NOW + 250,
    source: "SCHWAB",
  }, { nowMs: NOW });
  assert.equal(result.status, "VALID");
  assert.equal(result.snapshot.ageMs, 0);
});

test("missing snapshot timestamp blocks", () => {
  const result = assessAccountRiskSnapshot({
    accountId: "HASH-ABC",
    accountEquity: 13_500,
    currency: "USD",
    source: "SCHWAB",
  }, { nowMs: NOW });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_SNAPSHOT_UNAVAILABLE"]);
});

test("provider fetches only the exact encrypted account id", async () => {
  const calls = [];
  const provider = new SchwabAccountRiskProvider({
    requestJson: async (url) => {
      calls.push(url);
      return payload();
    },
    now: () => NOW,
  });
  const result = await provider.getSnapshot("HASH/ABC");
  assert.equal(result.status, "VALID");
  assert.deepEqual(calls, ["https://api.schwabapi.com/trader/v1/accounts/HASH%2FABC"]);
  assert.equal(result.snapshot.accountId, "HASH/ABC");
});

test("provider request failure blocks as account snapshot unavailable", async () => {
  const provider = new SchwabAccountRiskProvider({
    requestJson: async () => { throw new Error("offline"); },
    now: () => NOW,
  });
  const result = await provider.getSnapshot("HASH-ABC");
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_SNAPSHOT_UNAVAILABLE"]);
});

test("provider requires exact account identity before making a request", async () => {
  let calls = 0;
  const provider = new SchwabAccountRiskProvider({
    requestJson: async () => { calls += 1; return payload(); },
    now: () => NOW,
  });
  const result = await provider.getSnapshot("");
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["ACCOUNT_NOT_RESOLVED"]);
  assert.equal(calls, 0);
});

test("normalized snapshot preserves source provenance and deterministic source snapshot id", () => {
  const first = normalizeSchwabAccountRiskSnapshot(payload(), {
    accountId: "HASH-ABC",
    observedAt: NOW,
  });
  const second = normalizeSchwabAccountRiskSnapshot(payload(), {
    accountId: "HASH-ABC",
    observedAt: NOW + 1_000,
  });
  assert.equal(first.status, "VALID");
  assert.equal(first.snapshot.source, "SCHWAB");
  assert.match(first.snapshot.sourceSnapshotId, /^[a-f0-9]{64}$/);
  assert.equal(first.snapshot.sourceSnapshotId, second.snapshot.sourceSnapshotId);
});

test("returned provider results are immutable", async () => {
  const provider = new SchwabAccountRiskProvider({
    requestJson: async () => payload(),
    now: () => NOW,
  });
  const result = await provider.getSnapshot("HASH-ABC");
  assert.equal(result.status, "VALID");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.snapshot), true);
});
