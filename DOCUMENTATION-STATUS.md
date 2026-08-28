# ExecutionOS Documentation Status

This file distinguishes current authoritative project records from historical planning snapshots.

## Current authoritative records

### `USER-GUIDE.md`

The **living operator guide** for ExecutionOS as it exists now. This is the primary day-to-day reference for installation, Schwab authorization, session startup, candidate creation, risk sizing, ARMED/LIVE behavior, broker binding, VALID/THREATENED/INVALID state use, persistence, troubleshooting, security, command-line operation, and the complete enriched End-of-Day reporting workflow.

The User Guide must be updated whenever the normal operating workflow, broker integration, plan/risk fields, lifecycle semantics, persistence model, supported instruments, safety boundaries, EOD reporting procedure, or CLI surface changes.

### `docs/ExecutionOS_EOD_Report.md`

The dedicated operational/technical reference for the read-only EOD reporter added after the frozen V2.3.0 release baseline.

It defines:

- Schwab broker-authoritative trade-cycle reconstruction;
- the ExecutionOS browser-History export used for enrichment;
- ownership matching rules;
- planned-risk and realized-R interpretation;
- carry-in / closing-first context protection;
- gross profit factor versus average win/loss factor;
- HTML output and validation expectations.

For normal operator sequencing, defer to `USER-GUIDE.md`; for EOD-specific implementation/interpretation detail, use this document.

### ExecutionOS Management Governor Project Specification v1.2

The architecture/project decision record dated 26 August 2026 after analytics preservation.

Its embedded repository SHA, PR status, and pre-release sequencing are **historical snapshots of that date**. Do not rewrite v1.2 merely to make those dated fields agree with later merges, tagging, or the EOD reporting addition.

A future architecture revision should be created as a new specification version rather than silently rewriting v1.2.

### `research/30-day-management-study/methodology.md`

Authoritative technical provenance for the preserved historical study, including what was recovered, inferred, validated, or left unresolved.

### Root `README.md`

Current operational overview of ExecutionOS, the frozen V2.3.0 execution release, current `main`, Schwab/NinjaTrader architecture, EOD reporting, common commands, analytics-preservation status, and current development sequence.

### `docs/ExecutionOS_Documentation_Index.md`

Cross-document inventory and authority map. Update it when major project records, release states, or pull-request milestones change.

## Current implementation / release state

The frozen execution release is:

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

Current `main` includes that execution baseline plus the subsequently merged read-only EOD reporting workflow.

PR #7 merged EOD reporting into `main` at:

```text
bedd70979a3b18844386bcf8f927fd8a1f62307f
```

V3 has not started.

## Historical / superseded records

### `V2-MILESTONE-1.md`

**Historical design record.** It documents the original V2 Milestone 1 stateful execution prototype before the broker-aware V2.3 system existed. Retained for architecture history; not current operating documentation.

### `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf`

**Historical planning snapshot — superseded by later validated behavior and Project Specification v1.2.**

Its Monday live-test instructions and “still to test” sections are intentionally preserved because they record what was known at that time.

### Project Specification v1.0 / v1.1

Preserved historical specifications. v1.1 remains useful as a post-V2.3-validation rebaseline; v1.2 supersedes it for the dated architecture/analytics record.

### Project Specification v1.2 repository-status fields

The architecture/design content remains authoritative for the decisions it records, but its embedded branch SHA / open-PR / untagged-release status is a **dated snapshot**, not current repository state.

## Pull requests as project records

- **PR #1** — V2.3 execution system. Merged into `main` on 2026-08-27.
- **PR #2** — analytics preservation. Preserves the recovered historical methodology and unresolved 19-trade boundary.
- **PR #3** — preserved useful pre-V2 execution-discipline Markdown without importing obsolete pre-V2 React/UI wiring.
- **PR #4** — reconciled `main` history into the V2.3 lineage with no V2.3 tree-content changes.
- **PR #5** — completed V2.3 release-documentation closeout before the final release merge.
- **PR #6** — post-merge V2.3 documentation finalization.
- **PR #7** — read-only ExecutionOS End-of-Day reporting. Merged into `main` at `bedd70979a3b18844386bcf8f927fd8a1f62307f` after deterministic, real-data, and HTML validation.

## Documentation rule

Do not rewrite historical documents merely because later evidence changed project state. Preserve dated snapshots and point readers to the current User Guide, README, Documentation Index, EOD reference, and current code/validated behavior.

When a change affects day-to-day operation, update the User Guide as part of the same documentation closeout.

When a change affects architecture or a major project decision, create a new specification revision if the old specification is a dated historical record.
