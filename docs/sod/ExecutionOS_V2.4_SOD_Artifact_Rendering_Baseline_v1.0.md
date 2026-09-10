# ExecutionOS V2.4 SOD Artifact Rendering Baseline v1.0

**Status:** IMPLEMENTATION BASELINE  
**Date:** September 9, 2026  
**Branch:** `v24-sod-orchestration-lineage`

## 1. Purpose

This baseline separates **analysis authority** from **artifact rendering authority** for Start of Day generation.

The analysis provider may analyze trusted chart bytes, use current public-market research, and propose trade substance. It does **not** own the final Markdown, HTML, dashboard CSS, candidate versioning, lifecycle, ARM, execution, filesystem output paths, or broker authority.

The local SOD orchestration layer owns deterministic rendering.

## 2. Approved flow

```text
Trusted chart store
    ↓
Analysis provider
    ↓
Structured artifactContent + candidateProposals
    ↓
Provider contract validation
    ↓
Canonical candidate export + lineage resolution
    ↓
Deterministic SOD renderer
    ├── 19-section Markdown report
    ├── canonical dark 19-section HTML report
    └── light-theme SOD dashboard
    ↓
Candidate publication remains separate
```

For sessions with A+ candidates, the renderer receives the **post-export/post-lineage canonical candidate contracts**, not the provider's raw candidate proposal objects.

## 3. Structured artifact content only

Providers may return `artifactContent`, consisting of:

- hero metadata;
- exactly 19 ordered report sections;
- renderable semantic blocks;
- public-source/freshness metadata.

Allowed semantic block types are:

- paragraph;
- callout;
- list;
- table;
- metrics.

Provider-supplied `report`, `dashboard`, `html`, `markdown`, or `css` rendering authority is rejected.

All provider text is HTML-escaped by the renderer.

## 4. Canonical 19-section order

1. Executive Summary
2. Execution Discipline
3. Macro / Overnight Context
4. Today's Scheduled Risk
5. Rates, Volatility & Commodities
6. MES
7. MNQ
8. Market Regime / Breadth
9. Semiconductors / Primary Sector Focus
10. Mega-Cap Tech
11. Momentum / Special Situations
12. Crude Oil / MCL
13. Key Levels
14. Validation Map / No-Trade Zones
15. A+ Trades
16. Morning Priority
17. Earnings / Risk Events
18. Risk Management
19. Opening Game Plan / Process Goals

The provider must supply all 19 sections in this order. Instrument groupings inside the established sections may vary with the supplied chart set.

## 5. Candidate-derived human artifacts

Sections 15 and 16 are authority-sensitive and are therefore not rendered from provider prose.

### Section 15 — A+ Trades

The renderer creates the summary table and trade cards directly from canonical candidate contracts.

Required card order:

**READ → PLAN → TRIGGER → INVALIDATION → TARGETS → RISK → NO-TRADE → BEST LOCATION**

The summary table includes:

- rank;
- instrument;
- setup;
- direction;
- trigger / best location;
- explicit invalidation;
- targets;
- context / catalyst;
- rating.

### Section 16 — Morning Priority

The renderer sorts canonical candidates by `morningPriority` and derives the table from their trigger and thesis fields.

This prevents a provider-generated report from disagreeing with the candidate JSON that is delivered to PRETRADE.

## 6. Canonical report visual contract

The deterministic report renderer preserves the established canonical SOD proportions:

- fixed desktop left navigation: **250px**;
- main content maximum width: **1540px**;
- dark/navy trading-terminal theme;
- all 19 TOC entries;
- two-column A+ grid on desktop;
- A+ grid gap: **14px**;
- A+ card radius: **14px**;
- A+ body padding: approximately **14px × 15px**;
- A+ field-label column: **92px**;
- A+ body text: approximately **12px**;
- compact typography and no oversized trade cards;
- responsive single-column fallback.

The provider cannot change this CSS.

## 7. Dashboard visual contract

The deterministic dashboard renderer preserves the established dashboard character:

- fixed **250px** dark/navy left navigation;
- light main background;
- compact white cards;
- Executive Summary;
- Scheduled / Macro Risk;
- Futures Snapshot;
- Watchlist Overview;
- Long Candidates;
- Short Candidates;
- No-Trade Zones;
- detailed A+ Trades;
- Morning Priority;
- Earnings / Risk Events;
- Risk Management;
- Opening Game Plan / Process Goals;
- Execution Development Framework.

Detailed dashboard candidate rows use an approximately **90px** label column and compact 12px value text.

## 8. Risk policy owned by the renderer

A+ candidate cards always restate the standing risk boundary:

- maximum planned loss = 0.5% of trading-account equity;
- size from structural/effective stop;
- do not tighten the stop to fit risk;
- reduce size or pass;
- treat correlated exposure as one risk cluster.

The provider may add contextual risk observations through approved candidate fields, but it cannot weaken these rules.

## 9. Authority boundaries

The renderer has no authority to:

- create candidate identity or contract version;
- determine lineage;
- alter PRETRADE lifecycle;
- grant permission;
- select quantity;
- ARM;
- create execution handoff;
- place, replace, cancel, or flatten broker orders.

Rendering is presentation only.

## 10. Acceptance criteria

The rendering slice is accepted only if tests prove:

1. exact 19-section ordering is mandatory;
2. provider-rendered HTML/Markdown/CSS is rejected;
3. provider text is escaped;
4. A+ cards and morning priority are candidate-derived;
5. canonical compact report geometry is present;
6. canonical light-dashboard geometry is present;
7. orchestration renders from canonical candidates after export/lineage;
8. existing feeder/PRETRADE/execution authority tests remain green.
