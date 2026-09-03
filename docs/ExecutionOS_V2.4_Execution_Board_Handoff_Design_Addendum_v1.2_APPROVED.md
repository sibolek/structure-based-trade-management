# ExecutionOS V2.4 — Execution Board Handoff Integration
## Approved Design Addendum v1.2

**Status:** APPROVED / FROZEN  
**Date:** 2026-09-02  
**Branch:** `v24-execution-board-handoff`  
**Decision:** 22 — Normal Router Enablement & Recovery Hardening  
**Parent authority:** approved Decisions 10–21 and all previously approved Execution Board Handoff addenda

---

## Purpose

Decision 22 hardens the V2.4 Execution Board runtime router for normal use. It does not change the governing execution authority boundary:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Decision 22 introduces no broker-write authority. Schwab remains read-only at all times:

- `readOnly === true`
- `brokerWriteAuthority === false`
- no order placement
- no order replacement
- no cancellation
- no stop replacement or modification
- no automatic reduction
- no automatic flattening
- no other Schwab mutation

This document freezes Decisions **22A through 22J**. Design approval permits implementation; it is not implementation acceptance.

---

# Decision 22A — Normal Enablement & Emergency Disable Contract

### Frozen invariant

> **The V2.4 runtime router is a normal default-on ExecutionOS service after Decision-22 implementation acceptance. The normal workflow does not require a positive enable flag. One negative emergency disable switch pauses routing only; it never discards, retires, releases, rewrites, or otherwise changes durable execution ownership.**

### Configuration contract

The current acceptance-only positive gate `VITE_EXECUTIONOS_V24_ROUTER_ENABLED=true` is retired from the normal startup model.

The emergency switch is:

```text
VITE_EXECUTIONOS_V24_ROUTER_DISABLED=true
```

Configuration interpretation:

```text
unset  -> enabled
false  -> enabled
true   -> PAUSED
malformed nonempty value -> fail closed; router does not run
```

There is no competing positive ENABLED flag in the final normal model.

### PAUSED semantics

PAUSED is orchestration pause only. It must not:

- discard or retire an authorization;
- alter `executionListeningAt`;
- delete PREPARED or LISTENING installation state;
- release symbol ownership;
- alter a retirement cutoff;
- create or destroy LIVE ownership;
- move an EXIT to History;
- infer absence of ownership;
- acknowledge/block delivery solely because routing is paused.

Durable ownership remains authoritative while paused:

- PREPARED remains reserved;
- LISTENING remains an active broker-fill ownership interval;
- REQUESTED retains its frozen cutoff;
- LIVE remains V2.4 owned;
- reconciliation-required LIVE/ownership remains owned;
- EXIT remains owned until History completion.

> **Router disabled does not mean execution ownership disabled.**

The default-on transition is implemented only after hardening has passed the staged acceptance path in Decision 22J.

---

# Decision 22B — Fail-Closed Status Taxonomy

### Frozen invariant

> **Router service health and durable execution-ownership state are separate concerns. Temporary absence or temporal incompleteness of otherwise recoverable evidence produces WAITING, never terminal reconciliation. A known-invalid progression produces BLOCKED. An unexpected runtime failure produces ERROR and preserves the last durable ownership state. RECONCILIATION_REQUIRED is reserved for ownership intervals that cannot be proven from authoritative evidence.**

### Router service-health vocabulary

- `RUNNING`
- `WAITING_FOR_SCHWAB`
- `WAITING_FOR_PRETRADE`
- `WAITING_FOR_ROUTER_LOCK`
- `PAUSED`
- `STALE`
- `BLOCKED`
- `ERROR`

`RECONCILIATION_REQUIRED` is not a router-service health state. It is an execution-ownership state for the affected handoff/trade.

### Core classification rule

```text
proof still arriving                -> WAITING
known-invalid progression           -> BLOCKED
unexpected runtime/transport error  -> ERROR
ownership interval cannot be proven -> RECONCILIATION_REQUIRED
```

Temporary broker evidence insufficiency must not become reconciliation solely because evidence is incomplete at the present instant.

### Broker-evidence classification

Examples:

- broker disconnected / state absent -> WAITING_FOR_SCHWAB;
- Schwab state initializing -> WAITING;
- `readOnly !== true` -> BLOCKED;
- broker source not `SCHWAB` -> BLOCKED;
- temporary monitor error -> WAITING_FOR_SCHWAB unless it creates a proven ownership-evidence discontinuity;
- coverage absent while initializing -> WAITING;
- CONTIGUOUS coverage with `currentThrough < requiredThrough` -> WAITING;
- actual GAP across an ownership-sensitive interval -> RECONCILIATION_REQUIRED;
- journal structurally invalid after authoritative state exists -> RECONCILIATION_REQUIRED;
- authoritative coverage/journal contradiction -> RECONCILIATION_REQUIRED.

### Before versus after LISTENING

Before LISTENING, incomplete evidence normally prevents activation and remains WAITING. Known safety conflicts may BLOCK.

After LISTENING, incomplete but still recoverable evidence remains WAITING. A genuine discontinuity across the already-active ownership interval requires reconciliation.

### Retirement refinement

A Decision-16 retirement whose otherwise-valid aligned CONTIGUOUS evidence has not yet advanced through the frozen `cutoffAt` remains:

```text
REQUESTED / WAITING
```

It must not become `RECONCILIATION_REQUIRED` merely because broker evidence is still catching up.

No WAITING, BLOCKED, ERROR, or reconciliation classification creates broker-write authority.

---

# Decision 22C — Temporary Service Loss & Automatic Recovery

### Frozen invariant

> **Router dependencies are stage-specific rather than globally all-or-nothing. Pretrade is required for transport-facing handoff work, but once durable LISTENING ownership exists, pretrade availability is not required for retirement, first-fill ownership, LIVE promotion, or lifecycle advancement. Schwab is required for broker-ownership conclusions. Temporary service loss preserves durable ownership and recovery occurs automatically from durable state plus fresh authoritative evidence without browser refresh.**

### Two work lanes

#### Transport / activation lane

May require pretrade and, for admission, broker proof:

- discover;
- claim;
- PREPARED activation;
- establish LISTENING;
- ACK delivery;
- block delivery.

#### Durable broker-ownership lane

Requires durable local state plus authoritative Schwab evidence, but not pretrade:

- retirement resolution;
- first-fill ownership;
- LIVE promotion;
- LIVE lifecycle processing;
- EXIT/History completion.

### Pretrade outage

Before local installation, no new discovery/claim progress is invented.

While PREPARED, durable PREPARED/reservation remains unchanged and activation waits.

After LISTENING, pretrade loss must not stop retirement, first-fill matching, LIVE promotion, lifecycle updates, or EXIT processing.

A durable LISTENING ACK retry may be performed when pretrade returns even if Schwab is temporarily unavailable because ACK retry does not create a new ownership boundary.

### Schwab outage

When authoritative broker evidence is unavailable:

- PREPARED does not become LISTENING;
- LISTENING does not infer fill/no-fill;
- REQUESTED remains REQUESTED with the same cutoff;
- LIVE does not infer ADD/PARTIAL/FLAT/REVERSAL;
- EXIT ownership remains preserved.

### Recovery

Reconnection is not itself proof. Recovery must obtain fresh authoritative state and classify it under Decision 22B.

If the broker journal/coverage reconstructs the relevant interval continuously, the router catches up automatically using authoritative broker `executionTime` and the lossless journal.

If the required interval cannot be proven, reconciliation is required.

Temporary dependency loss must never require manual browser refresh merely to resume deterministic routing.

A completely new handoff does not take a sticky receiver claim while broker state is unavailable to begin safe admission.

---

# Decision 22D — Retirement Recovery Semantics

### Frozen invariant

> **A LISTENING discard durably creates one immutable REQUESTED retirement with a frozen Decision-16 cutoff. REQUESTED is nonterminal and retryable. Temporal broker catch-up remains REQUESTED/WAITING. RETIRED requires positive proof of no eligible fill through the cutoff. An eligible prior fill supersedes retirement. RECONCILIATION_REQUIRED is reserved for genuine inability to prove the ownership interval.**

### Canonical state machine

```text
LISTENING
  -> DISCARD
  -> REQUESTED
       -> proof still catching up -> REQUESTED / WAITING
       -> complete clean proof    -> RETIRED
       -> eligible prior fill     -> SUPERSEDED_BY_PRIOR_FILL
       -> interval unprovable     -> RECONCILIATION_REQUIRED
```

