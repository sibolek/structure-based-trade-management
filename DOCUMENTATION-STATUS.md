# ExecutionOS Documentation Status

This file distinguishes current authoritative project records from historical planning snapshots.

## Current authoritative records

### `USER-GUIDE.md`

The **living operator guide** for ExecutionOS as it exists now. This is the primary day-to-day reference for installation, Schwab authorization, session startup, candidate creation, risk sizing, ARMED/LIVE behavior, broker binding, VALID/THREATENED/INVALID state use, persistence, troubleshooting, security, and the complete command-line appendix.

Update this file whenever the normal operating workflow, broker integration, plan/risk fields, lifecycle semantics, persistence model, supported instruments, safety boundaries, or CLI surface changes.

### ExecutionOS Management Governor Project Specification v1.2

The current project/architecture decision record after completion of the analytics-preservation pass. It supersedes v1.1 for current project status while preserving prior versions as historical records.

Key v1.2 additions:

- analytics-preservation completion status;
- recovered 384-trade population and stop-management methodology;
- high-confidence historical R reconstruction with the documented one-trade NVDA threshold discrepancy;
- Schwab historical 1-minute price-history validation;
- explicit conclusion that the exact original 19-trade MFE/counterfactual sample membership is unresolved and should not be curve-fit;
- updated repository sequencing: preservation -> V2.3 closeout -> main reconciliation -> PR #1 update -> merge/tag -> V3.

### `research/30-day-management-study/methodology.md`

Authoritative technical provenance for the preserved historical study, including what was recovered, inferred, validated, or left unresolved.

### Root `README.md`

Current operational overview of ExecutionOS, V2.3 capabilities, Schwab/NinjaTrader architecture, common commands, analytics-preservation status, and development sequence. It links to the living User Guide for detailed operation.

## Historical / superseded records

### `V2-MILESTONE-1.md`

**Historical design record.** It documents the original V2 Milestone 1 stateful execution prototype before the broker-aware V2.3 system existed. Retained for architecture history; not current operating documentation.

### `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf`

**Historical planning snapshot - superseded by Project Specification v1.2.**

This document accurately records the pre-live-test state as of Sunday, 23 Aug 2026. Its Monday live-test instructions and "still to test" sections are intentionally not rewritten because they are evidence of the decision process at that time. Subsequent work validated the Schwab live path, expanded V2.3, and completed the analytics-preservation phase.

### Project Specification v1.0 / v1.1

Preserved historical specifications. v1.1 remains valuable as the post-V2.3-validation rebaseline; v1.2 is authoritative for current analytics provenance and sequencing.

## Pull requests

- **PR #1** - V2 execution-system development. Remains open for final V2.3 closeout/reconciliation; its description should be updated during that closeout phase before release.
- **PR #2** - analytics preservation. Merged into `v2-execution-system` on 2026-08-27 at merge commit `780b2a5`; its conversation remains a provenance record for the recovered historical methodology and unresolved 19-trade boundary.
- **Pre-V2 `main` reconciliation** - useful execution-discipline Markdown from commit `4dd27d1` is preserved as historical source material; its obsolete pre-V2 React/UI wiring is intentionally not imported into V2.3.

## Documentation rule

Do not rewrite historical documents merely because later evidence changed the project state. Preserve them as dated snapshots and point readers to the current authoritative User Guide and Project Specification instead.
