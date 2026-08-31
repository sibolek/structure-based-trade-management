# ExecutionOS V2.4 — Pre-Trade Permission Layer

## Approved Consolidated Design Baseline

**Version:** 0.4  
**Status:** APPROVED DESIGN BASELINE — Design Only / Phase 3 Implementation Not Yet Authorized  
**Project:** `sibolek/structure-based-trade-management`  
**Target baseline:** `main` at Phase 2 merge commit `9ea7a21` (or a verified descendant containing no conflicting V2.4 changes)  
**Relationship to V2.3:** Extends the upstream pre-trade permission flow; does not replace the trusted/frozen V2.3 execution layer  
**Relationship to V3:** Intended to stabilize the pre-trade contract and ARM boundary before Management Governor work begins  
**Phase 3 implementation status:** NOT YET AUTHORIZED  

**Consolidates and supersedes for top-level V2.4 design purposes:**

- ExecutionOS V2.4 broad design baseline v0.2;
- the broad v0.3 design with approved VIX/VIX1D market-regime addition;
- ExecutionOS V2.4 Phase 3 DSS & Volatility Buffer Design Baseline v0.3 (approved);
- Phase 1 and Phase 2 implementation/acceptance decisions now merged into `main`.

Where an older broad statement conflicts with the approved Phase 3 DSS baseline or with already-merged Phase 1/2 behavior, this v0.4 document uses the newer approved/implemented decision.

## v0.4 Final Reconciliation Notes

The final v0.4 baseline additionally locks or formalizes:

- SOD trade-card structured source-of-truth and extensible rich payload;
- pluggable push/pull candidate-source connectors and source registry/capability policy;
- source-scoped candidate identity and fail-closed cross-source same-symbol conflict handling;
- compound trigger definitions;
- static vs dynamic structural invalidation definitions and runtime `structureEvaluation`;
- Schwab as V2.4 V1 authoritative market-data/reference-metadata provider behind replaceable interfaces;
- `priceIncrement` semantics for directional stop rounding;
- deterministic Wilder ATR reconstruction from 20 completed RTH sessions + current session, with no persisted authoritative ATR accumulator;
- exact 10-second completed-bar grace semantics;
- expanded Phase 3 input/output/provenance contracts;
- Phase 5 ownership of trigger + structural-rule evaluation;
- first-class `entryConstraints[]` and `disqualifiers[]` preserved from trade-card definitions;
- composable structural invalidation rules using `ALL_OF` / `ANY_OF`;
- end-to-end verification against the META PMH Breakout / Retest A+ trade-card pattern.

### Approval Scope

This v0.4 document is the **authoritative top-level V2.4 design baseline** as of 2026-08-31. It supersedes earlier broad V2.4 design drafts and the separate Phase 3 DSS design baseline for design-reference purposes.

Approval of this document approves the **design**, not implementation. Phase 3 implementation remains gated on explicit implementation authorization. The frozen/trusted V2.3 execution layer and the read-only Schwab broker boundary remain protected.

---

# 1. Purpose

ExecutionOS V2.4 moves execution discipline one step upstream.

ExecutionOS V2.3 already preserves and manages a pre-entry Trade Contract after a candidate is armed and a broker fill is detected. V2.4 adds a deterministic **pre-trade permission layer** that determines whether a candidate deserves to enter that execution workflow.

> **V2.4 should improve trade permission, not become a trading-strategy engine.**

```text
CANDIDATE SOURCE
      ↓
NORMALIZED CANDIDATE
      ↓
PRE-TRADE PERMISSION LAYER
      ↓
CONTROLLED ARM BOUNDARY
      ↓
EXISTING V2.3 EXECUTION BOARD
      ↓
BROKER FILL OWNERSHIP
      ↓
EXECUTION / MANAGEMENT
      ↓
HISTORY / EOD REVIEW
```

The existing Execution Board remains the stable downstream execution layer.

---

# 2. Core Architectural Principle

Do not start over.
Do not discard, rewrite, or redesign working V2.3 execution-management functionality unless a specific architectural conflict makes a change necessary.

The canonical runtime direction is:

```text
APPROVED CANDIDATE SOURCE
(SOD / MANUAL / FUTURE APPROVED SOURCE)
        ↓
SOURCE ADAPTER / CANONICAL EXPORT
        ↓
VERSIONED CANDIDATE JSON
        ↓
CANDIDATE INGESTION
        ↓
WAITING
        ↓
PRETRADE_TRIGGER_EVALUATING
        ↓
PERMISSION_EVALUATING
        ↓
FRESH MARKET SNAPSHOT
        ↓
STRUCTURAL VALIDITY
        ↓
PHASE 3 DSS / MICRO-VOLATILITY BUFFER
        ↓
EFFECTIVE STOP
        ↓
PHASE 4 RISK SIZING
        ↓
MACRO / SETUP CONTEXT
        ↓
DECISION GATE
        ↓
READY / CAUTION / PASS
        ↓
MANUAL / CONTROLLED AUTO ARM
        ↓
EXISTING V2.3 EXECUTION BOARD
        ↓
BROKER ENTRY / FILL OWNERSHIP
        ↓
EXECUTION / MANAGEMENT
        ↓
HISTORY / EOD REVIEW
```

A SOD A+ trade is a **candidate proposal**, never an ARM command.

---

# 3. Governing Trading Logic

The stop/risk hierarchy is permanently:

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
POSITION SIZE
```

Macro/session volatility remains separate:

```text
SESSION / BROAD-MARKET VOLATILITY
        ↓
CONTEXT / SELECTIVITY / PERMISSION REASONING
```

Macro volatility must **not** mechanically widen or tighten the structural/effective stop.

> **If the correct stop is unaffordable, reduce size or pass the trade.**

The system must never tighten a structurally appropriate stop merely to fit the risk budget.

---

# 4. Current Implementation Status

## Phase 1 — Candidate Ingestion — COMPLETE / MERGED

Implemented and merged into `main`:

- versioned candidate bundle ingestion;
- loopback pre-trade API;
- validation / normalization;
- deterministic content hashing;
- duplicate / conflict / stale-version handling;
- supersession;
- persistence;
- read-only WAITING board;
- PRE-TRADE / EXECUTION workspace separation;
- no V2.4 ARM authority;
- no broker-write authority.

Primary endpoint:

```text
POST /api/candidates/import
```

Primary V2.4 pre-trade service bind:

```text
127.0.0.1:8788
```

## Phase 2 — MarketDataProvider — COMPLETE / MERGED

Implemented, live-tested, accepted, and merged into `main` via PR #10.

Current provider boundary:

```text
MarketDataProvider
  async getQuote()
  async getMinuteBars()
  async getDailyBars()
```

Approved/implemented market-data principles:

- Schwab is the authoritative V2.4 V1 read-only market-data and market/reference-metadata provider wherever required data are available;
- provider logic exposes normalized data, not opaque strategy indicators;
- market/session clock uses `America/New_York`;
- 1-minute data may be deterministically aggregated into 2-minute bars;
- RTH alignment begins 09:30 ET;
- missing and duplicate minute slots are detected;
- a bar may be source-complete but still temporally open;
- forming 2-minute bars are never considered complete;
- live quote freshness is evaluated fail-closed;
- provider remains READ ONLY;
- required instrument metadata such as `priceIncrement` / tick size should be obtained through the Schwab-backed provider/reference boundary;
- `priceIncrement` means the smallest valid executable price step for the instrument and is used only for directionally protective rounding;
- DSS contains no Schwab-specific calculation logic; normalized provider interfaces remain replaceable so a future NinjaTrader or other data source can be introduced without rewriting DSS;
- missing/unverifiable required instrument metadata fails closed.

Live acceptance on 2026-08-31 established:

- live quote age repeatedly ~0–1 second;
- zero missing RTH minute slots in observed tests;
- zero duplicate RTH minute slots in observed tests;
- newly closed 2-minute bar available by approximately +2 seconds and stable through +12 seconds;
- the approved 10-second publication grace is conservative;
- patched live probe correctly excludes the forming 2-minute interval;
- focused market-data suite 11/11 PASS;
- full suite 39/39 PASS;
- deterministic trade-state suite 10/10 PASS;
- production build PASS.

## Phase 3 — DSS / Volatility Buffer — DESIGN APPROVED / IMPLEMENTATION NOT YET AUTHORIZED

The detailed DSS design is locked by the approved Phase 3 v0.3 baseline and is incorporated into this document.

## Phase 4 — Effective-Stop Risk Sizing — NOT YET IMPLEMENTED

Consumes the immutable Phase 3 DSS result and sizes from `effectiveStop` only.

---

# 5. Scope of V2.4

V2.4 should answer these core questions:

1. Is the candidate structurally defined?
2. Has the candidate reached a state where pre-trade evaluation is relevant?
3. Is the required market data fresh and internally valid?
4. Where is the trade structurally invalidated?
5. How much local micro-volatility buffer is appropriate?
6. What is the effective stop?
7. Can the trade be sized within the configured risk limit?
8. Is there contextual caution or support?
9. May this candidate be armed?

Initial V2.4 scope includes:

- SOD Section 15 A+ ingestion as the first automated source;
- manual candidate compatibility;
- normalized candidate / Trade Contract representation;
- structural invalidation capture and rule semantics;
- deterministic 2-minute Wilder ATR(14);
- effective-stop calculation;
- effective-stop risk sizing;
- DTR / Daily ATR context;
- VIX / VIX1D broad-market volatility-regime context;
- deterministic trigger evaluation for supported trigger types;
- MANUAL_CONFIRMATION fallback;
- READY / CAUTION / PASS permission classification;
- MANUAL / AUTO arm modes;
- controlled automatic ARM transition;
- candidate expiry / supersession;
- provenance / immutable decision history;
- compatibility with existing broker-fill ownership and EOD History enrichment.

---

# 6. Explicitly Out of Scope

Deferred:

- automatic broker order placement;
- Schwab broker-write authority;
- automatic stop replacement / cancellation;
- automatic flattening;
- AI setup selection;
- VIX-generated candidates;
- general-purpose signal generation;
- full market scanner functionality;
- complex revenge-trading / behavioral detection;
- adaptive rule optimization;
- self-tuning buffer multipliers;
- full historical optimizer;
- sophisticated multi-factor strategy scoring;
- Management Governor;
- NinjaTrader write integration.

V2.4 is a **pre-trade permission system**, not a full automated trading system.

---

# 7. Candidate-Source Boundary and First Automated Source

## 7.1 Pluggable Candidate-Source Architecture

ExecutionOS must not be hard-wired to a single candidate source. The SOD A+ trade list is the **first automated source**, not the permanent or exclusive source.

All candidate sources must cross the same normalized ingestion boundary:

```text
SOURCE-SPECIFIC CANDIDATE OR TRADE DEFINITION
        ↓
