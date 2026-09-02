import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const board = source("src/components/V24AuthorizedTradesBoard.jsx");
const modal = source("src/components/V24TradeSpecificationModal.jsx");

test("authorized V2.4 cards advertise and open the full trade specification", () => {
  assert.match(board, /View full trade specification/);
  assert.match(board, /openSpecification\(installation\)/);
  assert.match(board, /V24TradeSpecificationModal/);
  assert.match(board, /role="button"/);
  assert.match(board, /event\.key === "Enter" \|\| event\.key === " "/);
});

test("DISCARD remains independent from card inspection", () => {
  assert.match(board, /event\.stopPropagation\(\);\s*discard\(installation\)/s);
  assert.match(board, /onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("trade specification modal renders the complete trading plan", () => {
  for (const field of [
    "Trade Thesis",
    "Entry Trigger",
    "Expected Entry",
    "Effective Stop",
    "Structural Invalid.",
    "Authorized Qty",
    "Frozen Max Risk",
    "Targets",
    "Management Plan",
    "Authorization Timeline",
  ]) {
    assert.match(modal, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const property of [
    "v24.thesis",
    "v24.trigger",
    "v24.currentExpectedEntry",
    "v24.effectiveStop",
    "v24.structuralInvalidation",
    "v24.selectedQuantity",
    "v24.authorizedMaxDollarRisk",
    "v24.targets",
    "v24.managementPlan",
    "v24.authorizedAt",
    "v24.executionListeningAt",
    "v24.handoffCreatedAt",
  ]) {
    assert.match(modal, new RegExp(property.replace(".", "\\.")));
  }
});

test("technical provenance remains available but visually secondary", () => {
  assert.match(modal, /<details/);
  assert.match(modal, /Technical \/ API Provenance/);

  for (const property of [
    "v24.handoffId",
    "v24.sourceId",
    "v24.candidateId",
    "v24.contractVersion",
    "v24.candidateContentHash",
    "v24.dssEvaluationId",
    "v24.riskEvaluationId",
    "v24.executionBoardReceiverId",
    "v24.authorizedExecutionAccountId",
  ]) {
    assert.match(modal, new RegExp(property.replace(".", "\\.")));
  }
});

test("inspector is explicitly read-only and supports standard close affordances", () => {
  assert.match(modal, /Read-only immutable authorization snapshot/);
  assert.match(modal, /this inspector never modifies broker orders/);
  assert.match(modal, /event\.key === "Escape"/);
  assert.match(modal, /aria-label="Close trade specification"/);
  assert.match(modal, /if \(event\.target === event\.currentTarget\) onClose\?\.\(\)/);
});