No additional durable WAITING state is required; `REQUESTED` itself is the durable pending-retirement state.

### RETIRED proof

RETIRE may be committed only when the broker proof contract is satisfied through `cutoffAt`, including:

- usable Schwab state;
- `readOnly === true`;
- source `SCHWAB`;
- no blocking broker error;
- exact authorized account available;
- execution coverage CONTIGUOUS;
- valid ownership journal;
- coverage/journal boundaries coherent;
- coverage begins no later than `executionListeningAt`;
- coverage extends through at least `cutoffAt`;
- no eligible execution with:

```text
executionListeningAt <= executionTime < cutoffAt
```

An execution exactly at or after cutoff is outside the retiring listener interval.

### Prior fill

If an eligible fill exists before the cutoff:

```text
SUPERSEDED_BY_PRIOR_FILL
```

wins. DISCARD cannot retroactively erase a fill executed while LISTENING ownership was active.

### Ownership retention

- REQUESTED retains reservation/ownership;
- SUPERSEDED_BY_PRIOR_FILL retains ownership until LIVE promotion;
- RECONCILIATION_REQUIRED retains ownership;
- only durably committed RETIRED releases the pre-fill reservation.

### Recovery

REQUESTED retirement is entirely durable and must recover across remount, HMR, reload, leader takeover, and browser restart without original in-memory context.

No elapsed-time timeout converts REQUESTED into a terminal state.

Retirement resolution is independent of pretrade once LISTENING exists.

---

# Decision 22E — Router Remount / HMR / Restart Recovery

### Frozen invariant

> **Router process and React instances are ephemeral and carry no execution authority. Every router start is a fresh epoch that reacquires leadership and reconstructs work from the latest canonical durable store plus fresh external evidence. No safety-sensitive durable state may require manual browser refresh to resume processing.**

### Epoch model

React may start, stop, and observe the router, but React state/effect lifetime is not ownership authority.

Every initial load, remount, HMR restart, hard reload, leader takeover, or browser restart creates a new ephemeral router epoch.

Ephemeral epoch data may include timers, cancellation state, health data, transport instances, and current results. Durable execution facts never depend on those values.

### Startup recovery

After leadership is acquired, the router rereads canonical durable state and resumes the normal Decision-20 orchestration from what is actually durable.

Examples:

- PREPARED -> resume Decision-17 activation rules;
- LISTENING -> continue first-fill ownership and ACK retry;
- REQUESTED -> resume retirement resolution;
- SUPERSEDED_BY_PRIOR_FILL -> continue exact prior-fill promotion;
- LIVE -> resume lifecycle processing;
- reconciliation -> preserve ownership;
- EXIT awaiting History -> continue terminal processing;
- completed History -> no action.

There is no separate recovery mutation engine.

### Graceful stop and replacement

When an epoch stops:

1. it begins no new router cycle;
2. any already-running cycle may settle while the old epoch still owns leadership;
3. only after in-flight work settles may its leadership callback release the lock;
4. the replacement epoch may then acquire leadership.

A new epoch may not become mutation-capable while an old leader epoch can still commit ownership mutations.

### Immutable times

Recovery never substitutes restart time for:

- `authorizedAt`;
- `executionListeningAt`;
- retirement `cutoffAt`;
- broker `executionTime`;
- existing lifecycle event time.

Stable receiver identity persists across epochs. Missing expected receiver identity fails closed.

HMR is treated as another router restart mode, not a special safety protocol.

Decision-17 proposed-boundary recovery is separately governed by Decision 22G.

---

# Decision 22F — Web Lock, Single-Leader & Cross-Tab Mutation Authority

### Frozen invariant

> **ExecutionOS uses two distinct browser-wide exclusive locking concerns: one long-lived V2.4 router leadership lock and one short-lived canonical Execution Board store writer lock. Exactly one tab may run automated V2.4 orchestration, and exactly one canonical read-modify-write transaction may execute at a time across all tabs.**

### Router leadership lock

The V2.4 router leadership lock determines which tab may run automated activation, retirement resolution, first-fill matching/promotion, and lifecycle advancement.

Only the lock holder is the automated router leader.

Heartbeat or stale detection can never bypass an actually-held Web Lock.

