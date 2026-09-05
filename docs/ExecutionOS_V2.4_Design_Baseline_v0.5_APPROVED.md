# ExecutionOS V2.4 — PRETRADE → ARM Integration

## Approved Consolidated Design Baseline

**Version:** 0.5  
**Status:** APPROVED DESIGN BASELINE — PRETRADE → ARM DESIGN COMPLETE / IMPLEMENTATION AUTHORIZED  
**Project:** `sibolek/structure-based-trade-management`  
**Design approval date:** 2026-09-05  
**Implementation branch:** `v24-execution-board-handoff`  
**Accepted downstream regression baseline:** `c6b220020603d33bf7ceb0f3e9d45a7342aedd5d`  
**Broker authority:** READ ONLY / NO BROKER WRITES  

This document consolidates and supersedes the top-level design authority previously distributed across:

- `ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md`;
- the approved Execution Board handoff integration baseline;
- the approved Phase 3 DSS / volatility-buffer design;
- the approved Phase 4 effective-stop risk-sizing design;
- approved Decisions 22–97 from the PRETRADE → ARM integration design sessions.

Where an earlier statement conflicts with a later frozen decision, **the later frozen decision in this v0.5 baseline governs**.

In particular, this v0.5 baseline supersedes earlier assumptions involving:

- automatic final ARM authorization;
- blanket one-active-candidate-per-symbol restrictions;
- generic trigger-evaluation terminology;
- mutable browser-side lifecycle authority;
- one-shot entry-only quantity semantics;
- reuse of unused quantity capacity for the life of a trade;
- silent mutation of authorization state after ARM.

---

# 1. Purpose

ExecutionOS V2.4 moves execution discipline upstream without replacing the trusted downstream execution lifecycle.

The core workflow is:

```text
CANDIDATE SOURCE
      ↓
CANONICAL CANDIDATE INGRESS
      ↓
WAITING
      ↓
PRETRADE_TRIGGER_EVALUATING
      ↓
PERMISSION_EVALUATING
      ↓
READY / CAUTION / PASS
      ↓
OPERATOR REVIEW
      ↓
ARM
      ↓
IMMUTABLE EXECUTION BOARD HANDOFF
      ↓
PENDING → CLAIMED → PREPARED → LISTENING
      ↓
BROKER FILL OWNERSHIP
      ↓
LIVE
      ↓
PARTIALS / SCALE / MANAGEMENT
      ↓
FLAT → EXIT
      ↓
HISTORY
```

The governing architectural invariant remains:

> **V2.4 authorizes; the handoff transfers; V2.3-compatible execution infrastructure owns execution.**

ExecutionOS V2.4 is not a strategy-generation engine and is not a broker-order automation system.

---

# 2. Permanent Safety and Trading Invariants

## 2.1 Broker boundary

The following remain permanent unless a later separately approved design explicitly changes them:

```text
readOnly === true
brokerWriteAuthority === false
```

V2.4 may not:

- place broker orders;
- cancel broker orders;
- replace broker orders;
- modify broker orders;
- flatten a broker position;
- silently convert decision-support state into broker action.

Schwab remains observation-only for the V2.4 boundary described here.

## 2.2 Structural stop and risk hierarchy

The permanent hierarchy is:

```text
STRUCTURAL INVALIDATION
        ↓
MICRO-VOLATILITY BUFFER
        ↓
EFFECTIVE STOP
        ↓
CURRENT EXPECTED ENTRY
        ↓
RISK BUDGET
        ↓
MAXIMUM AFFORDABLE QUANTITY
        ↓
OPERATOR-SELECTED QUANTITY
```

The distinction between `structuralInvalidation` and `effectiveStop` is permanent.

> **If the correct structural/effective stop is unaffordable, reduce size or PASS. Never tighten the stop to make the trade fit.**

The current governing planned-loss policy is:

```text
Maximum planned loss per trade = 0.5% of the relevant account equity
```

## 2.3 Planned truth versus executed truth

ExecutionOS preserves two separate truths:

1. **Authorization truth** — what candidate, trigger, stop, entry assumption, quantity, targets, and management plan were approved.
2. **Broker truth** — what fills and position changes actually occurred.

Observed broker activity never retroactively rewrites the authorization merely to make history appear compliant.

---

# 3. Accepted Implementation Baseline Before PRETRADE Integration

The implementation branch was accepted at downstream regression baseline:

```text
c6b220020603d33bf7ceb0f3e9d45a7342aedd5d
```

At that checkpoint the downstream lifecycle was accepted through:

```text
ARMED authorization
→ immutable Execution Board handoff
→ PENDING
→ CLAIMED
→ PREPARED
→ LISTENING
→ exact-account broker opening fill
→ LIVE
→ partial/add/exit processing
→ FLAT
→ EXIT
→ operator exit classification
→ History
→ symbol ownership release
```

The accepted baseline includes the synthetic downstream lifecycle E2E and related recovery/regression coverage. The PRETRADE → ARM integration described in this document is to be built **into** that accepted handoff boundary, not by casually redesigning the downstream execution lifecycle.

Existing V2.4 services already provide important building blocks including candidate ingestion/persistence, DSS, effective-stop calculation, Phase 4 risk sizing, ARM authorization services, immutable ARM provenance, handoff repositories, and downstream execution activation. The missing work is the complete authoritative orchestration and UI path from imported candidate through final ARM.

---

# 4. Canonical Candidate and PRETRADE Lifecycle

Canonical unarmed states are:

```text
WAITING
PRETRADE_TRIGGER_EVALUATING
PERMISSION_EVALUATING
READY
CAUTION
PASS
EXPIRED
INVALIDATED
DECLINED
SUPERSEDED
OCO_CANCELLED
```

Successful authorization establishes:

```text
ARMED
```

`ARMED` is immutable PRETRADE history after successful authorization. Downstream Execution state is projected separately.

The generic legacy term `TRIGGER_EVALUATING` is not canonical; the required term is:

```text
PRETRADE_TRIGGER_EVALUATING
```

## 4.1 Terminal unarmed outcomes

- `PASS` — a completed permission evaluation rejected this exact candidate/version.
- `EXPIRED` — validity ended before ARM.
- `INVALIDATED` — thesis-invalidating condition occurred before permission, or operator explicitly invalidated with reason.
- `DECLINED` — operator explicitly declined with structured reason.
- `SUPERSEDED` — newer version superseded the older still-active unarmed version of the same logical candidate.
- `OCO_CANCELLED` — an OCO sibling lost because another sibling successfully ARM'd.

Terminal outcomes never resurrect the same candidate/version. Continued interest requires a new candidate/version as applicable.

Temporary inability to evaluate is **not** PASS.

---

# 5. Canonical Candidate Ingress and Contract Immutability

## 5.1 One ingress boundary

All approved producers feed one server-side Candidate Ingress:

```text
SOD A+ candidates
Ad-hoc ChatGPT candidates
Manual imports
Future scanners/research feeds
        ↓
CANONICAL CANDIDATE INGRESS
        ↓
VALIDATION / NORMALIZATION / VERSIONING
        ↓
WAITING
```

Upstream producers submit **candidate proposals only**. They cannot establish:

- permission;
- sizing authority;
- ARM authorization;
- handoff state;
- Execution ownership.

SOD remains the first automated producer. Its canonical bundle source is:

```text
SOD_A_PLUS_TRADES
```

