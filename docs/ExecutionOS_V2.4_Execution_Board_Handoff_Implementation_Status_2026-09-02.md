# ExecutionOS V2.4 — Execution Board Handoff Integration
## Implementation Status — 2026-09-02

**Branch:** `v24-execution-board-handoff`  
**Design authority:** `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Design_Baseline_v0.1_APPROVED.md`  
**Approved addenda:** Decisions 10–19 in addenda v0.1–v0.9  
**Overall status:** **IN PROGRESS — DECISIONS 10–18 ACCEPTED; DECISION-19 CANONICAL STORE FOUNDATION ACCEPTED; REACT + LIVE-LIFECYCLE STORE MIGRATION IMPLEMENTED / AWAITING ACCEPTANCE; LIVE V2.4 RECEIVER ROUTING NOT YET ENABLED**

---

## 1. Governing boundary

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Broker order placement, modification, cancellation, stop replacement, automatic reduction, or automatic flattening remain **NOT AUTHORIZED / NOT IMPLEMENTED**.

---

## 2. Accepted implementation checkpoint

| Work | Status |
|---|---|
| Immutable handoff contract + persistence | **ACCEPTED** |
| Claim / delivery state machine | **ACCEPTED** |
| Exact broker account identity + execution coverage | **ACCEPTED / LIVE-PROVEN** |
| Handoff transport API | **ACCEPTED / ISOLATED RUNTIME-PROVEN** |
| Execution-activity provenance + admission gate | **ACCEPTED / LIVE-PROVEN** |
| V2.3 compatibility/provenance | **ACCEPTED** |
| Stable receiver + PREPARED/LISTENING persistence | **ACCEPTED** |
| Lossless journal + exact-account first-fill ownership | **ACCEPTED / LIVE-PROVEN** |
| Decision 11/16 durable retirement | **ACCEPTED** |
| Decision 17 atomic LISTENING activation | **ACCEPTED** |
| Decision 18 exact-account LIVE lifecycle | **ACCEPTED** |
| Decision 19 canonical store authority foundation | **ACCEPTED** |
| Decision 19 React + LIVE-lifecycle store migration | **IMPLEMENTED / AWAITING ACCEPTANCE** |

The V2.4 receiver/ownership route remains intentionally unmounted from the continuously running React Execution Board until the full Decision-19 store migration is accepted.

---

## 3. Frozen Decisions 10–19

- **Decision 10:** V2.4 authorization-bearing fields are immutable.
- **Decision 11:** universal pre-fill discard/disarm preserves audit and never mutates broker orders.
- **Decision 12:** exact authorized account owns the trade; symbol cleanliness is global across observable accounts.
- **Decision 13:** authoritative broker timing is Schwab `executionTime`; `detectedAt` is audit-only.
- **Decision 14:** stable opaque Execution Board receiver identity is durable and sticky.
- **Decision 15:** V2.4 fill ownership uses the lossless ownership journal, never bounded UI executions.
- **Decision 16:** discard freezes an exact retirement cutoff; incomplete proof requires reconciliation.
- **Decision 17:** LISTENING activation freezes exact `executionListeningAt = T` only after durable PREPARED and clean broker proof through T.
- **Decision 18:** after first fill, V2.4 LIVE lifecycle remains exact-account, lossless-journal, authoritative-time, order-provenance driven; coverage discontinuity requires reconciliation.
- **Decision 19:** the Execution Board has one durable store authority; every mutation is read-latest → mutate → exact-persist/readback with monotonic `storeRevision`; React is a projection, not persistence authority.

---

## 4. Accepted Decision 18 evidence

```text
v24:live-lifecycle-test       15/15 PASS
v24:broker-provenance-test   24/24 PASS
v24:fill-ownership-test      24/24 PASS
v24:v23-compat-test          13/13 PASS
v24:v23-install-test         16/16 PASS
v24:handoff-admission-test   16/16 PASS
v24:handoff-test             34/34 PASS
v24:handoff-api-test          7/7 PASS
v24:retirement-test          14/14 PASS
v24:activation-test          20/20 PASS
schwab:state-test            10/10 PASS
production build             PASS
```

