# ExecutionOS V2.4 — Execution Board Handoff Integration
## Implementation Status — 2026-09-02

**Branch:** `v24-execution-board-handoff`  
**Design authority:** `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`  
**Approved addenda:** Decisions 10–20 in addenda v0.1–v1.0  
**Overall status:** **IN PROGRESS — DECISIONS 10–20 ACCEPTED; NEXT: SYNTHETIC DASHBOARD E2E WITH V2.4 RUNTIME ROUTER EXPLICITLY ENABLED; LIVE ROUTER FEATURE GATE REMAINS DEFAULT OFF**

---

## 1. Governing boundary

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Broker order placement, modification, cancellation, stop replacement, automatic reduction, or automatic flattening remain **NOT AUTHORIZED / NOT IMPLEMENTED**.

---

## 2. Accepted checkpoint through Decision 20

| Work | Status |
|---|---|
| Immutable handoff contract + delivery | **ACCEPTED** |
| Exact broker account + coverage provenance | **ACCEPTED / LIVE-PROVEN** |
| Admission + V2.3 compatibility | **ACCEPTED** |
| Stable receiver + PREPARED/LISTENING | **ACCEPTED** |
| Decision 15 lossless exact-account first-fill ownership | **ACCEPTED / LIVE-PROVEN** |
| Decision 11/16 durable retirement | **ACCEPTED** |
| Decision 17 atomic LISTENING activation | **ACCEPTED** |
| Decision 18 exact-account LIVE lifecycle | **ACCEPTED** |
| Decision 19 canonical store authority + React migration | **ACCEPTED** |
| Decision 20 top-level runtime router + ownership transfer | **ACCEPTED** |

Decision 20 final acceptance evidence supplied by the operator:

```text
v24:runtime-router-test   18/18 PASS
v24:store-authority-test  15/15 PASS
v24:v23-install-test      16/16 PASS
v24:retirement-test       14/14 PASS
v24:activation-test       20/20 PASS
v24:fill-ownership-test   24/24 PASS
v24:live-lifecycle-test   15/15 PASS
v24:v23-compat-test       13/13 PASS
schwab:state-test         10/10 PASS
production build          PASS
```

---

## 3. Frozen Decisions 10–20

- **Decision 10:** V2.4 authorization-bearing fields are immutable.
- **Decision 11:** universal pre-fill discard/disarm preserves audit and never mutates broker orders.
- **Decision 12:** exact authorized account owns the trade; symbol cleanliness is global across observable accounts.
- **Decision 13:** authoritative broker timing is Schwab `executionTime`; `detectedAt` is audit-only.
- **Decision 14:** stable opaque Execution Board receiver identity is durable and sticky.
- **Decision 15:** V2.4 fill ownership uses the lossless ownership journal, never bounded UI executions.
- **Decision 16:** discard freezes an exact retirement cutoff; incomplete proof requires reconciliation.
- **Decision 17:** LISTENING activation freezes exact `executionListeningAt = T` only after durable PREPARED and clean broker proof through T.
- **Decision 18:** after first fill, V2.4 LIVE lifecycle remains exact-account, lossless-journal, authoritative-time, order-provenance driven; coverage discontinuity requires reconciliation.
- **Decision 19:** the Execution Board has one durable store authority; React is a projection and every mutation starts from latest durable state.
- **Decision 20:** one serialized top-level V2.4 router owns activation → retirement → first-fill → LIVE lifecycle orchestration; exact first fill atomically creates lifecycle + visible V2.4 LIVE projection; immutable installation becomes provenance-only after lifecycle creation; ownership releases only after EXIT reaches History.

Decision 20 authority:

- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v1.0_APPROVED.md`

---

## 4. Decision 20 implementation — ACCEPTED

### Runtime core

Added:

- `src/execution/execution-v24-active-ownership.js`
- `src/execution/execution-v24-runtime-router.js`
- `src/hooks/useV24ExecutionRouter.js`

Updated:

- `src/execution/execution-v24-handoff-activation.js`
- `src/execution/execution-v24-local-installation.js`
- `src/execution/execution-v24-retirement.js`
- `src/execution/execution-v23-store-authority.js`
- `src/App.jsx`

Implemented behavior:

- one app-level runtime router is independent of visible workspace;
- an exclusive browser Web Lock serializes the router across React StrictMode and multiple tabs using the same browser profile;
- one in-memory proposed Decision-17 `T` is retained while broker coverage catches up;
- discovery/activation is serial and deterministic;
- delivered LISTENING installations continue to be processed locally after they disappear from server discovery;
- retirement resolution precedes ordinary first-fill promotion;
- exact-account first fill atomically commits both durable V2.4 lifecycle and `origin = V24_HANDOFF` LIVE record in one canonical-store revision;
- the immutable LISTENING installation remains audit provenance but stops reserving the symbol as soon as a lifecycle exists;
- LIVE / LIVE_RECONCILIATION_REQUIRED reserve the symbol;
- EXIT reserves until corresponding V2.4 History exists;
- after History, old immutable installation/lifecycle provenance no longer blocks a fresh same-symbol authorization;
- lifecycle advancement continues independently of handoff discovery;
- legacy V2.3 React projection now excludes V2.4 LIVE/History records and preserves them across all legacy mutations, preventing accidental legacy processing.

### Operator UI

Added:

- `src/components/V24AuthorizedTradesBoard.jsx`
- `src/components/V24LiveExecutionBoard.jsx`
- `src/components/V24LiveTradeCard.jsx`

Behavior:

- PREPARED/LISTENING V2.4 authorizations render separately from legacy candidates;
- pre-fill V2.4 exposes DISCARD only, routed through Decision 16; no EDIT is exposed;
- V2.4 LIVE/EXIT/History renders separately from legacy V2.3 execution projection;
- LIVE card displays structural invalidation separately from effective stop;
- actual stop risk uses effective stop and frozen ARM-time `authorizedMaxDollarRisk`;
- V2.4 lifecycle quantity/average comes from Decision-18 durable lifecycle, never symbol-only current-position inference;
- `LIVE_RECONCILIATION_REQUIRED` remains visibly owned and cannot fall back into legacy execution logic.

### Post-acceptance safety gate

The router is mounted in `App`, but live execution of the loop still defaults **OFF** while the synthetic dashboard E2E is performed:

```text
VITE_EXECUTIONOS_V24_ROUTER_ENABLED=false   # default when unset
```

Therefore pulling/building this checkpoint cannot begin new handoff claims or LIVE routing unless the operator explicitly enables the flag. The next synthetic E2E will enable the flag deliberately while remaining broker-read-only and without requiring a real fill.

---

## 5. Focused Decision 20 tests

Command:

```text
npm run v24:runtime-router-test
```

The focused suite covers:

- lifecycle-aware symbol reservation;
- provenance-only installation after first fill;
- EXIT ownership through classification/History;
- atomic lifecycle + LIVE projection commit;
- idempotent promotion retry;
- stable proposed Decision-17 boundary across proof polls;
- serial activation ordering;
- local LISTENING processing after delivery disappears from discovery;
- retirement-before-fill priority;
- LIVE lifecycle advancement independent of discovery;
- legacy React projection hiding/preserving V2.4 LIVE and History records;
- top-level router/UI mounting and exclusive Web Lock;
- effective-stop/frozen-risk UI authority;
- DISCARD-only V2.4 pre-fill UI;
- fresh same-symbol installation allowed after prior V2.4 EXIT reaches History but blocked while prior lifecycle remains LIVE.

---

## 6. Decision 20 acceptance — COMPLETE

Final acceptance suite:

```text
npm run v24:runtime-router-test
npm run v24:store-authority-test
npm run v24:v23-install-test
npm run v24:retirement-test
npm run v24:activation-test
npm run v24:fill-ownership-test
npm run v24:live-lifecycle-test
npm run v24:v23-compat-test
npm run schwab:state-test
npm run build
```

All required checks passed. **Decision 20 is ACCEPTED.**

The next step is a **synthetic dashboard end-to-end test with the V2.4 runtime router explicitly enabled**, still broker-read-only and without requiring a real broker fill. Synthetic handoff creation must occur server-side through the real durable repositories; there is intentionally no browser/API route that creates handoffs. Only after that smoke test passes should the router default be considered for normal enablement or a real-fill test.

---

## 7. Still not implemented

- fast V2.4 Revise → Re-arm;
- explicit operator reconciliation workflow for ambiguous LIVE ownership;
- broker order placement, modification, cancellation, automatic reduction, stop replacement, or flattening.

`USER-GUIDE.md` remains intentionally unchanged until an accepted end-to-end operator workflow exists.
