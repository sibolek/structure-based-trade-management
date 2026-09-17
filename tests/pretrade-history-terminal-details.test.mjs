import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPretradeApiClient } from "../src/pretrade/pretrade-api-client.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("History renders persisted terminal note, timestamp, source, and reason code", () => {
  const workspace = source("src/components/PreTradeWorkspace.jsx");
  assert.match(workspace, /function dateTime\(/);
  assert.match(workspace, /candidate\.terminalOutcome/);
  assert.match(workspace, /terminal\?\.note/);
  assert.match(workspace, /terminal\?\.occurredAt/);
  assert.match(workspace, /terminal\?\.source/);
  assert.match(workspace, /terminal\?\.reasonCode/);
  assert.match(workspace, />When</);
  assert.match(workspace, /Source: \{source\}/);
  assert.match(workspace, /reasonNote \|\| readableCode\(reasonCode\)/);
});

test("operator invalidation sends structured reason metadata without changing authority", async () => {
  const requests = [];
  const client = createPretradeApiClient({
    baseUrl: "http://127.0.0.1:8788",
    idFactory: () => "history-test",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, status: 200, async json() { return {}; } };
    },
  });
  const candidate = {
    candidateId: "mes-history-test",
    contractVersion: 1,
    lifecycleState: "WAITING",
    stateRevision: 4,
  };

  await client.invalidate(candidate, {
    reasonCode: "SETUP_CONDITION_NO_LONGER_VALID",
    note: "Setup condition no longer valid.",
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/commands\/invalidate$/);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.expectedState, "WAITING");
  assert.equal(body.expectedRevision, 4);
  assert.equal(body.source, "OPERATOR");
  assert.equal(body.reasonCode, "SETUP_CONDITION_NO_LONGER_VALID");
  assert.equal(body.note, "Setup condition no longer valid.");
  assert.equal("tradeAuthorization" in body, false);
});
