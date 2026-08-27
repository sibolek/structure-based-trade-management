# ExecutionOS

## Management Governor Project Specification

**Version 1.2 - analytics-preservation closeout**  
**Date:** 26 August 2026  
**Primary repository:** `sibolek/structure-based-trade-management`  
**V2.3 baseline branch:** `v2-execution-system`  
**V2.3 baseline SHA:** `2db131ed2ffc156375d0b04739931238c8f4c15f`  
**Analytics-preservation branch:** `analytics-preservation-v23`  
**Current PRs:** PR #1 V2.3 development; PR #2 analytics preservation - both open, draft, unmerged  

> **Core design principle:** ExecutionOS should preserve intent, not force duration. Fast when executing a preauthorized plan. Deliberately frictional when renegotiating the plan under emotional pressure.

This specification supersedes v1.1 for current project status. v1.0, v1.1, `V2-MILESTONE-1.md`, and `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf` remain preserved as historical decision records.

---

## Document control

| Field | Value |
| --- | --- |
| Title | ExecutionOS Management Governor Project Specification |
| Version | 1.2 |
| Date | 26 August 2026 |
| Audience | Project owner / developer / future implementation collaborators |
| Purpose | Preserve validated V2.3 facts, analytics provenance, architecture decisions, release gates, safety boundaries, and V3 implementation sequencing. |
| Current V2 status | Broker-aware V2.3 baseline validated but not yet merged/tagged. |
| Preservation status | Analytics-preservation pass complete; three studies recovered, three historical market-study benchmarks preserved with unresolved exact sample membership. |

### Revision 1.2 changes

1. Records the completed analytics-preservation pass and distinguishes **recovered**, **high-confidence reconstructed**, and **benchmark-preserved but unresolved** evidence.
2. Replaces the earlier unqualified 19-trade MFE/counterfactual discussion with an explicit provenance warning: the numerical fingerprint is preserved, but the original 19 trade identities and sampling implementation are not defensibly recoverable from retained evidence.
3. Documents the recovered 384-trade population, historical stop-action semantics, and historical R reconstruction rule.
4. Records the one remaining R-threshold discrepancy: 27/48 reconstructed losers at or beyond -1R versus preserved 26/48, with no one-trade exception added to force the benchmark.
5. Records Schwab `GET /marketdata/v1/pricehistory` as a validated read-only 1-minute historical source for the recovered study window.
6. Records the anti-curve-fitting boundary used during 19-trade reconstruction: finite predeclared candidate schemes, frozen before market-data validation; no arbitrary combination search.
7. Updates the development sequence to: preservation complete -> V2.3 edge hardening -> deliberate `main` reconciliation -> PR #1 update -> merge/tag -> V3.
8. Marks earlier architecture and Milestone documents as historical rather than rewriting them.

---

## Contents

1. Executive summary
2. Problem statement and empirical rationale
3. What the research proved - and what remains historical evidence
4. ExecutionOS operating principles
5. Decision register
6. Current V2.3 implementation baseline
7. V2.3 release gate and re-baselining decision
8. Latency and split-second execution model
9. V3 Management Governor target architecture
10. Versioned Trade Contract and broker-reality data model
11. Validity, eligibility and management state
12. Trade archetypes
13. Broker event, local-service and NinjaTrader observer architecture
14. Management Governor policy model
15. PPV, R, MFE/MAE and counterfactual telemetry
16. Safety, enforcement and broker-write phases
17. Persistence, security and auditability
18. Test strategy and acceptance criteria
19. Delivery strategy
20. Revised 30-point implementation plan
21. Risks, open questions and deferred decisions
22. Recommended next actions
Appendix A. Current repository inventory
Appendix B. Evidence and source provenance
Appendix C. Glossary

---

# 1. Executive summary

ExecutionOS is a local, deterministic execution operating system whose job is to preserve pre-entry intent under live market pressure. It is not a setup scanner and is not intended to replace the broker. The trader performs the market read and executes in the normal broker platform; ExecutionOS freezes the plan, applies risk rules, observes broker reality, reconstructs state, governs management permissions, and preserves an auditable record.

The central behavioral problem is not simply early exits. It is **asymmetric tolerance under P/L pressure**: profitable trades tend to trigger rapid protection and resolution, while losing trades are granted materially more time and adverse movement. This allows a high win rate to coexist with weak expectancy.

The preserved thirty-day study continues to justify the Management Governor concept, but v1.2 sharpens the evidence hierarchy:

- **Recovered to preserved precision:** duration population and historical stop-management timing.
- **High-confidence reconstruction:** historical initial-risk / realized-R study, with one documented one-trade threshold discrepancy.
- **Historical benchmark preserved, exact sample unresolved:** the 19-trade fixed-duration, MFE, and capture-efficiency sample.

The design implication remains unchanged: ExecutionOS should not force winners to remain open for a fixed time. It should preserve the original contract, distinguish normal uncertainty from true invalidation, and make unplanned management changes visible or frictional.