SOURCE ADAPTER / CONNECTOR
        ↓
VERSIONED CANONICAL CANDIDATE BUNDLE
        ↓
POST /api/candidates/import
        ↓
VALIDATION / NORMALIZATION / PERSISTENCE
        ↓
WAITING
        ↓
COMMON V2.4 PERMISSION FLOW
```

A source adapter / connector may be push-based, pull-based, or manually invoked, but its output must conform to the same versioned candidate contract before the candidate enters ExecutionOS state.

Source-specific parsing, credentials, transport details, or proprietary fields must remain **outside** the core permission engine. The downstream permission flow must not need special-case logic for SOD versus any later approved source.

The candidate-source boundary must support, without redesigning the permission engine:

- `SOD_A_PLUS` as the first automated source;
- manual / ad-hoc candidate import using the same canonical contract;
- later approved scanners, research feeds, watchlists, or other external candidate producers;
- source-specific provenance and versioning;
- source allowlisting / capability policy for automated ingestion and AUTO requests.

Adding a new source requires a source adapter / connector, contract-validation tests, provenance mapping, and explicit source-policy approval. It must **not** require changes to DSS, risk sizing, the decision gate, or the existing Execution Board merely because the source is different.

No source connector may bypass candidate validation, persistence, `WAITING`, fresh permission evaluation, ARM policy, or any fail-closed rule.

### Source registry, trust, and capabilities

V2.4 must introduce a logical `CandidateSourceRegistry` before additional unattended automated sources are trusted. Source identity and source capability must be determined by the registered connector / transport context, not merely by a self-declared payload string. Conceptually each source registration should carry:

```text
sourceId
adapterId
adapterVersion
ingestionAllowed
autoRequestAllowed
trust / verification method
source freshness / health policy where applicable
```

A payload claiming `source = SOD_A_PLUS` does **not** by itself receive SOD privileges. AUTO-request capability is granted by source policy, never by payload assertion alone.

### Source-scoped candidate identity

Candidate identity must be source-scoped so unrelated producers cannot collide accidentally. The logical identity is:

```text
sourceId + candidateId + contractVersion
```

A future globally unique ID may additionally be assigned, but duplicate/version semantics must never cause `candidateId = nvda-long-01` from two different sources to be treated as revisions of one logical candidate unless an explicit linkage says so.

### Cross-source same-symbol conflicts

If two sources propose active candidates for the same symbol, especially opposing directions, V1 must not silently choose a winner based on source name or arrival time. It should surface a deterministic same-symbol/source conflict and require explicit resolution unless a later tested source-precedence policy is approved.

### Push and pull connector state

A pull-based connector may own source-specific state such as `checkpoint/cursor`, `lastSuccessfulRead`, `sourceFreshness`, and `adapterVersion`. A push-based connector may own transport verification/authentication and receipt provenance. Connector state remains outside DSS and the common permission engine. Both connector styles terminate at the same canonical candidate-bundle boundary.

### Current implementation note

The merged Phase 1 transport is already largely source-agnostic at the HTTP/store boundary: `POST /api/candidates/import` accepts a versioned candidate bundle and persists normalized candidates. The current code defaults an omitted candidate `source` to `SOD_A_PLUS`; it does **not yet constitute a full source-connector registry or source-policy layer**. Therefore:

- the generic ingestion API is already the reusable core;
- SOD is the first production candidate producer;
- future sources should be implemented as adapters/connectors feeding this same ingress contract;
- explicit source allowlisting/capability enforcement should be added before additional automated sources are trusted for unattended ingestion or AUTO requests.

## 7.2 First Automated Source — Start of Day A+ Trades

The first automated source is:

```text
SOD Section 15 — A+ Trades
```

The SOD process should produce:

```text
Human-readable SOD text report
Human-readable SOD HTML report
Machine-readable A+ candidate JSON bundle
```

An A+ designation is upstream evidence of candidate quality; it is not permission to ARM.

## 7.3 SOD Trade-Card Source-of-Truth Requirement

Every `SOD_A_PLUS` candidate shall be generated from the **same structured trade definition used to render the corresponding Section 15 A+ trade card**. Candidate generation shall not rely solely on the Section 15 summary-table row, nor shall ExecutionOS scrape, OCR, or reverse-parse rendered HTML or prose.

The normalized candidate must preserve the substantive trading intent expressed by the trade card, including, where present:

- symbol;
- direction;
- setup;
- READ / thesis;
- PLAN / intended setup sequence;
- TRIGGER semantics and trigger alternatives;
- structural INVALIDATION semantics;
- TARGETS;
- RISK guidance;
- NO-TRADE conditions;
- BEST LOCATION / preferred entry-location context;
- rating;
- A+ / Morning Priority rank;
- catalyst, higher-timeframe, or other context sections.

The same structured source object should fan out to both human and machine representations:

```text
STRUCTURED A+ TRADE DEFINITION
        ├────────→ SOD TEXT TRADE CARD
        ├────────→ SOD HTML TRADE CARD
        └────────→ VERSIONED CANDIDATE JSON
                          ↓
                    INGESTION API
```

The visual trade card is therefore a **rendered view of the source definition**, not the machine authority itself.

## 7.4 Compound Trigger and Dynamic-Structure Requirement

A trade card may express more than one acceptable entry trigger and may reference structural levels that do not yet exist when the SOD is generated. The normalized model must preserve that reality rather than forcing the trade into an invented static template.

### Trigger definition

The source trade definition may express a trigger set such as:

```text
triggerSpecification:
    mode = ANY_OF | ALL_OF | MANUAL_CONFIRMATION
    alternatives[]:
        type
        narrative
        machineEvaluable
        parameters / reference levels where known
```

Unsupported discretionary alternatives are preserved in provenance and may require `MANUAL_CONFIRMATION`; they are not discarded merely because V1 cannot evaluate them automatically. Only machine-evaluable alternatives may participate in AUTO ARM.

### Structural invalidation definition vs resolved structural invalidation

The source may provide either a static structural level or a structural rule whose concrete price is resolved later. Preserve two separate concepts:

```text
structuralInvalidationDefinition
    type / referenceType
    composition = SINGLE | ALL_OF | ANY_OF
    rule
    sourceTimeframe
    narrative / reason
    conditions[]
    resolutionMode = STATIC_PRICE | DYNAMIC_REFERENCE | MANUAL_CONFIRMATION
    price = optional when STATIC_PRICE

structureEvaluation
    status
    evaluatedAt
    definitionId / evaluationReference
    resolvedPrice
    sourceTimeframe
    evidenceReference
    satisfiedConditions[]
```

Structural invalidation may itself be compound. For example, a breakout/retest setup may require both a decisive failure back below the breakout level **and** loss of the dynamic 2-minute pullback low. `ALL_OF` / `ANY_OF` composition preserves that logic instead of collapsing it into one naive price comparison.

Examples of dynamic references include a future 2-minute breakout-pullback low, retest high, signal-bar extreme, or other setup structure that forms after the morning report. ExecutionOS must never invent such a price at ingestion time.

Phase 3 DSS consumes a **resolved, valid `structureEvaluation`** containing the actual structural price used for protective-stop calculation. Phase 3 does not own the full trigger-pattern, entry-constraint, disqualifier, or structural-rule engine.

> **Permanent rule:** the candidate preserves the setup definition; the permission pipeline resolves the current executable instance of that definition.

## 7.5 Entry Constraints and Disqualifiers

The normalized candidate must preserve meaningful PLAN / NO-TRADE semantics as first-class data rather than leaving them only as display prose.

### Entry constraints

`entryConstraints[]` describe conditions that must be satisfied, or explicitly reviewed, before a candidate is actionable. Examples include:

- do not chase the initial breakout;
- wait for a pullback / retest;
- require acceptance above or below a reference level;
- require buyers / sellers to hold a reclaimed or broken level;
- require the entry to occur near a preferred structural location.

Conceptually each constraint may carry:

```text
entryConstraint
    description
    ruleType
    machineEvaluable
    parameters
    sourceReference
```

A constraint that is not machine-evaluable is preserved and requires manual confirmation for an otherwise affected path; it is never silently discarded.

### Disqualifiers

`disqualifiers[]` preserve explicit NO-TRADE conditions or other veto conditions from the source definition. Examples include:

- extended first-breakout chase;
- repeated rotational chop inside a defined decision zone;
- a breakout poke that cannot establish acceptance;
- a structural condition that makes the original setup no longer desirable even if price later revisits the trigger.

Conceptually each disqualifier may carry:

```text
disqualifier
    description
    ruleType
    machineEvaluable
    parameters
    sourceReference
