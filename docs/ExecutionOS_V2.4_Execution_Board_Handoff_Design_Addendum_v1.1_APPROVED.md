# ExecutionOS V2.4 — Execution Board Handoff Integration
## Design Addendum v1.1 — APPROVED

**Decision:** 21  
**Title:** Full Trade Specification Inspector  
**Status:** APPROVED  
**Date:** 2026-09-02

---

## Decision 21 — Full Trade Specification Inspector

### Problem

The compact V2.4 Authorized Trades card correctly exposes operational authorization state, but it intentionally renders only a subset of the immutable handoff specification. During the synthetic dashboard E2E, the operator could see symbol, direction, setup, timeframe, account, expected entry, effective stop, structural invalidation, authorized quantity, and frozen max risk, but not the full thesis, trigger, targets, management plan, authorization timeline, or technical provenance.

The missing information was not lost in transport. The full specification already exists in the immutable V2.4 compatibility envelope stored with the local installation. The deficiency is presentation-only.

### Approved behavior

1. **Compact card remains compact.**
   - The V2.4 Authorized Trades card remains optimized for fast operational scanning.
   - It continues to show status, symbol, direction, setup, timeframe, account, expected entry, effective stop, structural invalidation, quantity, and frozen max risk.

2. **Clicking the card opens a read-only modal inspector.**
   - Mouse click opens the inspector.
   - Keyboard Enter/Space opens the inspector.
   - The card visually communicates that it is inspectable.
   - The existing DISCARD control remains an independent action and must not open the inspector.

3. **Trading information is visually primary.**
   The modal prominently renders:
   - symbol;
   - direction;
   - current authorization/listener status;
   - setup;
   - timeframe;
   - authorized execution account display;
   - trade thesis;
   - complete trigger object supplied by the V2.4 handoff;
   - current expected entry;
   - effective stop;
   - structural invalidation;
   - authorized quantity;
   - frozen maximum dollar risk;
   - all targets;
   - management plan;
   - authorization, execution-listening, and handoff-created timestamps.

4. **Technical provenance is preserved but visually secondary.**
   A collapsed `Technical / API Provenance` section exposes the immutable audit fields, including:
   - handoff ID;
   - source ID;
   - candidate ID;
   - contract version;
   - candidate content hash;
   - DSS evaluation ID;
   - risk evaluation ID;
   - Execution Board receiver ID;
   - exact authorized execution account ID.

5. **Inspector is strictly read-only.**
   - It introduces no mutation path.
   - It does not alter the handoff, compatibility envelope, local installation, broker state, or broker orders.
   - Changes to an authorized trade remain governed by the future Revise → Re-arm workflow.
   - V2.4 authorization-bearing provenance remains immutable.

6. **Close behavior.**
   - Close button (`X`).
   - Escape key.
   - Backdrop click.

### Architectural boundary

Decision 21 requires **no change** to the handoff API, handoff contract, broker adapter, admission rules, runtime router, activation protocol, ownership rules, retirement protocol, or Schwab read-only boundary.

It is a React presentation layer over the already-frozen `installation.compatibility.v24` envelope.

### Safety invariant

> **Inspecting an authorized trade can never create, replace, cancel, modify, reduce, or flatten a broker order.**

The broker-write authority remains false.