SOD candidates begin `WAITING`, use manual final ARM authorization, and carry `armAuthorized=false` until successful ARM.

## 5.2 Immutable candidate contract

Once accepted, a candidate contract is immutable.

Changes to any material trade-plan content require a new `contractVersion`, including:

- symbol or direction;
- setup;
- decision/entry timeframe;
- thesis;
- trigger contract;
- structural invalidation definition;
- entry intent;
- targets;
- management contract;
- validity window;
- contextual conditions that materially alter the trade plan.

Lifecycle/operator state changes use `stateRevision`; they do not mutate `contractVersion`.

Editorial corrections to accepted material also require a new version.

## 5.3 Version duplicate and conflict rules

- same logical candidate + same version + same content → idempotent no-op;
- same logical candidate + same version + different content → fail-closed version conflict;
- newer version → older still-active unarmed version becomes `SUPERSEDED`;
- ARMED versions are never rewritten or superseded operationally.

## 5.4 Validity

Every intraday candidate must carry exact finite validity:

```text
validFrom
validUntil
timezone/session provenance
```

Friendly source labels must resolve to exact boundaries before acceptance.

Before `validFrom`, the candidate remains non-progressing in `WAITING`.

At or after `validUntil`, any unarmed candidate becomes `EXPIRED` from active unarmed states. A successfully committed ARM before expiry is not retroactively revoked.

---

# 6. Candidate Source and SOD Trade-Card Semantics

The SOD A+ JSON must be generated from the same structured source object that renders the human trade card.

The normalized contract preserves substantive trading intent including, where present:

- symbol;
- direction;
- setup;
- READ/thesis;
- PLAN;
- structured trigger;
- structural invalidation;
- entry constraints;
- disqualifiers/no-trade conditions;
- targets;
- management contract;
- best-location context;
- catalyst/context;
- rating/Morning Priority;
- source provenance;
- validity.

Rendered prose or HTML is not machine authority. ExecutionOS must not scrape human prose to manufacture missing critical deterministic fields.

The source may preserve rich narrative payloads, but only approved structured fields have runtime machine authority.

---

# 7. Timeframe and Reference Semantics

V2.4 preserves distinct timeframe concepts:

```text
decisionTimeframe
entryTimeframe
volatilityTimeframe
structuralInvalidation.sourceTimeframe
```

Approved baseline defaults remain:

```text
decisionTimeframe   = 5m
entryTimeframe      = 2m
volatilityTimeframe = 2m
```

A candidate may explicitly define other supported values.

## 7.1 Reference levels

Trigger and structural references must be explicit authoritative definitions rather than ambiguous shorthand.

A reference carries sufficient semantics such as:

- type;
- session/window;
- timeframe;
- fixed or dynamic behavior;
- calculation/source version;
- provenance.

Examples include:

- ORH with explicit opening-range duration;
- PMH/PML with explicit premarket window;
- YDH/YDL;
- VWAP with session/calculation definition;
- fixed candidate price;
- price zone with lower/upper bounds;
- dynamic signal-bar or pullback structure.

Fixed references become immutable once authoritatively resolved for the applicable candidate context. Dynamic references use their authoritative value at the exact evidence time and may not introduce look-ahead values.

Candidate-defined discretionary levels/zones are allowed but must be labeled as candidate-defined rather than falsely presented as market-derived facts.

Material reference corrections that already affected trigger/permission state require dependent-state invalidation/reconciliation rather than silent historical rewriting.

## 7.2 Unresolved prerequisites

A candidate whose logic depends on unresolved prerequisites remains in its current lifecycle state, normally `WAITING`, with explicit structured prerequisite status.

Examples:

- ORH not yet formed;
- PMH not yet frozen;
- required completed bar not yet available;
- session/time boundary not yet reached.

Prerequisite resolution makes the candidate **eligible** for the next evaluator; it does not itself establish relevance, trigger satisfaction, permission, or ARM.

---

# 8. Trigger Architecture

## 8.1 Structured, versioned trigger contract

Runtime trigger authority comes only from a structured, versioned trigger contract composed from:

- approved deterministic trigger nodes;
- compound operators such as `ANY_OF` / `ALL_OF`;
- approved temporal/sequence operators;
- explicit `MANUAL_CONFIRMATION` nodes.

Human prose never becomes runtime trigger authority.

Unsupported or discretionary logic is never guessed. It either fails closed or uses explicit manual confirmation according to the accepted contract.

## 8.2 Relevance versus trigger satisfaction

`Relevant` and `Triggered` are permanently distinct.

Relevance means only:

> the candidate now warrants active trigger monitoring.

Relevance never implies permission or authorization.

Each registered trigger family owns two distinct predicates:

```text
evaluateRelevance(...)
evaluateSatisfaction(...)
```

ExecutionOS does not use a universal percent-distance relevance rule.

Purely discretionary/manual triggers cannot establish automatic relevance and require operator activation. A hybrid trigger may auto-activate from a deterministic prerequisite while still requiring later manual confirmation.

Relevance evaluation uses only lightweight fresh evidence needed for monitoring; it may not invoke DSS, Phase 4, account-risk, or ARM authority.

## 8.3 Activation and deactivation

A `WAITING` candidate may enter `PRETRADE_TRIGGER_EVALUATING` by:

- deterministic relevance; or
- explicit operator activation.

Operator activation starts monitoring only. It does not satisfy the trigger or bypass permission.

An automatically activated candidate may return to `WAITING` if relevance disappears before trigger satisfaction, provided it remains valid and not otherwise terminal.

A manually activated candidate is pinned active until trigger, explicit operator return, expiry, supersession, invalidation, or another terminal outcome.

## 8.4 Observation semantics

Every registered trigger node declares the authoritative evidence events that may evaluate it, for example:

```text
QUOTE_EVENT
BAR_CLOSE(timeframe)
SEQUENCE_EVENT
TIME_EVENT
MANUAL_EVENT
```

Evidence that does not match a node's declared observation semantics cannot satisfy it.

Examples:

- intrabar price break → quote/trade evidence;
- 2m close above level → completed 2m bar only;
- sweep → reclaim sequence → persistent sequence state;
- session time gate → time event;
- discretionary confirmation → manual event.

Trigger processing is idempotent to duplicate evidence and rejects stale/out-of-order evidence under normal operation.

## 8.5 Durable trigger progress

Stateful trigger progress is server-side durable state and includes, where applicable:

- candidate/version;
- trigger node identity;
- evaluator version;
- intermediate sequence state;
- consumed evidence identities;
- timing/bar bounds;
- manual-confirmation prerequisites.

Browser/process restart may not reset trigger progress.

Recovery resumes from the last durable state and consumes only authoritative new evidence, except where the trigger family explicitly supports deterministic historical reconstruction.

Unprovable evidence gaps fail closed.

Active evaluations remain bound to the evaluator version under which they began. Incompatible evaluator changes require explicit reconciliation or a new candidate/version.

## 8.6 Trigger persistence after satisfaction

Each trigger family explicitly declares persistence semantics after satisfaction, such as:

- condition-held;
- time-bounded;
- bar-bounded;
- one-shot;
- other approved temporal persistence.

There is no universal trigger-persistence duration.

If the satisfied trigger expires before ARM, dependent permission/review state is invalidated. The candidate either returns to trigger evaluation if the trigger can recur or moves to an applicable terminal outcome.

---

# 9. Structural Validity