The validated V2.3 baseline already proves the core broker-aware lifecycle: multiple candidates can remain armed, fills can bind automatically, live state can reconstruct ENTRY / ADD / PARTIAL / FLAT / REVERSAL, and the fill-during-edit race is handled deterministically. V3 should build on that baseline rather than rewrite it.

The next project boundary is therefore operational, not conceptual: close V2.3 cleanly, reconcile the newer `main`-side pre-V2 work, merge/tag the baseline only after explicit approval, then begin the Governor on a clean mainline.

---

# 2. Problem statement and empirical rationale

## 2.1 Behavioral execution problem

The recurrent execution failure occurs after entry. Once capital is at risk, the urge to resolve uncertainty can become stronger than the original structural plan. Unrealized P/L then starts substituting for price structure as the decision signal.

Observed failure modes include:

- panic exits while slightly red even though invalidation has not occurred;
- premature profit-taking because open profit feels fragile;
- stop movement toward breakeven/profit without a new structural reason;
- unauthorized adds or reversals after the original plan has changed emotionally;
- late-session attempts to force the day back to green;
- converting a planned intraday trade into a scalp when green or a rescue hold when red.

The corrective goal is **symmetry of process**, not symmetry of clock time.

## 2.2 Recovered duration population

The recovered execution window is **2026-07-22 09:30 ET through 2026-08-21 inclusive**. The 09:30 start boundary is an inferred reconstruction because it is the boundary that reproduces the preserved population fingerprint without fabricating source rows.

| Metric | Recovered result |
| --- | ---: |
| Completed same-day stock episodes | 384 |
| Winners / losers / flat | 265 / 118 / 1 |
| Win rate | ~69% |
| Median winner hold | 1.35 min |
| Median loser hold | 3.49 min |
| Mean winner hold | 5.04 min |
| Mean loser hold | 14.03 min |

The key asymmetry is direct: winning trades were typically resolved much sooner than losing trades.

## 2.3 Recovered historical stop-management evidence

The historical stop-action fingerprint is reproduced when the historical study treats strict episode-linked submitted stop actions as management intent, including rejected modification attempts. That historical semantic is intentionally different from production broker truth, where rejected changes do not count as accepted state changes.

| Historical stop metric | Recovered result |
| --- | ---: |
| Winners with BE/profit stop action | 135 |
| Losers with BE/profit stop action | 3 |
| Median winner action timing | 77 sec |
| Winner actions within 60 sec | 43.0% |
| Winner actions within 120 sec | 63.7% |

This is important because stop changes are machine-detectable management events. The system can identify when the trader attempts to reduce uncertainty before the contract or new structure authorizes the change.

## 2.4 Evidence classification rule

ExecutionOS documentation now distinguishes:

1. **Observed/recovered evidence** - reproducible from retained broker history or current code.
2. **High-confidence reconstruction** - a rule that reproduces almost all preserved statistics without ad hoc exceptions, with discrepancies documented.
3. **Preserved historical benchmark** - a prior numerical finding whose source membership is no longer fully reconstructible; retained as design evidence but not claimed as exact reproducibility.
4. **Proposed architecture** - forward-looking design decisions that must be tested before enforcement authority is granted.

---

# 3. What the research proved - and what remains historical evidence

## 3.1 Fixed-duration counterfactual benchmark

The project specification historically preserved the following 19-trade fast-winner sample:

| Scenario | Historical aggregate P/L | Trade-level result |
| --- | ---: | --- |
| Actual exits | +$86.46 | 19/19 actual winners |
| Hold to ~209 sec | +$111.30 | 6/19 improved |
| Hold to ~842 sec | +$18.16 | 11/19 losing at that timestamp |

**v1.2 provenance caution:** these numbers remain historical evidence, but the exact original 19 trade identities and original sampling implementation are unresolved. They must not be presented as presently reproducible from the retained dataset.

The design conclusion remains valid at the level supported by the benchmark: a blind long-duration rule is not justified. A fixed timer may be an input to management eligibility, but it cannot distinguish normal pullback from actual structural failure.

## 3.2 Historical MFE / capture benchmark

The same historical 19-trade sample preserved these opportunity-envelope results:

| Window after entry | Historical aggregate MFE | Actual realized | Approx. capture |
| --- | ---: | ---: | ---: |
| 5 min | ~$387 | ~$86 | ~22% |
| 10 min | ~$513 | ~$86 | ~17% |
| 15 min | ~$687 | ~$86 | ~13% |
| 30 min | ~$858 | ~$86 | ~10% |
| 60 min | ~$1,185 | ~$86 | ~7% |

The historical record also preserved that at least 2x realized profit was reached by 15/19 within 5 minutes, 16/19 within 10 minutes, and 17/19 within 60 minutes.

These figures remain useful as **historical design evidence** for poor monetization of favorable excursion. They are not a claim that the exact original sample has now been reidentified.

## 3.3 High-confidence historical R reconstruction

The historical R study is reconstructed with an explicit, broker-grounded rule and no trade-specific overrides.

A trade enters the historical R subset only when the **first accepted closing stop observed inside the flat-to-flat episode is already on the loss side of the episode blended opening-fill VWAP**. If the first accepted stop is already at breakeven/profit, the retained order history does not defensibly reveal the original risk-bearing stop and the trade is excluded.

