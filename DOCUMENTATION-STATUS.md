# ExecutionOS Documentation Status

**Updated:** 2026-08-31

This file distinguishes current authoritative project records from historical planning snapshots and dated approval artifacts.

## Current authoritative records

### `USER-GUIDE.md`

The **living operator guide** for ExecutionOS as it exists operationally. This remains the primary day-to-day reference for installation, Schwab authorization, session startup, candidate creation, risk sizing, ARMED/LIVE behavior, broker binding, VALID/THREATENED/INVALID state use, persistence, troubleshooting, security, command-line operation, and the complete enriched End-of-Day reporting workflow.

Update the User Guide whenever normal operator procedure, broker integration, risk fields, lifecycle semantics, persistence, supported instruments, safety boundaries, EOD procedure, or CLI surface changes.

Phase 3 DSS closeout did not yet change the downstream V2.3 operator execution workflow, so no User Guide rewrite is required solely to record Phase 3 acceptance.

### `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md`

The **authoritative top-level V2.4 design baseline**.

It records the approved pre-trade architecture, candidate-source boundary, lifecycle, Phase 3 DSS design, Phase 3→Phase 4 handoff, later context/decision-gate concepts, and ARM boundary.

Its approval-time statements that Phase 3 implementation was not yet authorized are a dated approval snapshot. Do not rewrite that approved-design artifact merely to erase what was true when it was approved.

Later implementation status is recorded by a phase closeout/acceptance document.

### `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md`

The **authoritative Phase 3 implementation/acceptance record**.

It records:

- implemented DSS scope;
- frozen 2m Wilder ATR(14) / RTH-only / `ATR × 0.30` policy;
- effective-stop and protective-rounding behavior;
- immutable DSS evaluation and lifecycle semantics;
- live Schwab input assembly and instrument-metadata handling;
- Reg NMS price-increment fallback and the 2026-11-02 variable-MPI cutoff;
- production permission-service integration;
- live NVDA read-only DSS proof;
- candidate import → persistence → PRE-TRADE Waiting Candidate Board smoke acceptance;
- final deterministic Phase 3 acceptance gate;
- explicit no-sizing / no-READY / no-ARM / no-broker-write boundary;
- exact Phase 3→Phase 4 handoff.

For the question “what did Phase 3 actually implement and validate?”, use this closeout record rather than the older implementation-status statement embedded in the approved design baseline.

### `docs/ExecutionOS_EOD_Report.md`

The dedicated operational/technical reference for the read-only EOD reporter added after the frozen V2.3.0 release baseline.

It defines Schwab broker-authoritative trade-cycle reconstruction, browser-History enrichment, ownership matching, planned-risk and realized-R interpretation, carry-in protection, metrics, HTML output, and validation expectations.

For normal operator sequencing, defer to `USER-GUIDE.md`; for EOD-specific implementation/interpretation detail, use this document.

### ExecutionOS Management Governor Project Specification v1.2

The architecture/project decision record dated 26 August 2026 after analytics preservation.

Its embedded repository SHA, PR status, and pre-release sequencing are **historical snapshots of that date**. Do not rewrite v1.2 merely to make those dated fields agree with later merges, tagging, EOD reporting, or V2.4 work.

A future project-wide architecture revision should be created as a new specification version rather than silently rewriting v1.2.

### `research/30-day-management-study/methodology.md`

Authoritative technical provenance for the preserved historical study, including what was recovered, inferred, validated, or left unresolved.

### Root `README.md`

Current project/operational overview. Defer to the User Guide for operator procedure, to the V2.4 design baseline for V2.4 architecture, and to phase closeout records for phase acceptance status.

### `docs/ExecutionOS_Documentation_Index.md`

The cross-document inventory and authority map. Update it when major project records, phase status, release states, or pull-request milestones change.

## Current implementation / release state

The frozen downstream execution release remains:

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

At the 2026-08-31 Phase 3 closeout, current `main` is:

```text
88cbac95381c2e0292cfea8fd7f4844100600ab7
```

V2.4 status at that checkpoint:

- Phase 1 Candidate Ingestion — **COMPLETE / MERGED**;
- Phase 2 MarketDataProvider — **COMPLETE / MERGED / LIVE-ACCEPTED**;
- Phase 3 DSS / Micro-Volatility Buffer — **IMPLEMENTATION COMPLETE / ACCEPTED on `v24-dss-phase3`; not yet merged**;
- Phase 4 Effective-Stop Risk Sizing — **NOT YET IMPLEMENTED**;
- later READY/CAUTION/PASS and ARM work — **NOT YET IMPLEMENTED**.

Final Phase 3 local acceptance gate:

```text
v24:dss-test       91/91 PASS
analytics:test     123/123 PASS
schwab:state-test  10/10 PASS
production build   PASS
```

A live read-only NVDA DSS probe returned `VALID` and a correctly protected effective stop from real Schwab market data. A separate synthetic candidate was accepted through the actual candidate-import API and visibly rendered in the PRE-TRADE Waiting Candidate Board.

A WAITING candidate has **not** yet crossed into the existing V2.3 Execution Board; that remains intentionally gated behind later permission, READY, and ARM work.

V3 has not started.

## Historical / superseded records

### `V2-MILESTONE-1.md`

**Historical design record.** It documents the original V2 Milestone 1 stateful execution prototype before the broker-aware V2.3 system existed. Retained for architecture history; not current operating documentation.

### `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf`

**Historical planning snapshot — superseded by later validated behavior and later design/acceptance records.**

Its Monday live-test instructions and “still to test” sections are intentionally preserved because they record what was known at that time.

### Project Specification v1.0 / v1.1

Preserved historical specifications. v1.1 remains useful as a post-V2.3-validation rebaseline; v1.2 supersedes it for the dated architecture/analytics record.

### Project Specification v1.2 repository-status fields

The architecture/design content remains authoritative for the decisions it records, but its embedded branch SHA / open-PR / untagged-release status is a **dated snapshot**, not current repository state.

### V2.4 Design Baseline v0.4 approval-time implementation status

The V2.4 design baseline remains authoritative for design. Its statement that Phase 3 implementation was not yet authorized is retained as approval-time history and is superseded **only for implementation status** by the Phase 3 closeout record.

## Pull requests as project records

- **PR #1** — V2.3 execution system.
- **PR #2** — analytics preservation.
- **PR #3** — preservation of useful pre-V2 execution-discipline Markdown.
- **PR #4** — history-only reconciliation.
- **PR #5** — V2.3 release-documentation closeout.
- **PR #6** — post-merge V2.3 documentation finalization.
- **PR #7** — read-only ExecutionOS End-of-Day reporting; historical merge commit `bedd70979a3b18844386bcf8f927fd8a1f62307f`.

Later V2.4 merges advanced `main` beyond that historical PR #7 state. Use current repository history and the Documentation Index for present branch/main status.

## Documentation rule

Do not rewrite historical or approved dated documents merely because later evidence changed project state. Preserve dated snapshots and add a new specification revision, closeout record, or status entry as appropriate.

When a change affects day-to-day operation, update the User Guide as part of the same documentation closeout.

When a change implements an approved architecture phase without changing the approval artifact itself, create a formal implementation/acceptance record and update this status file plus the Documentation Index.

When a change affects project-wide architecture beyond the scope of the existing dated specification, create a new specification revision rather than silently rewriting the old one.