```

Machine-evaluable disqualifiers may block the current permission path according to the later Phase 5 / Phase 7 policy. Unsupported discretionary disqualifiers remain visible and force manual handling rather than being treated as absent. Exact terminal-vs-transient effects are a later policy decision unless explicitly locked for a rule type.

These arrays are part of the stable normalized candidate model when present because they may materially affect permission. Their rich original narratives also remain in the extensible source payload.

## 7.6 Evolving Trade-Card Fields

The visual trade-card schema may evolve. ExecutionOS shall therefore distinguish between:

1. a **stable, versioned normalized candidate contract** containing the fields required for deterministic permission evaluation; and
2. an **extensible rich source/trade-card payload** preserving additional human-readable analysis and context.

New, renamed, reordered, or optional trade-card sections must not break candidate ingestion as long as the required normalized contract can still be produced. A new card field becomes part of the stable machine contract only when it is explicitly required for deterministic evaluation, permission, provenance, or auditability.

ExecutionOS must **not** infer missing critical machine fields from prose merely because a human-readable card contains similar language. Critical ambiguity fails closed or requires review.

---

# 8. Candidate Field Ownership

The candidate source owns strategic / structural intent and source provenance:

- source identity / source type;
- source-native artifact or event reference where available;
- source/adapter version provenance where available;
- symbol;
- direction;
- setup;
- decision timeframe where explicitly known;
- entry timeframe where explicitly known;
- thesis;
- trigger definition / trigger alternatives;
- entry constraints;
- disqualifiers / no-trade conditions;
- structural invalidation definition and static price where truly known;
- structural invalidation source timeframe;
- structural invalidation reason;
- structural invalidation rule;
- structural reference type;
- targets;
- planned entry reference;
- management plan;
- context notes;
- rating;
- source date;
- validity window;
- requested ARM mode.

ExecutionOS derives or refreshes live-dependent values:

- current expected entry;
- normalized market snapshot;
- 2-minute Wilder ATR(14);
- DSS policy version;
- buffer factor;
- raw volatility buffer;
- raw effective stop;
- rounded effective stop;
- applied buffer / rounding adjustment;
- current account risk budget;
- maximum permitted size;
- Daily ATR(14);
- current DTR / DTR utilization;
- VIX / VIX1D context where available;
- volatility regime classification;
- decision status / reasons;
- granted ARM mode.

The source must not be authoritative for live-derived values that can become stale before permission evaluation.

---

# 9. Canonical Candidate Contract — Timeframe Model

The old generic `timeframe = 2m` assumption is superseded.

V2.4 distinguishes:

```text
decisionTimeframe       = primary setup / structural decision timeframe
entryTimeframe          = primary entry / trigger timeframe
volatilityTimeframe     = timeframe used by DSS micro-volatility
structuralInvalidation.sourceTimeframe = actual source of invalidation
```

Approved V1 defaults:

```text
decisionTimeframe   = 5m
entryTimeframe      = 2m
volatilityTimeframe = 2m
```

Structural invalidation must preserve its actual source timeframe and must not be silently rewritten to 5m or 2m.

Existing Phase 1 candidate bundles containing a generic `timeframe` must be supported through explicit compatibility/migration semantics rather than silently reinterpreted.

---

# 10. Canonical Candidate Bundle — Conceptual Example

The following example intentionally mirrors the verified META PMH Breakout / Retest trade-card pattern. It demonstrates compound triggers, entry constraints, disqualifiers, and a dynamic structural reference that cannot be truthfully priced at SOD time.

```json
{
  "schemaVersion": 1,
  "sourceId": "SOD_A_PLUS",
  "sourceDate": "2026-08-31",
  "generatedAt": "2026-08-31T06:15:00-06:00",
  "candidates": [
    {
      "candidateId": "sod-2026-08-31-meta-long-01",
      "contractVersion": 1,
      "symbol": "META",
      "direction": "LONG",
      "setup": "PMH Breakout / Retest",
      "decisionTimeframe": "5m",
      "entryTimeframe": "2m",
      "volatilityTimeframe": "2m",
      "thesis": "Relative-strength continuation remains attractive if the PMH breakout is accepted and the retest structure holds.",
      "triggerSpecification": {
        "mode": "ANY_OF",
        "alternatives": [
          {"type": "2M_H2_ABOVE_PMH", "machineEvaluable": false},
          {"type": "MICRO_DOUBLE_BOTTOM_AT_RETEST", "machineEvaluable": false},
          {"type": "TIGHT_BULL_FLAG_HOLDING_LEVEL", "machineEvaluable": false, "level": 581.88},
          {"type": "STRONG_BULL_REVERSAL_AFTER_SHALLOW_SWEEP", "machineEvaluable": false, "level": 581.88}
        ]
      },
      "entryConstraints": [
        {
          "ruleType": "WAIT_FOR_RETEST",
          "machineEvaluable": true,
          "description": "Do not chase the initial breakout; wait for a pullback/retest."
        },
        {
          "ruleType": "BUYERS_HOLD_LEVEL",
          "machineEvaluable": true,
          "parameters": {"level": 581.88},
          "description": "Buyers must establish acceptance/hold around PMH."
        }
      ],
      "disqualifiers": [
        {
          "ruleType": "EXTENDED_FIRST_BREAKOUT_CHASE",
          "machineEvaluable": false,
          "description": "Do not chase an extended first breakout with no retest."
        },
        {
          "ruleType": "ROTATIONAL_CHOP_IN_ZONE",
          "machineEvaluable": false,
          "parameters": {"low": 579.00, "high": 581.88},
          "description": "Repeated rotation inside the decision zone is a no-trade condition."
        },
        {
          "ruleType": "NO_ACCEPTANCE_ABOVE_LEVEL",
          "machineEvaluable": true,
          "parameters": {"level": 581.88},
          "description": "A PMH poke without acceptance does not qualify."
        }
      ],
      "structuralInvalidationDefinition": {
        "composition": "ALL_OF",
        "conditions": [
          {
            "rule": "FAILED_HOLD_OR_RECLAIM",
            "referenceType": "PMH",
            "sourceTimeframe": "2m",
            "resolutionMode": "STATIC_PRICE",
            "price": 581.88,
            "reason": "Decisive failure back below PMH after the breakout."
          },
          {
            "rule": "LOSS_OF_DYNAMIC_STRUCTURE",
            "referenceType": "BREAKOUT_PULLBACK_LOW",
            "sourceTimeframe": "2m",
            "resolutionMode": "DYNAMIC_REFERENCE",
            "reason": "Loss of the structural pullback low invalidates the breakout/retest thesis."
          }
        ],
        "narrative": "A simple test below PMH is not invalidation if buyers promptly reclaim and the higher-low structure remains intact."
      },
      "plannedEntryReference": {
        "type": "PMH_BREAKOUT_RETEST",
        "price": 581.88,
        "description": "Preferred entry just above PMH after a successful retest proves resistance has become support."
      },
      "targets": [
        {"label": "T1", "price": 584.00},
        {"label": "T2", "price": 589.19},
        {"label": "T3", "price": 593.34}
      ],
      "managementPlan": "Manage structurally; size to the effective structural stop and never tighten the stop merely to make the position fit.",
      "rating": 4.5,
      "validity": {"session": "RTH"},
      "armPolicy": {"requestedMode": "MANUAL"},
      "sourceTradeDefinition": {
        "read": "Full human-readable READ text preserved here.",
        "plan": "581.88 break -> do not chase -> wait for pullback/retest -> buyers hold PMH -> long.",
        "triggerNarrative": "Full trigger narrative preserved here.",
        "invalidationNarrative": "Full invalidation narrative preserved here.",
        "targetsNarrative": "584 -> 589.19 YDH -> 593.34 TWH.",
        "riskNarrative": "Use the 2m breakout-pullback low only if its failure truly breaks the setup.",
        "noTradeNarrative": "Full NO-TRADE narrative preserved here.",
        "bestLocation": "Just above 581.88 after a successful retest.",
        "additionalSections": []
      }
    }
  ]
}
```

This is conceptual, not a commitment to the exact serialized field names for every later phase. The required semantics are the commitment: the source definition is preserved, no dynamic structural price is invented at ingestion, unsupported discretionary conditions are not discarded, and AUTO cannot use a path that is not fully machine-evaluable.

The source may request AUTO mode only where policy allows it, but it cannot grant itself ARM authority and cannot supply or override the DSS buffer multiplier.

---

# 11. Canonical Trade Contract

The downstream Execution Board should eventually consume one canonical normalized Trade Contract regardless of source.

Core concepts include:

- symbol;
- direction;
- setup;
- decision / entry / volatility timeframes;
- thesis;
- trigger specification and resolved trigger path;
- entry constraints and their evaluation results where applicable;
- disqualifiers / no-trade conditions and their evaluation results where applicable;
- structural invalidation definition and resolved structure evaluation;
- targets;
- management plan;
- planned entry reference;
- current expected entry;
- effective stop;
- intended size;
- planned dollar risk;
- context metrics;
- decision status;
- arm mode;
- provenance;
- contract version;
- createdAt;
- armedAt where applicable;
- exact DSS evaluation identity used for risk / ARM.

The distinction between structural invalidation and effective stop is permanent.

```text
Structural Invalidation: 179.80
Raw Volatility Buffer:     0.18
Raw Effective Stop:       179.62
Rounded Effective Stop:   179.61   (example only; depends on valid increment)
```

---

# 12. Structural Invalidation

Structural invalidation identifies when the setup thesis is genuinely wrong. ATR does **not** determine structural invalidation.

Potential structural references include:

- double bottoms / tops;
- signal-bar extremes;
- swing highs / lows;
- H2 / L2 structure;
- liquidity-sweep extremes;
- breakout / retest levels;
- trading-range boundaries;
- VWAP reclaim / failure;
- EMA / channel structure;
- prior-day levels;
- premarket levels.

The source contract preserves a `structuralInvalidationDefinition`, including at minimum the rule, reference semantics, reason, and `sourceTimeframe`. A numeric price is mandatory only when the definition is truly static. Dynamic structural references are resolved later by the structural-rule evaluator and captured in an immutable `structureEvaluation`.

Initial atomic rule examples:

- `TRADE_THROUGH`;
- `2M_CLOSE_BELOW`;
- `2M_CLOSE_ABOVE`;
- `FAILED_RECLAIM`;
- `FAILED_HOLD_OR_RECLAIM`;
- `LOSS_OF_DYNAMIC_STRUCTURE`;
- `MANUAL_CONFIRMATION`.

Structural rule composition supports:

- `SINGLE`;
- `ALL_OF`;
- `ANY_OF`.

The structural evaluator must preserve which atomic conditions were satisfied and which resolved structural price was supplied to DSS. Compound invalidation semantics must never be flattened into a weaker single-price rule merely because DSS ultimately requires one protective structural reference price.

For DSS eligibility, the structural result must include a valid resolved price and provenance. Missing or ambiguous dynamic structure must fail closed / require review; it must never be guessed.

Once a specific structural definition is part of an accepted candidate version, that **definition** remains fixed unless the candidate is explicitly revised/versioned. A runtime resolved price may legitimately appear later when the definition uses `DYNAMIC_REFERENCE`; that resolution is evidence of the existing definition, not a silent candidate rewrite.

---

# 13. Approved Phase 3 DSS Timeframe Model

## 13.1 Decision / Structural Timeframe

Primary default:

```text
5-minute
```

Used for setup / decision / structural context.

## 13.2 Entry Timeframe

Primary default:

```text
2-minute
```

Used for PRETRADE_TRIGGER evaluation and entry timing.

## 13.3 Micro-Volatility Timeframe

Approved DSS V1 volatility input:

```text
2-minute Wilder ATR(14)
```

## 13.4 Real-Time Quote

A fresh current quote is separate from bar-based ATR and is used for permission / expected-entry state.

---

# 14. Approved Wilder ATR(14) Methodology

Phase 3 uses standard Wilder ATR over valid completed 2-minute RTH bars.

For ordinary bars:

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

### Locked session rules

1. ATR source session is RTH.
2. Premarket and after-hours bars do not update ATR.
3. Wilder ATR state carries across RTH sessions.
4. The first RTH 2-minute bar of a new session uses:

```text
TR = high - low
```

This deliberately excludes overnight-gap contamination from the first RTH True Range.

5. Forming 2-minute bars never enter ATR.
6. The first current-session RTH 2-minute bar must complete before normal current-session DSS eligibility.

## 14.4 Deterministic ATR Reconstruction — No Persisted ATR State

Wilder ATR calculated state is **not persisted as authoritative application state**. On process start/restart, ExecutionOS reconstructs ATR deterministically from source market data.

Approved V1 reconstruction window:

```text
20 completed RTH sessions
+ current RTH session
```

Reconstruction sequence:

```text
Schwab historical 1m RTH bars
        ↓
