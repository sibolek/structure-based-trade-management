import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PreTradeExecutionOwnershipAuthority,
  EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY,
  EXECUTION_OWNERSHIP_PROJECTION_SOURCE,
} from "../schwab-bridge/pretrade-execution-ownership-authority.mjs";
import { PreTradeExecutionOwnershipProvider } from "../schwab-bridge/pretrade-execution-ownership-provider.mjs";

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-ownership-")), "ownership.json");
}

function canonicalStore(overrides = {}) {
  return {
    storeSchemaVersion: 1,
    storeRevision: 7,
    draft: null,
    candidates: [],
    liveTrades: [],
    history: [],
    view: "TRADE",
    notice: "",
    v24Installations: [],
    v24Retirements: [],
    v24Lifecycles: [],
    ...overrides,
  };
}

function publication(store = canonicalStore(), overrides = {}) {
  return {
    kind: "SNAPSHOT",
    source: EXECUTION_OWNERSHIP_PROJECTION_SOURCE,
    authority: EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY,
    storeKey: "execution-v23-store",
    publisherId: "receiver-1",
    publishedAt: "2026-09-06T20:00:00.000Z",
    store,
    ...overrides,
  };
}

function clockSequence(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test("missing or stale Execution projection stays UNKNOWN and never guesses FREE", async () => {
  const authority = new PreTradeExecutionOwnershipAuthority({
    filePath: tempFile(),
    clock: clockSequence([
      "2026-09-06T20:00:00.000Z",
      "2026-09-06T20:00:00.000Z",
      "2026-09-06T20:00:04.001Z",
    ]),
    maxAgeMs: 3000,
  });
  authority.load();
  const provider = new PreTradeExecutionOwnershipProvider({ resolver: (symbol) => authority.resolveSymbol(symbol) });

  const missing = await provider.checkSymbol("NVDA");
  assert.equal(missing.status, "UNKNOWN");
  assert.equal(missing.reasonCode, "EXECUTION_OWNERSHIP_AUTHORITY_UNAVAILABLE");
  assert.equal(missing.authoritative, false);

  authority.publish(publication());
  const stale = await provider.checkSymbol("NVDA");
  assert.equal(stale.status, "UNKNOWN");
  assert.equal(stale.reasonCode, "EXECUTION_OWNERSHIP_AUTHORITY_STALE");
  assert.equal(stale.authoritative, false);
});

test("PRETRADE derives FREE and OWNED server-side from canonical Execution store content", async () => {
  const authority = new PreTradeExecutionOwnershipAuthority({
    filePath: tempFile(),
    clock: () => "2026-09-06T20:00:00.500Z",
  });
  authority.load();
  const result = authority.publish(publication(canonicalStore({
    candidates: [{ originalPlan: { symbol: "NVDA" }, v24: { handoffId: "h-1" } }],
  })));
  assert.deepEqual(result.ownedSymbols, ["NVDA"]);

  const provider = new PreTradeExecutionOwnershipProvider({ resolver: (symbol) => authority.resolveSymbol(symbol) });
  const owned = await provider.checkSymbol("nvda");
  assert.equal(owned.status, "OWNED");
  assert.equal(owned.authoritative, true);
  assert.equal(owned.storeRevision, 7);
  assert.equal(owned.source, "EXECUTION_CANONICAL_STORE");

  const free = await provider.checkSymbol("AMD");
  assert.equal(free.status, "FREE");
  assert.equal(free.authoritative, true);
  assert.equal(free.storeRevision, 7);
});

test("malformed or incomplete Execution snapshots cannot normalize missing ownership evidence into FREE", () => {
  const missingLiveTrades = canonicalStore();
  delete missingLiveTrades.liveTrades;
  const invalidStores = [
    missingLiveTrades,
    canonicalStore({ storeSchemaVersion: 999 }),
    canonicalStore({ storeRevision: -1 }),
    canonicalStore({ candidates: null }),
    canonicalStore({ v24Lifecycles: {} }),
    canonicalStore({ draft: "not-a-draft-object" }),
  ];

  for (const store of invalidStores) {
    const authority = new PreTradeExecutionOwnershipAuthority({ filePath: tempFile() });
    authority.load();
    assert.throws(
      () => authority.publish(publication(store)),
      (error) => error.code === "EXECUTION_OWNERSHIP_STORE_INVALID",
    );
  }
});

test("browser may publish canonical store evidence but may not supply FREE/OWNED derived fields", () => {
  const authority = new PreTradeExecutionOwnershipAuthority({ filePath: tempFile() });
  authority.load();
  assert.throws(
    () => authority.publish(publication(canonicalStore(), { ownedSymbols: [] })),
    (error) => error.code === "EXECUTION_OWNERSHIP_DERIVED_FIELD_FORBIDDEN",
  );
  assert.throws(
    () => authority.publish(publication(canonicalStore(), { status: "FREE" })),
    (error) => error.code === "EXECUTION_OWNERSHIP_DERIVED_FIELD_FORBIDDEN",
  );
});

test("same store revision with different canonical content fails closed", () => {
  const authority = new PreTradeExecutionOwnershipAuthority({
    filePath: tempFile(),
    clock: () => "2026-09-06T20:00:00.500Z",
  });
  authority.load();
  authority.publish(publication(canonicalStore()));
  assert.throws(
    () => authority.publish(publication(canonicalStore({ candidates: [{ originalPlan: { symbol: "NVDA" } }] }))),
    (error) => error.code === "EXECUTION_OWNERSHIP_REVISION_CONFLICT",
  );
});

test("older Execution store revision is rejected rather than overwriting newer ownership truth", () => {
  const authority = new PreTradeExecutionOwnershipAuthority({
    filePath: tempFile(),
    clock: () => "2026-09-06T20:00:00.500Z",
  });
  authority.load();
  authority.publish(publication(canonicalStore({ storeRevision: 8 })));
  assert.throws(
    () => authority.publish(publication(canonicalStore({ storeRevision: 7 }))),
    (error) => error.code === "EXECUTION_OWNERSHIP_STALE_REVISION",
  );
});

test("heartbeat refreshes server-owned freshness only when revision and store hash match", () => {
  const authority = new PreTradeExecutionOwnershipAuthority({
    filePath: tempFile(),
    clock: clockSequence([
      "2026-09-06T20:00:00.500Z",
      "2026-09-06T20:00:02.000Z",
      "2026-09-06T20:00:02.000Z",
    ]),
  });
  authority.load();
  const first = authority.publish(publication());
  const heartbeat = authority.publish({
    kind: "HEARTBEAT",
    source: EXECUTION_OWNERSHIP_PROJECTION_SOURCE,
    authority: EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY,
    storeKey: "execution-v23-store",
    publisherId: "receiver-1",
    publishedAt: "2026-09-06T19:00:00.000Z",
    storeRevision: first.storeRevision,
    storeHash: first.storeHash,
  });
  assert.equal(heartbeat.receivedAt, "2026-09-06T20:00:02.000Z");
  assert.equal(authority.health().connected, true);

  assert.throws(
    () => authority.publish({
      kind: "HEARTBEAT",
      source: EXECUTION_OWNERSHIP_PROJECTION_SOURCE,
      authority: EXECUTION_OWNERSHIP_PROJECTION_AUTHORITY,
      storeKey: "execution-v23-store",
      publisherId: "receiver-1",
      publishedAt: "2026-09-06T20:00:02.000Z",
      storeRevision: first.storeRevision,
      storeHash: "0".repeat(64),
    }),
    (error) => error.code === "EXECUTION_OWNERSHIP_HEARTBEAT_MISMATCH",
  );
});

test("persisted ownership projection reloads with exact revision and derived symbols", async () => {
  const filePath = tempFile();
  const first = new PreTradeExecutionOwnershipAuthority({
    filePath,
    clock: () => "2026-09-06T20:00:00.500Z",
  });
  first.load();
  first.publish(publication(canonicalStore({
    liveTrades: [{ originalPlan: { symbol: "AMD" }, v24: { handoffId: "h-amd" } }],
  })));

  const reloaded = new PreTradeExecutionOwnershipAuthority({
    filePath,
    clock: () => "2026-09-06T20:00:01.000Z",
  });
  reloaded.load();
  const result = await reloaded.resolveSymbol("AMD");
  assert.equal(result.status, "OWNED");
  assert.equal(result.storeRevision, 7);
  assert.equal(result.authoritative, true);
});

test("tampering persisted derived ownership without matching integrity hash fails closed on startup", () => {
  const filePath = tempFile();
  const authority = new PreTradeExecutionOwnershipAuthority({
    filePath,
    clock: () => "2026-09-06T20:00:00.500Z",
  });
  authority.load();
  authority.publish(publication(canonicalStore({
    candidates: [{ originalPlan: { symbol: "NVDA" }, v24: { handoffId: "h-nvda" } }],
  })));

  const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
  persisted.projection.ownedSymbols = [];
  fs.writeFileSync(filePath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  const reloaded = new PreTradeExecutionOwnershipAuthority({ filePath });
  assert.throws(
    () => reloaded.load(),
    (error) => error.code === "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY",
  );
});

test("corrupt persisted ownership authority fails closed on startup", () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, updatedAt: null, projection: { status: "FREE" } }), "utf8");
  const authority = new PreTradeExecutionOwnershipAuthority({ filePath });
  assert.throws(
    () => authority.load(),
    (error) => error.code === "CORRUPT_EXECUTION_OWNERSHIP_AUTHORITY",
  );
});