### Canonical store writer lock

The writer lock protects all mutations of the canonical Execution Board store, including both V2.3 and V2.4 mutations because both share one durable store authority.

Every canonical mutation must follow:

```text
acquire writer lock
-> reread latest durable canonical state
-> compute mutation from that state
-> write
-> exact readback verification
-> release writer lock
```

No network/service operation is held inside the store writer lock.

### Passive-tab operator actions

A passive tab does not run automated router stages, but may persist explicitly authorized operator intent such as DISCARD through the serialized canonical-store mutation boundary.

Concurrent DISCARD attempts must resolve idempotently so the first frozen Decision-16 cutoff remains authoritative.

### Lock hierarchy

A passive UI writer acquires only the short store writer lock.

The automated router already owns the long-lived router leadership lock and may temporarily acquire the store writer lock.

No code may acquire router leadership while already holding the store writer lock.

### Cross-tab projection synchronization

A canonical store change in one tab must notify other tabs to reread the durable canonical store.

The notification is never execution authority. Notification payloads are not trusted as canonical state; they only trigger reread.

Failure of required Web Lock mutation capability fails closed rather than falling back to unsynchronized read-modify-write updates.

---

# Decision 22G — Decision-17 Proposed Boundary Recovery

### Frozen invariant

> **Decision 17 remains unchanged. A proposed `executionListeningAt = T` while PREPARED is transient router-epoch state and is not broker-fill ownership. One surviving epoch holds one proposal while evidence catches up. If that epoch ends before LISTENING becomes durable, the old proposal is discarded and the new epoch chooses a fresh T and performs fresh proof through that exact T. Once durable LISTENING(T) exists, T is immutable execution authority across all restarts.**

### Same-epoch behavior

While PREPARED, one proposed T is retained across repeated broker-proof WAITING cycles. Temporary dependency loss within the same surviving epoch does not continuously replace T.

### New epoch before LISTENING

If the router epoch ends while durable state remains PREPARED:

```text
old proposed T1 -> discarded
new epoch -> reread PREPARED -> choose fresh T2 -> fresh final admission through T2
```

An abandoned proposal never creates retroactive fill ownership.

Broker activity occurring before the fresh effective LISTENING boundary remains outside V2.4 ownership and must be considered by fresh admission checks.

### Durable LISTENING

If the canonical store contains valid LISTENING(T), the proposal phase has ended. T is preserved across HMR, reload, leader takeover, browser restart, and ACK retry.

Recovery decides PREPARED versus LISTENING exclusively from canonical durable state.

Proposed boundaries are not persisted as canonical execution-ownership fields. They may be exposed ephemerally for diagnostics only.

---

# Decision 22H — Visible Router Health, Heartbeat & Staleness

### Frozen invariant

> **ExecutionOS exposes persistent operator-visible V2.4 router health independently from individual trade ownership. Heartbeat is observability; the Web Lock remains leadership authority. Health-state transitions do not themselves mutate execution ownership.**

### Visible health states

- RUNNING
- WAITING_FOR_SCHWAB
- WAITING_FOR_PRETRADE
- WAITING_FOR_ROUTER_LOCK
- PAUSED
- STALE
- BLOCKED
- ERROR

`RECONCILIATION_REQUIRED` remains handoff/trade-specific ownership state.

### Health timestamps

The router exposes distinct operational timestamps:

- `lastHeartbeatAt`
- `lastSuccessfulCycleAt`
- `lastFailedCycleAt`

A failed cycle does not update `lastSuccessfulCycleAt`.

### Staleness

STALE means the active service heartbeat failed beyond its expected configured cadence tolerance without another intentional/classified condition explaining the absence.

The numerical stale threshold is derived from the implemented loop cadence plus tested browser scheduling tolerance; Decision 22 does not freeze an arbitrary magic number.

Known dependency outages may remain WAITING indefinitely while heartbeat remains healthy and therefore do not become STALE merely because the dependency outage is long.

### Multi-tab display

The leader reports its active state.

Passive tabs report `WAITING_FOR_ROUTER_LOCK` / routing active in another tab and continue to display canonical execution state through cross-tab projection synchronization.

A passive tab may report apparent stale leadership for operator awareness but may never become a second leader until the actual exclusive Web Lock is released and acquired.

