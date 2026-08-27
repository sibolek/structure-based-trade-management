# ExecutionOS User Guide

**Version:** 1.1  
**Date:** 27 August 2026  
**Status:** Living operator guide for current `main` — frozen V2.3.0 execution baseline plus post-release EOD reporting  
**Repository:** `sibolek/structure-based-trade-management`  
**Current product baseline:** `main`  
**Frozen execution release tag:** `v2.3.0`  
**Current documentation baseline:** `main`

> **Operating principle:** Structure decides. P/L emotion does not.
>
> ExecutionOS exists to preserve pre-entry intent under live market pressure. It does not choose trades for you and it does not currently place, replace, cancel, or flatten broker orders.

---

## Table of contents

1. [Purpose and authority](#1-purpose-and-authority)
2. [What ExecutionOS is](#2-what-executionos-is)
3. [Current project status](#3-current-project-status)
4. [Core workflow](#4-core-workflow)
5. [System architecture](#5-system-architecture)
6. [Installation and Schwab authorization](#6-installation-and-schwab-authorization)
7. [Starting a trading session](#7-starting-a-trading-session)
8. [Creating and risk-sizing a candidate](#8-creating-and-risk-sizing-a-candidate)
9. [Arming and broker-fill binding](#9-arming-and-broker-fill-binding)
10. [Live Execution Board](#10-live-execution-board)
11. [VALID / THREATENED / INVALID](#11-valid--threatened--invalid)
12. [Broker lifecycle semantics](#12-broker-lifecycle-semantics)
13. [Management discipline](#13-management-discipline)
14. [Editing an armed candidate](#14-editing-an-armed-candidate)
15. [Ending a trade and History](#15-ending-a-trade-and-history)
16. [Generating an accurate enriched EOD report](#16-generating-an-accurate-enriched-eod-report)
17. [Persistence and local data](#17-persistence-and-local-data)
18. [Futures / NinjaTrader status](#18-futures--ninjatrader-status)
19. [Historical analytics](#19-historical-analytics)
20. [Security boundaries](#20-security-boundaries)
21. [Troubleshooting](#21-troubleshooting)
22. [Current limitations and deferred work](#22-current-limitations-and-deferred-work)
23. [Repository and branch discipline](#23-repository-and-branch-discipline)
24. [Recommended daily operating procedure](#24-recommended-daily-operating-procedure)
25. [Glossary](#25-glossary)
26. [Appendix A — command reference](#appendix-a--command-reference)
27. [Appendix B — environment variables](#appendix-b--environment-variables)
28. [Appendix C — local files and retention](#appendix-c--local-files-and-retention)
29. [Appendix D — current development sequence](#appendix-d--current-development-sequence)

---

# 1. Purpose and authority

This is the practical, living operator guide for ExecutionOS as it exists now. It answers:

> **How do I operate ExecutionOS correctly today?**

Use this precedence when records disagree:

1. current code and validated broker behavior;
2. this User Guide for day-to-day operation;
3. the current Project Specification for architecture and decisions;
4. `research/30-day-management-study/methodology.md` for historical analytics provenance;
5. `DOCUMENTATION-STATUS.md` and the documentation index for current-versus-historical classification;
6. dated reports and older specifications as historical evidence only.

The living guide should be updated whenever normal operating workflow, broker integration, lifecycle semantics, persistence, risk behavior, reporting, or command-line surface changes.

---

# 2. What ExecutionOS is

ExecutionOS is a **local, broker-aware execution operating system** designed to preserve a trader's pre-entry plan after capital is at risk.

It separates three activities:

- **READ:** analyze the market and choose a setup;
- **PLAN / RISK:** define the contract, invalidation, structural stop, and affordable size;
- **EXECUTION MANAGEMENT:** observe broker reality and manage according to structure rather than open P/L.

The governing rule is:

> **Entry freezes the original plan. New structure can modify it. Emotion cannot.**

ExecutionOS is deliberately not a scanner, signal generator, broker replacement, automated trading system, universal hold timer, universal breakeven engine, or AI decision-maker in the split-second order path.

For equities, thinkorswim/Schwab remains the execution venue. ExecutionOS observes the broker through a read-only local bridge.

---

# 3. Current project status

## 3.1 Frozen V2.3.0 execution baseline

V2.3 completed release validation and was frozen under the annotated tag:

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

That tag is the immutable reference for the validated V2.3 execution release.

## 3.2 Current `main`

After the V2.3.0 tag was frozen, a **read-only end-of-day reporting workflow** was added through PR #7.

PR #7 merged into `main` on 27 August 2026 at:

```text
bedd70979a3b18844386bcf8f927fd8a1f62307f
```

The EOD addition does not add broker-write authority and does not change order placement, cancellation, replacement, or the validated production trade-state engine.

Current `main` therefore contains:

- the validated V2.3 execution system;
- preserved analytics/research tooling;
- the read-only Schwab bridge and local state API;
- the browser-based ExecutionOS history;
- the post-release read-only EOD reporting utility.

V3 has **not** started and requires separate explicit authorization.

## 3.3 V2.3 capabilities

The current execution system supports:

- multiple independently armed trade candidates;
- one armed candidate per symbol;
- automatic binding of matching Schwab opening fills;
- multiple simultaneous live trades;
- broker-derived average price, quantity, and peak quantity;
- ENTRY / ADD / PARTIAL / FLAT / REVERSAL state semantics;
- safe editing while the last saved candidate remains authoritative;
- deterministic fill-during-edit ownership;
- browser-local History and execution-decision records;
- read-only Schwab broker-state display.

A true live cross-zero reversal could not be forced through thinkorswim because the broker rejected the attempted cross-zero order. The deterministic state engine and actual React reversal transition path were nevertheless validated. Exact same-poll cross-symbol ownership remains a documented non-blocking edge case before any future broker-write or automated simultaneous-entry capability.

---

# 4. Core workflow

**READ -> PLAN -> RISK -> ARM -> TRIGGER -> HOLD -> UPDATE -> EXIT -> REVIEW**

| Stage | Purpose |
| --- | --- |
| READ | Analyze market structure outside the app. |
| PLAN | Freeze thesis, trigger, invalidation, structural stop, target, and management plan. |
| RISK | Verify that the structural stop is affordable at the intended size. |
| ARM | Make the saved plan eligible to listen for a matching future broker fill. |
| TRIGGER | Wait for the planned trigger, then execute in the broker. |
| HOLD | Do nothing while structure remains valid. |
| UPDATE | Record legitimate new structure and state changes. |
| EXIT | Exit for a planned, structural, or explicitly discretionary reason. |
| REVIEW | Judge execution quality separately from P/L. |

A correct market read is not automatically a setup; a valid setup is not automatically a trade.

---

# 5. System architecture

Normal Schwab equity path:

```text
thinkorswim / Schwab
        |
        v
Schwab Trader API
        |
        v
local schwab-bridge/monitor.mjs
        |
        +--> broker state engine
        |
        +--> read-only local API
              http://127.0.0.1:8787
                    |
                    v
              React / Vite UI
                    |
                    v
               ExecutionV23
```

Read-only local endpoints:

```text
GET /health
GET /api/state
```

The React UI polls `/api/state` once per second by default.

The bridge observes broker state. It does not place, replace, cancel, or flatten Schwab orders.

---

# 6. Installation and Schwab authorization

## 6.1 Install

```bash
git clone https://github.com/sibolek/structure-based-trade-management.git
cd structure-based-trade-management
npm install
```

Use `main` for normal operation unless a current project task explicitly requires another branch.

## 6.2 Local environment

```bash
cp .env.local.example .env.local
```

Required values include:

```text
SCHWAB_CLIENT_ID=...
SCHWAB_CLIENT_SECRET=...
SCHWAB_CALLBACK_URL=https://127.0.0.1:8182
```

Never commit `.env.local` or `.schwab-tokens.json`.

Confirm ignore rules:

```bash
git check-ignore .env.local .schwab-tokens.json
```

## 6.3 Authorize Schwab

```bash
npm run schwab:auth
```

Complete Schwab authentication in the browser. If the local callback page does not render, copy the full redirected URL from the browser address bar and paste it into the terminal when prompted.

## 6.4 Confirm account access

```bash
npm run schwab:account
```

A healthy result should show authorized account count, masked account identifier, account equity, 0.5% maximum planned-risk budget, buying power, and positions.

---

# 7. Starting a trading session

The normal live-equity session uses two terminals.

## Terminal 1 — Schwab monitor

```bash
npm run schwab:monitor
```

Wait for:

```text
MONITOR ARMED
```

The monitor authenticates, loads accounts and current positions, baselines pre-existing executions, starts the read-only local API, and begins polling for new fills.

Existing fills at startup are intentionally treated as baseline rather than fresh events.

## Terminal 2 — React UI

```bash
npm run dev
```

Open the Vite URL, normally:

```text
http://localhost:5173
```

Confirm **BROKER ONLINE** before relying on automatic fill binding.

Optional checks:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/state
```

---

# 8. Creating and risk-sizing a candidate

A candidate is a **pre-entry Trade Contract**, not a position.

Required planning fields include:

| Field | Meaning |
| --- | --- |
| Symbol | Instrument ticker. |
| Direction | LONG or SHORT. |
| Setup | Named setup / structure. |
| Timeframe | Primary execution timeframe. |
| Thesis | What price is doing and why the setup exists. |
| Trigger | What authorizes actual entry. |
| Invalidation | What proves the thesis wrong. |
| Structural stop | Price beyond which the setup is invalid. |
| Target | Planned objective / target framework. |
| Management plan | What management actions are preauthorized. |

The trigger should be concrete enough to answer yes/no in real time.

Invalidation is structural; it is not synonymous with being red, uncomfortable, or temporarily pulling back.

## 8.1 Risk hierarchy

The required sequence is:

**Structural stop -> acceptable risk -> position size**

Project risk rule:

> **Maximum planned loss per trade = 0.5% of the relevant account equity.**

For equities:

```text
risk per share = abs(expected entry - structural stop)
planned risk   = risk per share * intended shares
max risk       = account equity * 0.005
max size       = floor(max risk / risk per share)
```

If the correct structural stop is too expensive, reduce size or pass. Do not tighten the stop merely to make the dollar amount fit.

---

# 9. Arming and broker-fill binding

**ARM** means:

> The saved plan is complete, risk-valid, and eligible to listen for a matching future broker opening fill.

ARM does **not** send an order.

For Schwab equities, ownership requires consistency with:

- symbol;
- planned direction;
- opening position effect;
- execution occurring after the candidate's `armedAt` time.

Direction mapping:

- LONG expects opening BUY;
- SHORT expects opening SELL_SHORT.

V2.3 permits only one armed candidate per symbol.

A fresh candidate must not claim a broker position that already existed before it was armed.

---

# 10. Live Execution Board

After a matching broker fill, the candidate becomes LIVE.

The Live Execution Board preserves the original contract while showing broker-derived reality such as:

- actual entry price;
- entry quantity;
- current quantity;
- peak quantity;
- current average price;
- structural stop;
- planned-risk context;
- broker execution timeline;
- current VALID / THREATENED / INVALID classification.

The purpose is to keep the original plan visible after the emotional context changes.

---

# 11. VALID / THREATENED / INVALID

These labels classify **structure**, not profitability.

## VALID

Use VALID when the thesis remains intact. A VALID trade may be green, red, chopping, pulling back, or uncomfortable.

## THREATENED

Use THREATENED when new adverse structure materially weakens the thesis but has not yet crossed the invalidation boundary.

Examples include meaningful failure to continue, repeated failure to hold a breakout, or a new opposing structure.

THREATENED is currently a manual structural classification in V2.3. It is not automatically set merely because risk or P/L looks uncomfortable.

## INVALID

Use INVALID when the trade thesis has actually failed according to the frozen contract or a legitimate later structural update.

> **Green is not an exit. Red is not invalidation. Structure is invalidation.**

---

# 12. Broker lifecycle semantics

The broker state engine reconstructs:

## ENTRY

Flat -> non-zero exposure.

## ADD

Exposure increases in the same direction. Average price is recomputed and peak quantity increases as appropriate.

## PARTIAL

Exposure decreases but remains open in the same direction. The trade is not archived merely because a partial exit occurred.

## FLAT

Position quantity reaches zero. FLAT is terminal for that broker position episode.

## REVERSAL

An execution crosses through zero and leaves opposite exposure. The prior Trade Contract terminates; opposite exposure is not silently inherited by the old plan.

---

# 13. Management discipline

The primary live-management question is:

> **What changed on the chart?**

Before a discretionary manual exit, ask:

> **If I could not see my P/L, would I still exit this chart right now?**

and:

> **Would I make this exact same exit if yesterday had been +$50 instead of -$50?**

For fast 2-minute trades, avoid moving the stop toward breakeven/profit or manually exiting solely because of P/L during the remainder of the entry bar and the next completed 2-minute bar unless one of the following occurs:

- structural invalidation;
- predefined target;
- genuinely new adverse structure;
- explicitly preauthorized management action.

Do not improvise adds or size changes because a trade is green or red.

---

# 14. Editing an armed candidate

The last **saved** candidate remains authoritative while edits are in progress.

When editing:

- ExecutionOS creates a working copy;
- the saved candidate remains armed;
- unsaved edits are not authoritative;
- CANCEL discards the working copy;
- SAVE replaces the saved contract after risk validation.

If a broker fill occurs during editing, the last saved plan owns the fill and unsaved changes are discarded.

---

# 15. Ending a trade and History

When broker state becomes FLAT, the completed position episode can move to ExecutionOS History.

History should be reviewed for both:

- **trade outcome** — money made or lost;
- **execution quality** — whether the contract and legitimate structural updates were followed.

A correctly executed losing trade can be a good execution. A profitable panic exit can still be poor execution.

History may preserve:

- original frozen plan;
- arm event;
- broker entry detection;
- state changes;
- adds / partials;
- exit reason;
- decision timeline;
- completed timestamp.

This History is also the source of the **ExecutionOS enrichment layer** used by the EOD reporter.

---

# 16. Generating an accurate enriched EOD report

The EOD reporter deliberately combines **two independent sources**. An accurate enriched report requires understanding what each source contributes.

## 16.1 Source 1 — Schwab execution history

Schwab is authoritative for broker fills and position changes.

The EOD reporter uses Schwab's read-only history to reconstruct complete flat-to-flat trade cycles and calculate broker-derived metrics including:

- completed and open reconstructed cycles;
- long / short direction;
- peak quantity;
- entry VWAP;
- exit VWAP;
- reconstructed gross realized P/L;
- winners / losers / flat trades;
- win rate;
- average winner;
- average loser;
- gross profit factor;
- average win/loss factor;
- largest winner and loser.

A **broker-only** EOD report can be generated from Schwab data alone.

## 16.2 Source 2 — ExecutionOS Execution Board / History export

The **enriched** EOD report requires the completed Trade Contracts stored in ExecutionOS browser History.

This is the source for information Schwab does not know, including:

- setup;
- timeframe;
- thesis;
- trigger;
- invalidation;
- structural stop;
- target;
- management plan;
- expected entry;
- intended size;
- original planned dollar risk;
- realized R multiple;
- exit classification / reason;
- VALID / THREATENED / INVALID decision history;
- whether a broker trade was actually owned by an ExecutionOS contract.

> **Critical operating rule:** Download the ExecutionOS History export before generating the enriched EOD report.

If you skip the export, the reporter can still reconstruct Schwab trade cycles and P/L, but trades that should be ExecutionOS-owned may appear as **broker-only**, and setup, planned-risk, R-multiple, and process statistics cannot be fully populated.

## 16.3 Step 1 — make sure completed trades are in History

Before exporting, confirm every trade you expect to be enriched has completed its ExecutionOS lifecycle and is visible in **History**.

The helper reads persisted History from:

```text
execution-v23-store
```

A trade that has not yet completed/archived into History cannot be enriched from that export.

## 16.4 Step 2 — keep the Vite server running

Do **not** shut down the Vite server before exporting.

The export helper must run on the same browser origin as the ExecutionOS UI because browser `localStorage` is origin-specific.

If the normal UI is running at:

```text
http://localhost:5173
```

open the helper at:

```text
http://localhost:5173/eod-export.html
```

Do not casually switch between `localhost`, `127.0.0.1`, another port, or another browser profile. Those may have different local-storage namespaces and can yield an empty or incomplete export.

## 16.5 Step 3 — download ExecutionOS EOD History

Open:

```text
http://localhost:5173/eod-export.html
```

Choose:

```text
DOWNLOAD EXECUTIONOS EOD HISTORY
```

The helper reads only the browser's `execution-v23-store` History and downloads a file named like:

```text
executionos-eod-history-2026-08-27.json
```

The helper does not contact Schwab and does not mutate or delete ExecutionOS History.

By default the terminal reporter searches `~/Downloads` and automatically selects the newest file matching:

```text
executionos-eod-history-*.json
```

## 16.6 Step 4 — generate the report

For a specific trading date:

```bash
npm run schwab:eod -- --date=2026-08-27
```

To remove ambiguity, you may explicitly provide the export:

```bash
npm run schwab:eod -- --date=2026-08-27 --executionos=~/Downloads/executionos-eod-history-2026-08-27.json
```

The reporter prints a terminal summary and writes a self-contained HTML report to:

```text
reports/eod/YYYY-MM-DD.html
```

`reports/eod/` is Git-ignored.

## 16.7 Step 5 — verify enrichment actually occurred

An HTML file existing is **not sufficient proof** that the report is fully enriched.

Check the terminal output and reconciliation:

- confirm an ExecutionOS history export was auto-detected or explicitly loaded;
- confirm the number of ExecutionOS-owned cycles is plausible for the day's History;
- trades you know were run through ExecutionOS should not all appear broker-only;
- owned trades should show setup/process information;
- owned trades should show planned risk and R where the original Trade Contract supports those calculations;
- broker-only trades should remain explicitly broker-only rather than being force-matched.

Matching is intentionally conservative. The reporter matches by normalized symbol, direction, and entry-detection timing within a five-minute maximum window. Ownership is one-to-one. The reporter does not fabricate ownership simply to increase the match rate.

If you expected an ExecutionOS-owned trade but it appears broker-only, investigate the History export before accepting the enriched statistics.

## 16.8 Step 6 — understand carry-in / incomplete-context warnings

The reporter never invents a cost basis.

If a symbol's **first same-day execution is CLOSING**, the position may have been opened before the selected report date. That activity is context-incomplete and is excluded from reconstructed P/L rather than assigning a fictional opening price.

If the report shows a context warning, reconstructed gross realized P/L must **not** be described as definitive whole-account daily P/L.

This is especially important for swing positions carried into the session.

## 16.9 Step 7 — understand planned risk and R

For an ExecutionOS-owned trade, original planned risk is based on the frozen Trade Contract:

```text
planned risk = abs(expected entry - structural stop) * intended size
```

Realized R is:

```text
reconstructed realized gross P/L / original planned risk
```

Broker-only trades do not receive fabricated planned risk or R.

The optional COB risk snapshot comes from the current read-only monitor and is **not** treated as the frozen historical 0.5% risk budget for every completed trade.

## 16.10 Step 8 — distinguish the two profit-factor metrics

The report intentionally shows two different measures:

```text
Gross Profit Factor = gross profit / gross loss
```

```text
Average Win/Loss Factor = average winner / abs(average loser)
```

Do not conflate them.

## 16.11 Step 9 — preserve the export locally

The downloaded ExecutionOS History JSON contains trading-plan and execution-review information. Treat it as private/local working data.

Do not commit it to Git.

The dedicated reporting reference is:

```text
docs/ExecutionOS_EOD_Report.md
```

---

# 17. Persistence and local data

ExecutionOS stores browser state in `localStorage` under:

```text
execution-v23-store
```

A normal refresh should preserve drafts, armed candidates, live trades, and History.

Browser local storage is **not** a durable database or cloud backup. Clearing site data, using another browser profile, or changing browser origin can make that History unavailable.

Broker truth remains independently available from Schwab, but the local ExecutionOS decision record may be lost.

The EOD export helper is therefore also useful as a local review/export mechanism for completed History.

---

# 18. Futures / NinjaTrader status

MES, MNQ, MCL, ES, NQ, and CL may be represented in planning, but automatic NinjaTrader binding is not connected yet.

Schwab must not be treated as the futures source.

The planned future path is a separate read-only NinjaTrader observer normalized through a broker-agnostic event model before any Governor enforcement work.

---

# 19. Historical analytics

The repository preserves the historical evidence that motivated the future Management Governor.

Current evidence classification:

| Analysis | Status |
| --- | --- |
| Winner / loser duration | Recovered to preserved precision |
| Historical stop-management timing | Recovered to preserved precision |
| Historical initial-risk / realized-R | High-confidence reconstruction; one documented threshold discrepancy |
| 19-trade MFE | Benchmark and formula preserved; exact original membership unresolved |
| 19-trade capture efficiency | Benchmark and formula preserved; exact membership unresolved |
| 19-trade fixed-duration counterfactual | Benchmark and formula preserved; exact membership unresolved |

Do not search arbitrary trade combinations or timing conventions after seeing target numbers merely to force a historical match.

See:

```text
research/30-day-management-study/methodology.md
```

---

# 20. Security boundaries

Never commit or expose:

- Schwab Client Secret;
- OAuth access / refresh tokens;
- authorization codes;
- unmasked account identifiers;
- raw private broker exports;
- private EOD History exports.

Important local secret files:

```text
.env.local
.schwab-tokens.json
```

The Client Secret must never be placed in a `VITE_` variable or browser code.

Current Schwab integration is deliberately read-only.

No broker-write authority should be added until state reconstruction, Governor policy, override/emergency behavior, and shadow/live safety comparisons have been validated under a separately approved development phase.

---

# 21. Troubleshooting

## 21.1 BROKER OFFLINE

Confirm:

```bash
npm run schwab:monitor
```

Then:

```bash
curl http://127.0.0.1:8787/health
```

If the health endpoint works but React remains offline, confirm `VITE_EXECUTIONOS_BROKER_URL` points to the same local API.

## 21.2 Schwab authentication failure

Check `.env.local`, callback URL, and local token state. If refresh authorization is no longer valid:

```bash
npm run schwab:auth
```

## 21.3 Candidate did not bind

Check:

- candidate was ARMED before the fill;
- exact symbol match;
- LONG -> opening BUY;
- SHORT -> opening SELL_SHORT;
- broker execution classified OPENING;
- no disqualifying pre-existing position;
- monitor was running before the fill;
- UI was connected to the local API.

## 21.4 EOD report shows trades as broker-only unexpectedly

Check, in order:

1. Was the trade completed into ExecutionOS History?
2. Did you download **EXECUTIONOS EOD HISTORY** after the trade completed?
3. Was the helper opened on the same `localhost:5173` origin/browser profile as the ExecutionOS UI?
4. Did the terminal reporter say it loaded or auto-detected the intended export?
5. Did you accidentally leave a newer unrelated `executionos-eod-history-*.json` in `~/Downloads`?
6. If uncertain, rerun with explicit `--executionos=<path>`.

Do not manually force ownership in the report.

## 21.5 EOD export appears empty or incomplete

The most common causes are:

- opening the helper on a different origin;
- using a different browser profile;
- clearing browser storage;
- exporting before completed trades reached History.

## 21.6 EOD report has a context warning

A closing-first same-day fill indicates possible carry-in exposure. Do not treat the reconstructed gross P/L as definitive whole-account daily P/L when context is incomplete.

## 21.7 Futures candidate will not bind

Expected. NinjaTrader automatic binding is not connected yet.

---

# 22. Current limitations and deferred work

Not implemented / intentionally deferred:

- Schwab order placement, replacement, cancellation, or flattening;
- broker-write Governor enforcement;
- automatic NinjaTrader futures binding;
- true historical/live NBBO capture for market-order slippage;
- cloud persistence;
- multi-device synchronization;
- full durable execution database;
- AI in the latency-sensitive management path.

V2.3 deferred edge cases:

- exact same-poll cross-symbol execution ownership before future broker-write / automated simultaneous entry;
- true live cross-zero REVERSAL was not broker-validated because thinkorswim rejected the attempted cross-zero action;
- reversal behavior nevertheless passed deterministic state and synthetic end-to-end UI validation.

---

# 23. Repository and branch discipline

- `v2.3.0` is the frozen execution-release reference. Do not move or recreate it.
- current `main` is the authoritative operational/documentation baseline.
- do not casually rebase, overwrite, or rewrite validated `main` history;
- preserve the validated V2.3 execution semantics and historical analytics evidence;
- use isolated branches/worktrees for new changes;
- do not start V3 until explicitly authorized.

Relevant merged PRs:

- **PR #1** — V2.3 execution system -> `main`;
- **PR #2** — analytics preservation;
- **PR #3** — useful pre-V2 documentation preservation;
- **PR #4** — history-only `main` reconciliation;
- **PR #5** — V2.3 release-documentation closeout;
- **PR #6** — post-merge V2.3 documentation finalization;
- **PR #7** — read-only ExecutionOS end-of-day reporting.

---

# 24. Recommended daily operating procedure

## Before market / before the first intended trade

1. Open the repository terminal.
2. Confirm you are on the intended operational branch.
3. Start the Schwab monitor:

   ```bash
   npm run schwab:monitor
   ```

4. Wait for `MONITOR ARMED`.
5. In a second terminal start the UI:

   ```bash
   npm run dev
   ```

6. Open the Vite URL, normally `http://localhost:5173`.
7. Confirm BROKER ONLINE.
8. Confirm account equity / 0.5% risk budget and current positions look reasonable.

## For each potential trade

1. READ outside ExecutionOS.
2. Create the PLAN.
3. Complete RISK sizing from the structural stop.
4. ARM the candidate.
5. Wait for the planned TRIGGER and execute only in thinkorswim.
6. Confirm the candidate binds to the broker ENTRY.
7. Manage the trade as VALID / THREATENED / INVALID.
8. Ask **what changed on the chart?** before interfering.
9. Let actual broker FLAT state complete the episode.
10. Review the execution separately from P/L.

## After the session — required enriched-EOD sequence

1. Review ExecutionOS History for execution decisions, not just P/L.
2. Confirm trades that should be included in the enriched report have completed into **History**.
3. **Keep the Vite server running.**
4. In the same browser profile/origin used for ExecutionOS, open:

   ```text
   http://localhost:5173/eod-export.html
   ```

5. Download **EXECUTIONOS EOD HISTORY**.
6. Confirm the downloaded file is named like:

   ```text
   executionos-eod-history-YYYY-MM-DD.json
   ```

7. Generate the report:

   ```bash
   npm run schwab:eod -- --date=YYYY-MM-DD
   ```

8. Confirm the terminal says the ExecutionOS export was loaded/auto-detected.
9. Confirm ExecutionOS-owned versus broker-only counts are plausible.
10. Review planned risk and R only for genuinely ExecutionOS-owned trades.
11. Review the generated HTML at:

   ```text
   reports/eod/YYYY-MM-DD.html
   ```

12. If a context/carry-in warning appears, do not describe reconstructed gross P/L as definitive whole-account daily P/L.
13. Only after the History export is complete, stop the monitor and Vite server if desired.
14. Keep reports/exports local; do not commit private broker or ExecutionOS history data.

---

# 25. Glossary

**Armed candidate**  
A saved, risk-valid pre-entry contract listening for a matching future broker opening fill.

**Broker binding**  
Assignment of a new qualifying broker opening execution to the correct armed candidate.

**Broker-only trade**  
A reconstructed Schwab trade cycle that has no matched ExecutionOS History contract for the report.

**Enriched EOD report**  
EOD report combining Schwab broker fills with matched ExecutionOS History so plan, risk, R, setup, ownership, and process data can be shown.

**Execution state**  
VALID, THREATENED, or INVALID structural classification.

**FLAT**  
Broker position quantity equals zero.

**Gross profit factor**  
Gross profit divided by gross loss.

**Average win/loss factor**  
Average winner divided by the absolute value of average loser.

**Peak quantity**  
Maximum absolute position size reached during an episode.

**Structural stop**  
Stop derived from technical invalidation rather than a preferred dollar loss.

**Trade Contract**  
Frozen pre-entry plan including thesis, trigger, invalidation, structural stop, target, management plan, and risk context.

**Trade episode**  
A broker flat-to-flat lifecycle, subject to documented reversal semantics.

---

# Appendix A — command reference

## A.1 Project

```bash
npm install
npm run dev
npm run build
npm run preview
```

## A.2 Schwab authorization / account

```bash
npm run schwab:auth
npm run schwab:status
npm run schwab:account
npm run schwab:logout
```

## A.3 Live monitor

```bash
npm run schwab:monitor
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/api/state
```

## A.4 End-of-day reporting

Export enriched ExecutionOS History while Vite is still running:

```text
http://localhost:5173/eod-export.html
```

Generate default/current-date report:

```bash
npm run schwab:eod
```

Specific date:

```bash
npm run schwab:eod -- --date=2026-08-27
```

Explicit ExecutionOS export:

```bash
npm run schwab:eod -- --date=2026-08-27 --executionos=~/Downloads/executionos-eod-history-2026-08-27.json
```

Single symbol:

```bash
npm run schwab:eod -- --date=2026-08-27 --symbol=NVDA
```

Custom output path:

```bash
npm run schwab:eod -- --date=2026-08-27 --out=~/Desktop/eod-2026-08-27.html
```

Default HTML location:

```text
reports/eod/YYYY-MM-DD.html
```

## A.5 Historical Schwab / replay / slippage

```bash
npm run schwab:history
npm run schwab:history -- --days=7
npm run schwab:replay -- --days=7 --symbol=MRVL
npm run schwab:slippage
npm run schwab:slippage -- --days=7 --fragmented-only
```

## A.6 Bridge / regression tests

```bash
npm run schwab:state-test
npm run schwab:token-test
npm run schwab:price-history-test
npm run analytics:test
```

## A.7 Analytics reports

```bash
npm run analytics:report
npm run analytics:duration
npm run analytics:stops
npm run analytics:r
npm run analytics:mfe
npm run analytics:capture
npm run analytics:counterfactuals
```

## A.8 Historical reconstruction / forensics

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

These forensic commands preserve/reproduce historical methodology; they must not be used to curve-fit arbitrary combinations to a target result.

---

# Appendix B — environment variables

| Variable | Purpose | Typical/default |
| --- | --- | --- |
| `SCHWAB_CLIENT_ID` | Schwab Developer Portal client ID | Required |
| `SCHWAB_CLIENT_SECRET` | Schwab secret | Required; local only |
| `SCHWAB_CALLBACK_URL` | OAuth callback | `https://127.0.0.1:8182` |
| `SCHWAB_POLL_MS` | Live poll interval | `1000` |
| `EXECUTIONOS_API_PORT` | Local read-only broker API | `8787` |
| `VITE_EXECUTIONOS_BROKER_URL` | React broker-state URL | `http://127.0.0.1:8787` |

Never prefix the Schwab Client Secret with `VITE_`.

---

# Appendix C — local files and retention

Important local/Git-ignored data includes:

```text
.env
.env.local
.schwab-tokens.json
reports/eod/
research/30-day-management-study/raw-schwab-history.json
research/30-day-management-study/normalized-trades.json
research/30-day-management-study/historical-study-trades.json
research/30-day-management-study/schwab-minute-cache.json
```

Browser application state:

```text
execution-v23-store
```

Downloaded EOD enrichment exports are named like:

```text
executionos-eod-history-YYYY-MM-DD.json
```

Generated EOD reports are stored by default under:

```text
reports/eod/
```

Treat broker-derived data, EOD History exports, and generated reports as local/private artifacts unless deliberately archived elsewhere. Do not force-add them to Git.

---

# Appendix D — current development sequence

1. **Analytics preservation — complete; PR #2 merged.**
2. **Pre-V2 documentation preservation — complete; PR #3 merged.**
3. **`main` history reconciliation — complete; PR #4 merged with no V2.3 tree changes.**
4. **V2.3 final acceptance and functional release gate — complete.**
5. **V2.3 release-documentation closeout — complete; PR #5 merged.**
6. **V2.3 merge into `main` — complete; PR #1 merged.**
7. **Post-merge V2.3 documentation finalization — complete; PR #6 merged.**
8. **Annotated release tag `v2.3.0` — created, pushed, and verified.**
9. **Read-only EOD reporting — complete and validated; PR #7 merged.**
10. **Current EOD/documentation closeout — in progress.**
11. Begin V3 Management Governor only after separate explicit authorization.
12. Add the broker-agnostic event/adapter boundary, then a read-only NinjaTrader observer.
13. Implement Governor Observe/Govern mode before any broker-write enforcement.

The sequence remains intentionally conservative. Correctness, auditability, and separation of broker truth from locally reconstructed/enriched data take priority over feature velocity.

---

## Living-document maintenance rule

Update this guide whenever any of the following changes:

- normal startup or end-of-session workflow;
- EOD export/report procedure;
- authentication flow;
- broker-data source;
- plan/risk fields;
- candidate ownership rules;
- lifecycle semantics;
- persistence behavior;
- supported instruments;
- safety boundaries;
- command-line scripts;
- current branch/release workflow.

For historical research-method changes, also update `research/30-day-management-study/methodology.md`. For new architecture decisions, create or update the appropriate current Project Specification without rewriting dated historical specifications merely to make them agree with newer project state.
