# ExecutionOS V2.4 — Post-Phase Operator Walkthrough Reminder

## Purpose

When the current ExecutionOS V2.4 live acceptance / execution-board-handoff phase is formally closed, produce a complete practical operator walkthrough covering the entire pre-trade lifecycle from candidate ingestion through final ARM authorization.

This walkthrough is a required post-phase deliverable and should not be omitted before final release closeout.

## Required Scope

The walkthrough must cover, in order:

1. How an SOD A+ candidate is created and ingested.
2. What `WAITING` means operationally.
3. How and when the operator is notified that a candidate is approaching actionable location.
4. Which chart timeframes the operator should provide at each stage.
5. How trigger confirmation works.
6. How structural invalidation is established and frozen.
7. What Phase 3 DSS checks and what it does not authorize.
8. What Phase 4 risk sizing checks.
9. How `READY`, `CAUTION`, and `PASS` are determined.
10. How the authoritative review package works.
11. When and how quantity is explicitly selected.
12. What must be revalidated immediately before ARM.
13. What Execution ownership means and why stale or unknown ownership fails closed.
14. Exactly what the operator confirms at ARM.
15. What fact changes force a new review, block ARM, or require a fresh candidate.
16. What happens when price moves away from the planned setup location.
17. What happens when a candidate expires.
18. What happens after ARM and when authority transfers to the Execution Board.

## Required Presentation

The walkthrough should be practical and operator-facing rather than architecture-only.

For every stage, clearly separate:

- **What the operator does**
- **What ExecutionOS does automatically**
- **What can block or invalidate the stage**
- **What evidence / chart context should be available**

End with a concise live-trading checklist that can be used during an actual trading session without requiring the operator to remember the full architecture.

## Chart-Timeframe Guidance to Include

### SOD A+ candidate creation

- Futures (MES / MNQ): `4H → 1H → 15m → 5m`
- Equities: `Daily → 4H → 30m → 5m`

### Pre-ARM qualification / trigger confirmation

- `15m + 5m + 2m`
- Use these before ARM, when price is approaching the planned location or when the operator believes the trigger may have occurred.
- If material time or price movement occurs between READY/review and ARM, obtain a fresh `5m + 2m` look before final ARM.

## Usability Gap to Address

ExecutionOS currently lacks a dedicated candidate-proximity alert for price approaching `bestLocation` / trigger location while the candidate is still `WAITING`.

Post-phase follow-up should include a design for:

- prominent in-app proximity alert
- audible alert
- browser notification when ExecutionOS is not the active tab

The purpose is to notify the operator **before the trigger** so there is time to open the `15m / 5m / 2m` charts and assess the setup before permission and ARM.

## Core Principle

The walkthrough must make this distinction explicit:

> SOD charts establish the candidate thesis and planned location. Fresh 15m/5m/2m charts qualify the setup before ARM. Post-ARM charts are for execution and management, not for deciding whether the candidate deserved to be armed.

## Completion Condition

Do not consider the post-phase operator documentation complete until:

- the full walkthrough has been delivered,
- the operator-vs-automation responsibilities are explicit,
- the live checklist is included,
- the proximity-alert gap is documented for implementation follow-up.
