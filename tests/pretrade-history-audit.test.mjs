import assert from "node:assert/strict";
import test from "node:test";
import { projectTerminalHistoryAudit } from "../src/pretrade/pretrade-history-audit.js";

test("terminal history prefers operator note while preserving structured reason, source, and timestamp", () => {
  const audit = projectTerminalHistoryAudit({
    terminalOutcome: {
      state: "INVALIDATED",
      occurredAt: "2026-09-17T14:08:27.000Z",
      source: "OPERATOR",
      reasonCode: "OPERATOR_INVALIDATED",
      note: "Setup condition no longer valid.",
    },
  });

  assert.deepEqual(audit, {
    occurredAt: "2026-09-17T14:08:27.000Z",
    source: "OPERATOR",
    reasonCode: "OPERATOR_INVALIDATED",
    reasonText: "Setup condition no longer valid.",
    displayReason: "Setup condition no longer valid.",
  });
});

test("terminal history falls back to the structured reason when no human note exists", () => {
  const audit = projectTerminalHistoryAudit({
    terminalOutcome: {
      state: "EXPIRED",
      occurredAt: "2026-09-17T15:30:00.000Z",
      source: "VALIDITY_CLOCK",
      reasonCode: "VALIDITY_ENDED",
      note: null,
    },
  });

  assert.equal(audit.displayReason, "VALIDITY_ENDED");
  assert.equal(audit.source, "VALIDITY_CLOCK");
  assert.equal(audit.occurredAt, "2026-09-17T15:30:00.000Z");
});

test("legacy history can recover terminal audit fields from the latest lifecycle event", () => {
  const audit = projectTerminalHistoryAudit({
    lifecycleJournal: {
      events: [
        {
          eventType: "CANDIDATE_INVALIDATED",
          occurredAt: "2026-09-17T14:08:27.000Z",
          source: "SYSTEM",
          reason: "TRIGGER_RELEVANCE_LOST",
        },
      ],
    },
  });

  assert.equal(audit.displayReason, "TRIGGER_RELEVANCE_LOST");
  assert.equal(audit.source, "SYSTEM");
  assert.equal(audit.occurredAt, "2026-09-17T14:08:27.000Z");
});