For qualifying trades:

`historical initial risk = abs(entryVWAP - first accepted loss-side stop) * peakQuantity`

Recovered population and metrics:

| Metric | Reconstructed result |
| --- | ---: |
| Trades with reconstructible initial risk | 83 |
| Winners / losers | 35 / 48 |
| Median winner | +0.31R |
| Mean winner | +0.60R |
| Median loser | -1.00R |
| Mean loser | -1.01R |
| Winners below +0.5R | 68.6% |
| Winners below +1R | 82.9% |
| Losers at or beyond -1R | 56.3% reconstructed vs. 54.2% preserved |

The sole threshold crossing responsible for that last discrepancy is the 2026-08-20 NVDA long. The retained order history provides no defensible earlier in-episode risk-bearing stop, so the code does **not** introduce a hybrid entry basis or one-trade exception merely to force 54.2%.

## 3.4 19-trade provenance investigation

A strong execution-only clue was recovered: **189 of the 265 winners were held 209 seconds or less**, and 10% of 189 is 18.9, naturally suggesting a 19-trade stratified fast-winner sample. This supports an eligibility interpretation but does not prove the original sampling algorithm.

To prevent curve-fitting, the reconstruction froze **27 standard candidate sampling rules** before market-data validation: chronological and duration-sorted 1-in-10 schemes, equal-count 19-stratum representatives, and proportional-by-day variants.

Schwab historical 1-minute OHLCV was then pulled for the required symbol/day pairs. No predeclared candidate reproduced the full independent historical fingerprint. Standard bar-timestamp conventions were also tested without creating new samples. None resolved the mismatch.

**Preservation conclusion:** the exact original 19-trade membership is unresolved and not defensibly recoverable from retained evidence. The project must not search arbitrary combinations, custom offsets, symbol exclusions, or timing rules after seeing the target numbers simply to manufacture a match.

## 3.5 Research conclusion carried forward

The evidence still supports the product hypothesis:

> Entries often create more favorable opportunity than realized winners monetize, while management behavior shows materially greater tolerance for losing trades than profitable trades. ExecutionOS should therefore preserve contract intent and govern renegotiation, rather than impose a universal minimum hold or universal breakeven rule.

---

# 4. ExecutionOS operating principles

- **Preserve intent, not duration.** A 20-second scalp and a 45-minute intraday trade can both be disciplined if the behavior matches the preauthorized contract.
- **Structure is invalidation.** Red is not invalidation; green is not an exit.
- **Plan-aware over timer-aware.** No universal minimum hold, +1R unlock, or breakeven rule applies to every archetype.
- **Fast for authorized actions.** Preplanned targets or invalidation exits must remain immediate.
- **Friction for renegotiation.** Unplanned stop tightening, discretionary exits, risk widening, adds, and reversals should be surfaced or blocked according to severity.
- **Structural stop first, size second.** If the stop is unaffordable under the risk budget, reduce size or pass.
- **Emergency flatten is sacred.** The software must never trap the trader in a position.
- **Observe first, enforce later.** Read-only classification must precede broker-write authority.
- **R before dollars during management.** Dollar P/L is primarily a review metric.
- **Frozen means versioned.** A saved/armed contract is immutable; a saved edit creates a new superseding version.
- **Every interference becomes data.** Stop changes, partials, exits, overrides, and post-exit opportunity should be analyzable events.
- **Historical evidence is not a tuning target.** Benchmarks validate source reconstruction; source membership must never be invented from the benchmark.

---

# 5. Decision register

| ID | Status | Decision | Rationale |
| --- | --- | --- | --- |
| D-01 | Accepted | V3 builds on V2.3; no rewrite. | Preserve working plan/risk/broker binding. |
| D-02 | Accepted | Initial archetypes: `SCALP_1R`, `INTRADAY_STRUCTURAL`. | Keep first Governor rules narrow and testable. |
| D-03 | Accepted | No AI in the latency-sensitive order path. | Deterministic behavior and predictable latency. |
| D-04 | Accepted | Schwab remains read-only through V3A. | Prove policy before broker-write risk. |
| D-05 | Accepted | Futures use a separate NinjaTrader observer. | NinjaTrader is the actual futures execution source. |
| D-06 | Accepted | Broker adapters normalize into common lifecycle events. | UI and Governor should be broker-agnostic. |
| D-07 | Accepted | Trade Contracts are immutable/versioned. | Preserve historical intent and race ownership. |
| D-08 | Accepted | Historical analytics remain separate from production telemetry semantics. | Reproducibility and production correctness are different goals. |
| D-09 | Accepted | Production MFE_R / MAE_R will be scaling-aware. | Adds/partials require realized + unrealized trade-value accounting. |
| D-10 | Accepted | Historical 19-trade sample is not to be curve-fit. | Preserve scientific integrity. |
| D-11 | Accepted | V2.3 must close before a V3 branch is created. | Prevent scope drift and establish a clean release baseline. |
| D-12 | Accepted | Earlier planning documents remain historical snapshots. | Preserve decision history rather than rewriting it. |