Structural validity is a separate deterministic component from trigger satisfaction, DSS, and risk sizing.

Each permission attempt obtains a structural result:

```text
VALID
INVALID
BLOCKED
```

- `VALID` — the approved setup structure remains permissible.
- `INVALID` — the system can affirmatively prove the setup is structurally disqualified; during permission this may produce terminal PASS.
- `BLOCKED` — required structural evidence cannot currently be established; this is non-terminal and non-ARM-eligible.

Automatic structural judgment may use only approved deterministic rules and authoritative references/evidence.

Discretionary structural judgment requires explicit operator involvement.

Structural validity answers whether the thesis remains permissible. It does **not** replace or redefine `effectiveStop`.

Before trigger satisfaction, a deterministic thesis-invalidating condition may instead produce terminal `INVALIDATED`. Once the candidate has moved into permission, structural failure is represented through the permission outcome, normally PASS.

---

# 10. Phase 3 DSS — Preserved Approved Baseline

Phase 3 DSS consumes a resolved valid structural reference and produces the effective protective stop.

## 10.1 Approved volatility method

```text
2-minute Wilder ATR(14)
```

For ordinary completed bars:

```text
TR_t = max(
    high_t - low_t,
    abs(high_t - close_(t-1)),
    abs(low_t - close_(t-1))
)
```

Seed:

```text
ATR_14 = arithmetic mean of first 14 valid RTH True Ranges
```

Thereafter:

```text
ATR_t = ((ATR_(t-1) × 13) + TR_t) / 14
```

Approved session rules remain:

- RTH bars drive ATR;
- PM/AH bars do not update ATR;
- the first RTH 2m bar of a new session uses `high - low` to exclude overnight-gap contamination;
- forming bars never enter ATR;
- current-session first RTH 2m bar must complete before normal current-session DSS eligibility.

## 10.2 Deterministic reconstruction

The ATR accumulator is not persisted as authoritative application state.

On startup/restart, ATR is reconstructed deterministically from:

```text
20 completed RTH sessions
+ current RTH session
```

using authoritative source bars and deterministic 2m aggregation.

## 10.3 Approved buffer policy

V1 remains:

```text
Volatility Buffer = 2m Wilder ATR(14) × 0.30
```

The 0.30 multiplier is versioned policy and cannot be overridden by candidate source, symbol, setup, direction, source, or volatility regime without later explicit approved policy change.

## 10.4 Effective stop

LONG:

```text
rawEffectiveStop = structuralInvalidation - rawVolatilityBuffer
```

SHORT:

```text
rawEffectiveStop = structuralInvalidation + rawVolatilityBuffer
```

Rounding uses authoritative instrument `priceIncrement` and may never reduce protection:

- LONG → round downward to valid increment;
- SHORT → round upward to valid increment.

## 10.5 Freshness

Approved baseline remains:

```text
Live quote maximum age: 5 seconds
Completed 2m bar publication grace: 10 seconds
```

Stale/missing evidence fails closed.

## 10.6 DSS statuses

DSS returns only:

```text
VALID
BLOCKED
ERROR
```

DSS does not itself emit READY/CAUTION/PASS.

Each DSS evaluation is immutable and has a unique `dssEvaluationId` with sufficient provenance to reproduce why the stop was produced.

---

# 11. Permission Evaluation Pipeline

Canonical permission order is:

```text
trigger satisfied
      ↓
fresh market evidence
      ↓
structural validity
      ↓
Phase 3 DSS
      ↓
current expected-entry resolution
      ↓
exact account evidence
      ↓
Phase 4 risk sizing
      ↓
macro / setup context
      ↓
READY / CAUTION / PASS
```

## 11.1 Immutable permission attempt

Every pass through `PERMISSION_EVALUATING` is one immutable attempt with unique identity:

```text
permissionEvaluationId
```

The attempt explicitly links:

- candidate/version;
- satisfied trigger provenance;
- market snapshot/evidence;
- structural evaluation;
- DSS evaluation;
- current expected entry;
- exact account snapshot;
- Phase 4 risk evaluation;
- resulting permission outcome.

READY/CAUTION/PASS may be published only after the evidence required for that outcome is complete, mutually compatible, and fresh under its owning policies.

Retryable blockers may pause the same attempt only while previously acquired components remain usable. Stale/materially invalid components require a new permission attempt.

Completed attempts are never overwritten.

## 11.2 Temporary blockers

Temporary inability to evaluate does not add a new lifecycle state.

The candidate remains `PERMISSION_EVALUATING` with structured evaluation status such as:

```text
RUNNING
BLOCKED_RETRYABLE
BLOCKED_INTEGRITY
```

A temporary data/provider/account failure is not PASS.

## 11.3 Permission outcomes

- `READY` — positive permission package; ARM-eligible after review completeness.
- `CAUTION` — ARM-eligible only with conspicuous warnings and explicit acknowledgment of the current caution package.
- `PASS` — terminal for this exact candidate/version.

`READY` and `CAUTION` remain time-sensitive. Material stale/invalid evidence disables ARM and re-enters fresh permission evaluation.

---

# 12. Expected Entry, Account, Quantity, and Phase 4 Risk

## 12.1 Current expected entry

`currentExpectedEntry` is a freshness-sensitive authorization estimate, not necessarily the trigger price and not a guaranteed broker fill.

It is derived from a structured registered entry-intent model such as:

- marketable entry;
- stop entry;
- limit-at-level;
- retest entry;
- validated operator-selected assumption.

Operator entry assumptions are review state only and must be validated against the approved entry intent and current market context. They cannot be used to manufacture favorable sizing.

Permission and final ARM independently require a current valid expected-entry resolution.

## 12.2 Exact execution account

Every permission/ARM is bound to one exact eligible account selected in ExecutionOS.

Upstream account hints are non-authoritative.

A default account may auto-resolve only when unambiguous.

Account change invalidates permission/review/quantity/CAUTION state and requires re-evaluation.

ARM freezes the exact account; recovery may never substitute another account.

Missing fresh account evidence blocks permission rather than producing PASS.

## 12.3 Quantity units

All quantity values use native executable units:

- equities → shares;
- futures → contracts.

Phase 4 requires authoritative instrument identity and economics, including price increment/tick and value/multiplier metadata as applicable.

Missing required metadata blocks evaluation.

## 12.4 Phase 4 sizing

Phase 4 consumes the immutable VALID DSS `effectiveStop` and independently obtains fresh expected-entry/account/instrument inputs.

Conceptually:

```text
Risk Per Unit = |currentExpectedEntry - effectiveStop| × instrumentValue

Max Affordable Quantity = floor(maxDollarRisk / riskPerUnit)
```

Phase 4 may reduce maximum affordable quantity but may not alter structural invalidation or effective stop.

If no valid native minimum unit fits, the completed permission path may become PASS with a risk/affordability reason.

---

# 13. Operator Review Package

## 13.1 ARM-critical completeness

ARM is enabled only when the operator-critical package is complete/current, including:

- candidate identity/version;
- symbol/direction/setup;
- timeframe;
- satisfied trigger/provenance;
- current expected entry;
- structural invalidation;
- effective stop;
- exact account;
- max affordable quantity;
- selected quantity;
- max dollar risk;
- targets;
- management contract;
- permission state;
- freshness/provenance.

Detailed provenance remains available in Details.

## 13.2 Explicit quantity selection

`selectedQuantity` is initially unset in READY/CAUTION.

