# ExecutionOS User Guide

**Version:** 1.4  
**Date:** 4 September 2026  
**Status:** Living operator guide for the accepted ExecutionOS V2.4 Execution Board handoff branch  
**Repository:** `sibolek/structure-based-trade-management`  
**Current accepted integration branch:** `v24-execution-board-handoff`  
**Frozen downstream execution release:** `v2.3.0`

> **Operating principle:** Structure decides. P&L emotion does not.
>
> ExecutionOS preserves pre-entry intent, enforces deterministic risk/ownership boundaries, observes broker reality, and creates an auditable execution record. It does not currently place, replace, cancel, reduce, or flatten broker orders.

---

## Table of contents

1. [Purpose](#1-purpose)
2. [Current system status](#2-current-system-status)
3. [What ExecutionOS is and is not](#3-what-executionos-is-and-is-not)
4. [Architecture: V2.4 authorization → handoff → V2.3 execution](#4-architecture-v24-authorization--handoff--v23-execution)
5. [Risk model](#5-risk-model)
6. [Installation and startup](#6-installation-and-startup)
7. [Schwab authorization and account checks](#7-schwab-authorization-and-account-checks)
8. [Creating and managing trade candidates](#8-creating-and-managing-trade-candidates)
9. [Phase 3 DSS and Phase 4 risk sizing](#9-phase-3-dss-and-phase-4-risk-sizing)
10. [Arming, handoff, and broker execution](#10-arming-handoff-and-broker-execution)
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

This is the practical, living guide for operating ExecutionOS as it actually exists on the accepted V2.4 Execution Board handoff branch.

It answers:

> **How do I operate the system correctly today, what is implemented and accepted, and what remains intentionally unavailable in the current operator surface?**

Use this guide for normal operation on the accepted integration branch. Use approved design baselines/addenda for architecture authority and closeout/status records for implementation evidence.

---

# 2. Current system status

## 2.1 Frozen downstream execution baseline

The trusted downstream execution reference remains:

```text
v2.3.0
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

Legacy/manual V2.3 behavior remains the reference for:

- legacy armed-candidate workflow;
- legacy Schwab fill binding;
- deterministic `ENTRY / ADD / PARTIAL / FLAT / REVERSAL` state semantics;
- `VALID / THREATENED / INVALID` live management;
- History and execution review.

V2.4 reuses trusted downstream lifecycle concepts, but V2.4-origin trades do **not** use the legacy symbol-only / `detectedAt` ownership path. They use the exact-account, authoritative-`executionTime`, lossless-journal path described below.

## 2.2 V2.4 Phases 1–4

Phases 1–4 are merged to `main`:

1. **Phase 1 — Candidate Ingestion**;
2. **Phase 2 — MarketDataProvider**;
3. **Phase 3 — DSS / Micro-Volatility Buffer**;
4. **Phase 4 — Effective-Stop Risk Sizing**.

Phase 4 merge commit:

```text
0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

The accepted risk hierarchy is:

```text
STRUCTURAL INVALIDATION
        ↓
PHASE 3 EFFECTIVE STOP
        ↓
CURRENT EXPECTED ENTRY
        ↓
0.5% RISK BUDGET
        ↓
POSITION SIZE
```

## 2.3 V2.4 Execution Board handoff runtime

The V2.4 authorization → Execution Board handoff receiver, local installation, exact-account first-fill ownership, LIVE lifecycle, retirement, canonical store authority, cross-tab serialization, runtime router, recovery hardening, health/telemetry, and full trade-specification inspector are implemented and accepted on:

```text
v24-execution-board-handoff
```

Governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

The runtime router is a normal **default-on** service on this branch. No positive enable flag is required.

The handoff/runtime path creates **no broker-write authority**. Schwab remains an observational/read-only evidence source.

## 2.4 Important current operator-surface boundary

The accepted downstream handoff/runtime is real, but the complete upstream browser/API operator path is **not yet exposed as one normal end-to-end workflow**.

Current facts:

- the PRE-TRADE browser board displays imported `WAITING` candidates;
- Phase 3 DSS, Phase 4 sizing, ARM authorization, and handoff-construction services exist internally and are tested;
- the normal pretrade HTTP service exposes candidate import plus handoff transport/discovery/claim/ACK/block operations;
- the current browser PRE-TRADE board does **not** expose the complete `WAITING → permission → READY/CAUTION → ARM → create handoff` workflow;
- therefore an imported WAITING candidate does not automatically become a new production handoff merely because the router is running.

This distinction is important: **the receiver/router/ownership path is implemented and accepted; the full upstream operator orchestration into that receiver is not yet a normal product workflow.**

## 2.5 V3 status

V3 Management Governor has **not started** and requires separate explicit authorization.

---

# 3. What ExecutionOS is and is not

ExecutionOS is a **local, broker-aware execution operating system** designed to preserve pre-entry intent and enforce deterministic risk/ownership boundaries.

It separates:

- **READ** — market analysis and setup selection;
- **PLAN** — thesis, trigger, invalidation, target, management intent;
- **PRE-TRADE PERMISSION** — fresh structural/risk evaluation;
- **AUTHORIZATION / HANDOFF** — immutable execution authorization and transfer;
- **EXECUTION** — broker fill ownership and live lifecycle;
- **REVIEW** — execution quality independent of P/L.

It is **not** currently:

- a stock scanner;
- a market-news terminal;
- a general signal generator;
- a fully automated trading system;
- a broker replacement;
- a live order-entry panel;
- an automatic NinjaTrader binding layer;
- a broker-write Governor;
- a complete browser workflow for every internal V2.4 permission/ARM service.

Equity orders still belong in thinkorswim/Schwab. The Schwab integration remains read-only.

---

# 4. Architecture: V2.4 authorization → handoff → V2.3 execution

The accepted conceptual chain is:

```text
Candidate
  ↓
Phase 3 DSS
  ↓
Phase 4 risk sizing
  ↓
READY / CAUTION / PASS
  ↓
ARM
  ↓
V2.4 ARMED authorization freeze
  ↓
Execution Board handoff
  ↓
PREPARED
  ↓
LISTENING (immutable executionListeningAt)
  ↓
eligible exact-account opening fill
  ↓
LIVE
  ↓
VALID / THREATENED / INVALID
  ↓
EXIT
  ↓
History
```

The downstream portion from an existing handoff through recovery/ownership is implemented on the accepted handoff branch. The entire upstream portion is not yet exposed as one normal browser operator flow.

## 4.1 Authorization is not broker execution

A V2.4 `ARMED` authorization freezes pre-trade provenance. It does not prove:

- broker order submission;
- broker acceptance;
- a broker fill;
- broker-write authority.

Actual equity order entry remains manual in thinkorswim/Schwab.

## 4.2 PREPARED and LISTENING

`PREPARED` is a durable local pre-fill reservation before broker-fill listening authority begins.

`LISTENING` begins only after final admission proof and freezes one immutable:

```text
executionListeningAt
```

A transient proposed listening boundary while PREPARED is epoch-local and is not canonical ownership authority.

## 4.3 Runtime router and recovery

The router serializes:

```text
activation
→ retirement
→ first-fill ownership/promotion
→ LIVE lifecycle advancement
```

One browser-wide Web Lock owns automated router leadership. A separate browser-wide writer lock serializes canonical Execution Board writes across legacy V2.3 and V2.4.

After LISTENING becomes durable:

- pretrade-service loss does not suspend durable retirement/first-fill/LIVE lifecycle work;
- Schwab loss freezes broker-sensitive conclusions;
- service recovery does not require browser refresh;
- reload/HMR/remount/takeover creates a fresh router epoch but rereads the same durable canonical ownership state;
- one stable receiver identity survives on the same browser origin.

## 4.4 Exact-account V2.4 ownership

V2.4 ownership uses:

- exact authorized execution account;
- authoritative Schwab `executionTime`;
- lossless execution ownership journal;
- continuous coverage interval;
- broker order provenance for entry-fragment vs ADD classification.

`detectedAt` is audit information only and does not move the ownership boundary.

## 4.5 Read-only broker boundary

```text
readOnly === true
brokerWriteAuthority === false
```

No router, health, handoff, retirement, lifecycle, reconciliation, or recovery state creates broker-write authority.

---

# 5. Risk model

The permanent project rule is:

> **Maximum planned price risk per trade = 0.5% of the exact relevant trading-account equity.**

Required hierarchy:

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

Accepted V1 policy includes:

- 2-minute Wilder ATR(14);
- RTH-only reconstruction;
- `ATR × 0.30` volatility buffer;
- directionally protective price-increment rounding.

Phase 3 answers **where the protected execution stop belongs**.

### Equity price-increment transition boundary

The current pre-variable-MPI Reg NMS Rule 612 fallback has a hard cutoff:

```text
2026-11-02
```

On and after that date, absent an authoritative symbol-specific minimum-price-increment source, Phase 3 fails closed with:

```text
VARIABLE_MPI_SOURCE_REQUIRED
```

Do not bypass that boundary by assuming `$0.01`.

## 5.2 Phase 4 owns affordability

Phase 4 answers **how much size can be afforded against the exact effective stop**.

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

### Branch rule during current integration state

The accepted Decision 22 / handoff runtime is currently on:

```text
v24-execution-board-handoff
```

Until that branch is explicitly merged to `main`, normal operation of the accepted handoff/runtime must use the handoff branch:

```bash
git checkout v24-execution-board-handoff
git pull --ff-only
```

Do **not** switch to `main` expecting Decision 22 runtime behavior until the handoff branch has actually been merged.

## 6.2 Normal V2.4 equity session

Use **three terminals** for the full current V2.4 runtime surface.

### Terminal 1 — Schwab monitor

```bash
npm run schwab:monitor
```

Wait for healthy read-only broker state.

### Terminal 2 — V2.4 pretrade/handoff service

```bash
npm run v24:pretrade
```

Default bind:

```text
http://127.0.0.1:8788
```

This service provides candidate import/state plus the server-side handoff transport. It does not place broker orders.

### Terminal 3 — UI

```bash
npm run dev
```

Open the Vite URL shown in the terminal, normally:

```text
http://localhost:5173
```

Confirm:

- broker state is online;
- pretrade service is connected when transport/new handoff work is needed;
- router health is appropriate for the tab.

## 6.3 V2.4 runtime router startup

The router is **default-on**. Normal startup requires no positive enable variable.

Emergency pause:

```text
VITE_EXECUTIONOS_V24_ROUTER_DISABLED=true
```

Interpretation:

```text
unset  -> enabled
false  -> enabled
true   -> PAUSED
other nonempty value -> BLOCKED / fail closed
```

The retired positive flag:

```text
VITE_EXECUTIONOS_V24_ROUTER_ENABLED
```

must not be used.

PAUSED stops router orchestration only. It does not discard, retire, release, rewrite, or otherwise change durable execution ownership.

> **Router disabled does not mean execution ownership disabled.**

## 6.4 Router health

Operator-visible health states are:

```text
RUNNING
WAITING_FOR_SCHWAB
WAITING_FOR_PRETRADE
WAITING_FOR_ROUTER_LOCK
PAUSED
STALE
BLOCKED
ERROR
```

`RECONCILIATION_REQUIRED` and `LIVE_RECONCILIATION_REQUIRED` are ownership/trade conditions, not router-health states.

## 6.5 Health checks

Broker:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/state
```

V2.4 pretrade/handoff service:

```bash
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8788/api/candidates
```

Both service boundaries remain non-broker-writing.

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

### Phase 4 account-equity rule

For Phase 4 risk sizing, the authoritative Schwab field is:

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

A candidate is a **pre-entry contract proposal**, not a broker position.

A complete definition should state at minimum:

- symbol;
- direction;
- setup;
- primary timeframe;
- thesis;
- trigger;
- structural invalidation;
- targets;
- management intent.

## 8.1 Current PRE-TRADE browser behavior

The current V2.4 PRE-TRADE board displays imported candidates in `WAITING` state. It is intentionally a proposal board; WAITING candidates are not ARMED and are not eligible to own broker fills.

The current browser board does **not** expose the full internal permission/ARM workflow. Do not interpret visibility on the WAITING board as downstream execution authorization.

## 8.2 Candidate import

The V2.4 pretrade service accepts canonical candidate bundles through:

```text
POST /api/candidates/import
```

Default service:

```text
127.0.0.1:8788
```

Candidate source adapters must not bypass canonical validation, persistence, versioning, WAITING state, or authorization rules.

## 8.3 Candidate identity

V2.4 candidate identity/versioning is exact. Structural changes require a new candidate version rather than silent mutation of a previously evaluated candidate.

---

# 9. Phase 3 DSS and Phase 4 risk sizing

This section describes the **implemented internal pre-trade engine**. Not every internal function is currently exposed as a normal browser action.

## 9.1 Phase 3 DSS

Phase 3 accepts an already-resolved structural invalidation and produces an immutable DSS evaluation containing an `effectiveStop`.

Important behavior:

- no continuous DSS recalculation while merely `WAITING`;
- fresh `VALID` DSS may be reused during active permission evaluation;
- a newer completed 2-minute bar can stale the current evaluation;
- the next permission cycle may create a new immutable evaluation;
- after authorization, the exact DSS identity is frozen;
- Phase 3 never sizes the trade.

## 9.2 Phase 4 expected entry

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

Quote requirements include:

- positive bid and ask;
- `bid <= ask`;
- locked market allowed;
- crossed market blocked;
- quote age ≤5 seconds.

## 9.3 Risk geometry

```text
LONG riskDistance  = currentExpectedEntry - effectiveStop
SHORT riskDistance = effectiveStop - currentExpectedEntry
```

Directional geometry must be valid.

## 9.4 Risk budget

```text
rawMaxDollarRisk = accountEquity × 0.005
maxDollarRisk = floorToCent(rawMaxDollarRisk)
```

Budget rounding never rounds upward.

## 9.5 Equity sizing

```text
riskPerShare = riskDistance
rawQuantity = maxDollarRisk / riskPerShare
finalQuantity = floor(rawQuantity)
```

Odd lots are allowed. Fractional shares are not assumed.

## 9.6 Futures sizing

Trusted futures metadata includes:

```text
tickSize
tickValue
pointValue?   // optional consistency check
minimumQuantity
quantityIncrement
currency
```

Calculation:

```text
riskTicks = ceil(riskDistance / tickSize)
riskPerContract = riskTicks × tickValue
```

## 9.7 Affordability outcomes

Phase 4 statuses are:

```text
VALID
NO_AFFORDABLE_SIZE
BLOCKED
ERROR
```

`NO_AFFORDABLE_SIZE` means minimum valid size cannot fit the 0.5% risk budget.

Downstream consequence:

```text
PASS — STOP_RISK_CONFLICT
```

Do not solve this by tightening the stop.

## 9.8 Maximum affordable quantity is a ceiling

If:

```text
maxAffordableQuantity = 90
```

then quantities up to 90 may be valid, subject to instrument minimum/increment and all other checks. 91 is prohibited by that risk evaluation.

## 9.9 Every ARM attempt gets fresh risk

Every ARM attempt from `READY` / `CAUTION` requires a **new Phase 4 evaluation** from fresh inputs.

At final authorization:

- quote freshness ≤5 seconds;
- account snapshot freshness ≤15 seconds.

---

# 10. Arming, handoff, and broker execution

## 10.1 V2.4 `ARMED` authorization

Internal V2.4 authorization freezes the exact candidate/DSS/risk/quantity/account provenance.

The downstream authorization card and full trade-specification inspector are read-only.

### Current UI limitation

The complete upstream action that takes a WAITING browser candidate through permission, fresh ARM risk evaluation, final ARM authorization, and creation/registration of a new production handoff is **not yet exposed as one normal browser workflow**.

Therefore do not document or assume “click ARM on the WAITING board” behavior that does not exist.

## 10.2 Automatic downstream handoff processing

Once a valid handoff exists in the server-side handoff/delivery repositories, the default-on runtime router may discover and process it through:

```text
PENDING / CLAIMED
  ↓
PREPARED
  ↓
LISTENING
  ↓
DELIVERED
```

`PREPARED` reserves the symbol while no lifecycle exists. `LISTENING` freezes authoritative `executionListeningAt`.

## 10.3 DISCARD before fill

PREPARED may retire before listening begins.

LISTENING discard creates one durable `REQUESTED` retirement with immutable cutoff.

Possible states/outcomes include:

```text
REQUESTED / WAITING
RETIRED
SUPERSEDED_BY_PRIOR_FILL
RECONCILIATION_REQUIRED
```

Rules:

- healthy CONTIGUOUS evidence that is merely behind the cutoff remains REQUESTED/WAITING;
- no timeout converts healthy catch-up into reconciliation;
- `RETIRED` releases the pre-fill reservation;
- eligible fill in `[executionListeningAt, cutoffAt)` produces `SUPERSEDED_BY_PRIOR_FILL`;
- unprovable interval produces reconciliation.

## 10.4 First-fill ownership and LIVE promotion

Ownership requires:

- exact authorized account;
- authoritative Schwab `executionTime`;
- matching symbol/direction/opening semantics;
- continuous broker execution coverage;
- valid lossless ownership journal;
- required broker-order provenance.

A qualifying partial first fill establishes LIVE immediately.

Promotion atomically creates:

1. the durable V2.4 lifecycle; and
2. the visible V2.4-origin LIVE Execution Board projection.

After that atomic transfer, the immutable installation remains provenance-only and does not separately reserve the symbol.

## 10.5 LIVE lifecycle

Subsequent exact-account events use lossless journal sequence and authoritative `executionTime`:

```text
ENTRY_FRAGMENT
ADD
PARTIAL
FLAT
REVERSAL
```

Same-entry-order fragments remain entry fragments; a different broker opening order that increases the position is an ADD.

## 10.6 Reconciliation boundary

Coverage/provenance discontinuity after ownership does **not** release the trade.

Possible states include:

```text
RECONCILIATION_REQUIRED
LIVE_RECONCILIATION_REQUIRED
```

Current operator surface displays reconciliation-required conditions and preserves ownership fail-closed, but it does **not yet provide a complete explicit reconciliation-resolution workflow**. Do not clear or rewrite durable state manually to force release.

## 10.7 Actual order entry

Equity orders remain manual in thinkorswim/Schwab.

ExecutionOS does not:

- place orders;
- replace orders;
- cancel orders;
- modify stops;
- automatically reduce oversized exposure;
- flatten positions.

---

# 11. Live trade management

Once an eligible V2.4 first fill is promoted into execution ownership, the structural management framework remains:

```text
VALID
THREATENED
INVALID
```

These labels describe structure, not profitability.

## VALID

The thesis remains intact.

## THREATENED

New adverse structure materially weakens the thesis but has not yet met declared invalidation.

## INVALID

The thesis has failed according to the contract or a legitimate structural update.

Core rule:

> **Red is not invalidation. Green is not an exit. Structure is invalidation.**

## 11.1 Manual exit check

Before a discretionary exit, ask:

> **If I could not see my P/L, would I still exit this chart right now?**

## 11.2 Quantity/risk warnings

For V2.4 LIVE trades:

- `selectedQuantity` remains immutable authorization provenance;
- actual owned quantity may differ because of fills/adds;
- exposure above the authorized initial quantity remains owned and is warned, not automatically reduced;
- actual stop risk uses the V2.4 `effectiveStop`;
- the comparison budget is the frozen ARM-time authorized max-dollar-risk;
- no warning authorizes stop tightening or broker writes.

---

# 12. Persistence and local state

ExecutionOS currently has **two persistence domains** relevant to V2.4.

## 12.1 Server-side V2.4 pretrade/handoff files

Default local files include:

```text
.executionos-v24-state.json
.executionos-v24-execution-board-handoffs.json
.executionos-v24-execution-board-handoff-deliveries.json
```

They contain durable pretrade candidate state and immutable handoff/delivery state used by the local V2.4 service.

These files and their temporary write files are Git-ignored and must remain private/local.

## 12.2 Browser canonical Execution Board store

The canonical browser Execution Board store is persisted in localStorage under:

```text
execution-v23-store
```

Despite the historical key name, it now carries both legacy V2.3 and V2.4 downstream namespaces, including installation/retirement/lifecycle provenance.

All production browser-side mutations are serialized through the canonical writer boundary.

Cross-tab notifications trigger a reread of canonical durable state; event payloads are never authority.

Stable receiver identity is persisted separately on the same browser origin.

## 12.3 Recovery rules

Ordinary reload/remount/HMR/takeover must not require reconstruction from visual UI state.

After leadership acquisition the router rereads:

- latest canonical browser store;
- latest broker state;
- currently available handoff transport.

PREPARED proposed boundaries are ephemeral until LISTENING. Once LISTENING is durable, its exact boundary is immutable.

Do not manually edit localStorage or server JSON to bypass ownership, retirement, identity, or reconciliation rules.

---

# 13. End-of-Day reporting

The EOD reporter combines two independent sources:

1. Schwab broker execution history;
2. ExecutionOS browser History export.

## 13.1 Schwab execution history

Schwab is broker-authoritative for fills and position changes.

The reporter reconstructs complete-context broker cycles and metrics such as:

- direction;
- entry/exit VWAP;
- peak quantity;
- gross realized P/L for complete-context cycles;
- winners/losers;
- average winner/loser;
- profit factors.

## 13.2 ExecutionOS History export

The browser export supplies setup/process context Schwab does not know, including:

- setup/timeframe;
- thesis/trigger/invalidation;
- structural invalidation/legacy structural stop;
- V2.4 effective stop when applicable;
- target/management plan;
- expected entry/intended size;
- planned risk;
- realized R;
- ExecutionOS ownership and process state.

## 13.3 Planned-risk semantics

EOD risk enrichment is origin-aware:

```text
V2.4-origin trade -> v24.effectiveStop is execution/risk stop authority
legacy/manual V2.3 -> originalPlan.structuralStop is stop authority
```

For V2.4, structural invalidation remains separate audit/context information. Planned risk and actual-entry stop risk are not calculated from structural invalidation when an authoritative V2.4 effective stop exists.

## 13.4 Enriched EOD procedure

1. Confirm the intended trades have completed into ExecutionOS History.
2. Keep Vite running.
3. Use the same browser profile/origin used during the session.
4. Open:

```text
http://localhost:5173/eod-export.html
```

5. Choose:

```text
DOWNLOAD EXECUTIONOS EOD HISTORY
```

6. Run:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

Preferred explicit export path:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD --executionos=~/Downloads/executionos-eod-history-YYYY-MM-DD.json
```

Default HTML output:

```text
reports/eod/YYYY-MM-DD.html
```

## 13.5 Verify enrichment

Do not treat “HTML file created” as proof of complete enrichment.

Check:

- intended History export loaded;
- ExecutionOS-owned vs broker-only counts are plausible;
- setup/process fields appear where expected;
- planned risk/R appears only when supported;
- V2.4 risk is based on effective stop;
- unmatched broker cycles remain broker-only.

## 13.6 Carry-in/context warnings

The reporter does not invent cost basis. If the first same-day execution is closing activity, that position may have existed before the report window.

When carry-in/context warnings exist, reconstructed gross P/L is not a definitive whole-account daily P/L total.

## 13.7 Profit-factor distinction

```text
Gross Profit Factor = gross profit / gross loss
```

```text
Average Win/Loss Factor = average winner / abs(average loser)
```

Keep them distinct.

## 13.8 Private artifacts

History JSON and generated HTML contain private trading-plan/review information. Keep them local and do not commit them.

---

# 14. Futures / NinjaTrader status

MES/MNQ and other supported futures can be represented for sizing calculations.

However:

- live NinjaTrader broker binding is **not connected**;
- Schwab must not be treated as the futures execution source;
- futures sizing support is not equivalent to broker integration;
- a futures candidate will not automatically become LIVE from NinjaTrader today.

---

# 15. Security

Never commit or expose:

- Schwab Client Secret;
- OAuth access/refresh tokens;
- authorization codes;
- unmasked account numbers;
- private broker exports;
- ExecutionOS private History exports;
- V2.4 local pretrade/handoff state files.

Important local files include:

```text
.env.local
.schwab-tokens.json
.executionos-v24-state.json
.executionos-v24-execution-board-handoffs.json
.executionos-v24-execution-board-handoff-deliveries.json
```

Keep secrets out of browser-exposed `VITE_` variables.

---

# 16. Troubleshooting

## 16.1 Broker offline

```bash
npm run schwab:monitor
curl http://127.0.0.1:8787/health
```

`WAITING_FOR_SCHWAB` does not release durable ownership.

## 16.2 Pretrade service offline

```bash
npm run v24:pretrade
curl http://127.0.0.1:8788/health
```

`WAITING_FOR_PRETRADE` means new transport/activation work is unavailable. Durable post-LISTENING broker ownership processing continues when Schwab evidence is healthy.

## 16.3 Schwab authentication fails

Verify `.env.local`, callback URL, and token state. Reauthorize:

```bash
npm run schwab:auth
```

## 16.4 Router is not RUNNING

Interpret the visible health state:

- `WAITING_FOR_SCHWAB` — broker evidence unavailable;
- `WAITING_FOR_PRETRADE` — new transport/activation unavailable;
- `WAITING_FOR_ROUTER_LOCK` — another tab owns router leadership;
- `PAUSED` — emergency negative switch active;
- `BLOCKED` — known safety/config/capability blocker;
- `STALE` — leader heartbeat exceeded tolerance;
- `ERROR` — operational failure; durable ownership remains authoritative.

## 16.5 Imported WAITING candidate does not ARM automatically

This is currently expected. The PRE-TRADE browser board is a WAITING proposal surface; the complete permission/ARM/handoff-creation operator workflow is not yet exposed there.

Do not bypass this by fabricating handoff/local-storage state.

## 16.6 Existing handoff did not progress

Check:

- router health;
- Schwab availability;
- pretrade/handoff transport availability for activation;
- exact account/symbol;
- handoff delivery state;
- browser router leadership;
- broker coverage catch-up.

## 16.7 Fill did not become owned

Check:

- durable LISTENING;
- `executionTime >= executionListeningAt`;
- exact authorized account;
- matching opening direction/effect;
- continuous coverage;
- valid journal;
- retirement state/cutoff;
- broker order provenance.

A refresh should not be required for normal deterministic recovery.

## 16.8 Reconciliation required

Do not delete ownership or edit persistent state.

The current UI warns and retains ownership fail-closed. A complete explicit reconciliation-resolution workflow is not yet exposed.

## 16.9 Phase 4 says no affordable size

Do not tighten the stop. Reduce quantity if a smaller valid size exists; otherwise pass.

## 16.10 Phase 4 blocked

Common causes:

- stale/missing quote;
- missing required quote side;
- crossed market;
- invalid entry/stop geometry;
- stale/invalid account snapshot;
- unsupported currency/asset type;
- invalid/inconsistent instrument metadata;
- on/after 2026-11-02, missing authoritative variable-MPI source where required.

## 16.11 EOD broker-only rows

Check:

1. trade completed into History;
2. export downloaded after completion;
3. same browser origin/profile;
4. intended export loaded;
5. symbol/direction/timing plausibility.

---

# 17. Current limitations and deferred work

Current incomplete/deferred areas include:

- complete browser/API `WAITING → permission → ARM → handoff creation` operator orchestration;
- explicit reconciliation-resolution workflow;
- broader macro/context decision-gate logic beyond implemented components;
- broker order placement/replacement/cancellation;
- broker-write Governor enforcement;
- buying-power/margin eligibility gate;
- aggregate portfolio heat controls;
- broader asset/currency support;
- automatic NinjaTrader futures binding;
- cloud persistence/multi-device synchronization;
- durable production database for all decision history;
- AI in the latency-sensitive execution path.

Do not bypass these gaps with manual state edits or guessed fallbacks.

---

# 18. Repository discipline

Treat:

- `v2.3.0` as the frozen downstream release reference;
- `main` as the merged Phases 1–4 baseline;
- `v24-execution-board-handoff` as the current accepted handoff/runtime integration branch until explicitly merged;
- approved design/addendum documents as frozen architecture records;
- closeout/status records as implementation evidence.

Do not:

- move/delete the `v2.3.0` tag;
- rewrite approved historical design documents to simulate later implementation state;
- begin V3 without explicit authorization;
- commit credentials/tokens/private broker data/private EOD exports;
- commit V2.4 local state files.

Before switching branches, understand which runtime you are selecting. `main` does not automatically contain unmerged handoff-branch work.

---

# 19. Recommended daily operating procedure

This procedure reflects what can be operated safely today.

## Before market / before first trade

1. Use `v24-execution-board-handoff` while that remains the accepted unmerged handoff branch.
2. Start `npm run schwab:monitor`.
3. Wait for healthy read-only broker state.
4. Start `npm run v24:pretrade`.
5. Start `npm run dev`.
6. Confirm broker/pretrade connectivity.
7. Confirm router health. `RUNNING` is normal for the leader; another tab may show `WAITING_FOR_ROUTER_LOCK`.
8. Confirm broker positions and exact account state match reality.

## Candidate/pretrade work

1. Perform the READ outside ExecutionOS.
2. Define thesis, trigger, structural invalidation, targets, management intent.
3. Preserve `structure → effective stop → risk budget → size`.
4. Import canonical candidate bundles when using V2.4 candidate ingestion.
5. Treat the WAITING board as proposals only.
6. Do not assume the current browser board will automatically run the complete permission/ARM/handoff-creation workflow.

## When a valid V2.4 handoff exists

1. Let the default-on router perform safe discovery/activation.
2. Verify PREPARED/LISTENING authorization state in the Execution workspace.
3. Inspect the read-only full trade specification as needed.
4. Place actual equity orders only in thinkorswim/Schwab.
5. Let eligible exact-account fills establish LIVE ownership.
6. Manage LIVE state by `VALID / THREATENED / INVALID`.
7. Use DISCARD only for a pre-fill authorization; remember LISTENING discard may remain REQUESTED while Schwab evidence catches up.

## During outage/restart

Do not interpret service loss as ownership release and do not edit persistent state.

- PREPARED remains durable;
- LISTENING retains immutable boundary;
- REQUESTED retains cutoff;
- LIVE remains owned;
- EXIT remains owned until History;
- unprovable history requires reconciliation.

## After session

Export ExecutionOS History before shutting down the UI origin if you want enriched EOD reporting, then run the EOD report and retain artifacts privately.

---

# 20. Command reference

## Setup / UI

```bash
npm install
npm run dev
npm run build
npm run preview
npm run v24:pretrade
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

## V2.4 market data / DSS

```bash
npm run v24:market-data-test
npm run v24:market-data-probe
npm run v24:dss-live-probe
npm run v24:dss-test
npm run v24:risk-sizing-test
```

## V2.4 handoff / ownership / runtime validation

```bash
npm run v24:handoff-test
npm run v24:handoff-api-test
npm run v24:broker-provenance-test
npm run v24:handoff-admission-test
npm run v24:v23-compat-test
npm run v24:v23-install-test
npm run v24:fill-ownership-test
npm run v24:retirement-test
npm run v24:activation-test
npm run v24:live-lifecycle-test
npm run v24:store-authority-test
npm run v24:runtime-router-test
npm run v24:router-hardening-test
npm run v24:router-browser-test
```

The browser router suite uses real Web Locks for multi-tab leadership/recovery. The hardening suite covers the synthetic read-only REQUESTED-retirement recovery regression.

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

---

# 21. Documentation map

Authority principle: current validated code/runtime defines what the system actually does; this guide translates that into operator procedure; approved design addenda define frozen architecture for their scope.

| Need | Source |
|---|---|
| Operate current handoff branch | `USER-GUIDE.md` |
| Documentation authority/status | `docs/ExecutionOS_Documentation_Index.md` |
| Current vs historical map | `DOCUMENTATION-STATUS.md` |
| Overall V2.4 architecture | `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` |
| Phase 3 accepted implementation | `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` |
| Phase 4 design | `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` |
| Phase 4 accepted implementation | `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` |
| Handoff Decisions 10–20 | approved handoff design baseline/addenda through `v1.0` |
| Full Trade Specification Inspector | `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v1.1_APPROVED.md` |
| Decision 22 runtime hardening | `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Design_Addendum_v1.2_APPROVED.md` |
| EOD semantics | `docs/ExecutionOS_EOD_Report.md` |
| Historical analytics provenance | `research/30-day-management-study/methodology.md` |

Historical approved documents may intentionally contain status wording that was true at approval time. Do not use an older approval-time “not implemented yet” statement to override newer accepted code/closeout evidence.

---

# 22. Glossary

**Structural invalidation**  
The chart condition/price structure that proves the thesis wrong.

**Effective stop**  
The Phase 3 volatility-protected execution stop derived from structural invalidation. Phase 4 may not change it.

**DSS evaluation**  
Immutable Phase 3 evaluation identified by `dssEvaluationId`.

**Risk evaluation**  
Immutable Phase 4 evaluation identified by `riskEvaluationId`.

**Maximum affordable quantity**  
Largest valid quantity whose planned entry→effective-stop risk fits the 0.5% budget. It is a ceiling, not a required size.

**V2.4 `ARMED` authorization**  
Immutable pre-trade authorization freeze containing exact candidate, DSS, effective-stop, risk, account, and selected-quantity identity. It does not place an order.

**Handoff**  
Immutable transfer contract from V2.4 authorization into the downstream execution boundary.

**PREPARED**  
Durable local pre-fill reservation before authoritative broker-fill listening begins.

**LISTENING**  
Durable pre-fill reservation with immutable `executionListeningAt` and broker-fill eligibility.

**REQUESTED**  
Durable nonterminal retirement state after LISTENING discard; retains cutoff and ownership while evidence catches up.

**RETIRED**  
Clean pre-fill retirement proven through cutoff with no eligible prior fill; releases the reservation.

**SUPERSEDED_BY_PRIOR_FILL**  
Retirement outcome when an eligible fill occurred before cutoff; ownership proceeds toward LIVE.

**LIVE_RECONCILIATION_REQUIRED**  
Fail-closed LIVE ownership state after broker execution continuity/provenance becomes unprovable. Ownership is retained; current UI does not yet expose a complete reconciliation-resolution workflow.

**Router leadership**  
Browser-wide exclusive Web Lock authority permitting one tab to run automated V2.4 routing.

**Canonical store writer authority**  
Browser-wide serialized writer boundary for canonical Execution Board mutations.

**Execution state**  
Live structural classification `VALID`, `THREATENED`, or `INVALID`.

**Trade contract**  
Saved pre-entry intent: thesis, trigger, invalidation, targets/management, and risk context.

**Governor**  
Planned future V3 deterministic management-policy layer. V3 has not started.

---

## Living-document maintenance rule

Update this guide whenever normal startup, active branch/release state, broker-data source, candidate/risk semantics, pre-trade/ARM operator surface, handoff/ownership, persistence, supported instruments, safety boundaries, EOD procedure, or CLI surface changes.

Do not let this guide silently drift away from validated application behavior.