---

# 6. Current V2.3 implementation baseline

## 6.1 Current architecture

`thinkorswim / Schwab -> Schwab Trader API -> local Schwab bridge -> 127.0.0.1 read-only API -> React V2.3`

## 6.2 React layer

The active V2.3 workflow is `ExecutionV23`.

Validated behavior includes:

- multiple armed candidates listening independently;
- one armed candidate per symbol;
- automatic matching by symbol, direction, opening effect, and fill timing;
- matching candidate moves to LIVE while unrelated candidates remain armed;
- edit working copy while the last saved contract remains authoritative and listening;
- CANCEL discards the working copy;
- SAVE supersedes atomically without duplicate candidates;
- fill during edit binds the last saved contract and discards unsaved edits;
- multiple live trades are supported with a warning above the intended concurrency limit;
- broker average price, current quantity, peak quantity, risk, exit classification, and history are visible.

## 6.3 Schwab layer

Current read-only capabilities include:

- OAuth authorization and token refresh lifecycle;
- account discovery, balances, positions, and position bootstrap;
- live order polling and execution detection;
- historical order and transaction reconstruction;
- fragmented-fill handling;
- ENTRY / ADD / PARTIAL / FLAT / REVERSAL state semantics;
- execution VWAP and reference-slippage analytics;
- read-only localhost health/state API;
- historical 1-minute OHLCV price-history access for research.

## 6.4 Validated V2.3 acceptance state

| Capability | Status |
| --- | --- |
| Multi-candidate arming | PASS |
| Edit while saved candidate keeps listening | PASS |
| Cancel edit | PASS |
| Save/supersede without duplication | PASS |
| Fill during edit ownership | PASS |
| ARMED -> LIVE broker binding | PASS |
| History / exit classification | PASS |
| ENTRY / ADD / PARTIAL / FLAT / REVERSAL engine | PASS |
| Position bootstrap | PASS |
| Account equity / 0.5% risk refresh | PASS |
| Analytics regression + episode tests after R recovery | 14/14 PASS locally |

---

# 7. V2.3 release gate and re-baselining decision

PR #1 remains open, draft, unmerged, and currently non-mergeable. Its V2.3 head remains `2db131ed2ffc156375d0b04739931238c8f4c15f`. The branch also remains behind a newer `main`-side pre-V2 commit containing valuable execution-discipline work.

The correct release path is:

1. Freeze new V2 feature scope.
2. Complete edge-case acceptance for ADD, PARTIAL, SHORT, near-simultaneous fills, and reversal nuance.
3. Re-run build/state/broker smoke tests.
4. Reconcile `main` into `v2-execution-system` deliberately; never force-overwrite either side.
5. Resolve PR #1 mergeability intentionally.
6. Update PR #1 description from its stale V2.1 framing to V2.3 reality.
7. Merge/tag only after explicit approval.
8. Create the V3 branch from the clean merged/tagged baseline.

Analytics preservation is now complete enough to stop expanding V2 scope for research reasons.

---

# 8. Latency and split-second execution model

ExecutionOS must support fast trigger decisions and very short 1R scalps. The system therefore separates **preparation** from **execution**.

`PREPARE: READ -> PLAN -> RISK -> ARM`  
`LIVE TRIGGER: broker hotkey / ToS / NinjaTrader -> BROKER`  
`BROKER AWARENESS: FILL -> LIVE -> GOVERNOR ACTIVE`

No questionnaire, historical lookup, counterfactual engine, remote reasoning step, or AI belongs between trigger and order.

Broker awareness latency determines how the observer can be used, not whether a preauthorized trigger can be taken. A local deterministic write path, if ever introduced in V3B, must remain smaller and safer than manual order construction.

---

# 9. V3 Management Governor target architecture

The Governor is a pure deterministic policy engine, not JSX and not a broker-specific script.

```text
evaluateManagementAction(
  contract,
  executionState,
  marketState,
  requestedAction
)
=> AUTHORIZED | WARNING | OVERRIDE_REQUIRED | BLOCKED
```

## 9.1 V3A - Observe / Govern

- Broker reads remain authoritative for observed fills and order changes.
- ExecutionOS calculates R, validity, eligibility, and policy state.
- External actions taken in ToS/NinjaTrader are detected, classified, and logged.
- No order is physically blocked by ExecutionOS.
- Shadow mode builds evidence before enforcement.

## 9.2 V3B - Enforce

Only after a separate safety gate:

- controlled broker-write capability may be added;
- native bracket/OCO submission and authorized modifications may be permitted;
- risk expansion, excess adds, or unauthorized reversals can be hard-blocked inside the controlled path;
- emergency flatten remains reachable regardless of policy state.

---

# 10. Versioned Trade Contract and broker-reality data model

## 10.1 Immutable Trade Contract

A saved/armed contract is immutable. An edit is a working copy; SAVE creates a new version that supersedes the previous saved contract.

Illustrative shape:

```text
TradeContract {
  contractId,
  version,
  supersedesContractId,
  symbol,
  direction,
  setup,
  timeframe,
  thesis,
  trigger,
  invalidation,
  archetype,
  structuralStop,
  targetPolicy,
  managementPolicy,
  accountEquity,
  maximumRisk,
  authorizedSize,
  armedAt,
  supersededAt
}
```

Race rule: a fill observed before supersession belongs to the prior saved contract; a fill observed after supersession belongs to the new saved version. A working copy never owns a broker fill.

## 10.2 Contract lifecycle events

`CONTRACT_CREATED -> CONTRACT_ARMED -> CONTRACT_EDIT_STARTED -> (CONTRACT_EDIT_CANCELED | CONTRACT_SUPERSEDED) -> BROKER_FILL`

## 10.3 Execution state

Broker reality remains separate from intent.

```text
ExecutionState {
  status,
  source,
  actualEntryVWAP,
  currentQuantity,
  peakQuantity,
  side,
  brokerOrderIds,
  firstFillAt,
  currentStop,
  realizedPnl,
  ...
}
```

The pure trade-state engine should not absorb psychology, Governor policy, or UI state.

---

# 11. Validity, eligibility and management state

Validity and management eligibility are intentionally independent.

| Validity | Meaning | Default action |
| --- | --- | --- |
| VALID | Original thesis remains intact. | Hold according to contract; no P/L-only interference. |
| THREATENED | Adverse evidence exists but invalidation has not occurred. | Observe; defensive action only if policy authorizes it. |
| INVALID | Original thesis has failed. | Immediate exit authorized regardless of management lock. |

| Eligibility | Meaning |
| --- | --- |
| LOCKED | Archetype-specific conditions for profit-protection management have not been met. |
| ELIGIBLE | Defined management actions are now contract-authorized; action is still not mandatory. |

Invalidation always supersedes a management lock.

---

# 12. Trade archetypes

## 12.1 `SCALP_1R`

Purpose: preserve very fast preauthorized scalp execution.

Typical policy characteristics:

- fixed/defined 1R target or similarly explicit exit policy;
- no minimum time requirement before a planned target;
- target execution authorized immediately;
- risk widening remains prohibited;
- discretionary deviation remains auditable.

## 12.2 `INTRADAY_STRUCTURAL`

Purpose: allow a valid thesis to survive normal post-entry uncertainty while distinguishing actual structural failure from discomfort.

Policy can consider:

- validity state;
- original structural stop;
- R progress;
- new adverse structure;
- archetype-specific unlock conditions;
- broker-observed stop movement;
- partials and adds;
- elapsed time only as one input, never as the sole rule.

Additional archetypes should be added only after the first two produce stable live telemetry.

---

# 13. Broker event, local-service and NinjaTrader observer architecture

## 13.1 Broker-agnostic event boundary

V3-1 should define a normalized event model before adding a second broker adapter.

Illustrative event:

```text
BrokerEvent {
  broker,
  accountKey,
  instrument,
  eventType,
  instruction,
  positionEffect,
  quantity,
  price,
  brokerOrderId,
  executedAt,
  observedAt,
  rawRef
}
```

Raw broker fragments remain available for audit. Human-facing lifecycle state should coalesce fragments into economically meaningful events.

## 13.2 Schwab adapter

Schwab remains the proven equities/options observer. The browser should never receive client secrets or OAuth tokens.

## 13.3 NinjaTrader observer

After the normalized boundary is defined, add a minimal read-only local NinjaTrader observer using official execution/account events. It should feed the same BrokerEvent semantics used by Schwab.

This proves cross-broker parity before the full Governor depends on broker-specific behavior.

---

# 14. Management Governor policy model

A requested or observed action is evaluated against:

1. immutable contract intent;
2. broker execution state;
3. validity state;
4. management eligibility;
5. original risk and current risk;
6. archetype policy;
7. optional market telemetry;
8. safety overrides.

Examples:

- Planned target hit -> `AUTHORIZED`.
- Thesis invalidated -> `AUTHORIZED` immediately.
- Stop moved toward BE while VALID + LOCKED -> `OVERRIDE_REQUIRED` in V3A, potentially blocked inside a future controlled V3B path.
- Stop widened beyond original risk -> violation; eventual controlled path should `BLOCK`.
- Add beyond preauthorized risk/size -> violation.
- Reversal without a fresh opposite-side contract -> unauthorized reversal classification.

The Governor must be deterministic for identical inputs.

---

# 15. PPV, R, MFE/MAE and counterfactual telemetry

## 15.1 PPV

Premature Profit Protection (PPV) is a machine-detectable event class, not a universal claim that every early stop move is wrong.

A PPV detector should compare observed stop/order changes against:

- original contract;
- entry VWAP and quantity state;
- validity;
- management eligibility;
- archetype policy;
- structural updates.

## 15.2 Production R

Production R must use the contract's original planned risk. Historical R reconstruction logic is retained only to reproduce the old study and must not silently become the production TradeContract risk model.

## 15.3 Production MFE_R / MAE_R

Production telemetry should be scaling-aware:

`combined trade value = realized P/L to date + unrealized P/L on remaining size`

`MFE_R = max favorable combined trade value / original contract risk`

