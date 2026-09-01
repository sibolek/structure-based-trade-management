# ExecutionOS User Guide

**Version:** 1.2  
**Date:** 1 September 2026  
**Status:** Living operator guide for current `main` — frozen V2.3 downstream execution plus merged V2.4 Phases 1–4 pre-trade infrastructure  
**Repository:** `sibolek/structure-based-trade-management`  
**Current product baseline:** `main`  
**Frozen downstream execution release:** `v2.3.0`

> **Operating principle:** Structure decides. P&L emotion does not.
>
> ExecutionOS preserves pre-entry intent and constrains risk/management decisions. It does not currently place, replace, cancel, or flatten broker orders.

---

## Table of contents

1. [Purpose](#1-purpose)
2. [Current system status](#2-current-system-status)
3. [What ExecutionOS is and is not](#3-what-executionos-is-and-is-not)
4. [Architecture: V2.4 PRE-TRADE vs V2.3 EXECUTION](#4-architecture-v24-pre-trade-vs-v23-execution)
5. [Risk model](#5-risk-model)
6. [Installation and startup](#6-installation-and-startup)
7. [Schwab authorization and account checks](#7-schwab-authorization-and-account-checks)
8. [Creating and managing trade candidates](#8-creating-and-managing-trade-candidates)
9. [Phase 3 DSS and Phase 4 risk sizing](#9-phase-3-dss-and-phase-4-risk-sizing)
10. [Arming and broker execution](#10-arming-and-broker-execution)
11. [Live trade management](#11-live-trade-management)
12. [Persistence and local state](#12-persistence-and-local-state)
13. [End-of-Day reporting](#13-end-of-day-reporting)
14. [Futures / NinjaTrader status](#14-futures--ninjatrader-status)
15. [Security](#15-security)
16. [Troubleshooting](#16-troubleshooting)
17. [Current limitations and deferred work](#17-current-limitations-and-deferred-work)
18. [Repository discipline](#18-repository-discipline)
19. [Recommended daily operating procedure](#19-recommended-daily-operating-procedure)
20. [Command reference](#20-command-reference)
21. [Documentation map](#21-documentation-map)
22. [Glossary](#22-glossary)

---

# 1. Purpose

This is the practical, living guide for operating ExecutionOS as it exists on current `main`.

It answers:

> **How do I use the system correctly today, and what parts of the newer V2.4 architecture are implemented versus still intentionally gated?**

Use this guide for normal operation. Use the approved design baselines for architecture decisions and the phase closeouts for implementation/acceptance evidence.

---

# 2. Current system status

## 2.1 Frozen downstream execution baseline

The broker-aware execution layer remains frozen under:

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

V2.3 remains the trusted downstream reference for:

- armed-candidate ownership;
- matching Schwab fill binding;
- `ARMED → LIVE` transition in the existing Execution Board;
- broker position reconstruction;
- `ENTRY / ADD / PARTIAL / FLAT / REVERSAL` semantics;
- `VALID / THREATENED / INVALID` live management;
- History and execution review.

## 2.2 V2.4 Phases 1–4 are now merged

Current `main` contains:

1. **Phase 1 — Candidate Ingestion**;
2. **Phase 2 — MarketDataProvider**;
3. **Phase 3 — DSS / Micro-Volatility Buffer**;
4. **Phase 4 — Effective-Stop Risk Sizing**.

Phase 4 was merged through PR #14 at:

```text
0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

Final Phase 4 acceptance gate:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        293/293 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

## 2.3 Critical boundary: internal V2.4 `ARMED` is not yet the V2.3 Execution Board

Phase 4 implements an internal authorization/provenance freeze named `ARMED`.

That internal state is **not yet** the explicit transfer/binding into the existing V2.3 Execution Board.

Therefore, today:

- V2.4 can calculate/validate risk and freeze exact DSS/risk/quantity provenance internally;
- it does **not** place a broker order;
- it does **not** claim a Schwab fill;
- it does **not** silently create a V2.3 live trade;
- the final V2.4 internal `ARMED` → V2.3 Execution Board handoff remains deferred.

This distinction is essential when reading code, logs, or design documents.

## 2.4 V3 status

V3 Management Governor has **not started** and requires separate explicit authorization.

---

# 3. What ExecutionOS is and is not

ExecutionOS is a **local, broker-aware execution operating system** designed to preserve a trader's pre-entry plan and enforce deterministic risk/ownership boundaries.

It separates:

- **READ** — market analysis and setup selection;
- **PLAN** — thesis, trigger, invalidation, target, management intent;
- **PRE-TRADE PERMISSION** — fresh structural/risk checks;
- **EXECUTION** — broker fill ownership and live state;
- **REVIEW** — execution quality independent of P/L.

It is **not** currently:

- a stock scanner;
- a market-news terminal;
- a signal generator;
- a fully automated trading system;
- a broker replacement;
- a live order-entry panel;
- an AI that decides whether a setup is good;
- an automatic NinjaTrader binding layer;
- a broker-write Governor.

Equity orders still belong in thinkorswim/Schwab. The Schwab integration remains read-only.

---

# 4. Architecture: V2.4 PRE-TRADE vs V2.3 EXECUTION

The current architecture deliberately separates upstream pre-trade logic from frozen downstream execution ownership.

```text
V2.4 PRE-TRADE

Candidate
   ↓
Phase 3 DSS
   structural invalidation
   effectiveStop
   dssEvaluationId
   ↓
Phase 4 risk sizing
   currentExpectedEntry
   exact account equity
   instrument conversion
   maxAffordableQuantity
   riskEvaluationId
   ↓
permission consequence
   ↓
READY / CAUTION / PASS
   ↓
ARM attempt
   ↓
fresh Phase 4 evaluation
   ↓
selected-quantity validation
   ↓
internal V2.4 ARMED provenance freeze
   ↓
[future explicit transfer/binding]
   ↓

V2.3 EXECUTION

Existing V2.3 Execution Board
   ↓
matching broker opening fill
   ↓
LIVE
   ↓
VALID / THREATENED / INVALID
   ↓
FLAT / History
```

The bracketed handoff remains future V2.4 work.

## 4.1 Why this separation matters

The upstream system may determine that a candidate is structurally/risk-valid without taking ownership of a broker position.

The downstream V2.3 system may own a live broker position only through its established binding semantics.

Do not treat an internal V2.4 `ARMED` record as proof of:

- order submission;
- broker fill;
- live position ownership;
- V2.3 Execution Board binding.

---

# 5. Risk model

The permanent project rule is:

> **Maximum planned price risk per trade = 0.5% of the exact relevant trading-account equity.**

The required hierarchy is:

```text
STRUCTURE
   ↓
INVALIDATION
   ↓
EFFECTIVE STOP
   ↓
RISK BUDGET
   ↓
POSITION SIZE
```

Never choose size first and tighten the stop until the dollars fit.

## 5.1 Phase 3 owns the stop

Phase 3 converts structural invalidation into a volatility-protected `effectiveStop`.

The accepted policy uses:

- 2-minute Wilder ATR(14);
- RTH-only reconstruction;
- `ATR × 0.30` volatility buffer;
- directionally protective price-increment rounding.

Phase 3 answers **where the protected thesis invalidation belongs**.

## 5.2 Phase 4 owns affordability

Phase 4 answers **how much size can be afforded against that exact stop**.

It may reduce quantity or reject affordability. It may never alter structural invalidation or `effectiveStop`.

> **Phase 3 determines the correct stop. Phase 4 determines whether and how large we can afford to trade against that stop. Phase 4 never changes the stop.**

---

# 6. Installation and startup

## 6.1 Clone / install

```bash
git clone https://github.com/sibolek/structure-based-trade-management.git
cd structure-based-trade-management
npm install
```

For normal use, work from current `main` unless a specific development session says otherwise.

```bash
git checkout main
git pull --ff-only
```

## 6.2 Normal equity session

Use two terminals.

### Terminal 1 — Schwab monitor

```bash
npm run schwab:monitor
```

Wait until the monitor is ready.

### Terminal 2 — UI

```bash
npm run dev
```

Open the Vite URL shown in the terminal, normally:

```text
http://localhost:5173
```

Confirm the broker status is online before relying on automatic Schwab execution observation.

## 6.3 Optional local health checks

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/state
```

The broker boundary remains read-only.

---

# 7. Schwab authorization and account checks

## 7.1 Environment

Create the local environment file:

```bash
cp .env.local.example .env.local
```

Provide locally:

```text
SCHWAB_CLIENT_ID=...
SCHWAB_CLIENT_SECRET=...
SCHWAB_CALLBACK_URL=https://127.0.0.1:8182
```

Never commit `.env.local` or tokens.

Verify ignores:

```bash
git check-ignore .env.local .schwab-tokens.json
```

## 7.2 Authorize / reauthorize

```bash
npm run schwab:auth
```

Complete authentication on Schwab's site. If the callback page does not load locally, copy the full redirected URL from the browser and paste it into the terminal when requested.

## 7.3 Account check

```bash
npm run schwab:account
```

A healthy account check should resolve the intended account and show current account information without using live P/L as a management cue.

### Phase 4 account-equity rule

For Phase 4 production risk sizing, the authoritative Schwab field is:

```text
currentBalances.liquidationValue
```

Phase 4 does not substitute:

- cash;
- buying power;
- available funds;
- margin excess;
- initial balances;
- another account;
- `currentBalances.equity` when liquidation value is absent.

The exact execution account is required.

---

# 8. Creating and managing trade candidates

A candidate is a **pre-entry contract**, not a broker position.

The plan should state at minimum:

- symbol;
- direction;
- setup;
- primary timeframe;
- thesis;
- trigger;
- structural invalidation;
- target/framework;
- management intent.

## 8.1 Thesis

Use structurally testable language.

Good:

```text
Bull-channel pullback is holding prior breakout structure; continuation remains valid only while that structure remains intact.
```

Weak:

```text
Looks strong and should go higher.
```

## 8.2 Trigger

The trigger should be concrete enough to answer yes/no in real time, such as:

- breakout and hold;
- H2 / second-entry long;
- failed breakdown and reclaim;
- breakout/retest;
- signal-bar break from defined structure.

## 8.3 Invalidation

Invalidation is what proves the thesis wrong. It is not synonymous with:

- temporary red P/L;
- discomfort;
- a normal pullback;
- desire to protect open profit.

## 8.4 Candidate identity

V2.4 candidate persistence/versioning is exact. Structural changes require a new candidate version rather than silent mutation of a previously evaluated candidate.

---

# 9. Phase 3 DSS and Phase 4 risk sizing

This section describes the **merged internal pre-trade engine**. Not every internal field is necessarily exposed in the current operator UI.

## 9.1 Phase 3 DSS

Phase 3 accepts an already-resolved structural invalidation and produces an immutable DSS evaluation containing an `effectiveStop`.

Important behavior:

- no continuous DSS calculations while merely `WAITING`;
- fresh `VALID` DSS may be reused during permission activity;
- a newer completed 2-minute bar can stale the current DSS evaluation;
- the next permission cycle refreshes it;
- after authorization, the exact DSS identity is frozen;
- Phase 3 never sizes the trade.

## 9.2 Phase 4 expected entry

Supported V2.4 modes:

### `MARKETABLE_NOW`

```text
LONG  = ask
SHORT = bid
```

### `STOP_TRIGGER`

```text
LONG  = max(triggerPrice, ask)
SHORT = min(triggerPrice, bid)
```

No fallback to last/mark/candle close is allowed.

Quote rules include:

- positive bid and ask;
- bid <= ask;
- locked market allowed;
- crossed market blocked;
- maximum quote age 5 seconds.

## 9.3 Risk geometry

```text
LONG riskDistance  = currentExpectedEntry - effectiveStop
SHORT riskDistance = effectiveStop - currentExpectedEntry
```

Directional geometry must be valid; the implementation does not use an absolute-value shortcut to legitimize crossed invalidation.

## 9.4 Risk budget

```text
rawMaxDollarRisk = accountEquity × 0.005
maxDollarRisk = floorToCent(rawMaxDollarRisk)
```

Budget rounding never rounds upward.

## 9.5 Equity sizing

For whole-share equities:

```text
riskPerShare = riskDistance
rawQuantity = maxDollarRisk / riskPerShare
finalQuantity = floor(rawQuantity)
```

Odd lots are allowed. Fractional shares are not assumed.

## 9.6 Futures sizing

Phase 4 futures metadata uses trusted:

```text
tickSize
tickValue
pointValue?   // optional cross-check
minimumQuantity
quantityIncrement
currency
```

Calculation:

```text
riskTicks = ceil(riskDistance / tickSize)
riskPerContract = riskTicks × tickValue
```

The protective tick ceiling prevents underestimating risk when distance does not land exactly on a tick.

## 9.7 Affordability outcomes

Phase 4 statuses:

```text
VALID
NO_AFFORDABLE_SIZE
BLOCKED
ERROR
```

`NO_AFFORDABLE_SIZE` means the inputs are valid but the minimum permitted quantity cannot fit the 0.5% risk budget.

Downstream consequence:

```text
PASS — STOP_RISK_CONFLICT
```

Do not solve this conflict by tightening the stop.

## 9.8 Maximum affordable quantity is a ceiling

The calculated quantity is the **maximum risk-affordable quantity**, not a required size.

If:

```text
maxAffordableQuantity = 90
```

then:

```text
90 = allowed
50 = allowed
91 = prohibited
```

The selected quantity must also satisfy the instrument minimum/increment.

## 9.9 Every ARM attempt gets fresh risk

Every ARM attempt from `READY` / `CAUTION` creates a **new Phase 4 evaluation** from fresh inputs.

A previous risk evaluation is never considered “recent enough” simply because little time has passed.

At final authorization, quote freshness (≤5s) and account freshness (≤15s) are rechecked.

---

# 10. Arming and broker execution

There are now two concepts named `ARMED` in the architecture. Keep them separate.

## 10.1 Internal V2.4 `ARMED`

Phase 4 final authorization freezes:

```text
authorizedDssEvaluationId
authorizedRiskEvaluationId
arm: {
  authorizedAt,
  candidateVersion,
  dssEvaluationId,
  riskEvaluationId,
  selectedQuantity
}
lifecycleState = ARMED
```

This is a **pre-trade authorization/provenance freeze** only.

It does not place an order and does not yet perform the explicit handoff into V2.3.

## 10.2 Existing V2.3 armed candidate

The existing V2.3 Execution Board uses armed candidates to listen for matching broker opening fills.

That downstream workflow remains trusted/frozen and currently owns live broker binding.

Until the explicit V2.4→V2.3 handoff is implemented, do not assume internal V2.4 authorization automatically becomes a V2.3 broker-listening candidate.

## 10.3 Actual order entry

Equity orders are placed in thinkorswim/Schwab by the trader.

ExecutionOS does not currently:

- send an order;
- replace a stop;
- cancel an order;
- flatten a position.

---

# 11. Live trade management

Once the existing V2.3 Execution Board owns a matching broker fill, the live execution framework remains:

```text
VALID
THREATENED
INVALID
```

These labels describe structure, not profitability.

## VALID

The thesis remains intact. A VALID trade may be red, green, slow, or uncomfortable.

## THREATENED

New adverse structure materially weakens the thesis but has not yet met the declared invalidation condition.

## INVALID

The thesis has failed according to the contract or a legitimate structural update.

Core rule:

> **Red is not invalidation. Green is not an exit. Structure is invalidation.**

## 11.1 Manual exit check

Before a discretionary exit, ask:

> **If I could not see my P/L, would I still exit this chart right now?**

Do not use open P/L as a substitute for chart evidence.

## 11.2 Scaling

Before an add, know:

- current quantity;
- add quantity;
- new total quantity;
- structural/effective stop context;
- total planned risk.

Do not improvise size because the trade is winning or losing.

---

# 12. Persistence and local state

The existing V2.3 browser Execution Board stores UI state in `localStorage` under:

```text
execution-v23-store
```

Browser storage is not a durable database backup.

Clearing site data or changing browser profile/origin can remove local decision/history state.

V2.4 pre-trade/DSS/risk repositories use their own persisted contracts in the implementation. Do not manually edit persisted JSON/state to bypass identity, freshness, or append-only rules.

For long-term review, keep intended local exports/reports deliberately rather than relying only on browser storage.

---

# 13. End-of-Day reporting

The EOD reporter combines **two independent data sources**.

An accurate enriched report requires understanding both.

## 13.1 Source 1 — Schwab execution history

Schwab is broker-authoritative for fills and position changes.

The reporter reconstructs complete flat-to-flat cycles and broker-derived metrics such as:

- direction;
- entry/exit VWAP;
- peak quantity;
- gross realized P/L for complete-context cycles;
- winners/losers;
- average winner/loser;
- profit factors.

## 13.2 Source 2 — ExecutionOS History export

The enriched report needs the completed Trade Contracts stored in browser History.

The export supplies information Schwab does not know, including:

- setup/timeframe;
- thesis/trigger/invalidation;
- structural stop;
- target/management plan;
- expected entry/intended size;
- planned risk;
- realized R;
- execution-state/process information;
- ExecutionOS ownership.

> **Critical operating rule:** Download the ExecutionOS History export before generating the enriched report.

Without it, broker reconstruction can remain valid for complete-context Schwab cycles, but ExecutionOS-specific enrichment cannot be considered complete.

## 13.3 Step-by-step enriched EOD procedure

### Step 1 — confirm trades are in History

Before export, confirm every trade that should be enriched has completed into **ExecutionOS History**.

A trade not in History cannot be enriched from the browser export.

### Step 2 — keep Vite running

Do **not** stop the Vite server before exporting.

Browser local storage is origin-specific.

If the live UI is running at:

```text
http://localhost:5173
```

open the helper at:

```text
http://localhost:5173/eod-export.html
```

Use the **same browser profile and origin** used during the trading session.

Do not casually switch between:

- `localhost` and `127.0.0.1`;
- different ports;
- different browser profiles.

Those can have different local-storage namespaces.

### Step 3 — download ExecutionOS EOD History

Choose:

```text
DOWNLOAD EXECUTIONOS EOD HISTORY
```

The downloaded file is named like:

```text
executionos-eod-history-YYYY-MM-DD.json
```

This export reads browser History only. It does not contact Schwab or modify History.

### Step 4 — generate the report

Basic:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

Preferred explicit form when multiple exports may exist:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD --executionos=~/Downloads/executionos-eod-history-YYYY-MM-DD.json
```

Default HTML output:

```text
reports/eod/YYYY-MM-DD.html
```

### Step 5 — verify enrichment actually occurred

Do not treat “HTML file created” as proof of a fully enriched report.

Check:

- the intended History export was loaded or auto-detected;
- ExecutionOS-owned versus broker-only counts are plausible;
- known ExecutionOS-owned trades are not all broker-only;
- owned trades show setup/process fields;
- owned trades show planned risk/R when their contracts support it;
- unmatched Schwab cycles remain explicitly broker-only.

Matching is intentionally conservative. Do not force ownership merely to improve match count.

### Step 6 — investigate unexpected broker-only rows

Verify:

- report date;
- completed History entry;
- downloaded export;
- browser origin/profile;
- symbol;
- direction;
- entry timing;
- that the intended export file, not a newer unrelated file, was loaded.

### Step 7 — respect carry-in / incomplete-context warnings

The reporter never invents a cost basis.

If the first same-day execution is a closing execution, the position may have existed before the report date. That activity is treated as context-incomplete rather than receiving a fictional entry.

When a carry-in/context warning exists, do **not** describe reconstructed gross P/L as definitive whole-account daily P/L.

### Step 8 — planned risk and R

For an ExecutionOS-owned historical trade, the EOD enrichment uses the applicable saved contract semantics. Broker-only trades do not receive fabricated planned risk or R.

The EOD reporter's current account/risk snapshot is not a historical frozen per-trade risk budget.

### Step 9 — profit-factor distinction

```text
Gross Profit Factor = gross profit / gross loss
```

```text
Average Win/Loss Factor = average winner / abs(average loser)
```

Do not conflate them.

### Step 10 — retain artifacts privately

The History JSON and generated HTML report contain private trading-plan/review information.

Keep them local. Do not commit them to Git.

For implementation/reporting details, see:

```text
docs/ExecutionOS_EOD_Report.md
```

---

# 14. Futures / NinjaTrader status

Common futures such as MES/MNQ can be represented by the system, and Phase 4 contains futures sizing metadata/calculation support.

However:

- live NinjaTrader broker binding is **not connected**;
- Schwab must not be treated as the futures execution source;
- futures sizing support is not equivalent to broker integration;
- a futures candidate will not automatically promote to LIVE from NinjaTrader today.

A future broker-agnostic adapter/observer design remains separate work.

---

# 15. Security

Never commit or paste publicly:

- Schwab Client Secret;
- OAuth access/refresh tokens;
- authorization codes;
- unmasked account numbers;
- private broker exports;
- ExecutionOS private History exports.

Important local files:

```text
.env.local
.schwab-tokens.json
```

Keep secrets out of browser-exposed `VITE_` variables.

The read-only broker boundary is a deliberate safety control.

---

# 16. Troubleshooting

## 16.1 Broker offline

Start/verify:

```bash
npm run schwab:monitor
curl http://127.0.0.1:8787/health
```

If the API is on a custom port, ensure the UI uses the same `VITE_EXECUTIONOS_BROKER_URL`.

## 16.2 Schwab authentication fails

Verify `.env.local`, callback URL, and token state. Reauthorize with:

```bash
npm run schwab:auth
```

## 16.3 Candidate/fill did not bind in existing V2.3 Execution Board

Check:

- candidate was actually armed in the V2.3 broker-listening layer;
- symbol matches;
- direction/opening effect matches;
- fill occurred after arm time;
- monitor was already running;
- there was not a pre-existing position that should prevent fresh ownership.

Do not assume an internal V2.4 `ARMED` record has already been transferred to V2.3; that handoff is not yet implemented.

## 16.4 Phase 4 says no affordable size

Do not tighten the stop.

Correct choices are:

- choose a smaller valid quantity if one exists; or
- pass when minimum quantity cannot fit.

## 16.5 Phase 4 is blocked

Common categories include:

- stale/missing quote;
- required quote side missing;
- crossed market;
- invalid entry/stop geometry;
- unresolved/stale/invalid account snapshot;
- unsupported currency/asset type;
- invalid/inconsistent instrument metadata.

A `BLOCKED` result is not the same thing as `PASS — STOP_RISK_CONFLICT`.

## 16.6 EOD report shows broker-only trades unexpectedly

Check, in order:

1. trade completed into History;
2. History export was downloaded after completion;
3. export helper used same origin/profile;
4. intended export was loaded;
5. symbol/direction/timing match plausibly.

## 16.7 EOD export empty/incomplete

Likely causes:

- different browser origin;
- different profile;
- browser site data cleared;
- export performed before completed trades reached History.

---

# 17. Current limitations and deferred work

Current intentionally incomplete areas include:

- explicit V2.4 internal `ARMED` → V2.3 Execution Board transfer/binding;
- broader context/decision-gate logic beyond implemented Phase 4 risk consequences;
- broker order placement/replacement/cancellation;
- broker-write Governor enforcement;
- buying-power/margin eligibility gate;
- aggregate portfolio heat controls;
- non-USD conversion/additional asset types;
- automatic NinjaTrader futures binding;
- cloud persistence / multi-device synchronization;
- durable production database for all decision history;
- true contemporaneous NBBO capture for all historical slippage analysis;
- AI in the latency-sensitive execution path.

These are not reasons to bypass current safety boundaries with manual state edits or guessed fallbacks.

---

# 18. Repository discipline

Treat:

- `v2.3.0` as the frozen downstream execution-release reference;
- current `main` as the authoritative integrated baseline;
- approved design documents as dated architecture records;
- phase closeouts as implementation/acceptance records.

Do not:

- rewrite validated history casually;
- move/delete the `v2.3.0` tag;
- modify approved historical baselines merely to erase approval-time status;
- begin V3 without explicit authorization;
- commit credentials, tokens, raw private broker data, or private EOD exports.

Important PR records include:

- PR #7 — read-only EOD reporting;
- PR #12 — V2.4 Phase 3 DSS implementation;
- PR #13 — Phase 3 post-merge documentation cleanup;
- PR #14 — V2.4 Phase 4 Effective-Stop Risk Sizing.

---

# 19. Recommended daily operating procedure

This reflects the **current usable operator path** and the fact that the V2.4→V2.3 final handoff is not yet a complete operator surface.

## Before market / before first trade

1. Update current `main` if appropriate:

   ```bash
   git checkout main
   git pull --ff-only
   ```

2. Start the Schwab monitor:

   ```bash
   npm run schwab:monitor
   ```

3. Start the UI:

   ```bash
   npm run dev
   ```

4. Confirm broker online/account state is sensible.
5. Confirm current broker positions match reality.

## For each potential trade

1. Perform the READ outside ExecutionOS.
2. Define thesis, trigger, invalidation, target, and management intent.
3. Preserve the rule: structure → stop → risk → size.
4. Use the currently exposed workflow for the candidate you intend to execute.
5. Do not assume internal V2.4 authorization automatically arms the existing V2.3 Execution Board until the explicit handoff is implemented.
6. Place the actual equity order only in thinkorswim/Schwab.
7. Once the V2.3 Execution Board owns a matching fill, manage structure as `VALID / THREATENED / INVALID`.
8. Ask **what changed on the chart?** before discretionary interference.

## After the session

1. Confirm completed ExecutionOS trades are in History.
2. **Keep Vite running.**
3. Open the export helper on the same browser origin/profile:

   ```text
   http://localhost:5173/eod-export.html
   ```

4. Download **EXECUTIONOS EOD HISTORY**.
5. Generate the report:

   ```bash
   npm run schwab:eod -- --date=YYYY-MM-DD
   ```

6. Prefer explicit `--executionos=<path>` when multiple exports may exist.
7. Verify enrichment/ownership counts are plausible.
8. Respect carry-in/context warnings.
9. Review execution quality separately from P/L.
10. Keep private exports/reports local.

---

# 20. Command reference

## Setup / UI

```bash
npm install
npm run dev
npm run build
npm run preview
```

## Schwab

```bash
npm run schwab:auth
npm run schwab:status
npm run schwab:account
npm run schwab:monitor
npm run schwab:history
npm run schwab:replay
npm run schwab:slippage
npm run schwab:state-test
npm run schwab:token-test
npm run schwab:price-history-test
```

## End-of-Day

```bash
npm run schwab:eod
npm run schwab:eod -- --date=YYYY-MM-DD
npm run schwab:eod -- --date=YYYY-MM-DD --executionos=~/Downloads/executionos-eod-history-YYYY-MM-DD.json
npm run schwab:eod -- --date=YYYY-MM-DD --symbol=NVDA
npm run schwab:eod -- --date=YYYY-MM-DD --out=~/Desktop/eod-YYYY-MM-DD.html
```

## V2.4 validation

```bash
npm run v24:dss-test
npm run v24:risk-sizing-test
```

## Full tests / analytics

```bash
npm run analytics:test
npm run analytics:report
npm run analytics:duration
npm run analytics:stops
npm run analytics:r
npm run analytics:mfe
npm run analytics:capture
npm run analytics:counterfactuals
```

## Historical research / diagnostics

The repository retains research commands for reproducibility, including:

```bash
npm run research:30day-management
npm run research:normalize-30day
npm run research:reconstruct-30day
npm run research:enrich-stops
npm run research:report-recovered
npm run research:audit-market-data
npm run research:diagnose-fast-winners
npm run research:diagnose-fast-winner-strata
npm run research:validate-fast-winners-schwab
npm run research:diagnose-minute-alignment
```

Use the research methodology document for provenance/anti-curve-fitting rules.

---

# 21. Documentation map

Use the following sources by purpose:

| Need | Source |
|---|---|
| Operate ExecutionOS today | `USER-GUIDE.md` |
| Current documentation authority/status | `docs/ExecutionOS_Documentation_Index.md` |
| Current vs historical map | `DOCUMENTATION-STATUS.md` |
| Overall V2.4 architecture | `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` |
| Phase 3 implementation | `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` |
| Phase 4 design | `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` |
| Phase 4 implementation / merge | `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` |
| EOD semantics | `docs/ExecutionOS_EOD_Report.md` |
| Longer-term Governor direction | `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` |
| Historical analytics provenance | `research/30-day-management-study/methodology.md` |

---

# 22. Glossary

**Structural invalidation**  
The chart condition/price structure that proves the thesis wrong.

**Effective stop**  
The Phase 3 volatility-protected stop derived from structural invalidation. Phase 4 may not change it.

**DSS evaluation**  
An immutable Phase 3 evaluation identified by `dssEvaluationId`.

**Risk evaluation**  
An immutable Phase 4 evaluation identified by `riskEvaluationId`, containing expected-entry, account, instrument, calculation, status, and provenance.

**Maximum affordable quantity**  
The largest valid quantity whose planned entry→effective-stop risk fits the 0.5% budget. It is a ceiling, not a required quantity.

**Internal V2.4 `ARMED`**  
A pre-trade authorization/provenance freeze containing exact candidate/DSS/risk/quantity identity. It does not place an order and is not yet the explicit V2.3 Execution Board handoff.

**V2.3 armed candidate**  
The existing downstream broker-listening candidate used by the frozen Execution Board to bind a matching future Schwab opening fill.

**Broker binding**  
The downstream process assigning a new opening fill to the correct V2.3 armed candidate.

**Execution state**  
The live structural classification `VALID`, `THREATENED`, or `INVALID`.

**Trade contract**  
The saved pre-entry intent: thesis, trigger, invalidation, target/management, and risk context.

**Trade episode**  
A broker position lifecycle from flat to flat, subject to reversal semantics.

**Governor**  
The planned future V3 deterministic management-policy layer. V3 has not started.

---

## Living-document maintenance rule

Update this guide whenever normal startup, broker-data source, candidate/risk semantics, pre-trade/ARM boundaries, broker ownership, persistence, supported instruments, safety boundaries, EOD procedure, or CLI surface changes.

Do not let this guide silently drift away from the actual application.