deterministic completed 2m RTH aggregation
        ↓
True Range sequence
        ↓
arithmetic-mean seed from first 14 valid TRs
        ↓
Wilder recursion across all subsequent RTH 2m bars
        ↓
current ATR
```

The 20-session warm-up window is intentionally generous; any seed influence becomes negligible well before the current session while restart/replay behavior remains deterministic.

Cached raw/source bars may be used as an optimization if their provenance and integrity are valid, but a cached/persisted ATR accumulator or `lastAtr` value is never authoritative. PM/AH bars never update the reconstructed ATR.

---

# 15. 2-Minute Bar Construction and Completion Semantics

Approved RTH alignment:

```text
09:30:00–09:31:59 ET
09:32:00–09:33:59 ET
09:34:00–09:35:59 ET
...
```

Phase 2 established an important distinction:

```text
sourceComplete
    = all required source 1m slots exist

temporallyClosed
    = wall clock is past the end of the aggregate interval

complete
    = sourceComplete && temporallyClosed
```

A provider may publish a still-forming 1-minute candle before that minute closes. Therefore `sourceComplete` alone is insufficient.

This behavior is regression-protected.

---

# 16. Approved Buffer Policy

V1 formula:

```text
Volatility Buffer = 2m Wilder ATR(14) × 0.30
```

Approved V1 ownership rules:

- global policy multiplier = `0.30`;
- multiplier is versioned/configurable by policy;
- candidate sources cannot supply a multiplier;
- no per-symbol override in V1;
- no per-setup override in V1;
- no per-direction override in V1;
- no per-source override in V1;
- no volatility-regime override in V1;
- no adaptive/self-tuning multiplier in V1;
- no arbitrary minimum or maximum buffer clamps.

The 0.30 value may later be revised only through an explicit versioned policy change supported by evidence.

---

# 17. Effective-Stop Calculation

For LONG:

```text
rawEffectiveStop = structuralInvalidation.price - rawVolatilityBuffer
```

For SHORT:

```text
rawEffectiveStop = structuralInvalidation.price + rawVolatilityBuffer
```

ATR affects the protective distance around structure; it does not redefine the thesis.

---

# 18. Tick Size and Directional Rounding

The raw effective stop must be rounded to a valid instrument price increment without reducing protection.

## LONG

Round **downward** to the next valid price increment.

## SHORT

Round **upward** to the next valid price increment.

Governing principle:

> **Rounding may never reduce intended protective distance.**

Persist at minimum:

- raw ATR;
- multiplier;
- raw buffer;
- structural invalidation;
- raw effective stop;
- valid price increment;
- rounding direction;
- rounding adjustment;
- final effective stop;
- applied buffer.

---

# 19. Phase 3 Market-Data Freshness

Freshness is part of permission and fails closed.

## Live quote

Approved V1 maximum age:

```text
5 seconds
```

## Completed 2-minute bar publication grace

Approved V1 grace:

```text
10 seconds
```

A newly completed 2-minute interval may take a short time to appear from the provider. During the first 10 seconds after the boundary, normal publication latency is allowed. The previously valid completed-bar ATR may remain temporarily acceptable for an already-active permission evaluation, but the newly forming bar must **never** be substituted or treated as complete.

If the expected newly completed bar is still unavailable after the 10-second grace interval, DSS must enter `BLOCKED` with an explicit missing/stale completed-bar reason rather than silently continue. A new ARM decision may not rely indefinitely on the prior bar once the grace expires.

---

# 20. DSS Status Model

Phase 3 DSS does **not** emit READY / CAUTION / PASS.

Phase 3 statuses are:

```text
VALID
BLOCKED
ERROR
```

## VALID

Required market data and structural inputs are valid and a deterministic effective stop has been produced.

## BLOCKED

Examples:

- insufficient ATR history;
- current-session warm-up not complete;
- missing / duplicate / incomplete required bars;
- expected completed bar absent after grace;
- stale quote;
- invalid/missing structural invalidation;
- unavailable required instrument metadata;
- stale DSS evaluation relative to a new completed bar.

A data block is not automatically a permanent PASS.

## ERROR

Examples:

- provider exception;
- calculator/internal contract error;
- impossible numeric state.

READY / CAUTION / PASS belong to the downstream permission decision layer.

---

# 21. Extended-Hours DSS Policy

Extended-hours candidates may be manually armed when candidate policy permits.

Approved V1 policy:

- PM/AH bars do not update Wilder ATR;
- use the most recent valid RTH Wilder ATR;
- require fresh extended-hours quote / trigger data;
- persist separate provenance for volatility source session and evaluation session;
- extended-hours AUTO ARM is prohibited in V1.

Conceptual provenance:

```text
volatilitySession = RTH
evaluationSession = PREMARKET | AFTER_HOURS
```

---

# 22. Abnormal Volatility / Gap Behavior

Legitimate abnormal volatility is not capped or normalized away.

If ATR becomes large because actual volatility is large:

```text
larger ATR
    ↓
larger buffer
    ↓
wider effective stop
    ↓
smaller Phase 4 size or no affordable size
```

A large gap does not contaminate the first RTH 2-minute TR because the first RTH bar uses `high-low`.

Tiny legitimate ATR is likewise not automatically floored by an arbitrary clamp.

---

# 22.1 Canonical Phase 3 DSS Input Contract

The Phase 3 evaluator should consume a normalized input equivalent to:

```text
DssEvaluationInput

candidate:
    candidateId
    sourceId
    contractVersion
    candidateContentHash
    symbol
    direction
    decisionTimeframe = 5m
    entryTimeframe = 2m

structuralInvalidationDefinition:
    referenceType
    rule
    reason
    sourceTimeframe
    resolutionMode

structureEvaluation:
    status
    evaluatedAt
    evaluationReference
    resolvedPrice
    evidenceReference

marketSnapshot:
    snapshotId
    provider
    capturedAt
    quote
    executionBars

instrument:
    instrumentType
    priceIncrement
    instrumentValueMetadata

dssPolicy:
    policyId
    policyVersion
    volatilityMethod = WILDER_RMA
    volatilityPeriod = 14
    volatilityTimeframe = 2m
    bufferMultiplier = 0.30
    quoteMaxAgeMs = 5000
    completedBarPublicationGraceMs = 10000
    atrReconstructionCompletedRthSessions = 20

calculation:
    calculatorVersion