Phase 4 maximum is a **ceiling**, not a recommended or automatically selected size.

The operator explicitly selects:

```text
0 < selectedQuantity <= maxAffordableQuantity
```

SOD/source size hints may be informational but never silently populate selected quantity.

## 13.3 Review package identity

Server-side review state is bound to an exact materially reviewed authorization package using a `reviewPackageId` or equivalent authoritative identity.

Materially equivalent refreshes may preserve review state. Material changes create a new review package and clear quantity/CAUTION acknowledgment as required.

## 13.4 CAUTION acknowledgment

CAUTION requires explicit inline acknowledgment of the current caution set before ARM.

Acknowledgment is bound to the exact current caution/review package. Material change clears it.

READY requires no caution acknowledgment.

## 13.5 Final ARM confirmation

ARM itself is the final quantity/direction confirmation, for example:

```text
ARM NVDA LONG — 25 SHARES
```

No separate quantity-confirmation modal is required.

Accidental Enter-key activation must not ARM a trade.

---

# 14. ARM Revalidation, Atomicity, and Recovery

## 14.1 Fresh ARM-time comparison

Final ARM performs fresh authorization validation.

If the fresh package materially differs from the reviewed package:

- fresh max quantity below selected quantity → ARM fails; operator selects new quantity;
- new/material CAUTION → fresh acknowledgment/review required;
- PASS → ARM prohibited;
- material expected entry/effective stop/structural invalidation/dollar risk/account/state change → review + re-ARM required.

ExecutionOS never silently increases or decreases `selectedQuantity` during final ARM.

## 14.2 Atomic ARM commit

Successful ARM is one logical atomic operation only when all required durable facts are mutually consistent:

```text
immutable candidate ARMED provenance
+ exactly one immutable handoff
+ exactly one initial PENDING delivery
```

UI success is shown only after that durable result exists.

Partial persistence is fail-closed and recoverable.

## 14.3 ARM recovery

Every ARM reaching commit has a durable unique operation identity and immutable frozen payload.

Recovery behavior:

- if exact authorization is durably proven → forward-complete missing candidate-ARM/handoff/PENDING artifacts idempotently;
- if authorization cannot be proven → do not create authorization; require fresh permission and a new operator ARM.

Recovery never chooses a different payload, quantity, account, winner, or handoff.

## 14.4 No AUTO ARM

For this integration, **final ARM is always operator-controlled**.

Automation may:

- ingest candidates;
- establish relevance;
- evaluate triggers;
- run permission;
- calculate sizing;
- deliver alerts.

Automation may not establish final ARM authorization.

Upstream AUTO requests may be preserved as source intent/provenance but do not grant automatic ARM authority.

True AUTO ARM requires a future separate design.

---

# 15. Same-Symbol Candidates and OCO

## 15.1 Coexistence

Multiple same-symbol candidates may coexist in PRETRADE and independently evaluate.

ExecutionOS never infers OCO merely from symbol, direction, setup similarity, or arrival order.

## 15.2 OCO Group entity

OCO relationships are represented by a separate authoritative OCO Group entity.

OCO may be declared by:

- explicit upstream relationship intent; or
- explicit operator action.

Committed membership is bound to exact `candidateId + contractVersion` identities and is immutable.

A candidate may belong to at most one active OCO group.

Changing membership requires dissolve + new group, not in-place mutation.

## 15.3 Same-symbol ARM gate

Final ARM is blocked when:

- another non-terminal same-symbol candidate exists outside the same active OCO group; or
- Execution currently owns the symbol.

Terminal same-symbol candidates do not block.

The conflict may be resolved by OCO grouping or terminal disposition such as decline/invalidate as applicable.

## 15.4 OCO winner semantics

Trigger satisfaction does **not** cancel siblings.

Multiple OCO members may independently become trigger-satisfied, READY, or CAUTION.

The **first successfully committed ARM wins**.

That same atomic ARM transaction establishes:

```text
winner → ARMED
group → RESOLVED
still-active siblings → OCO_CANCELLED
one immutable handoff
one PENDING delivery
```

Concurrent sibling ARM attempts serialize; at most one wins.

A failed/stale/review-invalidated ARM does not resolve the group and does not cancel siblings.

## 15.5 OCO closure and dissolution

An unresolved active group may be explicitly `DISSOLVED` before any member ARM and before resolution/recovery has begun.

If all members become terminal non-ARMED without a winner, group becomes:

```text
CLOSED_NO_ARM
```

`RESOLVED` is reserved for successful winner ARM.

A new candidate version does not inherit predecessor OCO membership.

## 15.6 OCO sizing

Each member has independent:

- permission;
- risk evaluation;
- max quantity;
- selected quantity;
- caution package.

There is no pooled group quantity or pooled risk budget.

Only the winner's quantity becomes execution authority.

---

# 16. Execution Handoff and Router Boundary

The accepted downstream handoff remains immutable and exact-account linked.

Canonical rule:

> **PRETRADE authorizes; the handoff transfers; Execution owns operation.**

After successful ARM:

- PRETRADE `ARMED` becomes immutable read-only authorization history;
- PRETRADE cannot modify, decline, invalidate, rescale, return, or re-ARM that authorization;
- post-ARM DISCARD/retirement belongs to Execution;
- a discarded ARMED authorization does not return to READY; renewed interest requires a new candidate/version.

## 16.1 Downstream projection

PRETRADE remains `ARMED` while downstream state is shown as a separate read-only projection using immutable linkage IDs, never symbol inference.

Examples:

```text
pretradeState = ARMED
executionState = PENDING | LISTENING | LIVE | EXIT | HISTORY
```

If projection data are unavailable, UI says unavailable rather than guessing.

## 16.2 Router baseline

The V2.4 router is enabled by default and may be disabled only through the approved configuration switch:

```text
VITE_EXECUTIONOS_V24_ROUTER_DISABLED=true
```

Malformed authority blocks rather than degrading into unsafe fallback.

The accepted router architecture preserves serialized routing, leader/lock discipline, durable authority, recovery, and the rule that no network activity occurs while the critical store lock is held.

A LISTENING downstream trade survives PRETRADE disappearance because Execution already owns it.

---

# 17. Entry Authorization After ARM

Every successful intraday ARM carries a finite immutable first-entry authorization window.

The entry deadline is derived from the approved entry/management contract and is never extended merely because of:

- browser delay;
- process downtime;
- transport delay;
- recovery delay.

If no qualifying opening fill occurs before the boundary:

```text
unfilled authorization → retired/discarded
```

The old authorization may not later establish LIVE ownership.

Renewed interest requires fresh PRETRADE evaluation and new ARM.

If a qualifying first fill occurs in time, the trade becomes LIVE and unused position-build capacity is governed separately.

A broker fill observed after an expired no-fill authorization remains recorded as broker truth and creates an authorization exception rather than retroactively extending authorization.

Recovery may establish that a timely fill occurred from authoritative broker evidence but may never change the original deadline.

---

# 18. Quantity Semantics, Scaling, and Position Build

## 18.1 ARM quantity meaning

`selectedQuantity` is the maximum simultaneous position size authorized by ARM, not a one-shot order size.

Execution may scale in across multiple legs and scale out through partial exits under the frozen management contract.

Reducing exposure does not require new authorization.

Increasing simultaneous size beyond the immutable ARM ceiling requires a future separately approved risk-expansion authorization mechanism.

## 18.2 Structured management contract

