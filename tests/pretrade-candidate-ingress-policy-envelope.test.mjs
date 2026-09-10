import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import {
  AUTOMATED_UNTOUCHED_ONLY,
  PreTradeCandidateIngress,
} from "../schwab-bridge/pretrade-candidate-ingress.mjs";

function candidate() {
  return {
    candidateId: "sod-2026-09-09-amd-vwap-reclaim-long",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-09",
    generatedAt: "2026-09-09T14:00:00.000Z",
    symbol: "AMD",
    direction: "LONG",
    setup: "VWAP reclaim continuation",
    timeframe: "2m",
    thesis: "Continuation after confirmed VWAP reclaim.",
    trigger: { type: "MANUAL_CONFIRMATION", prompt: "Confirm reclaim" },
    structuralInvalidation: {
      price: 160,
      rule: "acceptance below reclaim structure",
      referenceType: "SWING_LOW",
      reason: "long thesis invalid below reclaim structure",
    },
    targets: [162, 164],
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-09T13:30:00.000Z",
      validUntil: "2026-09-09T20:00:00.000Z",
      timezone: "America/Denver",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
  };
}

function createIngress() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-policy-envelope-"));
  const store = new PreTradeStore({ filePath: path.join(dir, "state.json") });
  store.load();
  return {
    store,
    ingress: new PreTradeCandidateIngress({
      store,
      clock: () => "2026-09-09T14:01:00.000Z",
      idFactory: () => "policy-envelope-event-1",
    }),
  };
}

test("immutable bundle envelope carries restrictive automated ingress policy through normal import call", () => {
  const { store, ingress } = createIngress();
  const result = ingress.importBundle({
    source: "SOD_A_PLUS_TRADES",
    bundleId: "sod-2026-09-09-a-plus-trades-v1",
    ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
    candidates: [candidate()],
  });

  assert.equal(result.ingressPolicy, AUTOMATED_UNTOUCHED_ONLY);
  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(store.snapshot().candidates[0].lifecycleState, "WAITING");
  assert.equal(
    store.snapshot().candidates[0].lifecycleJournal.events[0].provenance.ingressPolicy,
    AUTOMATED_UNTOUCHED_ONLY,
  );
});

test("unsupported policy in immutable bundle envelope fails closed before mutation", () => {
  const { store, ingress } = createIngress();

  assert.throws(
    () => ingress.importBundle({
      source: "SOD_A_PLUS_TRADES",
      bundleId: "unsafe-policy",
      ingressPolicy: "AUTOMATED_REPLACE_ANYTHING",
      candidates: [candidate()],
    }),
    (error) => error.code === "INVALID_INGRESS_POLICY",
  );
  assert.equal(store.snapshot().candidates.length, 0);
});
