import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTriggerContract,
  triggerObservationTypes,
  triggerRequiresManualConfirmation,
} from "../schwab-bridge/pretrade-trigger-contract.mjs";

test("manual shorthand normalizes to versioned one-shot satisfaction contract", () => {
  const { normalized, errors } = normalizeTriggerContract({
    type: "MANUAL_CONFIRMATION",
    evaluatorVersion: 1,
    prompt: "Confirm H2 signal",
  });
  assert.deepEqual(errors, []);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.evaluatorVersion, 1);
  assert.equal(normalized.relevance, null);
  assert.equal(normalized.satisfaction.type, "MANUAL_CONFIRMATION");
  assert.equal(normalized.satisfaction.nodeId, "satisfaction");
  assert.equal(normalized.persistence.type, "ONE_SHOT");
  assert.equal(triggerRequiresManualConfirmation(normalized), true);
});

test("quote relevance and completed-bar satisfaction preserve distinct observation semantics", () => {
  const { normalized, errors } = normalizeTriggerContract({
    evaluatorVersion: 1,
    relevance: { type: "QUOTE_COMPARISON", side: "last", operator: "gte", value: 99 },
    satisfaction: { type: "BAR_CLOSE_COMPARISON", timeframe: "2m", operator: "GTE", value: 100 },
    persistence: { type: "BAR_BOUND", timeframe: "2m" },
  });
  assert.deepEqual(errors, []);
  assert.equal(normalized.relevance.observationType, "QUOTE_EVENT");
  assert.equal(normalized.satisfaction.observationType, "BAR_CLOSE");
  assert.equal(normalized.persistence.type, "BAR_BOUND");
  assert.deepEqual([...triggerObservationTypes(normalized.relevance)], ["QUOTE_EVENT"]);
  assert.deepEqual([...triggerObservationTypes(normalized.satisfaction)], ["BAR_CLOSE"]);
});

test("compound ALL_OF may combine deterministic and manual satisfaction nodes", () => {
  const { normalized, errors } = normalizeTriggerContract({
    evaluatorVersion: 1,
    satisfaction: {
      type: "ALL_OF",
      children: [
        { nodeId: "price", type: "QUOTE_COMPARISON", side: "ASK", operator: "GTE", value: 180 },
        { nodeId: "confirm", type: "MANUAL_CONFIRMATION", prompt: "Confirm structure" },
      ],
    },
    persistence: "ONE_SHOT",
  });
  assert.deepEqual(errors, []);
  assert.equal(normalized.satisfaction.children.length, 2);
  assert.equal(triggerRequiresManualConfirmation(normalized), true);
  assert.deepEqual(new Set(triggerObservationTypes(normalized.satisfaction)), new Set(["QUOTE_EVENT", "MANUAL_EVENT"]));
});

test("manual confirmation cannot manufacture automatic relevance", () => {
  const result = normalizeTriggerContract({
    evaluatorVersion: 1,
    relevance: { type: "MANUAL_CONFIRMATION" },
    satisfaction: { type: "MANUAL_CONFIRMATION" },
  });
  assert.match(result.errors.join(" "), /may not use MANUAL_CONFIRMATION for automatic relevance/);
});

test("unsupported trigger family and evaluator version fail closed", () => {
  let result = normalizeTriggerContract({ type: "RECLAIM_AND_HOLD", level: 180, evaluatorVersion: 1 });
  assert.match(result.errors.join(" "), /not supported/);

  result = normalizeTriggerContract({ type: "MANUAL_CONFIRMATION", evaluatorVersion: 2 });
  assert.match(result.errors.join(" "), /unsupported/);
});

test("quote and bar comparison nodes require explicit deterministic operands", () => {
  let result = normalizeTriggerContract({ type: "QUOTE_COMPARISON", evaluatorVersion: 1, side: "LAST", value: 100 });
  assert.match(result.errors.join(" "), /operator/);

  result = normalizeTriggerContract({ type: "BAR_CLOSE_COMPARISON", evaluatorVersion: 1, operator: "GTE", value: 100 });
  assert.match(result.errors.join(" "), /timeframe/);
});