```

Phase 3 must reject/block inputs that do not establish a valid resolved structural price, required market-data integrity, or valid instrument increment. Legacy Phase 1 `timeframe` values are compatibility inputs only and must not be silently reinterpreted as structural provenance.

`entryConstraints[]`, `disqualifiers[]`, compound trigger evaluation, and compound structural-rule interpretation are resolved upstream of Phase 3. Phase 3 receives their consequence through a valid `structureEvaluation` and permission context; it does not reinterpret trade-card prose.

# 22.2 Canonical Phase 3 DSS Output / Provenance Contract

Each evaluation should produce an immutable result containing, at minimum:

```text
dssEvaluationId
status = VALID | BLOCKED | ERROR
reasonCodes[]

candidateId
sourceId
candidateContractVersion
candidateContentHash

structuralInvalidationDefinition snapshot
structureEvaluation snapshot
resolvedStructuralInvalidationPrice

priorAtrValue
currentTrueRange
atrValue
atrMethod
atrPeriod
atrTimeframe
atrSourceSession
atrReconstructionWindow
latestCompletedBar

rawVolatilityBuffer
rawEffectiveStop
priceIncrement
roundingDirection
roundingAdjustment
effectiveStop

snapshotId
provider
quoteTimestamp
quoteAgeMs

policyId
policyVersion
calculatorVersion
inputHash
evaluatedAt
```

The precise serialized schema may evolve under versioning, but the audit chain must always be sufficient to reproduce why the evaluation produced its status and stop.

# 23. Immutable DSS Evaluation Model

Each Phase 3 calculation produces an immutable DSS evaluation snapshot with a unique identity, conceptually:

```text
dssEvaluationId
candidateId
candidateContractVersion
evaluatedAt
marketSnapshot provenance
structuralInvalidation snapshot
ATR provenance
DSS policy version
calculator version
raw buffer
raw effective stop
rounding provenance
effectiveStop
status
reason codes
```

Do not mutate a prior evaluation in place.

Candidate state may reference:

```text
currentDssEvaluationId
authorizedDssEvaluationId
```

The exact DSS evaluation used for ARM must remain auditable forever.

---

# 24. DSS Recalculation Lifecycle

## WAITING

WAITING candidates do not continuously recalculate DSS on every completed 2-minute bar.

## Permission becomes relevant

DSS is calculated when PRETRADE_TRIGGER / permission becomes relevant.

## New completed 2-minute bar before ARM

If permission remains active and a new completed 2-minute bar arrives, the previous DSS evaluation becomes stale for a new ARM decision and must be recalculated.

## Quote ticks alone

Quote ticks alone do **not** cause ATR / effective-stop recalculation.

## Candidate structure revision

A structural invalidation change requires an explicit candidate revision/version; it is not a live DSS mutation.

## Before ARM

The prospective effective stop may change as completed-bar ATR changes.

## At ARM

The exact DSS evaluation used is frozen.

## After ARM

Phase 3 performs no post-ARM stop recalculation.

---

# 25. Canonical Candidate Lifecycle Terminology

Canonical V2.4 lifecycle terminology is:

```text
SOD_A_PLUS_CREATED / MANUAL_CANDIDATE_CREATED
        ↓
INGESTED
        ↓
WAITING
        ↓
PRETRADE_TRIGGER_EVALUATING
        ↓
PERMISSION_EVALUATING
        ↓
READY / CAUTION / PASS
        ↓
MANUAL_ARM / AUTO_ARM / REJECT / EXPIRE
        ↓
ARMED
        ↓
EXISTING V2.3 EXECUTION FLOW
```

Core states:

- `INGESTED`;
- `WAITING`;
- `PRETRADE_TRIGGER_EVALUATING`;
- `PERMISSION_EVALUATING`;
- `READY`;
- `CAUTION`;
- `PASS`;
- `ARMED`;
- `EXPIRED`;
- `REJECTED`;
- `SUPERSEDED`.

Legacy persisted `TRIGGER_EVALUATING` values should be normalized to `PRETRADE_TRIGGER_EVALUATING` on state load and canonical writes should use the new term only.

---

# 26. Permission Evaluation Order

Approved order:

```text
fresh market snapshot
        ↓
structural validity check
        ↓
Phase 3 DSS
        ↓
Phase 4 risk sizing
        ↓
macro / setup context
        ↓
decision gate
        ↓
READY / CAUTION / PASS
```

The downstream component may consume the upstream result but may not alter it merely to improve affordability or decision outcome.

---

# 27. Phase 3 → Phase 4 Risk Handoff

Phase 3 hands Phase 4 an immutable **VALID** DSS evaluation containing both:

- structural invalidation;
- effective stop;
- exact DSS provenance.

Phase 4 independently obtains fresh:

- `currentExpectedEntry`;
- relevant account equity / maximum dollar risk;
- instrument value / sizing metadata.

Phase 4 sizes **exclusively from `effectiveStop`**.

Phase 4 may reduce size but may never alter:

- `structuralInvalidation`;
- `effectiveStop`.

Every risk evaluation must reference the exact:

```text
dssEvaluationId
```

used.

---

# 28. Risk Integration

Conceptual risk math:

```text
Risk Per Unit = |Current Expected Entry - Effective Stop| × Instrument Value
```

```text
Maximum Position Size = Maximum Dollar Risk / Risk Per Unit
```

Current trading risk policy:

```text
Maximum planned loss per trade = 0.5% of relevant account equity
```

If no valid minimum size fits:

```text
NO_AFFORDABLE_SIZE
```

Later permission mapping:

```text
PASS — STOP_RISK_CONFLICT
```

Never tighten structural invalidation or effective stop to make the trade fit.

---

# 29. Expected Entry Handling

Preserve separate concepts:

```text
plannedEntryReference
currentExpectedEntry
```

The source provides the planned entry reference.
ExecutionOS refreshes current expected entry near permission/risk evaluation.

Risk sizing uses the fresh current expected entry, not the stale morning reference.

---

# 30. Stop Quality Advisory

Potential advisory states:

- `GOOD`;
- `MARGINAL`;
- `LIKELY_INSIDE_NORMAL_NOISE`;
- `EXCESSIVELY_WIDE_RELATIVE_TO_STRUCTURE`.

Stop quality is **not part of Phase 3 DSS permission math**. It is deferred to Phase 6 macro/setup context as an advisory classification unless a future explicit tested rule promotes a condition into permission logic.

It must not secretly alter the approved 0.30 buffer policy or mutate structural/effective stops.

---

# 31. Macro Volatility Context — Three Separate Layers

V2.4 deliberately separates three volatility concepts:

```text
INSTRUMENT-SPECIFIC REALIZED VOLATILITY
2m Wilder ATR(14)
    → DSS / STOP BUFFERING

SESSION REALIZED VOLATILITY
DTR / Daily ATR
    → INSTRUMENT / SESSION CONTEXT

BROAD-MARKET IMPLIED VOLATILITY
VIX / VIX1D / optional term structure
    → MARKET REGIME / SETUP SELECTIVITY / PERMISSION CONTEXT
```

The layers must not be conflated.

DTR / Daily ATR and VIX-family measures must not mechanically modify structural invalidation, DSS multiplier, volatility buffer, or effective stop.

---

# 32. Instrument / Session Realized Volatility Context

Daily True Range:

```text
TR = max(
    High - Low,
    |High - Previous Close|,
    |Low - Previous Close|
)
```

Initial Daily ATR:

```text
Daily ATR(14)
```

DTR utilization:

```text
Current DTR / Daily ATR
```

DTR above 100% does **not** mean the session is “used up.”

DTR / Daily ATR are context, never trade triggers and never DSS stop inputs.

---

# 33. Broad-Market Implied-Volatility Regime — VIX / VIX1D

VIX-family measures are an approved **context and selectivity input** for V2.4.

Initial supported conceptual inputs:

- VIX level;
- VIX absolute change;
- VIX percent change;
- VIX rolling percentile / relative regime classification;
- VIX1D level;
- VIX1D absolute / percent change;
- VIX1D relative to VIX;
- optional later VIX9D / VIX3M term-structure context;
- source timestamps / freshness.

Intended direction:

```text
VIX / VIX1D / TERM STRUCTURE
        ↓
MARKET REGIME / SETUP SELECTIVITY / CONTEXT
```

Prohibited direction:

```text
VIX → CANDIDATE CREATION
VIX → TRADE TRIGGER
VIX → STRUCTURAL INVALIDATION
VIX → DSS BUFFER MULTIPLIER
VIX → EFFECTIVE STOP
```

VIX may later influence:

- SOD Morning Priority / A+ ranking;
- setup preference by volatility regime;
- context confidence;
- READY / CAUTION explanations;
- empirical performance analysis by setup × volatility regime.

ExecutionOS should prefer **relative regime classification** over brittle fixed VIX thresholds.

No fixed VIX level automatically creates PASS unless a later explicit, tested policy is separately approved.

---

# 34. Setup-Aware Context

Example continuation context:

```text
DTR Utilization: 121%
VIX Regime: Elevated / rising
Setup: Continuation
Context: CAUTION — extended session and less favorable volatility regime
```

Example reversal context:

```text
DTR Utilization: 121%
VIX1D: Elevated relative to VIX
Setup: Reversal / liquidity sweep
Context: POTENTIALLY FAVORABLE — exhaustion / stop-sweep conditions possible
```

These are explanatory context examples, not yet a finalized deterministic decision matrix.

Future setup-by-volatility weighting should preferably be informed by ExecutionOS performance data rather than unsupported theory alone.

---

# 35. Trigger, Entry-Constraint, and Disqualifier Representation

Every imported candidate must preserve its source trigger semantics and either:

1. provide at least one deterministic machine-evaluable trigger path; or
2. require `MANUAL_CONFIRMATION` for the unsupported trigger path.

Compound trigger sets use explicit composition such as:

```text
triggerSpecification.mode = ANY_OF | ALL_OF | MANUAL_CONFIRMATION
```

Only a fully machine-evaluable satisfied trigger path may participate in AUTO ARM.

Initial high-suitability deterministic trigger types include:

- break above / below a price level;
- reclaim and hold;
- breakout + retest;
- sweep + reclaim.

More discretionary patterns may initially require manual confirmation:

- nuanced H2 / L2;
- strong reversal bar;
- micro double bottom / top;
- tight bull flag;
- contextual discretionary pattern combinations.

`entryConstraints[]` and `disqualifiers[]` are evaluated alongside the trigger/structure layer when their rule types are supported. A machine-evaluable trigger does not become AUTO-eligible merely because it fired if a required entry constraint is unmet or a disqualifier is active. Unsupported discretionary constraints/disqualifiers force manual handling rather than being ignored.

---

# 36. Trigger Satisfaction and Fresh Permission Evaluation

> **SOD A+ candidates are ingested as WAITING immediately after they are produced, but ARM requires a fresh V2.4 permission evaluation using current structure, market data, DSS, risk, and context.**

Typical events:

- price approaches trigger zone;
- relevant machine-evaluable event occurs;
- manual review occurs;
- controlled periodic refresh while active.

```text
WAITING
   ↓