`MAE_R = max adverse combined trade value / original contract risk`

This avoids the historical simplification that assumes fixed quantity.

## 15.4 Historical benchmark preservation

The original 19-trade MFE/capture/fixed-duration numbers remain in `expected-results.json` as historical fingerprints. They must be labeled as benchmark-preserved, not exact-reproduced, until independent evidence recovers the original sample membership.

## 15.5 Market-data adapter

Production market telemetry should use a provider abstraction. The historical preservation pass proved that Schwab price history can supply 1-minute OHLCV for the recovered study window; that does not by itself decide the eventual live telemetry provider or quote granularity.

---

# 16. Safety, enforcement and broker-write phases

## 16.1 Safety hierarchy

1. Broker-native protective orders remain authoritative.
2. Emergency flatten is always reachable.
3. Read failures must degrade gracefully rather than remove broker protection.
4. Write failures must never leave the trade less protected than the broker-native state.
5. Every write request must be idempotent or uniquely attributable.
6. Risk expansion requires stricter controls than profit-protection changes.

## 16.2 V3A boundary

No broker write authority. Detect, classify, warn, journal, review.

## 16.3 V3B boundary

Separate explicit approval and live safety gate required before any order-write functionality is introduced.

---

# 17. Persistence, security and auditability

## 17.1 Persistence evolution

Browser localStorage was appropriate for V2 prototypes. V3 requires a durable replayable event history.

Start with local append-only JSONL; adopt SQLite later if query needs justify it.

Suggested event classes:

`CONTRACT_CREATED`  
`CONTRACT_ARMED`  
`CONTRACT_EDIT_STARTED`  
`CONTRACT_EDIT_CANCELED`  
`CONTRACT_SUPERSEDED`  
`BROKER_FILL`  
`STATE_CHANGED`  
`STOP_CHANGED`  
`PPV_DETECTED`  
`PARTIAL`  
`EXIT`  
`REVIEW_COMPLETED`

## 17.2 Security model

- Schwab credentials are entered only on Schwab authorization pages.
- Client ID/secret and OAuth tokens remain local and Git-ignored.
- Broker credentials must never cross browser-visible payloads.
- NinjaTrader observer should communicate with a localhost service rather than exposing broker internals directly to React.
- Logs, screenshots, research exports, and project documents must not contain secrets or full account identifiers.
- If credentials are exposed, rotate them rather than relying on deletion.

## 17.3 Audit model

The journal should reconstruct frozen intent, contract supersession, fills, state changes, stop changes, attempted management, Governor result, overrides, exits, and review.

---

# 18. Test strategy and acceptance criteria

Use Node's built-in test runner initially. Broker-specific fixtures should not be required for pure policy tests.

Core acceptance cases:

| Case | Scenario | Required result |
| --- | --- | --- |
| A | `SCALP_1R` reaches planned target immediately | Target `AUTHORIZED`; no timer blocks it. |
| B | `INTRADAY_STRUCTURAL`, +0.31R, VALID + LOCKED, stop moved toward BE | PPV / `OVERRIDE_REQUIRED`. |
| C | Thesis invalidated seconds after fill | Exit `AUTHORIZED` immediately. |
| D | Requested stop widens risk beyond original contract | Violation in V3A; future controlled path blocks. |
| E | Fragmented fill 40 + 30 + 30 | One 100-share trade; correct VWAP. |
| F | Partial 100 -> 50 | PARTIAL; 50 remain live. |
| G | Long 100 -> sell 200 without fresh short contract | Close long + detect unauthorized reversal/new short. |
| H | Fill arrives while candidate edit working copy is open | Last saved contract owns fill; unsaved edit discarded. |
| I | SAVE edit before fill | New contract version owns future fill; old version remains audit history. |
| J | Equivalent Schwab and NinjaTrader event sequences | Normalized lifecycle semantics match. |

Non-functional criteria:

- no duplicate fills under reconnect/polling conditions;
- restart recovery does not lose armed/live contract ownership;
- Governor deterministic for identical inputs;
- credentials never enter browser state;
- emergency flatten always available;
- write-path failure leaves broker-native protection intact;
- analytics historical-mode tests remain isolated from production telemetry semantics.

---

# 19. Delivery strategy

| Phase | Scope | Explicitly not included |
| --- | --- | --- |
| Phase 0 - Close V2.3 | Final edge tests, `main` reconciliation, PR #1 update, merge/tag. | New V2 features. |
| V3-1 - Core plumbing | BrokerAdapter, shared Schwab client, normalized BrokerEvent, versioned TradeContract, durable journal, baseline tests. | Behavioral enforcement, broker writes. |
| V3-2 - Multi-broker observer | Minimal NinjaTrader read-only observer, cross-broker normalization, event-driven lifecycle hardening. | Governor enforcement, broker writes. |
| V3-3 - Governor observe-only | Archetypes, validity/eligibility policy, PPV, R display, override audit. | Automated order control. |
| V3-4 - Telemetry | MarketDataAdapter, scaling-aware MFE/MAE, shadow tracking, capture/counterfactual review. | Broker writes. |
| V3-5 - Controlled write path | Native brackets, authorized modifications, hotkeys, hard risk blocks with broker-specific gates. | Merge until separate safety gate passes. |