Each candidate carries structured machine-readable management content plus optional human notes.

Structured management may define:

- `FLEXIBLE_WITHIN_CEILING` entry building;
- structured tranches;
- scale-out rules;
- re-add permissions;
- flat re-entry permissions;
- stop-management rules;
- target rules;
- terminal conditions;
- build windows.

Free-form prose is guidance only and cannot silently create machine authority.

The management contract is immutable candidate content and is frozen into ARM.

## 18.3 Position-build window

Unused ARM quantity does not remain automatically available for the life of the trade.

After a timely first fill, the live management contract defines initial position-building semantics such as:

- single-entry;
- time-bounded build;
- bar-bounded build;
- structured tranche conditions.

When all applicable initial-build opportunities expire, never-used capacity becomes unavailable for ordinary scale-in.

The immutable historical ARM ceiling remains unchanged, but the current live-management ceiling may become lower.

## 18.4 Complete Position Build

The operator may explicitly complete the initial position-building phase before the window expires.

This permanently relinquishes never-used initial capacity without rewriting the immutable ARM ceiling.

The resulting live-management ceiling becomes the maximum simultaneous quantity that was legitimately established before completion, even if current quantity was later reduced.

Automatic build-window expiry uses the same ceiling semantics.

Completing position build is distinct from permanently closing all future exposure-increase authority.

## 18.5 Re-add within established ceiling

Re-add after partial scale-out is allowed without new ARM only when:

- frozen management contract explicitly permits it;
- same symbol/direction/account/trade ownership remains;
- structure remains valid;
- resulting quantity does not exceed the applicable live-management ceiling;
- fresh add-risk checks pass.

A re-add may restore exposure toward legitimately established capacity; it may not resurrect stale never-used build capacity.

---

# 19. Live Risk Accounting and Finite Lifecycle Loss Budget

Every exposure-increasing leg — initial scale or permitted re-add — must pass fresh execution-side aggregate-risk validation.

The proposed resulting state must satisfy both:

```text
resulting live quantity <= applicable authorized/live-management ceiling
```

and

```text
cumulative realized losses attributable to authorization
+ worst-case remaining open loss after proposed add
<= original authorizedMaxDollarRisk
```

The ARM risk budget is a finite lifecycle loss budget, not a reusable instantaneous open-risk allowance.

Realized losses consume remaining risk capacity.

Realized profits do **not** replenish or increase the original risk budget.

If the requested add is too large, ExecutionOS may show the maximum permitted quantity for explicit operator choice, but may never silently resize an exposure-increasing action.

## 19.1 P/L attribution

Risk accounting derives realized P/L from the lossless broker journal and execution legs owned by the exact ARM authorization.

Use broker-authoritative lot/P&L attribution when reliably tied to the authorization; otherwise use one documented deterministic inventory convention for internal risk accounting.

Every relevant fill must be attributable. Ambiguity blocks exposure increases and triggers reconciliation/exception handling.

This is internal risk accounting, not tax accounting.

---

# 20. Live Effective Stop Authority

The current live effective/protective stop may change only through:

- explicit operator management action; or
- deterministic stop-management rule in the frozen authorized management contract.

Every change records:

- prior stop;
- new stop;
- timestamp;
- source;
- reason/rule.

Structural invalidation remains separate.

For exposure-increase risk checking, use the current authoritative effective/protective stop only if it remains valid under the management plan and is at least as risk-protective as the ARM effective-stop boundary.

A more protective stop may free some risk capacity **within** immutable quantity and dollar-risk ceilings.

A less-protective/wider stop may not be used to manufacture add capacity beyond authorization.

A missing authoritative current stop blocks exposure increases.

Updating ExecutionOS stop state does not imply a broker stop-order modification because broker writes remain disabled.

---

# 21. Actual Fill Economics

The immutable ARM record permanently preserves the expected-entry assumption used for authorization.

As soon as authoritative broker fills exist, live risk accounting switches to actual execution economics.

Actual fills never rewrite the historical ARM expected entry.

Small slippage that remains within authorization is recorded for audit/performance analysis and is not itself an authorization violation.

If actual fills cause risk, quantity, account, direction, timing, or other behavior to exceed the authorization envelope:

- broker activity remains recorded exactly as observed;
- the original authorization remains unchanged;
- an Authorization Exception is raised.

Partial fills, scale-ins, partial exits, and re-adds are risk-accounted from actual owned broker inventory.

Favorable fills may reduce current risk but never increase immutable quantity or dollar-risk ceilings.

If actual fill attribution cannot be established reliably, further exposure increases fail closed pending reconciliation.

---

# 22. Targets

Targets are structured, versioned candidate/ARM contract content.

Target definitions may include approved semantics such as:

- fixed price;
- price zone;
- authoritative reference-derived target;
- R-multiple;
- measured move;
- other approved deterministic target type.

Targets also carry explicit observation criteria, for example:

- trade-through;
- bar-close at/beyond;
- enter zone.

Dynamic targets preserve calculation/reference provenance and never use look-ahead values.

Target attainment creates live Execution management state/events but does not itself imply or perform a broker exit.

Planned scale-out fractions/quantities may be part of the frozen management contract, while actual broker fills remain authoritative for what occurred.

Authorized targets are immutable after ARM.

A later discretionary target may be recorded as live operator context but must remain labeled separately from the originally authorized target set.

---

# 23. Post-ARM Discretionary Management

Operator discretion after ARM is represented as explicit live Execution management actions/observations layered on top of, never silently modifying, the immutable authorization.

Risk-reducing actions may be applied within existing authorization and are durably recorded, including:

- partial reduction;
- final exit;
- more-protective effective-stop change;
- relinquishing unused build capacity;
- disabling future re-add/exposure-increase authority.

Actions that would enlarge quantity authority or widen risk beyond the remaining authorized lifecycle budget fail closed unless a future explicit risk-expansion authorization mechanism is separately designed and approved.

Free-form discretionary notes never become automatic machine authority.

---

# 24. Flat, Exit, and Re-Entry

Partial exits/re-adds may occur while authorization remains live under the frozen management contract.

Default verified flat behavior is terminal:

```text
FLAT → EXIT
```

The authorization is spent and cannot be reused.

Deliberate re-entry after fully flat is allowed only if the frozen management contract explicitly pre-authorized bounded flat re-entry semantics, and all original quantity/risk ceilings plus fresh add checks still apply.

Explicit final exit, stop-out, terminal management condition, or other terminal condition ends re-entry authority.

---

# 25. Authorization Exceptions and Reconciliation

Observed broker activity that conflicts with the frozen authorization creates a durable **Execution Authorization Exception**.

Authorization truth and broker truth remain separate.

Hard violations may include:

- quantity ceiling breach;
- dollar-risk breach;
- wrong account;
- wrong direction;
- late opening fill;
- prohibited terminal re-entry;
- management-contract violation;
- materially unresolvable fill attribution.

Critical exceptions block further exposure increases while still allowing exposure reduction/exit.

Returning numerically to compliance does not automatically restore exposure-increase authority after a CRITICAL exception.

Explicit reconciliation is required.

Where broker/auth state is objectively clear, the operator may choose an approved reconciliation outcome such as:

- Continue Trade after fresh compliance/risk checks; or
- Close to New Exposure permanently while retaining reduce/exit authority.

Integrity conflicts cannot be operator-overridden.

Historical exception records remain permanent.

---

# 26. PRETRADE UI Organization

