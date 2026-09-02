# ExecutionOS V2.4 — Execution Board Handoff Integration
## Design Addendum v0.3 — APPROVED

**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Parent authorities:**
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.1_APPROVED.md`
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.2_APPROVED.md`

**Status:** **APPROVED — DECISION 13 FROZEN**

---

## 1. Purpose

This addendum freezes Decision 13. It closes the execution-history completeness gap discovered while designing the pre-install broker-cleanliness evaluator.

The bounded recent-executions list exposed by the live broker API is useful for UI inspection, but it is not authoritative proof that no same-symbol execution occurred after a V2.4 authorization. Safety decisions therefore require separate lossless execution-activity provenance for the current contiguous monitor-coverage interval.

The governing handoff boundary remains:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Nothing in this addendum authorizes broker writes.

---

## 2. Decision 13 — Execution-time authority and lossless activity proof

### 2.1 Approved invariant

> **Broker clean-interval and V2.4 fill-ownership timing use Schwab `executionTime` as the authoritative event timestamp; `detectedAt` is audit provenance only. The bounded recent-executions UI list must never be used as proof of execution-history completeness. The monitor maintains a lossless account+symbol execution-activity watermark for the current contiguous coverage interval. That activity proof resets whenever continuous coverage is lost. Missing or invalid execution-time provenance fails closed as insufficient execution coverage.**

### 2.2 Timestamp authority

For clean-interval comparison:

```text
executionTime >= authorizedAt
```

means the broker execution occurred inside the authorization-to-install interval and therefore blocks installation.

`detectedAt` records when ExecutionOS observed the fill. It may be used for latency/audit diagnostics, but it is not the event-time authority for admission or fill ownership.

The same event-time rule is intended for downstream V2.4 fill matching:

```text
executionTime >= executionListeningAt
```

No fill may become eligible merely because it was detected after the ownership boundary if Schwab reports that the fill itself occurred before that boundary.

### 2.3 Lossless activity watermark

The live broker state must maintain safety provenance independently of the bounded recent-executions UI list.

Conceptually:

```text
executionActivity {
    schemaVersion
    source
    coverageStartedAt
    currentThrough
    entries: [
        {
            accountId
            symbol
            latestExecutionTime
            latestDetectedAt
        }
    ]
}
```

There is at most one current entry per exact opaque account ID + normalized symbol pair.

For the admission question “has any execution occurred in this symbol since `authorizedAt`?”, retaining the latest authoritative execution timestamp per account+symbol is lossless: if the latest execution is earlier than `authorizedAt`, no later execution exists in the proven interval; if it is equal to or later than `authorizedAt`, intervening activity exists.

This safety provenance is not truncated merely to keep the UI compact.

### 2.4 Coverage alignment and reset

The activity proof is valid only for the same current contiguous observation interval represented by broker execution coverage.

When coverage is lost:

```text
CONTIGUOUS → GAP
```

the account+symbol activity proof is invalidated/reset for admission purposes.

On the first successful poll after a gap, the monitor begins a new continuous proof interval at the new `coverageStartedAt`. It must not carry pre-gap activity-watermark completeness claims into the recovered interval.

An authorization older than the recovered `coverageStartedAt` therefore fails the clean-interval gate with:

```text
BROKER_EXECUTION_COVERAGE_GAP
```

### 2.5 Missing or invalid execution time

If Schwab reports an execution that cannot be assigned a valid authoritative `executionTime`, ExecutionOS cannot prove whether that activity occurred before or after a relevant authorization/listening boundary.

The monitor must fail closed and break execution-history coverage rather than silently substituting `detectedAt` or another timestamp.

Admission consequence:

```text
BROKER_EXECUTION_COVERAGE_GAP
```

No `last`, local detection time, order-entered time, or inferred timestamp may substitute for missing authoritative execution time.

### 2.6 Recent execution list remains UI-only

The existing bounded `executions` list may remain capped for dashboard usability.

Permanent distinction:

```text
recent executions list
    = UI / human inspection

execution activity watermark
    = safety / ownership proof
```

The admission evaluator must use the activity watermark, never infer completeness from the number or age of records remaining in the recent-executions list.

---

## 3. Interaction with Decision 12

Decision 12 remains unchanged:

- exact Phase 4 account determines which account may own the trade;
- symbol cleanliness is global across all connected accounts;
- any current same-symbol position blocks;
- any same-symbol execution since `authorizedAt` blocks.

Decision 13 supplies the authoritative, non-truncating evidence used to prove the execution-activity portion of that gate.

For the authorized account:

```text
INTERVENING_BROKER_ACTIVITY
```

For a different observed account:

```text
WRONG_ACCOUNT_EXECUTION_OBSERVED
```

---

## 4. Implementation consequences

The next implementation increment must include:

1. a validated execution-activity provenance contract;
2. account+symbol latest-execution watermark maintenance;
3. activity-proof reset on monitor coverage gap/recovery;
4. rejection of missing/invalid Schwab execution time as a coverage failure;
5. live broker state exposure of the activity proof separately from the bounded recent-execution list;
6. a pure pre-install admission evaluator using exact account, broker health, coverage, activity watermark, global positions, and existing local symbol ownership;
7. deterministic tests for every admission failure reason and successful admission;
8. no browser installation or broker-write behavior until the evaluator is accepted.

---

## 5. Safety boundary

Decision 13 does not authorize order placement, modification, cancellation, replacement, stop movement, or automatic flattening.

The Schwab integration remains read-only.

---

## 6. Approval

Decision 13 was explicitly approved by the user on 2026-09-02 and is frozen by this addendum.