Sequencing rule: NinjaTrader is early, but not first. Close V2.3, define the common event/contract boundary, then build the observer before the full Governor rollout.

---

# 20. Revised 30-point implementation plan

## Phase 0 - Close V2.3

1. Freeze V2 feature scope.
2. Re-run production build.
3. Re-run deterministic trade-state tests.
4. Re-run credential lifecycle and broker smoke checks.
5. Validate ADD edge behavior in the V2.3 UI.
6. Validate PARTIAL behavior end-to-end.
7. Validate SHORT / cover full UI lifecycle.
8. Validate two fills arriving close together.
9. Validate reversal nuance and candidate ownership.
10. Reconcile the newer `main`-side pre-V2 work deliberately.
11. Resolve conflicts without overwriting either branch's valuable work.
12. Re-run build/state/broker/UI tests after reconciliation.
13. Update PR #1 description to V2.3 reality.
14. Merge and tag V2.3 only after explicit approval.

## V3-1 - Core plumbing

15. Create V3 branch from merged/tagged V2.3.
16. Extract reusable Schwab client/normalization code without behavior changes.
17. Define `BrokerAdapter` interface.
18. Define normalized `BrokerEvent` schema version 1.
19. Define versioned `TradeContract` schema.
20. Add durable local event journal.
21. Add replay tests for contract/event ownership and restart recovery.

## V3-2 - Multi-broker observer

22. Build minimal read-only NinjaTrader observer using official account/execution events.
23. Normalize NinjaTrader events into the same BrokerEvent semantics.
24. Add cross-broker parity fixtures and tests.
25. Harden UI lifecycle to consume event-driven updates while retaining snapshot fallback.

## V3-3 / V3-4 - Governor + telemetry

26. Implement pure Governor decision function and archetype policies.
27. Add validity + management eligibility state.
28. Add PPV/order-change detection and production R telemetry.
29. Add MarketDataAdapter plus scaling-aware MFE_R / MAE_R and shadow tracking.
30. Run observe-only shadow mode long enough to compare Governor classifications with post-trade review before any enforcement authority is considered.

V3-5 broker writes are a separate post-plan safety phase, not automatically authorized by completion of these 30 points.

---

# 21. Risks, open questions and deferred decisions

| Item | Status / mitigation |
| --- | --- |
| V2.3 mergeability | Open; reconcile `main` intentionally. |
| Near-simultaneous fill edge cases | Final V2.3 hardening item. |
| NinjaTrader observer transport | Define simplest official local event path after BrokerEvent schema. |
| Restart recovery across brokers | Must be tested before Governor depends on live state. |
| Cross-broker symbol identity | Normalize instrument identity carefully; prevent accidental cross-binding. |
| Live market-data provider / quote granularity | Deferred to V3-4; historical Schwab minute data does not settle production quote needs. |
| Stop-change visibility fidelity | Validate broker order replacement/cancel history per adapter. |
| Archetype unlock rules | Research through observe-only telemetry; begin minimal. |
| Broker-write permissions | High-risk deferred boundary requiring separate approval. |
| AI role | Review/research only unless future evidence justifies more; never latency-sensitive order path. |
| Exact original 19-trade sample membership | Unresolved; do not curve-fit. |
| Historical R -1R threshold | One documented NVDA discrepancy; no special-case override. |

---

# 22. Recommended next actions

## Immediate

1. Treat analytics preservation as complete.
2. Pull the latest `analytics-preservation-v23` documentation updates locally.
3. Keep PR #2 draft and unmerged until the chosen preservation merge sequence is explicitly approved.
4. Return focus to V2.3 final acceptance and edge hardening.
5. Reconcile the newer `main` work deliberately.
6. Refresh PR #1 description only during V2.3 closeout.
7. Merge/tag V2.3 only after explicit approval and green tests.

## After V2.3 closeout

8. Create the V3 branch from the clean baseline.
9. Define BrokerAdapter/BrokerEvent/TradeContract versioning before adding NinjaTrader.
10. Build the minimal NinjaTrader observer.
11. Implement the Governor in observe-only mode.
12. Accumulate live event evidence before granting enforcement authority.

**Immediate boundary:** do not begin broker-write implementation merely because the architecture is specified. Enforcement requires a separate live safety gate.

---

# Appendix A. Current repository inventory

## A.1 Active project state

| Item | Current value |
| --- | --- |
| Repository | `sibolek/structure-based-trade-management` |
| V2.3 baseline branch | `v2-execution-system` |
| V2.3 head | `2db131ed2ffc156375d0b04739931238c8f4c15f` |
| Active V2.3 app | `src/pages/ExecutionV23.jsx` |
| Preservation branch | `analytics-preservation-v23` |
| PR #1 | Open, draft, unmerged, non-mergeable at current snapshot |
| PR #2 | Open, draft, unmerged preservation PR |

## A.2 Key V2.3 files

