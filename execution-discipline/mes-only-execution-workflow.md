# MES-Only Execution Workflow

> **Preservation note — 2026-08-27:** This document is preserved from pre-V2 `main` commit `4dd27d1` as a historical 20-session execution-discipline block. The original `Status: ACTIVE` applied to that temporary futures discipline phase; it is not a universal current ExecutionOS operating rule. For current operation, defer to `USER-GUIDE.md`.

Status: ACTIVE
Scope: Live futures execution
Duration: 20 trading sessions
Primary Instrument: MES only
Max Trades: 4 per day
Max Losses: 2 per day
Purpose: Bring execution discipline up to analysis quality

## Purpose

My chart analysis is improving faster than my live execution. This workflow exists to close that gap.

This phase is not about maximizing P&L. It is about making execution boring, consistent, and non-emotional.

## Core Problem

This workflow addresses:

- Taking too many trades
- Switching instruments to recover losses
- Using ES because it feels easier to make back money
- Letting P&L influence decision quality
- Paying too much in fees from overtrading
- Taking reasonable tactical trades that are not selective enough
- Managing structure trades like fear scalps

Red-flag thought:

> "I find it easier with ES to make up a loss."

> That is recovery thinking, not professional trading.

## Primary Rule

During this block:

- Live futures execution is **MES only**
- ES is not allowed live
- MNQ is observation/paper only
- MCL is observation only unless separately planned
- ES/MNQ/MCL may be used for chart reading, confirmation, replay, study, and paper trading only
- No recovery trades
- No silent clicks

## 20-Session Discipline Block

| Rule               | Requirement                                |
| ------------------ | ------------------------------------------ |
| Live instrument    | MES only                                   |
| Max trades per day | 4                                          |
| Max losing trades  | 2                                          |
| Max daily loss     | Defined before the open                    |
| Contract size      | Fixed size only                            |
| ES                 | Not allowed live                           |
| MNQ                | Observation or paper only                  |
| MCL                | Observation only unless separately planned |
| Recovery trades    | Forbidden                                  |
| Silent clicks      | Forbidden                                  |

## Allowed Trade Types During This Block

Only at meaningful levels:

- Breakout pullback
- Failed breakout
- Failed breakdown
- Reclaim of ORH / ORL / VWAP / YDC / PMH / PML
- Wedge reversal at support or resistance
- Double bottom / double top with confirmation
- Breakout mode resolution with retest
- Higher-low or lower-high continuation after clean level test

## Forbidden Trade Types

- First break in breakout mode without retest/follow-through
- Middle-of-range trades
- EMA-tangle trades
- Trades with unaffordable structural stop
- Trades taken because price is moving without me
- Trades taken to recover
- ES/MNQ trades because MES feels too slow
- Any trade that cannot be explained in one clean sentence

## Stop-Trading Conditions

Stop trading if:

- 4 trades have been taken
- 2 losing trades have been taken
- Daily loss limit is hit
- A rule is broken and the urge to continue appears
- I want to make back money
- The next trade cannot be explained in one clean sentence