PRETRADE_TRIGGER becomes relevant
   ↓
refresh normalized market snapshot
   ↓
evaluate trigger path / entry constraints / disqualifiers
   ↓
validate / resolve structure
   ↓
calculate / refresh DSS
   ↓
calculate risk
   ↓
refresh context
   ↓
READY / CAUTION / PASS
```

---

# 37. Decision Status and Arm Mode

Permission states:

- `READY`;
- `CAUTION`;
- `PASS`.

Arm mode is independent:

- `MANUAL`;
- `AUTO`.

Conservative initial policy:

```text
READY   → MANUAL or AUTO
CAUTION → MANUAL ONLY
PASS    → ARM PROHIBITED
```

Only READY may auto-arm.

A candidate source may request AUTO but ExecutionOS grants or denies that request.

---

# 38. Controlled Automated Arming

Initial AUTO eligibility requires all of the following:

- approved source (`SOD_A_PLUS` initially);
- machine-evaluable trigger;
- trigger actually satisfied;
- structure still valid;
- fresh required market data;
- fresh current expected entry;
- VALID non-stale DSS evaluation;
- effective stop valid;
- Phase 4 risk fits;
- account-risk data fresh enough;
- no duplicate/conflicting active candidate;
- no existing broker position causing ownership ambiguity;
- Decision Status = READY;
- AUTO requested and permitted;
- candidate not expired;
- RTH evaluation for AUTO in V1;
- global / source / candidate kill switch allows it.

Automated ARM means transitioning a validated candidate into the existing ARMED state.

It does **not** send a broker order.

---

# 39. Fail-Closed Principle

Default automated action when required information is stale, invalid, ambiguous, or missing:

```text
DO NOT ARM
```

Automation must not silently invent critical trade data.

Data unavailability generally BLOCKS permission rather than converting the candidate into a permanent PASS.

---

# 40. Candidate Ingestion Outcomes

Candidate-specific outcomes include:

- `ACCEPTED`;
- `NEEDS_REVIEW`;
- `REJECTED`;
- `DUPLICATE_IGNORED`;
- `CONFLICT`.

Incomplete or ambiguous critical data must not be guessed.

Bundle-level structural failures reject the bundle; candidate-level failures should not unnecessarily block valid peers in the same otherwise-valid bundle.

Persistence must complete before the API reports successful acceptance.

---

# 41. Idempotency, Versioning, and Supersession

`candidateId` identifies a logical candidate.

Same candidate/version + same content:

```text
DUPLICATE_IGNORED
```

Same candidate/version + different content:

```text
CONFLICT — CANDIDATE_ID_CONTENT_MISMATCH
```

Revisions increment `contractVersion`.

A successfully accepted newer version may supersede an older active version according to explicit conflict rules.

Opposite-direction replacement must not silently supersede without explicit logic.

---

# 42. Duplicate and Same-Symbol Handling

Conservative V2.4 policy remains:

> Preserve historical/superseded versions in audit history, but permit only one active candidate per symbol across `INGESTED`, `WAITING`, `PRETRADE_TRIGGER_EVALUATING`, `PERMISSION_EVALUATING`, `READY`, `CAUTION`, and the downstream `ARMED` ownership boundary unless a later explicit model changes this constraint.

This remains aligned with the conservative V2.3 one-candidate-per-symbol execution ownership boundary.

---

# 43. Expiry and Validity

SOD candidates are session-scoped by default unless a narrower validity window is supplied.

Structural invalidation terminates eligibility immediately regardless of remaining time.

A generic fixed lifetime should not be imposed on every setup.

---

# 44. Normalized Market Snapshot

Conceptual shared boundary:

```text
MarketSnapshot

symbol
timestamp
lastPrice

executionBars:
    timeframe = 2m
    bars = [...]

session:
    high
    low
    previousClose

dailyBars:
    [...]

marketVolatilityContext:
    vix
    vixChange
    vixPercentChange
    vixPercentile
    vix1d
    vix1dChange
    vix1dVsVix
    termStructureClass

freshness:
    quoteAge
    barAge
    volatilityContextAge
```

Trigger Evaluator, DSS, Risk, and Context components should consume normalized boundaries rather than provider-specific raw payloads wherever practical.

---

# 45. Provenance and Auditability

ExecutionOS must be able to answer:

> Why did this candidate exist?

> Why did this DSS evaluation produce this effective stop?

> Why did risk accept or reject this size?

> Why did the permission layer produce READY / CAUTION / PASS?

> Why was the candidate armed?

Provenance should include, where applicable:

- candidate source / source version;
- candidateId / contractVersion;
- structural invalidation source / rule / timeframe;
- market-data timestamps;
- quote age;
- 2m bar identity / completion state;
- ATR value / method / session provenance;
- DSS policy version;
- calculator version;
- buffer factor;
- raw / rounded effective stop;
- rounding provenance;
- `dssEvaluationId`;
- account equity snapshot;
- maximum dollar risk;
- current expected entry;
- calculated size;
- risk-evaluation identity;
- DTR / Daily ATR;
- VIX / VIX1D values / timestamps / regime;
- context classification;
- decision reasons;
- requested / granted ARM mode;
- ARM authorization;
- manual overrides;
- rejection / expiry / supersession reason.

---

# 46. Existing Execution Board Integration

The existing V2.3 Execution Board remains downstream owner of:

- ARMED state;
- broker-fill matching;
- LIVE promotion;
- broker lifecycle handling;
- ENTRY / ADD / PARTIAL / FLAT / REVERSAL semantics;
- execution state;
- History.

V2.4 feeds the Execution Board only after permission is earned.

No V2.4 phase may silently change the trusted V2.3 execution-management semantics.

---

# 47. EOD / History Compatibility

EOD reporting should eventually distinguish:

- MANUAL ExecutionOS-owned trades;
- AUTOMATED-ARM ExecutionOS-owned trades;
- broker-only trades.

V2.4 provenance should support analysis of:

- candidate source;
- candidate-to-trade conversion;
- manual vs automated ARM;
- permission status at ARM;
- risk compliance;
- rejection / block reasons;
- ATR buffer behavior;
- setup × volatility-regime performance;
- realized R.

Do not weaken the conservative broker-cycle ownership model.

---

# 48. Management Governor Compatibility

V2.4 should stabilize the upstream contract before V3 begins.

The future Management Governor should ideally receive:

```text
Canonical Trade Contract
+
Current Broker State
+
Market / Structural State
+
Management Policy
```

The Governor should not need special-case logic based on whether a candidate originated manually or automatically.

---

# 49. Logical Module Boundaries

Conceptual architecture:

```text
candidate-source-registry
        ↓
candidate-source-adapters / connectors
        ├── sod-trade-definition-export
        ├── manual / ad-hoc candidate adapter
        └── future approved source adapters
        ↓
canonical candidate bundle
        ↓
candidate-ingestion-api
        ↓
candidate-validator / normalizer
        ↓
candidate-lifecycle / persistence
        ↓
market-data-provider
        ↓
permission evaluation
        ├── trigger-evaluator
        ├── structural-validator
        ├── dss-policy
        ├── wilder-atr
        ├── dss-evaluator / dynamic-stop-engine
        ├── risk-sizing-engine
        ├── macro-context-engine
        └── decision-gate
        ↓
arm-permission-service
        ↓
existing V2.3 Execution Board
```

Recommended Phase 3 implementation modules once authorized:

```text
schwab-bridge/
  dss-policy.mjs
  wilder-atr.mjs
  dss-evaluator.mjs
  dss-provenance.mjs