---

## 5. Decision 19 canonical store authority — foundation accepted

Approved design authority:

- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v0.9_APPROVED.md`

Canonical runtime:

- `src/execution/execution-board-store-repository.js`

Already migrated and accepted:

- `src/execution/execution-v24-local-installation.js`
- `src/execution/execution-v24-retirement.js`

The canonical repository preserves:

```text
storeSchemaVersion
storeRevision

draft
candidates
liveTrades
history
view
notice

v24Installations
v24Retirements
v24Lifecycles

+ unknown forward-compatible namespaces
```

Accepted transaction contract:

```text
read latest durable store
→ normalize canonical namespaces
→ mutate latest state
→ increment storeRevision exactly once
→ write complete store
→ exact durable readback
→ publish committed snapshot to same-context subscribers
```

Foundation acceptance evidence supplied by operator:

```text
v24:store-authority-test   8/8 PASS
v24:v23-install-test      16/16 PASS
v24:retirement-test       14/14 PASS
v24:activation-test       20/20 PASS
v24:live-lifecycle-test   15/15 PASS
production build          PASS
```

---

## 6. Decision 19 second slice — implemented / awaiting acceptance

Runtime added:

- `src/execution/execution-v23-store-authority.js`

Runtime migrated:

- `src/execution/execution-v24-live-lifecycle.js`
- `src/pages/ExecutionV23.jsx`

Implemented behavior:

- V2.4 LIVE lifecycle persistence now transacts through the same canonical repository as installation and retirement;
- V2.3 React state is now a projection of the canonical repository, not a persistence authority;
- every manual V2.3 UI mutation starts from the latest durable store and writes only the legacy projection fields back into that latest canonical snapshot;
- React subscribes to same-context canonical commits so V2.4 writes cannot remain hidden behind a stale component snapshot;
- direct full-store `localStorage.setItem` persistence has been removed from `ExecutionV23`;
- canonical `storeRevision` continues to advance on repository transactions;
- V2.4/unknown namespaces survive unrelated manual V2.3 UI mutations;
- the legacy V2.3 first-fill matcher explicitly skips `origin = V24_HANDOFF` records;
- the legacy V2.3 LIVE lifecycle matcher explicitly skips `origin = V24_HANDOFF` records;
- legacy/manual V2.3 symbol/`detectedAt` execution behavior is otherwise unchanged.

Expanded focused command:

```text
npm run v24:store-authority-test
```

Expected count: **15 tests**:

```text
8 canonical repository tests
4 V2.3 projection-authority tests
3 React/LIVE-lifecycle routing tests
```

The focused suite verifies no direct React full-store writer, explicit V2.4 exclusion from legacy matchers, canonical lifecycle persistence, namespace preservation, latest-durable transactions, same-context subscription, and forward-compatible field retention.

### Acceptance gate

Run:

```text
npm run v24:store-authority-test
npm run v24:v23-install-test
npm run v24:retirement-test
npm run v24:activation-test
npm run v24:live-lifecycle-test
npm run v24:v23-compat-test
npm run build
```

No live V2.4 receiver routing is enabled in this slice.

---

## 7. Current boundary

The branch still does **not**:

- mount the Decision-17 receiver loop into live React;
- promote a real V2.4 first fill into the visible LIVE board;
- route visible V2.4 LIVE/EXIT/History projection through Decision 18;
- implement fast Revise → Re-arm;
- place, modify, cancel, reduce, or flatten broker orders.

Once the second Decision-19 slice is accepted, the stale-snapshot persistence race is closed and live receiver integration can proceed on top of one durable authority.

---

## 8. Documentation rule

`USER-GUIDE.md` remains intentionally unchanged because there is still no accepted end-to-end operator workflow. Approved dated design records remain immutable; this status record tracks current implementation behavior.
