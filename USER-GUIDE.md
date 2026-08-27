# ExecutionOS User Guide

**Version:** 1.0  
**Date:** 27 August 2026  
**Status:** Living operator guide for the current V2.3 baseline  
**Repository:** `sibolek/structure-based-trade-management`  
**Current development baseline:** `v2-execution-system`  
**Current documentation baseline:** `v2-execution-system`

> **Operating principle:** Structure decides. P/L emotion does not.
>
> ExecutionOS exists to preserve pre-entry intent under live market pressure. It does not choose trades for you and it does not currently place, replace, or cancel broker orders.

---

## Table of contents

1. [Purpose of this guide](#1-purpose-of-this-guide)
2. [What ExecutionOS is](#2-what-executionos-is)
3. [What ExecutionOS is not](#3-what-executionos-is-not)
4. [Current project status](#4-current-project-status)
5. [The ExecutionOS workflow](#5-the-executionos-workflow)
6. [System architecture](#6-system-architecture)
7. [Prerequisites](#7-prerequisites)
8. [Initial installation](#8-initial-installation)
9. [Schwab configuration and authorization](#9-schwab-configuration-and-authorization)
10. [Starting ExecutionOS for a trading session](#10-starting-executionos-for-a-trading-session)
11. [Understanding the broker status panel](#11-understanding-the-broker-status-panel)
12. [Creating a trade candidate](#12-creating-a-trade-candidate)
13. [Risk sizing and permission](#13-risk-sizing-and-permission)
14. [Arming a candidate](#14-arming-a-candidate)
15. [Managing the Armed Candidate Board](#15-managing-the-armed-candidate-board)
16. [How broker-fill binding works](#16-how-broker-fill-binding-works)
17. [The Live Execution Board](#17-the-live-execution-board)
18. [Execution state: VALID, THREATENED, INVALID](#18-execution-state-valid-threatened-invalid)
19. [Broker lifecycle events: ENTRY, ADD, PARTIAL, FLAT, REVERSAL](#19-broker-lifecycle-events-entry-add-partial-flat-reversal)
20. [Management discipline while a trade is live](#20-management-discipline-while-a-trade-is-live)
21. [Editing an armed candidate safely](#21-editing-an-armed-candidate-safely)
22. [Ending a trade and using History](#22-ending-a-trade-and-using-history)
23. [Persistence and local state](#23-persistence-and-local-state)
24. [Using ExecutionOS without the Schwab link](#24-using-executionos-without-the-schwab-link)
25. [Futures and NinjaTrader status](#25-futures-and-ninjatrader-status)
26. [Historical analytics and research tools](#26-historical-analytics-and-research-tools)
27. [Security and data handling](#27-security-and-data-handling)
28. [Troubleshooting](#28-troubleshooting)
29. [Current limitations and deferred work](#29-current-limitations-and-deferred-work)
30. [Repository and branch discipline](#30-repository-and-branch-discipline)
31. [Recommended daily operating procedure](#31-recommended-daily-operating-procedure)
32. [Glossary](#32-glossary)
33. [Appendix A - Complete command-line reference](#appendix-a---complete-command-line-reference)
34. [Appendix B - Environment variables](#appendix-b---environment-variables)
35. [Appendix C - Local files and data retention](#appendix-c---local-files-and-data-retention)
36. [Appendix D - Current development sequence](#appendix-d---current-development-sequence)

---

# 1. Purpose of this guide

This is the practical, living user guide for operating ExecutionOS as it exists now. The Project Specification explains architecture and design decisions; the historical methodology documents the empirical research; this guide answers a different question:

> **How do I actually use ExecutionOS correctly today?**

The guide is intended to remain current as ExecutionOS evolves. When a new version changes the normal operating workflow, broker integration, risk behavior, user interface, or command-line interface, this document should be updated as part of the same change.

The authoritative hierarchy is:

1. **This User Guide** - day-to-day operation and troubleshooting.
2. **ExecutionOS Management Governor Project Specification** - architecture, design decisions, release gates, and future direction.
3. **`research/30-day-management-study/methodology.md`** - historical analytics provenance and reproduction rules.
4. **README.md** - concise repository overview and common commands.
5. Older milestone and planning documents - historical snapshots only.

---

# 2. What ExecutionOS is

ExecutionOS is a **local, broker-aware execution operating system** designed to preserve a trader's pre-entry plan after capital is at risk.

It separates three activities that are often mixed together during discretionary trading:

- **Reading the market** - your price-action analysis and setup selection.
- **Defining permission** - what conditions authorize entry, what invalidates the trade, where the structural stop belongs, and how much risk is permitted.
- **Managing execution** - holding, updating, or exiting based on structure rather than the emotional effect of open P/L.

The system's core workflow is:

**READ -> PLAN -> RISK -> ARM -> TRIGGER -> HOLD -> UPDATE -> EXIT -> REVIEW**

ExecutionOS currently integrates with Schwab in a **read-only** mode. You continue to place equity orders in thinkorswim/Schwab. ExecutionOS observes broker executions, reconstructs position state, and binds a matching opening fill to an armed candidate.

The intended behavioral result is simple:

> **Entry freezes the original plan. New structure can modify it. Emotion cannot.**

---

# 3. What ExecutionOS is not

ExecutionOS is deliberately narrow.

It is **not** currently:

- a stock scanner;
- a market-news terminal;
- a signal generator;
- a fully automated trading system;
- a broker replacement;
- an order-entry panel;
- an AI that decides whether a setup is good;
- a universal minimum-hold timer;
- a universal breakeven-stop engine;
- a profit-and-loss optimization engine;
- a live NinjaTrader futures integration.

ExecutionOS also does not currently send orders to Schwab. The local broker service is read-only. A UI button inside ExecutionOS cannot place, replace, cancel, or flatten a Schwab order.

This matters operationally: **thinkorswim remains the execution venue for equities.** ExecutionOS is the decision and state layer beside it.

---

# 4. Current project status

## 4.1 Current baseline

The active product and documentation baseline is **V2.3** on branch `v2-execution-system`. The analytics-preservation work was merged into this branch through PR #2 and is now part of the V2.3 baseline.

V2.3 supports:

- multiple independently armed trade candidates;
- one armed candidate per symbol;
- automatic binding of matching Schwab opening fills;
- simultaneous live trades;
- broker-derived position average price and quantity;
- peak-quantity tracking;
- ENTRY / ADD / PARTIAL / FLAT / REVERSAL lifecycle reconstruction;
- plan editing while the last saved candidate remains armed;
- deterministic fill-during-edit behavior;
- History and execution-decision records;
- browser-local persistence;
- a read-only Schwab broker-status panel.

## 4.2 Release-validation status

V2.3 completed its release-validation gate on 27 August 2026.

Validated release gates include:

- analytics regression: 14/14 passing;
- deterministic broker trade-state regression: 10/10 passing;
- production Vite build;
- clean tracked working tree after install/build;
- exact validation against the remote `v2-execution-system` head;
- read-only `/health` and `/api/state` runtime smoke tests;
- live ADD, PARTIAL, FLAT, and SHORT-path acceptance;
- synthetic end-to-end REVERSAL acceptance in the React lifecycle.

A true live cross-zero REVERSAL could not be forced through thinkorswim because the broker rejected the attempted cross-zero order. The exact same-poll cross-symbol execution case also remains deferred as a non-blocking edge case before any future broker-write or automated simultaneous-entry capability.

V2.3 is therefore release-validated, but PR #1 remains unmerged and no V2.3 release tag should be created without explicit approval.

## 4.3 Analytics preservation status

The empirical research that motivated the future Management Governor has been preserved. Three study areas were recovered to strong historical confidence; three 19-trade market-study outputs remain benchmark-preserved with unresolved exact membership.

Do not attempt to reverse-engineer arbitrary trade combinations merely to force a historical benchmark match.

---

# 5. The ExecutionOS workflow

The workflow is not just navigation. Each stage has a specific job.

| Stage | Purpose |
| --- | --- |
| READ | Analyze market structure outside the app. |
| PLAN | State the trade thesis, entry trigger, invalidation, structural stop, target, and management plan. |
| RISK | Verify that the structural stop is affordable at the intended size. |
| ARM | Make the saved plan eligible to listen for a matching broker fill. |
| TRIGGER | Wait for the planned entry condition to occur, then execute in the broker. |
| HOLD | Do nothing when structure has not changed. |
| UPDATE | Record legitimate new structure and change trade state when appropriate. |
| EXIT | End the trade for a structural, planned, or explicitly discretionary reason. |
| REVIEW | Evaluate execution quality independently from P/L. |

The workflow deliberately separates **analysis** from **permission**. A correct read is not automatically a setup; a valid setup is not automatically a trade.

---

# 6. System architecture

At the current stage, the normal equity path is:

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

The local monitor exposes two read-only endpoints:

- `GET /health`
- `GET /api/state`

The React UI polls `/api/state` once per second by default.

The local API retains broker account summaries, current open positions, and the most recent execution events needed by the interface. Live P/L is intentionally not shown in the broker-status panel.

---

# 7. Prerequisites

Before using ExecutionOS, you need:

- the project repository on the local machine;
- Node.js/npm capable of running the current Vite project;
- a Schwab Developer Portal application configured for the Trader API;
- the registered callback URL `https://127.0.0.1:8182`;
- thinkorswim/Schwab for actual equity order entry;
- a browser for the React UI;
- terminal access for the local monitor and development server.

For futures, NinjaTrader is the execution platform, but automatic NinjaTrader binding is **not connected yet**.

---

# 8. Initial installation

From a terminal:

```bash
git clone https://github.com/sibolek/structure-based-trade-management.git
cd structure-based-trade-management
npm install
```

During the current preservation/closeout phase, make sure you are on the intended working branch before pulling changes. The exact branch will change after the preservation and V2.3 release work are merged, so check the current project checkpoint rather than assuming an old branch name indefinitely.

To inspect the current branch:

```bash
git branch --show-current
```

To update the branch you are already on:

```bash
git pull
```

Do not casually rebase or overwrite `main`. The useful pre-V2 documentation has been preserved and `main` history has been reconciled into the V2.3 line without changing the validated V2.3 file tree.

---

# 9. Schwab configuration and authorization

## 9.1 Create the local environment file

Copy the template:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and provide:

```text
SCHWAB_CLIENT_ID=...
SCHWAB_CLIENT_SECRET=...
SCHWAB_CALLBACK_URL=https://127.0.0.1:8182
```

Never commit `.env.local`.

Verify sensitive files are ignored:

```bash
git check-ignore .env.local .schwab-tokens.json
```

## 9.2 First authorization

Run:

```bash
npm run schwab:auth
```

The bridge opens Schwab's OAuth page. Complete authentication on Schwab's site and authorize the desired account(s).

Schwab redirects to the registered local HTTPS callback. The page may not load because the current proof-of-concept does not run a local HTTPS callback listener. If so:

1. copy the complete redirected URL from the browser address bar;
2. return to the terminal;
3. paste that URL when prompted.

ExecutionOS extracts the authorization code and stores the resulting tokens locally in `.schwab-tokens.json`.

## 9.3 Confirm account access

Run:

```bash
npm run schwab:account
```

A healthy result should show:

- successful authentication;
- authorized account count;
- masked account identifier;
- current account equity;
- the 0.5% maximum planned risk budget;
- buying power;
- current positions.

The tool deliberately avoids displaying open P/L as a management cue.

## 9.4 Token lifecycle

Access tokens are short-lived and are automatically refreshed when close to expiration. Refresh tokens have a longer but finite lifecycle. If authorization can no longer be refreshed, run:

```bash
npm run schwab:auth
```

again.

---

# 10. Starting ExecutionOS for a trading session

The normal live-equity session uses **two terminals**.

## Terminal 1 - Schwab monitor

From the repository root:

```bash
npm run schwab:monitor
```

The monitor:

1. authenticates;
2. loads authorized accounts;
3. bootstraps current positions;
4. reads recent executions as a baseline;
5. starts the read-only local API;
6. begins polling for new fills;
7. prints `MONITOR ARMED` when ready.

Existing fills are intentionally ignored as new events after startup. This prevents old orders from suddenly binding to freshly armed candidates.

The default poll interval is 1000 ms.

Stop the monitor with:

```text
Ctrl+C
```

## Terminal 2 - React UI

Run:

```bash
npm run dev
```

Open the local Vite URL shown in the terminal, typically something like:

```text
http://localhost:5173
```

The browser should show the broker-status panel at the top and the V2.3 ExecutionOS interface below it.

## 10.1 Optional health checks

If you want to verify the local broker service independently of React:

```bash
curl http://127.0.0.1:8787/health
```

and:

```bash
curl http://127.0.0.1:8787/api/state
```

The health endpoint should return an `ok` response and monitor status. `/api/state` returns the current read-only broker snapshot.

---

# 11. Understanding the broker status panel

The top panel shows **Schwab Live State**.

## BROKER ONLINE

When connected, the panel can show:

- monitor status;
- monitor polling interval;
- last update time;
- masked account identifier;
- current equity;
- the computed 0.5% max-risk budget;
- count of open positions;
- current broker positions;
- recent execution events;
- reconstructed lifecycle event and position transition;
- observed fill-detection delay.

Live P/L is intentionally hidden.

## BROKER OFFLINE

If the panel says BROKER OFFLINE, the React application is still usable for planning and review, but automatic Schwab fill binding is unavailable.

The most common reason is simply that this process is not running:

```bash
npm run schwab:monitor
```

If the monitor is running but the UI remains offline, see the troubleshooting section.

---

# 12. Creating a trade candidate

A candidate is a **pre-entry contract**, not a position.

The current PLAN editor requires all of the following before the candidate can move to risk sizing:

| Field | Meaning |
| --- | --- |
| Symbol | Instrument ticker. |
| Direction | LONG or SHORT. |
| Setup | The named setup or structure being traded. |
| Timeframe | Primary execution timeframe, usually 2m for the current workflow. |
| Thesis | What exactly you believe price is doing. |
| Trigger | What authorizes actual entry in the broker. |
| Invalidation | What proves the thesis wrong. |
| Structural Stop | Price beyond which the setup is invalid. |
| Target | Planned objective or target framework. |
| Management Plan | How the trade is intended to be managed after entry. |

## 12.1 Thesis

The thesis should describe the actual trade, not a narrative designed to justify action.

A good thesis is structurally testable. For example:

```text
Bull-channel pullback is holding the 20 EMA and prior breakout area; continuation is valid only while the pullback structure remains intact.
```

A poor thesis is vague:

```text
NVDA looks strong and I think it can go higher.
```

## 12.2 Trigger

The trigger is the event that authorizes entry in thinkorswim. Examples may include:

- breakout and hold above a defined level;
- H2 or second-entry long after a pullback;
- failed breakdown and reclaim;
- breakout/retest confirmation;
- signal-bar break from a defined structure.

The trigger should be concrete enough that you can answer **yes or no** in real time.

## 12.3 Invalidation

Invalidation is the structural condition that proves the thesis wrong. It is not the same thing as:

- being temporarily red;
- discomfort;
- a normal pullback;
- a single unfavorable tick;
- the desire to protect open profit.

## 12.4 Structural Stop

The structural stop belongs beyond the price structure that invalidates the setup. The correct sequence is:

**structure -> stop -> risk -> size**

Never reverse this sequence by choosing size first and tightening the stop until the dollar risk fits.

## 12.5 Target and management plan

The target may be a single price, a target zone, or a defined structural management objective. The management plan should state what you are allowed to do after entry, including any preplanned scaling or exit logic.

---

# 13. Risk sizing and permission

After the plan is frozen, ExecutionOS moves to the RISK stage.

The risk editor uses:

- expected entry;
- structural stop;
- intended size;
- account equity from the Schwab broker state when available.

The project risk rule is:

> **Maximum planned loss per trade = 0.5% of the relevant account equity.**

For equities:

```text
risk per share = abs(expected entry - structural stop)
planned risk   = risk per share * intended shares
max risk       = account equity * 0.005
max size       = floor(max risk / risk per share)
```

If planned risk exceeds max risk:

- reduce size; or
- pass the trade.

Do **not** tighten the structural stop merely to make the number fit.

## 13.1 Duplicate-candidate protection

V2.3 permits only one armed candidate per symbol. A second candidate for the same symbol should not be armed concurrently.

## 13.2 Existing-position protection

A fresh candidate should not bind to a Schwab position that was already open before the candidate was armed. The system uses both the current broker position state and new post-arm execution events to reduce false ownership.

---

# 14. Arming a candidate

**ARM** means:

> This saved plan is complete, risk-valid, and now eligible to listen for a matching future broker opening fill.

It does **not** mean an order has been sent.

After arming:

- the candidate appears on the Armed Candidate Board;
- its saved contract becomes authoritative;
- `armedAt` becomes part of fill ownership;
- you may begin a new candidate without removing existing armed ideas;
- a matching Schwab fill can promote the candidate automatically to LIVE.

A newly armed candidate should be considered a commitment to the saved plan, not a casual watchlist note.

---

# 15. Managing the Armed Candidate Board

The board may contain several symbols simultaneously.

Each armed candidate continues listening independently until one of the following occurs:

- a matching broker opening fill binds it;
- you explicitly delete/discard it;
- you edit and save a superseding version.

## 15.1 One per symbol

There should be no two independently armed candidates for the same ticker. If your setup materially changes, edit the existing candidate rather than creating a duplicate.

## 15.2 Multiple armed symbols

It is normal for several unrelated symbols to remain armed while you wait for triggers. This is one of the important V2.3 differences from earlier single-trade workflow versions.

## 15.3 Armed does not mean entered

Do not confuse:

- **candidate state**: ARMED;
- **broker state**: actual open position;
- **execution state**: VALID / THREATENED / INVALID.

They describe different things.

---

# 16. How broker-fill binding works

For Schwab equities, V2.3 listens to new execution events from the local broker monitor.

A candidate can bind when the new execution is consistent with:

- the same symbol;
- the candidate's direction;
- an opening position effect;
- an execution that occurs after the candidate was armed.

For direction matching:

- LONG expects an opening BUY;
- SHORT expects an opening SELL_SHORT.

When the match occurs, the candidate leaves ARMED and becomes a live trade.

## 16.1 Why `armedAt` matters

The system must not accidentally bind an old fill or pre-existing position to a new plan. The arm timestamp is therefore part of the ownership logic.

## 16.2 Why broker position state also matters

A candidate is not supposed to claim a position that already existed before it was created. The broker snapshot is used to identify currently open positions and guard against false fresh-entry ownership.

## 16.3 Fill detection is not instantaneous

Observed delay includes more than internet latency. It may include:

- thinkorswim/Schwab propagation time;
- API availability;
- the monitor polling phase;
- HTTP request/response time;
- local-vs-broker clock differences.

Historical live testing showed the read-only polling path to be usable for awareness, but ExecutionOS should still be treated as an observer rather than a hard real-time order router.

---

# 17. The Live Execution Board

Once a candidate binds to a broker fill, the Live Execution Board becomes the center of the workflow.

A live trade retains the original saved contract while also showing broker-derived reality such as:

- actual entry price;
- entry quantity;
- current quantity;
- peak quantity;
- current average price;
- structural stop;
- planned risk context;
- execution timeline;
- current VALID / THREATENED / INVALID state.

The key concept is that **the original plan remains visible after entry**. The system is designed to prevent the live P/L experience from silently rewriting what the trade was supposed to be.

## 17.1 More than two live instruments

V2.3 can represent multiple simultaneous live trades, but the operating framework warns when concurrency exceeds the intended limit. The practical rule remains:

> Keep the number of live instruments small enough that each trade can still be managed structurally.

---

# 18. Execution state: VALID, THREATENED, INVALID

These labels describe structural state, not profitability.

## VALID

Use VALID when the original thesis remains intact.

A VALID trade may be:

- green;
- red;
- chopping;
- temporarily pulling back;
- uncomfortable.

If the structure that justified entry remains intact, the trade can remain VALID.

## THREATENED

Use THREATENED when new adverse structure has appeared but the original setup has not yet crossed its invalidation boundary.

Examples may include:

- a meaningful failure to continue;
- repeated inability to hold a breakout level;
- a structurally important lower high or higher low against the trade;
- a new opposing pattern that materially weakens the thesis.

THREATENED is not a euphemism for "I am nervous." It requires chart evidence.

## INVALID

Use INVALID when the trade thesis has actually failed according to the frozen contract or legitimate later structural update.

Examples:

- structural stop / invalidation is broken;
- the defining breakout fails in a way that destroys the setup;
- the pattern resolves opposite to the thesis;
- a predeclared invalidation condition occurs.

**Red is not invalidation. Green is not an exit. Structure is invalidation.**

---

# 19. Broker lifecycle events: ENTRY, ADD, PARTIAL, FLAT, REVERSAL

The broker state engine translates fills into position lifecycle events.

## ENTRY

A position moves from flat to non-zero exposure in one direction.

```text
FLAT -> LONG
```

or:

```text
FLAT -> SHORT
```

ENTRY is the event that can bind an armed candidate.

## ADD

Exposure increases while direction remains the same.

```text
LONG 20 -> LONG 40
```

or:

```text
SHORT 20 -> SHORT 40
```

The state engine updates the blended average price and peak quantity. End-to-end ADD behavior has been accepted for V2.3.

## PARTIAL

Exposure decreases but remains open in the same direction.

```text
LONG 40 -> LONG 20
```

A partial exit should **not** mark the trade flat or archive it as completed. End-to-end PARTIAL behavior has been accepted for V2.3.

## FLAT

The position reaches zero.

```text
LONG 20 -> FLAT
```

or:

```text
SHORT 20 -> FLAT
```

FLAT is a terminal broker-state event for that position episode.

## REVERSAL

An execution crosses through zero and leaves exposure open in the opposite direction.

```text
LONG 20 -> SHORT 10
```

or the reverse.

REVERSAL is supported by the state engine, but exact V2.3 episode ownership and UI behavior remain part of final release acceptance.

---

# 20. Management discipline while a trade is live

ExecutionOS is built around a specific behavioral problem: once a position is open, the urge to resolve uncertainty can become stronger than the original plan.

The system therefore uses the following discipline.

## 20.1 Ask what changed on the chart

The primary management question is:

> **What changed on the chart?**

Do not substitute:

- "I am up $20";
- "I do not want this winner to turn red";
- "I am down $15";
- "I want to get back to green today";
- "This trade feels slow."

for a structural answer.

## 20.2 Manual exit check

Before a discretionary manual exit, ask:

> **If I could not see my P/L, would I still exit this chart right now?**

and:

> **Would I make this exact same exit if yesterday had been +$50 instead of -$50?**

If the answer exposes P/L-driven decision contamination, the execution decision is not structurally justified.

## 20.3 Early management

For fast 2-minute trades, the immediate post-entry window is particularly vulnerable to emotional interference. Unless the original contract authorizes it, avoid moving the stop toward breakeven/profit or manually exiting solely because of P/L during the remainder of the entry bar and the next completed 2-minute bar.

Early changes require one of:

- structural invalidation;
- a predefined target;
- genuinely new adverse structure;
- an explicitly preauthorized management rule.

## 20.4 Scaling

If an add was planned, the risk allocation should have been defined before entry. Before adding, explicitly know:

- current quantity;
- add quantity;
- new total quantity;
- structural stop;
- total risk after the add.

Do not improvise size changes merely because the trade is winning or losing.

---

# 21. Editing an armed candidate safely

V2.3 deliberately solves a subtle race condition: **what happens if you edit a plan while the old saved candidate is still capable of filling?**

The rule is:

> **The last saved candidate remains authoritative and keeps listening until the edit is saved.**

When you choose Edit:

- ExecutionOS creates a working copy;
- the original saved candidate remains armed;
- unsaved changes are not authoritative;
- CANCEL discards the working copy;
- SAVE creates the new saved candidate version after risk validation.

## 21.1 Fill during edit

If the broker fill arrives while you are editing:

- the **last saved plan** owns the fill;
- that saved plan moves LIVE;
- the unsaved working-copy changes are discarded.

This is intentional. A plan that was never saved must never retroactively become the trade contract after an execution has already occurred.

---

# 22. Ending a trade and using History

When broker state becomes FLAT, the live position episode can move to History.

History exists to answer:

> **What did I decide at each opportunity to interfere?**

The review should separate two scores:

- **trade outcome** - money made or lost;
- **execution quality** - whether the plan was followed and changes were structurally justified.

A correctly executed losing trade can be a successful execution day. A profitable panic exit can still be a poor execution decision.

Review the timeline for:

- original frozen plan;
- arm event;
- broker entry detection;
- state changes;
- adds or partials;
- stop/management changes where recorded;
- exit reason;
- any discretionary override behavior.

---

# 23. Persistence and local state

V2.3 stores its application state in browser `localStorage` under:

```text
execution-v23-store
```

A normal browser refresh should therefore preserve:

- draft plan state;
- armed candidates;
- live trades;
- history.

## 23.1 Important limitation

Browser local storage is not cloud storage and is not a durable database backup.

Clearing browser site data, using a different browser profile, or manually clearing local storage can remove the saved ExecutionOS UI state.

Broker truth still exists independently at Schwab, but the local ExecutionOS decision record may not.

## 23.2 Do not use browser storage as the only long-term archive

As the project matures, durable local persistence/export should replace reliance on browser local storage for critical records.

---

# 24. Using ExecutionOS without the Schwab link

The React interface remains usable when the broker monitor is offline.

You can still:

- create plans;
- perform risk planning if you provide/retain the necessary inputs;
- manage candidate drafts;
- review local history.

You cannot rely on:

- automatic broker-fill detection;
- current Schwab positions;
- broker-derived account equity;
- automatic ARMED -> LIVE binding;
- live broker lifecycle events.

The interface should clearly show BROKER OFFLINE in this condition.

---

# 25. Futures and NinjaTrader status

The current interface recognizes common futures symbols such as:

- MES
- MNQ
- MCL
- ES
- NQ
- CL

and labels their intended execution source as **NINJATRADER**.

However, the UI currently warns:

> NinjaTrader binding is not connected yet.

Therefore:

- futures plans can be represented conceptually;
- automatic futures broker-fill binding is **not** available;
- Schwab must not be treated as the futures source;
- the future V3 path calls for a separate read-only NinjaTrader observer normalized through a broker-agnostic event model.

Do not assume that a futures candidate will auto-promote to LIVE from NinjaTrader today.

---

# 26. Historical analytics and research tools

The repository contains a preservation-grade analytics layer used to reconstruct the historical evidence that motivated the future Management Governor.

These tools are **not required to operate a normal trading session**. They are for research, validation, regression testing, and project development.

## 26.1 Preserved study areas

The analytics modules cover:

- winner/loser duration;
- stop-management behavior;
- historical R multiples;
- MFE/MAE;
- capture efficiency;
- fixed-duration counterfactuals;
- broker-agnostic flat-to-flat episode reconstruction.

## 26.2 Current evidence status

| Analysis | Status |
| --- | --- |
| Duration | Recovered to preserved precision |
| Historical stop-management timing | Recovered to preserved precision |
| Historical R | High-confidence reconstruction with one documented threshold discrepancy |
| 19-trade MFE | Benchmark/formula preserved; exact historical membership unresolved |
| 19-trade capture efficiency | Benchmark/formula preserved; membership unresolved |
| 19-trade fixed-duration study | Benchmark/formula preserved; membership unresolved |

## 26.3 Anti-curve-fitting rule

Do not search arbitrary trade combinations, symbol exclusions, custom offsets, or bar-timing rules after seeing historical target numbers merely to create a match.

If a future replacement sample is created, define its membership rule **before** observing the market outcomes and label it a **new reproducible study**, not a recovery of the original historical sample.

## 26.4 Local research files

Raw, normalized, enriched, and cached market-data files are deliberately Git-ignored. They may contain broker-derived information and must remain local.

---

# 27. Security and data handling

## 27.1 Secrets

Never commit or paste publicly:

- Schwab Client Secret;
- OAuth access token;
- OAuth refresh token;
- authorization code;
- unmasked account numbers;
- raw broker exports containing sensitive identifiers.

## 27.2 Local secret files

The important local files are:

```text
.env.local
.schwab-tokens.json
```

Both are Git-ignored.

## 27.3 Browser boundary

The Client Secret must never be exposed to React/browser code. The browser communicates only with the local read-only broker-state API.

## 27.4 Read-only broker phase

The current Schwab integration is deliberately read-only. This is a safety feature, not a missing convenience feature.

No broker-write authority should be added until:

1. state reconstruction is stable;
2. Governor policy is tested in observation mode;
3. override and emergency-flatten rules are defined;
4. shadow/live comparison validates that the system would not interfere with legitimate exits.

---

# 28. Troubleshooting

## 28.1 BROKER OFFLINE in the UI

First verify that the monitor is running:

```bash
npm run schwab:monitor
```

Then test:

```bash
curl http://127.0.0.1:8787/health
```

If that fails, the monitor/local API is not listening on the expected port.

If `/health` works but the UI remains offline, verify that the UI is pointing to the same broker URL. The default is:

```text
http://127.0.0.1:8787
```

A custom UI URL may be set through `VITE_EXECUTIONOS_BROKER_URL`.

## 28.2 Schwab authentication fails

Check:

- `.env.local` exists;
- Client ID is correct;
- Client Secret is correct;
- callback is exactly `https://127.0.0.1:8182`;
- token file exists if reusing authorization.

If the refresh token has expired or is invalid:

```bash
npm run schwab:auth
```

## 28.3 Port 8787 is already in use

Set a different local API port in `.env.local`:

```text
EXECUTIONOS_API_PORT=8788
```

Then point React at the same port:

```text
VITE_EXECUTIONOS_BROKER_URL=http://127.0.0.1:8788
```

Restart both monitor and Vite after changing environment variables.

## 28.4 Fill happened but candidate did not bind

Check all of the following:

- Was the candidate already ARMED before the fill?
- Does symbol match exactly?
- Does LONG correspond to opening BUY?
- Does SHORT correspond to opening SELL_SHORT?
- Was the broker execution classified as OPENING?
- Was there already an existing position in that symbol?
- Was the monitor running before the fill?
- Is the UI connected to the local broker API?

If the monitor started after the fill, that execution may have been intentionally absorbed into the startup baseline rather than emitted as a new post-arm event.

## 28.5 Cannot arm a second candidate for the same symbol

This is expected behavior. Edit the existing candidate or remove it first. V2.3 permits one armed candidate per symbol.

## 28.6 Futures symbol will not bind

Expected. NinjaTrader automatic binding is not connected yet.

## 28.7 UI state looks stale after code changes

First try a normal browser reload. V2.3 includes local-store migration logic for recent state changes.

If a development migration is genuinely incompatible, export or record any important local state before clearing browser site data. Clearing local storage can delete local ExecutionOS history.

## 28.8 History or candidate vanished after browser cleanup

Browser local storage is local state. Clearing site data can remove it. The broker account remains independent, but the local decision record may be lost.

## 28.9 Historical study command cannot find source files

Many research datasets are intentionally local and Git-ignored. Reconstruct or regenerate them using the documented research pipeline rather than inventing rows.

---

# 29. Current limitations and deferred work

The following are important **current-state facts**, not defects to work around with assumptions.

## Not implemented / intentionally deferred

- Schwab order placement, replacement, or cancellation;
- broker-write Governor enforcement;
- automatic NinjaTrader futures binding;
- true historical/live NBBO capture for market-order slippage;
- cloud persistence;
- multi-device synchronization;
- full durable execution database;
- AI in the split-second management path.

## V2.3 deferred edge cases

The V2.3 release-validation gate is complete. The following are documented deferred items rather than V2.3 release blockers:

- exact same-poll cross-symbol execution ownership remains deferred before any broker-write or automated simultaneous-entry capability;
- true live cross-zero REVERSAL could not be broker-validated because thinkorswim rejected the attempted cross-zero order;
- REVERSAL lifecycle behavior has nevertheless passed deterministic state tests and synthetic end-to-end React acceptance.

Do not expand these deferred cases into unrelated V3 architecture work during V2.3 release closeout.

---

# 30. Repository and branch discipline

ExecutionOS is currently in V2.3 release closeout.

The key rules are:

- do not merge PR #1 without explicit approval;
- do not casually rebase or overwrite `main`;
- preserve the validated V2.3 broker-aware architecture and release-tested file tree;
- keep historical analytics and preserved pre-V2 execution-discipline material intact;
- update PR #1 to describe actual V2.3 behavior before final merge consideration;
- create the V3 branch only after V2.3 is cleanly merged and tagged.

Pull-request status:

- **PR #1** - V2 execution system, `v2-execution-system` -> `main`; still open and unmerged;
- **PR #2** - analytics preservation -> `v2-execution-system`; merged;
- **PR #3** - pre-V2 execution-discipline documentation reconciliation; merged;
- **PR #4** - history-only `main` reconciliation with no V2.3 tree changes; merged.

The user guide should be updated again when PR #1 is merged and the normal working branch changes.

---

# 31. Recommended daily operating procedure

This is the concise operating sequence for a normal Schwab equity session.

## Before market / before first intended trade

1. Open the repository terminal.
2. Confirm you are on the intended project branch.
3. Start the Schwab monitor:

   ```bash
   npm run schwab:monitor
   ```

4. Wait for `MONITOR ARMED`.
5. In a second terminal, start the UI:

   ```bash
   npm run dev
   ```

6. Open the Vite URL in the browser.
7. Confirm **BROKER ONLINE**.
8. Confirm account equity and 0.5% max-risk budget look reasonable.
9. Confirm current broker positions match reality.

## For each potential trade

1. Perform the READ outside ExecutionOS.
2. Create the PLAN, including entry trigger, invalidation, structural stop, target, and management.
3. Complete RISK sizing.
4. ARM the candidate.
5. Wait for the planned TRIGGER to occur and enter only in thinkorswim.
6. Confirm the candidate binds to the new broker ENTRY.
7. Manage the trade as VALID / THREATENED / INVALID.
8. Ask **what changed on the chart?** before interfering.
9. Let broker FLAT state close the episode and review the execution.

## After the session

1. Review History for execution decisions, not just P/L.
2. Stop the monitor with `Ctrl+C`.
3. Stop the Vite server with `Ctrl+C` if desired.
4. Preserve any research/export artifacts that are intentionally local.
5. Do not commit secrets or raw private broker data.

---

# 32. Glossary

**Armed candidate**  
A saved, risk-valid pre-entry contract that is listening for a matching future broker opening fill.

**Broker binding**  
The process by which a new broker opening execution is assigned to the correct armed candidate.

**Entry VWAP / average price**  
The blended average price of fills that opened/increased the position.

**Execution state**  
The structural classification VALID, THREATENED, or INVALID.

**FLAT**  
Broker position quantity equals zero.

**Governor**  
The planned V3 deterministic policy layer that will evaluate whether a management action is authorized, warning-worthy, override-required, or blocked.

**Historical benchmark**  
A preserved numerical result from prior research that may not have fully recoverable source membership.

**Management eligibility**  
A future V3 concept describing whether a specific management action is currently authorized, independent of whether the trade itself is VALID or THREATENED.

**Peak quantity**  
Maximum absolute position size reached during an episode.

**Structural stop**  
The price boundary derived from technical invalidation, not from a desired dollar loss.

**Trade contract**  
The frozen pre-entry plan: thesis, trigger, invalidation, structural stop, target, management rules, and risk context.

**Trade episode**  
A flat-to-flat broker lifecycle for one symbol/account/direction sequence, subject to reversal semantics.

---

# Appendix A - Complete command-line reference

This appendix lists the current repository command surface and the common direct shell commands required to operate or validate ExecutionOS.

## A.1 Project setup and branch inspection

### Clone the repository

```bash
git clone https://github.com/sibolek/structure-based-trade-management.git
```

### Enter the repository

```bash
cd structure-based-trade-management
```

### Install dependencies

```bash
npm install
```

### Show current branch

```bash
git branch --show-current
```

### Pull the current branch

```bash
git pull
```

### Check repository status

```bash
git status
```

### Inspect branches

```bash
git branch -a
```

Do not merge/rebase sensitive project branches unless that action is explicitly part of the current release plan.

---

## A.2 Environment setup

### Create `.env.local`

```bash
cp .env.local.example .env.local
```

### Confirm secret files are Git-ignored

```bash
git check-ignore .env.local .schwab-tokens.json
```

---

## A.3 React / Vite application commands

### Development server

```bash
npm run dev
```

Starts the Vite development server.

### Production build

```bash
npm run build
```

Builds the current React application for production. Use this as part of the V2.3 release gate.

### Preview production build

```bash
npm run preview
```

Serves the built output locally for preview.

---

## A.4 Schwab authentication and account commands

### Authorize / reauthorize Schwab

```bash
npm run schwab:auth
```

Runs the OAuth authorization-code flow and writes local tokens.

### Read account status

```bash
npm run schwab:account
```

Shows authorized account summary, equity, 0.5% risk budget, buying power, and open positions.

### Broker connection status

```bash
npm run schwab:status
```

Checks local Schwab authentication/token state.

### Remove local tokens

```bash
npm run schwab:logout
```

Deletes the local token file. It does **not** revoke Schwab authorization remotely.

---

## A.5 Live Schwab monitor

### Start the monitor and local API

```bash
npm run schwab:monitor
```

Starts read-only order polling, state reconstruction, latency observation, and the local broker-state API.

### Stop the monitor

```text
Ctrl+C
```

### Health endpoint

```bash
curl http://127.0.0.1:8787/health
```

### Broker-state endpoint

```bash
curl http://127.0.0.1:8787/api/state
```

---

## A.6 Historical Schwab order verification

### Default history command

```bash
npm run schwab:history
```

### Example: seven-day history

```bash
npm run schwab:history -- --days=7
```

### Example: thirty-day NVDA history

```bash
npm run schwab:history -- --days=30 --symbol=NVDA
```

### Export the 30-day sanitized history used by research reconstruction

```bash
npm run schwab:history-export
```

This writes to the local Git-ignored historical research path defined in `package.json`.

---

## A.7 Historical state replay

### Default replay

```bash
npm run schwab:replay
```

### Example

```bash
npm run schwab:replay -- --days=7 --symbol=MRVL
```

Replay assumes the symbol is flat at the beginning of the selected window. Choose a window whose first fill is a known opening execution when validating lifecycle logic.

---

## A.8 Slippage and execution-fragment analytics

### Default

```bash
npm run schwab:slippage
```

### Seven days

```bash
npm run schwab:slippage -- --days=7
```

### Thirty days for one symbol

```bash
npm run schwab:slippage -- --days=30 --symbol=AMD
```

### Fragmented executions only

```bash
npm run schwab:slippage -- --days=7 --fragmented-only
```

The current slippage analysis is reference-based and does not yet provide true market-order slippage versus contemporaneous NBBO.

---

## A.9 Schwab bridge tests

### State-engine tests

```bash
npm run schwab:state-test
```

Exercises ENTRY / ADD / PARTIAL / FLAT / REVERSAL state mechanics.

### Token lifecycle test

```bash
npm run schwab:token-test
```

Runs the long credential-lifecycle test across an access-token refresh boundary.

### Historical 1-minute market-data validation

```bash
npm run schwab:price-history-test
```

Validates read-only Schwab `/marketdata/v1/pricehistory` access and minute-candle availability.

---

## A.10 Analytics tests and reports

### All analytics / episode tests

```bash
npm run analytics:test
```

### Full analytics report

```bash
npm run analytics:report
```

### Duration only

```bash
npm run analytics:duration
```

### Stop-management report

```bash
npm run analytics:stops
```

### R-multiple report

```bash
npm run analytics:r
```

### MFE/MAE report

```bash
npm run analytics:mfe
```

### Capture-efficiency report

```bash
npm run analytics:capture
```

### Fixed-duration counterfactual report

```bash
npm run analytics:counterfactuals
```

---

## A.11 Historical study reconstruction commands

### Run the 30-day study runner

```bash
npm run research:30day-management
```

### Normalize exported Schwab history into trade episodes

```bash
npm run research:normalize-30day
```

### Full export -> normalize -> analytics reconstruction pipeline

```bash
npm run research:reconstruct-30day
```

### Enrich the historical study with recovered stop history and historical R fields

```bash
npm run research:enrich-stops
```

### Run reports against the recovered enriched local dataset

```bash
npm run research:report-recovered
```

---

## A.12 Historical forensic diagnostics

These commands were used to recover methodology and are retained for reproducibility and future debugging. They are not normal daily-trading commands.

### Diagnose study-window boundary

```bash
npm run research:diagnose-window
```

### Diagnose the extra winner around the inferred study boundary

```bash
npm run research:diagnose-extra-winner
```

### Diagnose a one-trade benchmark delta

```bash
npm run research:diagnose-one-trade-delta
```

### Diagnose historical stop actions

```bash
npm run research:diagnose-stops
```

### Diagnose stop-to-trade linkage

```bash
npm run research:diagnose-stop-linkage
```

### Diagnose initial-risk population

```bash
npm run research:diagnose-r
```

### Diagnose R winner differences

```bash
npm run research:diagnose-r-winners
```

### Diagnose R provenance

```bash
npm run research:diagnose-r-provenance
```

### Diagnose stop lifecycle for historical R

```bash
npm run research:diagnose-r-lifecycle
```

### Compare historical R denominator bases

```bash
npm run research:diagnose-r-basis
```

### Audit whether historical market samples exist locally

```bash
npm run research:audit-market-data
```

### Diagnose the fast-winner eligibility/sample population

```bash
npm run research:diagnose-fast-winners
```

### Diagnose standard fast-winner stratification rules

```bash
npm run research:diagnose-fast-winner-strata
```

### Validate frozen candidate samples using Schwab minute data

```bash
npm run research:validate-fast-winners-schwab
```

### Diagnose standard minute-bar timestamp alignment conventions

```bash
npm run research:diagnose-minute-alignment
```

The last four commands are preservation forensics. Their purpose is to document what could and could not be recovered, **not** to optimize a sample until it matches a target.

---

## A.13 Useful direct Node entry points

The npm scripts above are preferred. For debugging, each script ultimately runs a Node entry point defined in `package.json`, including:

```text
schwab-bridge/index.mjs
schwab-bridge/monitor.mjs
schwab-bridge/history.mjs
schwab-bridge/replay.mjs
schwab-bridge/slippage.mjs
schwab-bridge/state-test.mjs
schwab-bridge/token-test.mjs
schwab-bridge/price-history-test.mjs
research/30-day-management-study/run-study.mjs
research/30-day-management-study/normalize-schwab-history.mjs
```

Use the npm aliases unless you are deliberately debugging the script implementation.

---

# Appendix B - Environment variables

The project currently recognizes the following important local configuration values.

| Variable | Purpose | Typical/default value |
| --- | --- | --- |
| `SCHWAB_CLIENT_ID` | Schwab Developer Portal client ID. | Required |
| `SCHWAB_CLIENT_SECRET` | Schwab Developer Portal secret. | Required; local only |
| `SCHWAB_CALLBACK_URL` | Registered OAuth callback. | `https://127.0.0.1:8182` |
| `SCHWAB_POLL_MS` | Live order-poll interval. | `1000`; constrained to 500-10000 ms |
| `EXECUTIONOS_API_PORT` | Local read-only broker API port. | `8787` |
| `VITE_EXECUTIONOS_BROKER_URL` | React URL for local broker API. | `http://127.0.0.1:8787` |

Never prefix the Schwab Client Secret with `VITE_`. Any `VITE_` environment variable may be exposed to browser code.

---

# Appendix C - Local files and data retention

The following files are intentionally local/Git-ignored in the current project:

```text
.env
.env.local
.schwab-tokens.json
research/30-day-management-study/raw-schwab-history.json
research/30-day-management-study/normalized-trades.json
research/30-day-management-study/historical-study-trades.json
research/30-day-management-study/schwab-minute-cache.json
```

These categories include:

- credentials and tokens;
- broker-derived raw history;
- normalized historical trade episodes;
- enriched research datasets;
- cached Schwab minute bars.

Do not force-add these files to Git.

The React application separately stores current UI state in browser `localStorage` under:

```text
execution-v23-store
```

---

# Appendix D - Current development sequence

At the time of this guide's publication, the intended project sequence is:

1. **Analytics preservation - complete; PR #2 merged.**
2. **Pre-V2 documentation preservation - complete; PR #3 merged.**
3. **`main` history reconciliation - complete; PR #4 merged with no V2.3 tree changes.**
4. **V2.3 final acceptance and full release gate - complete.**
5. Rewrite PR #1 to describe actual V2.3 behavior and validated release status.
6. Merge PR #1 only after explicit approval.
7. Tag V2.3 only after the intended merge state is confirmed and explicitly approved.
8. Begin V3 Management Governor from the clean merged baseline.
9. Add the broker-agnostic event/adapter boundary, then a read-only NinjaTrader observer.
10. Implement Governor Observe/Govern mode before any broker-write enforcement.

The sequence is intentionally conservative. ExecutionOS is becoming a system that can influence live management decisions; correctness and auditability are more important than feature velocity.

---

## Living-document maintenance rule

Update this guide whenever any of the following changes:

- normal startup commands;
- authentication flow;
- broker-data source;
- plan/risk fields;
- candidate ownership rules;
- live state semantics;
- persistence behavior;
- supported instruments;
- safety boundaries;
- command-line scripts;
- current branch/release workflow.

For historical research-method changes, also update `research/30-day-management-study/methodology.md`. For architecture decisions, update the Project Specification. Do not silently let this guide drift away from the actual application.