```

Potential supporting module:

```text
instrument-metadata.mjs
```

These are logical boundaries, not immutable filenames.

---

# 50. Current Development Phasing

## Phase 1 — Candidate Ingestion — COMPLETE

- versioned JSON bundle;
- local import endpoint;
- validation / normalization;
- persistence;
- WAITING board;
- idempotency / conflict / supersession handling;
- reusable source-agnostic canonical ingress boundary.

**Source extensibility note:** Phase 1 provides the common ingestion core. Additional automated sources are added through source adapters/connectors and explicit source-policy approval; they do not create alternate ingestion paths.

## Phase 2 — MarketDataProvider — COMPLETE

- read-only Schwab provider;
- normalized quote / minute / daily data;
- New York session handling;
- continuity checks;
- deterministic 1m → 2m aggregation;
- temporal closure semantics;
- live acceptance / freshness verification.

## Phase 3 — DSS / Volatility Buffer — NEXT, DESIGN APPROVED

- candidate/state compatibility migration;
- 5m / 2m timeframe contract normalization;
- Wilder ATR(14);
- versioned 0.30 policy;
- effective-stop calculation;
- directional tick rounding;
- freshness / integrity blocks;
- immutable DSS evaluations;
- provenance;
- lifecycle integration.

## Phase 4 — Effective-Stop Risk Sizing

- fresh current expected entry;
- account risk snapshot;
- risk per unit;
- size rounding / minimum size;
- risk-evaluation statuses: `VALID`, `BLOCKED`, `NO_AFFORDABLE_SIZE`, `ERROR`;
- `NO_AFFORDABLE_SIZE` may later map to decision `PASS / STOP_RISK_CONFLICT`;
- independent freshness for expected-entry/account inputs;
- exact `dssEvaluationId` linkage;
- no stop modification.

## Phase 5 — Trigger + Structural Rule Evaluation

- deterministic trigger taxonomy, including compound `ANY_OF`/`ALL_OF` semantics where approved;
- PRETRADE_TRIGGER evaluator;
- structural-rule evaluator that resolves `DYNAMIC_REFERENCE` invalidation definitions into immutable `structureEvaluation` results;
- MANUAL_CONFIRMATION fallback;
- no guessing of unresolved structure;
- trigger / structure freshness and expiry;
- live/replay equivalence;
- production provider of the resolved `structureEvaluation` consumed by Phase 3.

Phase 3 may be implemented and unit/integration-tested earlier using deterministic test/manual `structureEvaluation` inputs; Phase 3 does not absorb the Phase 5 trigger/pattern engine.

## Phase 6 — Macro / Setup Context

- Daily ATR / DTR;
- VIX / VIX1D context;
- relative volatility regime;
- setup-aware context advisory;
- optional SOD priority linkage;
- no stop modification.

## Phase 7 — Decision Gate

- READY;
- CAUTION;
- PASS;
- deterministic reason codes.

## Phase 8 — Controlled Automated Arming

- requested / granted MANUAL/AUTO;
- deterministic eligibility;
- RTH-only AUTO in V1;
- kill switches;
- conflict handling;
- provenance;
- fail-closed ARM transition;
- no broker order placement.

Behavioral / Management Governor work remains deferred.

---

# 51. Phase 3 Implementation Sequence — Once Explicitly Authorized

Recommended small-commit order:

1. candidate/state compatibility migration;
2. pure Wilder ATR implementation;
3. versioned DSS policy;
4. effective-stop math + directional rounding;
5. market-data freshness / integrity checks;
6. immutable DSS evaluation / provenance;
7. persistence integration;
8. permission lifecycle integration;
9. full regression;
10. documentation / closeout.

Recommended test order:

1. pure Wilder ATR;
2. DSS evaluator / stop math;
3. immutable provenance;
4. lifecycle integration;
5. full regression / live verification where relevant.

---

# 52. Testing Requirements

Each phase must remain independently testable.

## Candidate ingestion

Test:

- valid bundle;
- unsupported schema;
- malformed bundle;
- partial candidate failures;
- duplicate retry;
- content mismatch;
- supersession;
- same-symbol conflict;
- persistence-before-success;
- restart recovery.

## Market data

Test:

- quote normalization;
- New York RTH boundaries / DST;
- missing / duplicate minute detection;
- 390 RTH minutes → 195 complete 2m bars;
- forming 2m interval exclusion;
- closed interval with missing source minute remains incomplete;
- quote freshness fail-closed;
- read-only provider request construction.

## DSS

Test:

- Wilder ATR seed;
- Wilder recursive update;
- RTH carry across sessions;
- first RTH bar `high-low` rule;
- PM/AH exclusion;
- current-session warm-up;
- LONG / SHORT stop math;
- 0.30 buffer policy;
- candidate override prohibition;
- directional tick rounding;
- no protection reduction;
- stale quote;
- missing / duplicate / incomplete bars;
- 10-second completed-bar grace;
- extended-hours manual-only behavior;
- immutable evaluation snapshots;
- stale-evaluation rules;
- no post-ARM DSS recalc.

## Risk

Test:

- effective-stop distance;
- fresh current expected entry;
- account-risk calculation;
- size rounding;
- minimum size;
- `NO_AFFORDABLE_SIZE`;
- exact `dssEvaluationId` linkage;
- prohibition against changing stops.

## Context

Test:

- DTR;
- Daily ATR;
- utilization >100%;
- VIX / VIX1D normalization / freshness;
- rising vs falling vol at similar absolute VIX;
- relative-regime classification;
- no candidate creation from VIX;
- no trigger creation from VIX;
- no DSS stop modification from macro context.

## Triggers

Test:

- level break;
- reclaim-and-hold;
- breakout/retest;
- sweep/reclaim;
- MANUAL_CONFIRMATION fallback;
- expiry;
- stale data;
- structural invalidation;
- live/replay equivalence.

## Decision gate

Test:

- READY;
- CAUTION;
- PASS;
- deterministic reason codes;
- multiple simultaneous cautions.

## Automated ARM

Test:

- READY+AUTO;
- READY+MANUAL;
- CAUTION manual-only;
- PASS prohibition;
- extended-hours AUTO prohibition;
- stale candidate;
- live position conflict;
- opposite direction;
- repeated source event;
- restart recovery;
- fill during update;
- expiry;
- kill switches;
- provenance.

## Regression

Confirm no breakage to:

- manual candidate flow;
- V2.3 ARMED behavior;
- broker-fill binding;
- live lifecycle;
- History;
- EOD enrichment;
- Schwab read-only boundary.

---

# 53. Locked Phase 3 V1 Decision Ledger

The following are approved and should not be reopened during implementation without an explicit design change:

1. 5m is primary for setup / decision / structural context.
2. 2m is primary for entry trigger / execution timing.
3. Micro-volatility uses standard 2m Wilder ATR(14).
4. Wilder seed = arithmetic mean of first 14 valid RTH TRs.
5. Wilder state carries across RTH sessions.
6. PM/AH bars do not update ATR.
7. First RTH bar TR = `high-low`.
8. First current-session 2m RTH bar must complete before normal RTH DSS eligibility.
9. Extended-hours candidates may be manually ARMED when policy allows.
10. EH DSS uses most recent valid RTH ATR + fresh EH quote/trigger data.
11. EH AUTO ARM is prohibited in V1.
12. Global V1 buffer multiplier = 0.30.
13. The multiplier is a global versioned policy with no symbol/setup/direction/candidate/source/regime overrides in V1.
14. Candidate sources cannot supply their own multiplier.
15. No arbitrary min/max buffer clamps.
16. LONG raw effective stop subtracts the raw volatility buffer from resolved structural invalidation.
17. SHORT raw effective stop adds the raw volatility buffer to resolved structural invalidation.
18. LONG effective stop rounds down to the valid price increment.
19. SHORT effective stop rounds up to the valid price increment.
20. Rounding may never reduce intended protective distance.
21. Live quote maximum age = 5 seconds.
22. Completed 2m bar publication grace = 10 seconds.
23. Forming 2m bars never enter ATR.
24. DSS statuses = VALID / BLOCKED / ERROR.
25. READY / CAUTION / PASS remain downstream permission states.
26. Data failures block; they do not automatically create permanent PASS.
27. DSS evaluations are immutable snapshots.
28. WAITING candidates do not continuously recalculate on every completed 2m bar.
29. DSS calculation occurs when PRETRADE_TRIGGER / permission becomes relevant.
30. A new completed 2m bar before ARM stales the prior DSS evaluation for a new ARM decision while permission is active.
31. Quote ticks alone do not cause ATR/effective-stop recalculation.
32. Structural invalidation definition remains fixed unless the candidate is explicitly revised/versioned.
33. Prospective effective stop may change before ARM as completed-bar ATR changes.
34. The exact DSS evaluation used for ARM freezes at ARM.
35. Phase 3 performs no post-ARM DSS recalculation.
36. Legitimate abnormal volatility is not capped or normalized away.
37. Wider legitimate stops flow to smaller Phase 4 size or no affordable size.
38. Canonical lifecycle state name = PRETRADE_TRIGGER_EVALUATING.
39. Permission order = fresh market snapshot -> structural validity -> Phase 3 DSS -> Phase 4 risk -> later context / decision gate.
40. Phase 3 hands Phase 4 an immutable VALID DSS evaluation containing resolved structure, effective stop, and provenance.
41. Phase 4 independently obtains fresh current expected entry and account-risk inputs.
42. Phase 4 sizes exclusively from `effectiveStop`.
43. Phase 4 may reduce size but may not alter `structuralInvalidation` or `effectiveStop`.
44. Minimum-size risk conflict = `NO_AFFORDABLE_SIZE`, later mapped to PASS - `STOP_RISK_CONFLICT`.
45. Every risk evaluation references the exact `dssEvaluationId`.

---

# 54. Resolved Questions — Do Not Treat as Open

The following older broad-baseline questions are now resolved:

- initial MarketDataProvider: read-only Schwab path accepted for current V2.4 use;
- market/session timezone: `America/New_York`;
- 2-minute RTH alignment: 09:30–09:31:59, 09:32–09:33:59, etc.;
- forming-bar semantics: source completeness is insufficient; temporal closure required;
- quote freshness: 5 seconds;
- completed 2-minute publication grace: 10 seconds;
- volatility method: 2m Wilder ATR(14);
- ATR session source: RTH;
- overnight-gap handling: first RTH bar TR = high-low;
- ATR state: carries across RTH sessions;
- initial buffer multiplier: 0.30 global versioned policy;
- extended-hours AUTO ARM: prohibited in V1;
- canonical trigger-evaluation lifecycle name: PRETRADE_TRIGGER_EVALUATING;
- V2.4 V1 authoritative market-data/reference-metadata provider: Schwab, behind replaceable normalized interfaces;
- `priceIncrement` supplied through provider/reference metadata and used for protective directional rounding;
- Wilder ATR state is reconstructed, not persisted;
- ATR reconstruction window: 20 completed RTH sessions + current RTH session;
- source identity/capability is registry-controlled, not trusted from payload assertion;
- candidate identity is source-scoped;
- dynamic structural invalidation is resolved through `structureEvaluation`, not guessed at ingestion;
- compound structural invalidation preserves `SINGLE` / `ALL_OF` / `ANY_OF` semantics;
- trade-card PLAN / NO-TRADE semantics are preserved through first-class `entryConstraints[]` and `disqualifiers[]` when materially relevant;
- unsupported discretionary trigger/constraint/disqualifier semantics are preserved and require manual handling rather than being discarded;
- Phase 3 DSS status model: VALID / BLOCKED / ERROR;
- DSS evaluations: immutable;
- risk sizing must use effective stop and exact `dssEvaluationId`.

---

# 55. Remaining Open Design Questions

These are genuinely outside the locked Phase 3 DSS baseline and may be resolved in later phases or implementation design:

1. What exact SOD structured trade-definition/export component writes both the trade-card views and candidate JSON bundle in production?
2. What exact `CandidateSourceAdapter` / `CandidateSourceRegistry` interface and transport-verification mechanism should be implemented for additional candidate sources?
3. Which candidate fields are mandatory for every A+ setup type, and which belong only in the extensible rich source payload?
4. Which structural invalidation rules and `DYNAMIC_REFERENCE` types are supported first beyond the initial list?
5. Which deterministic trigger, entry-constraint, and disqualifier rule types are implemented first, and which remain manual-only?
6. For supported disqualifiers, which conditions block only the current permission attempt versus terminally PASS/EXPIRE the candidate?
7. What exact conditions produce READY vs CAUTION vs PASS outside the already-locked DSS/risk invariants?
8. Should CAUTION remain manual-only in all V1 cases or only specified categories?
9. What is the final auto-arm kill-switch model?
10. How should opposite-direction supersession and cross-source same-symbol conflict resolution work?
11. Which provenance fields become schema-mandatory vs optional beyond the locked Phase 3 audit minimum?
12. How should automated candidates be rendered in History/EOD UI?
13. Should trigger/structure reevaluation be event-driven, periodic, or hybrid initially?
14. Which VIX-family fields are mandatory in the first context implementation: VIX only, VIX+VIX1D, or broader term structure?
15. What rolling window / percentile boundaries define LOW / NORMAL / ELEVATED / STRESS regimes?
16. How should stale/unavailable VIX context affect MANUAL vs AUTO permission?
17. Which setup types, if any, receive deterministic context modifiers before sufficient ExecutionOS performance history exists?
18. What exact account-risk freshness threshold should Phase 4 use?
19. What minimum-size and share/contract rounding rules apply by instrument class?

---

# 56. Implementation Directive

Before Phase 3 implementation begins:

1. use current merged `main` as the baseline;
2. preserve trusted V2.3 behavior;
3. preserve Phase 1 candidate ingestion / persistence;
4. preserve Phase 2 MarketDataProvider semantics;
5. implement only the approved Phase 3 DSS boundary;
6. keep Schwab READ ONLY;
7. make changes in small, independently testable commits;
8. run focused tests before integration tests;
9. run full regression before merge;
10. do not begin V3 Management Governor work;
11. do not add broker-write authority.

**Implementation gate:** Phase 3 implementation begins only after Steven explicitly authorizes implementation against the reviewed v0.4 baseline (or explicitly states that the approved Phase 3 v0.3 baseline remains the implementation authority).

---

# 57. Core V2.4 Design Constraint

> **Does this directly help determine whether a candidate should be allowed into the existing Execution Board?**

If yes, it may belong in V2.4.
If not, defer it.

> **ExecutionOS remains an execution-discipline system. V2.4 moves the discipline boundary one step earlier—from “manage this trade correctly” to “earn permission to arm this trade.”**

---

# 58. Verified End-to-End Walkthrough — META PMH Breakout / Retest

This walkthrough was used as the final design validation for v0.4. It intentionally stresses the architecture with multiple trigger alternatives, dynamic structure, a compound invalidation rule, entry constraints, explicit no-trade conditions, and later DSS/risk evaluation.

The source trade card contains, in substance:

```text
META LONG
Setup: PMH Breakout / Retest
Plan: 581.88 break -> do not chase -> wait for pullback/retest -> buyers hold PMH -> long
Triggers: H2 OR micro double-bottom OR tight bull flag OR strong reversal after shallow sweep
Invalidation: decisive failure below 581.88 PLUS loss of the structural pullback low
No-trade: extended first-breakout chase; rotational chop; PMH poke without acceptance
Best location: just above 581.88 after a successful retest
Targets: 584 -> 589.19 -> 593.34
```

The design preserves the entire structured source definition at ingestion. It does **not** invent the future 2-minute breakout-pullback low.

Runtime flow:

```text
STRUCTURED META TRADE DEFINITION
        ↓
