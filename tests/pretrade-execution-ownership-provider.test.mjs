import assert from "node:assert/strict";
import test from "node:test";

import { PreTradeExecutionOwnershipProvider } from "../schwab-bridge/pretrade-execution-ownership-provider.mjs";

test("unconnected execution ownership authority returns UNKNOWN and never guesses FREE", async () => {
  const provider = new PreTradeExecutionOwnershipProvider();
  const result = await provider.checkSymbol(" nvda ");
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reasonCode, "EXECUTION_OWNERSHIP_AUTHORITY_UNAVAILABLE");
  assert.equal(result.symbol, "NVDA");
  assert.equal(result.authoritative, false);
  assert.equal(Object.isFrozen(result), true);
});

test("authoritative FREE and OWNED resolver results are accepted with exact symbol provenance", async () => {
  let status = "FREE";
  const provider = new PreTradeExecutionOwnershipProvider({
    async resolver(symbol) {
      return { status, symbol, source: "EXECUTION_CANONICAL_STORE", authoritative: true, revision: 17 };
    },
  });
  const free = await provider.checkSymbol("NVDA");
  assert.equal(free.status, "FREE");
  assert.equal(free.authoritative, true);
  assert.equal(free.revision, 17);
  status = "OWNED";
  const owned = await provider.checkSymbol("NVDA");
  assert.equal(owned.status, "OWNED");
  assert.equal(owned.authoritative, true);
});

test("FREE or OWNED without authoritative provenance fails closed", async () => {
  const provider = new PreTradeExecutionOwnershipProvider({
    async resolver() { return { status: "FREE", source: "UNTRUSTED" }; },
  });
  await assert.rejects(
    provider.checkSymbol("NVDA"),
    (error) => error.code === "EXECUTION_OWNERSHIP_PROVENANCE_REQUIRED",
  );
});

test("invalid resolver status and missing symbol fail closed", async () => {
  const provider = new PreTradeExecutionOwnershipProvider({
    async resolver() { return { status: "MAYBE", authoritative: true }; },
  });
  await assert.rejects(provider.checkSymbol("NVDA"), (error) => error.code === "EXECUTION_OWNERSHIP_RESULT_INVALID");
  await assert.rejects(provider.checkSymbol(""), (error) => error.code === "EXECUTION_OWNERSHIP_SYMBOL_REQUIRED");
});