PRETRADE UI uses three conceptual sections:

## Active

Includes active unarmed candidates and unresolved ARM recovery:

- WAITING;
- PRETRADE_TRIGGER_EVALUATING;
- PERMISSION_EVALUATING;
- READY;
- CAUTION;
- unresolved ARM recovery.

## Authorized / Execution

Includes `ARMED` candidates while downstream Execution remains active.

PRETRADE state remains ARMED; downstream state is projected separately.

## History

Includes:

- terminal unarmed outcomes;
- ARMED records after downstream History / ownership release.

UI classification does not mutate lifecycle state.

---

# 27. Alerts

Alerts are produced by a separate event-driven notification subsystem consuming committed durable event journals.

Alerts:

- never cause lifecycle transitions;
- never gate lifecycle transitions;
- never roll back transitions;
- may navigate the operator to relevant UI;
- may not ARM or otherwise alter authorization.

Delivery uses stable event IDs and durable per-channel idempotency/disposition.

---

# 28. Concurrency, CAS, and Event Journal

## 28.1 Server-side authority

All PRETRADE lifecycle mutations and ARM coordination are server-side authoritative.

Browser state is presentation-only.

Every mutable candidate has monotonic:

```text
stateRevision
```

separate from `contractVersion`.

Actions identify exact candidate/version/state/revision and use compare-and-swap semantics.

Successful material mutation increments `stateRevision`.

Stale actions cannot overwrite newer state.

## 28.2 Durable event journal

Every material lifecycle/authorization transition emits exactly one durable append-only event in the same authoritative mutation.

Events record; they do not cause state.

Event records include sufficient fields such as:

- event ID;
- candidate/version;
- resulting revision;
- before/after states;
- timestamp;
- source;
- reason;
- operation/evaluation IDs.

Duplicate logical operations do not duplicate lifecycle events.

Routine polling/refresh does not generate lifecycle events unless a material state/evaluation transition occurs.

---

# 29. Freshness Authority

Freshness is owned by backend domain policies.

Each input/evaluation carries immutable timing/provenance.

Freshness thresholds are centralized, versioned/configured, and may differ by domain/phase where explicitly approved.

Stale or unverifiable evidence fails closed.

Browser clock/page age is never authoritative.

READY/CAUTION that become stale automatically disable ARM and re-enter permission evaluation as required.

Final ARM uses strict current freshness.

---

# 30. Intent-Specific Command API

PRETRADE and related Execution lifecycle mutation APIs expose **intent-specific commands**, never generic state-setting endpoints.

Examples include commands conceptually equivalent to:

- activate candidate;
- return auto-activated candidate to waiting where legal;
- confirm manual trigger;
- decline candidate;
- invalidate candidate;
- select quantity;
- acknowledge caution;
- create/dissolve OCO group;
- ARM candidate;
- complete position build;
- close further exposure;
- approved live management actions.

Every command includes:

- exact candidate/version or relevant authoritative entity identity;
- durable idempotency `operationId`;
- expected lifecycle state;
- expected revision;
- related revision guards where needed, such as OCO group revision.

The lifecycle coordinator determines legal resulting state and performs validation, CAS, persistence, event journaling, and creation of authoritative evaluation/handoff IDs.

The browser cannot directly assign canonical state.

Automatic evaluators use the same authoritative mutation coordination path as operator commands.

Duplicate command submissions with the same operation identity return the established result without duplicating side effects.

Rejected commands return structured fail-closed reason codes.

---

# 31. Startup and Crash Recovery

ExecutionOS performs deterministic authoritative reconciliation before enabling mutable lifecycle actions for affected entities.

Recovery loads durable:

- candidate contracts/state/revisions;
- lifecycle event journals;
- OCO entities;
- permission/review records;
- ARM operation records;
- handoffs;
- delivery records;
- Execution ownership/lifecycle;
- broker execution journal.

Recovery order prioritizes ownership safety:

1. resolve incomplete ARM operations;
2. reconcile OCO outcomes;
3. establish downstream Execution ownership;
4. reconstruct broker-driven lifecycle/risk state;
5. enable normal evaluator/command mutation only after authoritative state is coherent.

Proven incomplete operations are forward-completed idempotently.

Authority that cannot be proven is never invented.

Entities with unresolved integrity conflicts remain fail-closed/read-only for authorization-changing or risk-increasing actions.

Recovery may repair read-only projections from stronger linked authority but may not silently rewrite immutable authorization history or choose among contradictory authoritative records without proof.

---

# 32. Same-Symbol Candidate Behavior After Execution Ownership Release

When Execution releases symbol ownership, the conflict is removed but old permission is not grandfathered.

A still-valid candidate must obtain fresh permission before ARM.

Previously satisfied trigger state may be retained only if its trigger-specific persistence semantics still permit it; otherwise the candidate returns to trigger evaluation or reaches the appropriate terminal outcome.

Fresh account, market, DSS, Phase 4, review, quantity, and CAUTION state are required.

An unresolved OCO group may resume viable members after ownership conflict clears.

---

# 33. PRETRADE Persistence and Future Analytics Compatibility

This baseline's operational persistence is authoritative for execution correctness, recovery, and auditability.

Durable records intentionally preserve the full decision chain, including:

- immutable candidate/version history;
- trigger/evidence provenance;
- structural evaluations;
- DSS/permission/risk evaluations;
- selected quantity and caution review state;
- ARM provenance;
- immutable handoff/delivery state;
- lossless broker fills;
- live stop/target/management events;
- lifecycle loss accounting;
- authorization exceptions;
- terminal outcomes.

A future analytics/reporting module may build read-only derived projections from this operational truth. Analytics must never become operational authority or rewrite historical execution facts.

Detailed market-path persistence/reconstruction required for advanced MFE/MAE, post-exit path, replay, and simulation remains a future analytics design concern and is not required to begin the PRETRADE implementation.

---

# 34. Implementation Plan — Approved by Decision 97

The design phase is complete. Implementation proceeds in small independently testable slices.

## Slice 1 — Canonical Backend Lifecycle Authority

Implement:

- authoritative PRETRADE coordinator;
- canonical transitions;
- `stateRevision` CAS;
- durable operation identities/idempotency;
- event journal;
- terminal outcomes;
- prerequisite/blocker representation;
- recovery gating.

## Slice 2 — Candidate Ingress + Versioning

Implement/reconcile:

- one canonical ingress;
- immutable candidate contracts;
- version/content duplicate/conflict handling;
- supersession;
- exact validity;
- structured trigger/reference/entry/management contracts.

## Slice 3 — Trigger Engine

Implement:

- relevance evaluator;
- trigger satisfaction evaluator;
- observation semantics;
- persistent sequence progress;
- reference resolution;
- trigger persistence;
- manual-confirmation path.

## Slice 4 — Permission Pipeline

Integrate:

```text
fresh evidence
→ structural validity
→ DSS
→ expected-entry resolution
→ exact account evidence
→ Phase 4
→ READY / CAUTION / PASS
```

with immutable permission provenance and blocker/retry behavior.

## Slice 5 — Review + ARM

Implement:

- account context;
- explicit quantity;
- review-package identity;
- CAUTION acknowledgment;
- material-refresh invalidation;
- same-symbol/OCO ARM gates;
- intent-specific ARM command;
- atomic ARM/recovery;
- accepted immutable handoff integration.

## Slice 6 — PRETRADE UI

