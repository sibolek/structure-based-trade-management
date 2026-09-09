import assert from "node:assert/strict";
import test from "node:test";

import {
  SOD_LINEAGE_NEW,
  SOD_LINEAGE_REVISED,
  SOD_LINEAGE_UNCHANGED,
} from "../schwab-bridge/sod-candidate-lineage.mjs";
import {
  publicationIntentForLineage,
  SOD_PUBLICATION_EXACT_REPLAY,
  SOD_PUBLICATION_NEW,
  SOD_PUBLICATION_PRETRADE_PREFLIGHT_REQUIRED,
} from "../schwab-bridge/sod-publication-intent.mjs";

function lineage(classification, contractVersion = 1) {
  return {
    classification,
    candidateId: "sod-2026-09-09-nvda-vwap-reclaim-long",
    contractVersion,
  };
}

test("NEW lineage maps to new publication while PRETRADE remains final authority", () => {
  const result = publicationIntentForLineage(lineage(SOD_LINEAGE_NEW));
  assert.equal(result.publicationIntent, SOD_PUBLICATION_NEW);
  assert.equal(result.pretradePreflightRequired, false);
  assert.equal(result.finalAuthority, "PRETRADE");
});

test("UNCHANGED lineage maps to exact replay and never implies supersession", () => {
  const result = publicationIntentForLineage(lineage(SOD_LINEAGE_UNCHANGED, 3));
  assert.equal(result.publicationIntent, SOD_PUBLICATION_EXACT_REPLAY);
  assert.equal(result.contractVersion, 3);
  assert.equal(result.pretradePreflightRequired, false);
  assert.equal(result.finalAuthority, "PRETRADE");
});

test("REVISED lineage requires PRETRADE supersession preflight instead of claiming eligibility", () => {
  const result = publicationIntentForLineage(lineage(SOD_LINEAGE_REVISED, 2));
  assert.equal(result.publicationIntent, SOD_PUBLICATION_PRETRADE_PREFLIGHT_REQUIRED);
  assert.equal(result.pretradePreflightRequired, true);
  assert.equal(result.finalAuthority, "PRETRADE");
});

test("publication intent refuses unresolved or unknown lineage", () => {
  assert.throws(
    () => publicationIntentForLineage({ classification: SOD_LINEAGE_NEW, candidateId: "", contractVersion: 1 }),
    (error) => error.code === "SOD_PUBLICATION_INTENT_INVALID",
  );
  assert.throws(
    () => publicationIntentForLineage(lineage("MAGIC", 1)),
    (error) => error.code === "SOD_PUBLICATION_INTENT_INVALID",
  );
});