SOD_A_PLUS CANONICAL CANDIDATE
        ↓
WAITING
        ↓
PRETRADE_TRIGGER_EVALUATING
        ↓
trigger path + entry constraints + disqualifiers evaluated
        ↓
dynamic breakout-pullback structure forms
        ↓
structureEvaluation resolves the structural price
        ↓
PERMISSION_EVALUATING
        ↓
Schwab market snapshot + reconstructed Wilder ATR(14)
        ↓
Phase 3 DSS effective stop
        ↓
Phase 4 fresh-entry risk sizing
        ↓
context / decision gate
        ↓
READY / CAUTION / PASS
        ↓
MANUAL / eligible controlled AUTO ARM
        ↓
existing V2.3 Execution Board
```

Illustrative-only DSS example (not historical META data):

```text
resolved structural pullback low = 581.72
reconstructed 2m Wilder ATR(14) = 0.60
buffer multiplier = 0.30
raw buffer = 0.18
raw LONG effective stop = 581.54
priceIncrement = 0.01
rounded effective stop = 581.54
```

Illustrative-only risk example:

```text
fresh currentExpectedEntry = 582.03
risk per share = 582.03 - 581.54 = 0.49
maximum dollar risk = account-equity policy output
maximum size = floor(maximum dollar risk / 0.49)
```

The walkthrough passes only because the architecture preserves all of the following without invention or loss:

- the full trade-card source definition;
- multiple alternative triggers;
- entry constraints such as "do not chase" / "wait for retest";
- explicit NO-TRADE disqualifiers;
- compound invalidation semantics;
- runtime dynamic structural resolution;
- strict separation of structural invalidation from ATR buffering;
- deterministic Schwab-backed market data and reconstructed ATR;
- directional price-increment rounding;
- risk sizing from the effective stop rather than stop manipulation;
- separation of DSS `VALID/BLOCKED/ERROR` from later `READY/CAUTION/PASS`;
- source-policy and MANUAL/AUTO ARM boundaries;
- no broker order placement from V2.4.

**Verification conclusion:** the candidate model and permission pipeline can represent the reviewed A+ trade-card pattern without flattening it into a simplistic level trigger, inventing an unavailable structural price, discarding discretionary setup semantics, or compromising the existing V2.3 execution boundary.

---

# 59. Final Summary

```text
APPROVED CANDIDATE SOURCE
(SOD TRADE DEFINITION / MANUAL / FUTURE SOURCE ADAPTER)
        ↓
SOURCE ADAPTER / CONNECTOR
        ↓
VERSIONED CANONICAL CANDIDATE JSON
        ↓
LOCAL INGESTION API
        ↓
WAITING
        ↓
PRETRADE_TRIGGER_EVALUATING
        ↓
FRESH NORMALIZED MARKET DATA
        ↓
TRIGGER PATH / ENTRY CONSTRAINTS / DISQUALIFIERS
        ↓
STRUCTURE RESOLUTION / VALIDITY
        ↓
2m WILDER ATR(14)
        ↓
0.30 MICRO-VOLATILITY BUFFER
        ↓
DIRECTIONALLY ROUNDED EFFECTIVE STOP
        ↓
IMMUTABLE DSS EVALUATION
        ↓
FRESH EXPECTED ENTRY + ACCOUNT RISK
        ↓
POSITION SIZE / NO_AFFORDABLE_SIZE
        ↓
MACRO CONTEXT
(DTR / DAILY ATR + VIX / VIX1D REGIME)
        ↓
READY / CAUTION / PASS
        ↓
MANUAL / CONTROLLED AUTO ARM
        ↓
EXISTING V2.3 EXECUTION BOARD
```

The Decision Support System feeds the permission layer and ultimately the Execution Board. It does not replace the Execution Board.

The first automated candidate source is the SOD Section 15 A+ list, generated from the same structured trade definition that renders each A+ trade card. The ingestion boundary is intentionally source-extensible; later approved sources must use adapters/connectors that produce the same canonical candidate contract.

SOD candidates are automatically ingested but are **not armed merely because they appeared in the morning report**.

Macro volatility informs context/selectivity but does not mechanically alter structural invalidation, DSS buffer policy, or effective stop.

AUTO ARM is permitted only after a fresh deterministic permission evaluation and remains an ARM-state transition, not broker order placement.

V2.4 should be completed and stabilized before V3 Management Governor begins.