Replace the read-only WAITING-only experience with authoritative projections/actions for:

- Active;
- Authorized / Execution;
- History.

The UI emits intents only; it does not establish canonical state.

## Slice 7 — Required Live-Management Extensions

Add only the new concepts required by this frozen baseline, including:

- entry-authorization expiry;
- position-build windows;
- complete-position-build;
- live-management ceiling;
- exposure-increase risk checks;
- lifecycle loss budget;
- live effective-stop authority;
- targets;
- discretionary management actions;
- authorization exception/reconciliation.

The accepted downstream lifecycle is extended where necessary, not casually redesigned.

---

# 35. Test and Acceptance Strategy

Every implementation slice requires focused deterministic tests before progression.

Final acceptance requires:

- focused slice tests;
- existing downstream regression suite;
- deterministic PRETRADE tests;
- build verification;
- synthetic full PRETRADE → Execution E2E.

The principal new full-path E2E should establish:

```text
SOD / Candidate Ingress
        ↓
WAITING
        ↓
relevance
        ↓
trigger satisfied
        ↓
PERMISSION_EVALUATING
        ↓
READY
        ↓
quantity selected
        ↓
ARM
        ↓
immutable handoff
        ↓
PENDING
        ↓
LISTENING
        ↓
broker fill
        ↓
LIVE
        ↓
EXIT
        ↓
History
```

Additional required scenario coverage includes at least:

- CAUTION + acknowledgment;
- PASS;
- expiration;
- manual trigger;
- reference prerequisite;
- same-symbol conflict;
- OCO winner/cancellation;
- failed OCO ARM leaves group viable;
- stale permission during ARM;
- interrupted ARM recovery;
- partial fills;
- scaling/re-adds;
- position-build expiry/completion;
- finite lifecycle loss budget;
- authorization exception;
- restart recovery.

No implementation slice is accepted merely because it builds; behavioral invariants must be regression-tested.

---

# 36. Explicitly Out of Scope for This Implementation

The following remain outside the present PRETRADE → ARM implementation unless separately designed/approved:

- broker order placement/cancel/replace/flatten;
- true unattended AUTO ARM;
- automatic broker stop management;
- AI-generated trading authority;
- self-tuning risk/ATR buffer policy;
- generalized strategy/scanner engine;
- unrestricted risk-expansion authorization after ARM;
- tax-lot accounting;
- full TradeZella-style analytics UI;
- full market replay engine;
- full historical backtesting engine;
- automatic behavioral coaching that can modify authorization.

The persistence and provenance architecture should support future analytics, but analytics remains read-only derived functionality until separately designed.

---

# Appendix A — Frozen Decisions 22–97

The following decisions are frozen and are implementation authority. The summaries below are intentionally concise; the governing semantics are expanded in the sections above.

## Decision 22 — Router
V2.4 router default ON; approved disable switch only; serialized/recoverable authority with accepted lock/leader discipline and downstream LISTENING persistence.

## Decision 23 — Hybrid Relevance-Gated Activation
WAITING auto-activates only from deterministic fresh relevance; any eligible candidate may be manually activated; activation is monitoring, not trigger satisfaction or authorization.

## Decision 24 — Trigger Satisfaction Gate
Only actual supported trigger satisfaction moves PRETRADE trigger evaluation into permission; manual triggers require explicit confirmation; no bypass.

## Decision 25 — READY / CAUTION / PASS
READY and CAUTION are ARM-eligible under their review rules; PASS is terminal and fail-closed.

## Decision 26 — ARM Information Completeness
ARM requires complete/current operator-critical identity, trigger, entry, stop, quantity, risk, account, target, management, and freshness data.

## Decision 27 — Explicit Quantity Selection
Selected quantity begins unset and must be explicitly chosen within the Phase 4 maximum; upstream hints are non-authoritative.

## Decision 28 — ARM Is Final Quantity Confirmation
ARM button itself confirms direction and quantity; material fresh changes require review; no accidental Enter-key ARM.

## Decision 29 — READY/CAUTION Time Sensitivity
Supporting evidence is monitored; material stale/invalid state disables ARM and revalidates permission; no grandfathering.

## Decision 30 — ARM Atomicity
Successful ARM durably establishes immutable ARMED provenance + exactly one handoff + exactly one PENDING delivery as one logical transaction.

## Decision 31 — Durable ARM Recovery
Proven frozen authorization is forward-completed idempotently; unproven authorization is never invented.

## Decision 32 — Relevance Disappearance
Auto-activated trigger monitoring may de-escalate to WAITING when relevance disappears; manual activation remains pinned until an allowed resolution.

## Decision 33 — Expiration
Unarmed candidates reaching validity end become terminal EXPIRED; ARMED is not retroactively revoked.

## Decision 34 — Invalidation
Pre-trigger deterministic/operator thesis invalidation produces terminal INVALIDATED; post-trigger structural failure is handled through permission/PASS.

## Decision 35 — PASS Terminal
PASS is terminal for the exact candidate/version; continued interest requires a new version.

## Decision 36 — DECLINED
Operator may terminally decline an unarmed active candidate with structured reason and optional note.

## Decision 37 — Newer Versions
A newer contract version supersedes the older active unarmed version of the same logical candidate; ARMED remains immutable.

## Decision 38 — CAUTION Acknowledgment
CAUTION requires explicit acknowledgment bound to the exact current caution/review package.

## Decision 39 — ARM-Time Material Changes
Final ARM package must materially match reviewed package; no silent quantity changes or stale CAUTION/stop/account assumptions.

## Decision 40 — Concurrency / CAS
All PRETRADE mutations are server-authoritative, serialized/idempotent as required, CAS-guarded by monotonic stateRevision separate from contractVersion.

## Decision 41 — Durable Event Journal
Every material PRETRADE lifecycle/authorization transition emits one durable append-only event in the authoritative mutation.

## Decision 42 — Freshness Authority
Backend domain policies own freshness; stale/unverifiable evidence fails closed; browser time is non-authoritative.

## Decision 43 — No AUTO ARM
Automation may evaluate but final ARM is always operator-controlled in this integration.

## Decision 44 — Canonical Candidate Ingress
All candidate producers submit proposals through one server-side ingress and cannot establish permission/sizing/ARM/execution authority.

## Decision 45 — Backend Authority
All PRETRADE lifecycle mutations and ARM coordination are server-side; browser state is presentation-only.

## Decision 46 — Review Package Identity
Selected quantity and CAUTION acknowledgment are bound to exact materially reviewed authorization package identity.

## Decision 47 — Permission Blockers
Temporary inability to evaluate remains PERMISSION_EVALUATING with structured blocker status rather than inventing a new lifecycle state or PASS.

## Decision 48 — Post-ARM Ownership Boundary
Successful ARM permanently transfers operational ownership to Execution; PRETRADE ARMED becomes immutable.

## Decision 49 — Downstream Status Projection
PRETRADE ARMED and downstream Execution state remain separate state machines linked by immutable IDs.

## Decision 50 — PRETRADE UI Sections
UI organizes Active, Authorized/Execution, and History without mutating canonical states.

## Decision 51 — Alerts
Alerts consume committed events and never cause, gate, roll back, or authorize lifecycle transitions.

## Decision 52 — Candidate Immutability
Accepted trade-plan content is immutable; material edits require a new contractVersion.