- `src/pages/ExecutionV23.jsx`
- `src/components/BrokerStatusPanel.jsx`
- `src/hooks/useBrokerState.js`
- `schwab-bridge/index.mjs`
- `schwab-bridge/monitor.mjs`
- `schwab-bridge/history.mjs`
- `schwab-bridge/replay.mjs`
- `schwab-bridge/slippage.mjs`
- `schwab-bridge/trade-state.mjs`
- `schwab-bridge/live-state-api.mjs`

## A.3 Analytics-preservation files

- `analytics/execution-metrics.mjs`
- `analytics/management-metrics.mjs`
- `analytics/r-metrics.mjs`
- `analytics/r-history.mjs`
- `analytics/stop-history.mjs`
- `analytics/mfe-mae.mjs`
- `analytics/capture-efficiency.mjs`
- `analytics/counterfactuals.mjs`
- `research/30-day-management-study/methodology.md`
- `research/30-day-management-study/expected-results.json`
- `research/30-day-management-study/run-study.mjs`
- reconstruction and forensic diagnostics under `research/30-day-management-study/`

## A.4 Documentation status

- `README.md` - current operational overview.
- `DOCUMENTATION-STATUS.md` - authoritative/historical document map.
- `V2-MILESTONE-1.md` - historical/superseded milestone record.
- `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf` - historical planning snapshot, superseded for current status.
- Project Specification v1.0 / v1.1 - historical specifications.
- Project Specification v1.2 - current authoritative decision record.

---

# Appendix B. Evidence and source provenance

## B.1 Recovered trading-study evidence

- Schwab account/order/transaction reconstruction covering the recovered study window.
- 384 flat-to-flat same-day stock episodes: 265 winners, 118 losers, 1 flat.
- Duration fingerprint reproduced to preserved precision.
- Historical stop-management fingerprint reproduced to documented precision.
- Historical R population reconstructed to 83 trades with all preserved mean/median/winner-threshold metrics reproduced and one documented discrete loser-threshold discrepancy.

## B.2 Historical market-study evidence

Preserved numerical benchmarks:

- 19-trade actual P/L +$86.46.
- 209s counterfactual +$111.30; 6/19 improved.
- 842s counterfactual +$18.16; 11/19 losing.
- MFE approximately $387 / $513 / $687 / $858 / $1,185 at 5 / 10 / 15 / 30 / 60 minutes.
- 2x actual reached by 15/19, 16/19, 17/19 at 5 / 10 / 60 minutes.

These values are preserved as historical fingerprints. Exact sample membership is unresolved.

## B.3 Market-data source validation

Schwab Market Data `GET /marketdata/v1/pricehistory` was validated read-only for the recovered study window using 1-minute OHLCV and extended-hours data. The preservation diagnostics cached market data locally in a Git-ignored file and never committed credentials, tokens, account identifiers, or raw private research exports.

## B.4 Anti-curve-fitting rule

The reconstruction did not search arbitrary 19-trade combinations. Candidate rules were declared before market-data validation. Standard minute-bar alignment interpretations were tested without generating new sample combinations. No rule reproduced the full historical fingerprint. The project therefore records the sample as unresolved instead of tuning source membership to the benchmark.

## B.5 Current code/project-state evidence

- Current GitHub V2.3 baseline and PR #1 status verified through the repository connector on 26 Aug 2026.
- Current preservation PR #2 status and body refreshed on 26 Aug 2026.
- Root README, Milestone 1 historical notice, documentation status map, preservation methodology, and this v1.2 source are stored on `analytics-preservation-v23`.

## B.6 Reliability rule

Where current code and earlier dated documents disagree about *current implementation state*, current code and current PR metadata take precedence. Earlier documents remain valid as historical design records for what was known or planned at their dates.

---

# Appendix C. Glossary

| Term | Definition |
| --- | --- |
| Archetype | A predefined management mode such as `SCALP_1R` or `INTRADAY_STRUCTURAL`. |
| Trade Contract | Immutable/versioned pre-entry intent: thesis, trigger, invalidation, risk, stop, target policy, management policy. |
| Broker reality | Authoritative observed fills, orders, positions, timestamps, and account state. |
| R | One unit of original planned contract risk. |
| MFE | Maximum Favorable Excursion. |
| MAE | Maximum Adverse Excursion. |
| MFE_R / MAE_R | Scaling-aware favorable/adverse excursion expressed in original contract R. |
| PPV | Premature Profit Protection event/violation classification. |
| Validity | Thesis state: VALID / THREATENED / INVALID. |
| Eligibility | Whether defined profit-management actions are LOCKED or ELIGIBLE. |
| Governor | Deterministic policy engine evaluating management actions against contract, broker, and market state. |
| V3A | Observe/Govern phase without broker-write enforcement. |
| V3B | Controlled enforcement phase after a separate safety gate. |
| Shadow tracking | Post-entry/post-exit passive market observation for telemetry and counterfactual review. |
| BrokerAdapter | Broker-specific implementation that emits normalized BrokerEvents. |
| BrokerEvent | Broker-agnostic normalized lifecycle event. |
| OCO | One-cancels-other broker-native order relationship. |

---

**End of specification - Version 1.2**