Normal RUNNING status is compact. PAUSED, STALE, BLOCKED, and ERROR require persistent operator-visible attention.

---

# Decision 22I — Error & Stage Observability

### Frozen invariant

> **Router operational failures are recorded separately from durable execution ownership. Failures are stage-attributed, operator-readable, and diagnostically useful, but telemetry itself is never execution authority and never mutates ownership.**

### Failure stages

- `ACTIVATION`
- `RETIREMENT`
- `FIRST_FILL`
- `LIFECYCLE`
- `ROUTER_SERVICE`
- `STORE`
- `TRANSPORT`

### Structured failure information

Operational failure metadata includes, when available:

- `occurredAt`;
- stage;
- stable error `code`;
- concise `message`;
- `handoffId`;
- symbol;
- scope;
- recoverability classification.

Failure scope distinguishes at least handoff-level, service-level, and canonical-store-level failure.

### Active versus historical diagnostics

- `activeError` represents the currently unresolved operational failure;
- `lastFailure` preserves the most recent failure after recovery;
- `lastSuccessfulCycleAt` and `lastFailedCycleAt` remain distinct.

A later successful recovery may clear `activeError` while retaining `lastFailure` for diagnostics.

### Failure isolation

One handoff-level reconciliation or classified failure does not automatically stop unrelated safe handoffs.

A global canonical-store integrity/capability failure stops mutation-capable progression globally because Decision 19 makes that store the durable execution authority.

Classified WAITING, BLOCKED, and RECONCILIATION outcomes are not automatically treated as unexpected runtime exceptions.

### Telemetry storage

Router health/error telemetry is operational metadata and is not written into the canonical execution store merely for heartbeat/error display. It must not create a shadow execution database.

Stable error codes remain available for automated tests and diagnostics; the primary trading UI presents concise operator-readable status rather than raw debug traces.

---

# Decision 22J — Test Matrix, Acceptance Gate & USER-GUIDE Transition

### Frozen invariant

> **Decision-22 design approval and Decision-22 implementation acceptance are separate gates. Implementation acceptance requires deterministic state-machine tests, actual browser-runtime proof for browser concurrency/restart guarantees, synthetic read-only E2E recovery, complete regression of Decisions 10–21, and a successful production build. USER-GUIDE.md remains unchanged until the full implementation acceptance gate passes.**

## Gate A — Design approval

Approval of Decisions 22A–22J freezes this design and permits implementation.

It does not make the default-on router implementation accepted.

## Gate B — Implementation acceptance

Required sequence:

```text
IMPLEMENT
-> targeted deterministic tests
-> real browser-runtime tests
-> read-only synthetic E2E
-> full Decisions 10-21 regression
-> production build
-> evidence review
-> explicit implementation acceptance
-> USER-GUIDE transition
```

### Required test layers

#### 1. Deterministic state-machine/unit/integration tests

Cover:

- default enable/disable contract;
- WAITING/BLOCKED/ERROR/reconciliation taxonomy;
- service-loss recovery;
- retirement semantics;
- restart reconstruction;
- proposed-boundary recovery;
- health/staleness logic;
- error observability;
- canonical store transaction serialization where independently testable.

#### 2. Real browser-runtime tests

Actual browser behavior, not source inspection or fake Web Locks alone, must prove:

- exactly one router leader across tabs;
- passive-tab behavior;
- actual Web Lock release and takeover;
- no overlapping old/new router epochs;
- cross-tab canonical mutation serialization;
- passive-tab projection synchronization;
- reload/remount recovery;
- stale detection never creates split-brain leadership.

A development-only browser automation harness such as Playwright is recommended, but equivalent actual-browser automated proof is acceptable.

#### 3. Recovery matrix

The implementation must be interrupted and recover correctly at least across:

- PREPARED;
- LISTENING;
- ACK pending;
- REQUESTED;
- SUPERSEDED_BY_PRIOR_FILL;
- LIVE;
- EXIT awaiting History.

No scenario may require manual refresh to make valid durable work resume.

#### 4. Retirement acceptance blockers

Mandatory proof:

```text
CONTIGUOUS + valid journal + currentThrough < cutoffAt
-> remains REQUESTED

later clean proof through cutoff + no fill
-> RETIRED

eligible prior fill before cutoff
-> SUPERSEDED_BY_PRIOR_FILL

actual ownership-evidence discontinuity
-> RECONCILIATION_REQUIRED
```