## Decision 53 — Same-Symbol OCO
Multiple same-symbol alternatives may coexist when explicitly OCO; first successful ARM wins and atomically OCO-cancels remaining active siblings.

## Decision 54 — OCO Creation / Same-Symbol Coexistence
Same-symbol candidates may coexist ungrouped; OCO is explicit, represented by separate authoritative OCO Group entity, never inferred.

## Decision 55 — Same-Symbol ARM Gate
ARM is blocked by other non-terminal same-symbol candidates outside the same OCO group or by active Execution ownership.

## Decision 56 — OCO Dissolution
Unresolved OCO may be explicitly dissolved before ARM/recovery; membership changes use dissolve + new group.

## Decision 57 — OCO Resolution Atomic with ARM
Winner ARMED, group RESOLVED, active siblings OCO_CANCELLED, handoff, and PENDING delivery are established in the same durable ARM transaction.

## Decision 58 — Failed OCO ARM
Failed/stale/uncommitted ARM does not choose a winner or cancel siblings.

## Decision 59 — OCO No-Arm Closure
All-terminal-without-winner groups become CLOSED_NO_ARM; RESOLVED requires successful ARM.

## Decision 60 — OCO + Candidate Version
OCO membership binds exact candidate/version and is not inherited by a newer contract version.

## Decision 61 — Candidate Validity
Every intraday candidate has exact finite validFrom/validUntil and session/timezone provenance.

## Decision 62 — Execution Account
Permission/ARM binds one exact eligible account; account change invalidates permission/review; ARM freezes account.

## Decision 63 — Quantity Semantics
Quantity is native executable units with authoritative instrument/tick/value metadata.

## Decision 64 — OCO Sizing
Each OCO member independently owns permission/risk/quantity/review; no pooled group risk or quantity.

## Decision 65 — OCO Triggers
OCO trigger/permission progress is independent per member; cancellation occurs only on successful winner ARM.

## Decision 66 — Scale In/Out
ARM quantity is maximum simultaneous position size, permitting scale-in/scale-out under management contract rather than one-shot entry only.

## Decision 67 — Re-Add Within Ceiling
Re-add after partial scale-out is allowed only when pre-authorized by management and within applicable live ceiling with fresh checks.

## Decision 68 — Exposure-Increase Risk Check
Every exposure-increasing leg requires fresh aggregate-risk validation; reductions do not require new risk authorization.

## Decision 69 — Stop Used for Add Risk
Add-risk uses current authoritative protective stop only when valid and at least as protective as the ARM boundary; widening cannot manufacture capacity.

## Decision 70 — Live Effective-Stop Authority
Live effective stop changes only through explicit operator action or deterministic authorized rule with full provenance.

## Decision 71 — Terminal Exit / Flat Re-Entry
Default flat is terminal; bounded flat re-entry requires explicit pre-authorization in the frozen management contract.

## Decision 72 — Structured Management Contract
Machine-readable management rules plus optional notes define scale, re-add, stop, terminal, and other live semantics; prose alone is not authority.

## Decision 73 — Entry Build Policy
ARM selected quantity is max simultaneous position; build policy may be flexible or tranche-structured and violations remain observable exceptions.

## Decision 74 — Authorization Exceptions
Broker activity outside the frozen envelope creates durable exception state; broker truth is preserved and authorization is never retroactively normalized.

## Decision 75 — Critical Exception Reconciliation
CRITICAL exception requires explicit reconciliation before add authority can resume; integrity conflicts are not operator-overridable.

## Decision 76 — Finite Lifecycle Loss Budget
Authorized max dollar risk is a finite lifecycle loss budget; realized losses consume it and realized profits do not replenish it.

## Decision 77 — P/L Attribution
Authorization risk accounting derives realized P/L deterministically from lossless broker-owned execution legs; ambiguity blocks adds.

## Decision 78 — Same-Symbol Candidate After Ownership Release
Ownership release removes only the conflict; old permission is not grandfathered and fresh evaluation/review is required.

## Decision 79 — Trigger Persistence
Every trigger family declares explicit post-satisfaction persistence semantics; no universal trigger duration.

## Decision 80 — Structured/Versioned Trigger Contract
Runtime trigger authority comes only from approved structured versioned trigger nodes/operators/manual confirmation, never prose guessing.

## Decision 81 — Automatic Relevance Evaluator
Relevance is a separate deterministic trigger-family evaluator using lightweight fresh evidence and never implies satisfaction/permission/ARM.

## Decision 82 — Trigger Observation Semantics
Every trigger node declares authoritative evidence-event semantics; processing is event-driven, idempotent, and rejects stale/out-of-order evidence.

## Decision 83 — Durable Trigger Progress
Stateful trigger progress persists server-side across restart; unprovable evidence gaps fail closed; evaluator version remains bound.

## Decision 84 — Reference-Level Authority
Trigger/structural levels use explicit authoritative fixed/dynamic definitions with provenance; unresolved or materially corrected references fail closed/reconcile.

## Decision 85 — Unresolved Prerequisites
Unresolved deterministic prerequisites remain structured conditions within current lifecycle state rather than new lifecycle states.

## Decision 86 — Immutable Permission Evaluation
Each PERMISSION_EVALUATING attempt has one immutable identity linking trigger, evidence, structure, DSS, account, entry, Phase 4, and final outcome.

## Decision 87 — Structural Validity Component
Structural evaluation returns VALID/INVALID/BLOCKED as a distinct permission component separate from trigger, DSS, and risk.

## Decision 88 — Current Expected Entry
Expected entry is a validated structured entry-intent-derived risk estimate, not trigger price or guaranteed fill.

## Decision 89 — Actual Fill Economics
ARM preserves expected-entry provenance while live risk switches to actual broker fill economics; violations create exceptions without rewriting ARM.

## Decision 90 — Finite First-Entry Authorization
Every intraday ARM has a finite immutable first-fill authorization window; unfilled expiry retires authorization.

## Decision 91 — Position-Build Capacity Expiry
Unused initial ARM capacity does not remain available forever; structured build windows/tranches govern and live ceiling may ratchet lower.

## Decision 92 — Complete Position Build
Operator may explicitly end initial build early, permanently relinquishing never-used capacity while preserving re-add semantics within established live ceiling.

## Decision 93 — Structured Targets
Targets are structured/versioned contract content; target attainment creates management state/events but no broker action.

## Decision 94 — Post-ARM Discretionary Management
Live discretionary actions/observations layer on immutable ARM; risk reductions are allowed and recorded, risk expansion fails closed absent future authority.

## Decision 95 — Intent-Specific API
Lifecycle mutation APIs expose intent commands with operation identity/revision guards; no generic client state-setting endpoint exists.

## Decision 96 — Startup Recovery
Startup reconciles ARM/OCO/Execution/broker authority deterministically before mutable actions resume; unproven contradictions fail closed.

## Decision 97 — Design Complete / Implementation Slices
The PRETRADE → ARM integration architecture is complete; implementation proceeds in seven controlled slices, and new architecture decisions are introduced only when implementation reveals a genuinely unresolved material issue.

---

# Final Design Closure Statement

With Decision 97 approved, **ExecutionOS V2.4 PRETRADE → ARM architecture is frozen for implementation at v0.5**.

The implementation team shall work from this document and the accepted downstream regression baseline. The design is not to be reopened for speculative additions. If implementation exposes a genuine unresolved material architectural conflict, that issue must be isolated, explicitly designed, approved, and documented before changing the frozen behavior.
