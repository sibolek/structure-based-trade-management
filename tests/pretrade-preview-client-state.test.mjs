import assert from "node:assert/strict";
import test from "node:test";
import { acceptPreviewAndObserve, mergePreviewObservation } from "../src/pretrade/pretrade-preview-client-state.js";
import { createPretradeApiClient } from "../src/pretrade/pretrade-api-client.js";

const preview = { previewId: "p1", operationId: "o1", proposalHash: "h1", accountScope: "a1", state: "PREVIEW_READY" };

test("lost POST response preserves original operation and blocks success-like discard", async () => {
  const observations = [];
  const client = { acceptPreview: async () => { throw new TypeError("network lost"); } };
  await assert.rejects(acceptPreviewAndObserve(client, preview, value => observations.push(value)));
  const last = observations.at(-1);
  assert.equal(last.outcomeUnknown, true);
  assert.equal(last.preview.operationId, "o1");
  assert.equal(last.operation.state, "ACCEPTING");
});

test("durable response survives a failed status fetch and an older polling response", async () => {
  const observations = [];
  const receipt = { operationId: "o1", result: "ADMITTED", receiptId: "r1" };
  const client = { acceptPreview: async () => receipt, previewStatus: async () => { throw new TypeError("GET failed"); } };
  await assert.rejects(acceptPreviewAndObserve(client, preview, value => observations.push(value)));
  const last = observations.at(-1);
  assert.deepEqual(last.receipt, receipt);
  assert.equal(last.outcomeUnknown, false);
  assert.deepEqual(mergePreviewObservation(last, { preview, operation: { state: "UNSTARTED" } }), last);
});

test("malformed successful acceptance JSON produces outcome unknown without allocating another operation", async () => {
  const urls = [];
  const client = createPretradeApiClient({ baseUrl: "http://test.invalid", fetchImpl: async url => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => url.endsWith("/session") ? { sessionToken: "s" } : null };
  } });
  await assert.rejects(client.acceptPreview(preview), { code: "OUTCOME_UNKNOWN" });
  assert.equal(urls.length, 2);
});