#### 5. Service-loss matrix

Pretrade outage must stop only transport/activation work that actually requires pretrade while already-owned broker-lifecycle work continues where broker proof is healthy.

Schwab outage must freeze broker-sensitive conclusions and recover automatically from reconstructed proof.

Both unavailable must preserve durable state with no ownership release.

#### 6. Health/observability

Must demonstrate all visible service states, distinct successful/failed cycle timestamps, heartbeat/staleness behavior, and separation of trade reconciliation from router health.

### Default-enablement rollout

Implementation is staged:

1. hardening is implemented while controlled activation remains available;
2. targeted and browser recovery tests pass;
3. the 22A negative disable/default-on configuration transition is implemented;
4. the complete suite is rerun against the actual normal default configuration.

### Existing regression commands

The final gate includes at minimum:

```bash
npm run v24:runtime-router-test
npm run v24:store-authority-test
npm run v24:v23-install-test
npm run v24:retirement-test
npm run v24:activation-test
npm run v24:fill-ownership-test
npm run v24:live-lifecycle-test
npm run v24:v23-compat-test
npm run schwab:state-test
node --test tests/execution-v24-trade-specification-ui.test.mjs
npm run build
```

Decision-22 implementation should also introduce aggregate hardening/browser acceptance commands, conceptually:

```bash
npm run v24:router-hardening-test
npm run v24:router-browser-test
```

Exact script/file names may be finalized during implementation while preserving this acceptance scope.

### Synthetic E2E

No deliberate real brokerage fill is required.

A clean synthetic handoff lifecycle must be repeated through authorization, LISTENING, DISCARD, REQUESTED, catch-up, RETIRED, card disappearance, and symbol release, with at least one recovery interruption that automatically resumes without manual corrective refresh.

A two-tab synthetic scenario must also prove passive-tab operator intent, leader resolution, passive projection refresh, leader close, and takeover.

### Hard broker-safety acceptance condition

At all relevant levels:

```text
readOnly === true
brokerWriteAuthority === false
```

Decision-22 code must introduce no Schwab mutation path.

Any failure involving duplicate leadership, lost canonical state, changed LISTENING boundary, changed retirement cutoff, incorrect fill ownership, false retirement, release under uncertainty, missed lifecycle ownership, or broker-write authority blocks acceptance.

### USER-GUIDE transition

`USER-GUIDE.md` remains unchanged throughout design approval and implementation testing.

Only after explicit Decision-22 implementation acceptance may it be updated to describe:

- normal automatic router startup;
- router health display;
- multi-tab behavior;
- dependency WAITING states;
- emergency PAUSED behavior;
- DISCARD/REQUESTED semantics;
- automatic restart/service recovery;
- reconciliation meaning;
- continued Schwab read-only boundary.

---

# Decision-22 Approved Architecture Summary

Decision 22 freezes the following combined operating model:

```text
normal default-on router
+ emergency pause-only negative switch
+ stage-specific dependency gating
+ durable ownership recovery
+ retryable REQUESTED retirement
+ disposable router epochs
+ one automated router leader
+ one browser-wide canonical-store writer
+ ephemeral PREPARED proposed boundary
+ persistent visible router health
+ stage-attributed operational telemetry
+ real browser acceptance proof
+ zero broker-write authority
```

The implementation must continue to preserve all accepted Decisions 10–21 invariants.

---

## Approval status

**Decision 22A — APPROVED / FROZEN**  
**Decision 22B — APPROVED / FROZEN**  
**Decision 22C — APPROVED / FROZEN**  
**Decision 22D — APPROVED / FROZEN**  
**Decision 22E — APPROVED / FROZEN**  
**Decision 22F — APPROVED / FROZEN**  
**Decision 22G — APPROVED / FROZEN**  
**Decision 22H — APPROVED / FROZEN**  
**Decision 22I — APPROVED / FROZEN**  
**Decision 22J — APPROVED / FROZEN**

**Decision 22 design status:** APPROVED / FROZEN  
**Implementation status:** NOT YET ACCEPTED  
**USER-GUIDE transition:** DEFERRED UNTIL IMPLEMENTATION ACCEPTANCE
