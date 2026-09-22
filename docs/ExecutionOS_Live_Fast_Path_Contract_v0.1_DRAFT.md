# ExecutionOS live trade-card fast path — contract v0.1

**Status:** DRAFT FOR DESIGN REVIEW; not approved or released. Initial clock/quote-evidence changes are committed on the working branch, with follow-up defects recorded in the implementation handoff; the live fast path is not implemented.
**Date:** 2026-09-21  
**Base:** `main` at `e49f30f2f7dccc1c544002a0806eab40fd46bb54`  
**Evidence:** [September 21 audit](ExecutionOS_Live_Fast_Path_Repository_Audit_2026-09-21.md) · [Preview/admission implementation handoff](ExecutionOS_Live_Preview_Admission_Implementation_Handoff_2026-09-21.md)

## 1. Intended operator experience

The operator submits a fresh chart from ExecutionOS, sees one readable proposed card or an explicit no-setup result, and chooses **Accept into PRETRADE** or **Discard preview**. Services and account selection are prepared before the session. No operator file packaging, JSON copying or browser handoff is required during this flow.

The initial profile supports one symbol, one proposal at most, US equities during regular market hours, decision timeframe `5m` and entry/volatility timeframe `2m`. Unsupported instruments, sessions and timeframe combinations receive an explicit unsupported result. Higher-timeframe panes provide context with separately displayed data times. A 5m/15m screenshot is not evidence of a current 2m structure review.

Accepting the proposal creates a candidate only. Existing trigger confirmation, structural evidence, permission, DSS, risk, quantity selection and exact-package review precede a separate **ARM** action. Broker entry/exit stays manual. The system must not manufacture trigger satisfaction merely to complete a lifecycle test.

## 2. Architecture and required design amendment

Reuse the existing provider, chart store, run coordination and canonical PRETRADE ingress. The model proposes trade substance; trusted local code owns identity derivation, version/lineage, validation and durable orchestration. No second candidate store or competing lifecycle authority is introduced.

Proposed amendment to the frozen full-SOD scope: add an explicit `INTRADAY_CARD` profile with bounded zero-or-one-candidate output inside the existing orchestration architecture. The full SOD profile retains its 19 sections, mandatory research and existing publication policy. The intraday profile requests only the card and evidence needed for it, uses current trusted local market context, and makes no unsupported news/fundamental claims. A trade requiring unavailable research is returned as `NEEDS_CONTEXT`, without an eligible preview. Required research is never silently reused past its declared validity or replaced by model memory.

The intraday result stops at proposal preview. It does not automatically publish to the feeder or admit to PRETRADE. Explicit acceptance reaches existing canonical ingress with manual authorization semantics. This profile change, including its research boundary, requires design approval; it is not implied by the original provider hardening baseline.

Trusted, versioned policy selects the profile before invocation and defines research requirements for each supported setup; model output cannot waive them. Unclassified requirements return `NEEDS_CONTEXT`. Persist the profile and schema version with the run, preview and receipt. Historical untagged artifacts retain their original full-SOD interpretation and cannot acquire live-preview authority. Intraday validation exceptions never apply to full-SOD runs. Existing manual import remains a separately labeled legacy path; it cannot grant a fast-path validation badge or accept a known fast-path proposal by omitting its required preview proof.

Preserve durable run identity, bounded resources, strict local output validation, admission integrity and no automatic provider retries. Start with the existing conservative single-flight scope; concurrent work receives `BUSY`. Expanding concurrency or changing same-date/symbol/setup identity requires a separate explicit decision. Repeated same-setup proposals follow existing unchanged/revised/supersession rules, not randomly generated identities.

## 3. Freshness evidence

Record distinct times: `sourceDataAsOf` per pane, `capturedAt`, `receivedAt`, provider start/end, preflight time, preview-visible acknowledgment and admission time. Receipt/generation time never substitutes for chart-data time.

Bind bytes to their SHA-256 and declare capture provenance as trusted capture or operator-attested upload. File modification time, image OCR and model assertions alone cannot prove freshness. Replay/delayed charts and unknown capture/data times cannot receive a live-eligible preview. Operator attestation must remain labeled; it must be corroborated against current provider bars/quotes. A recent screenshot of an old chart remains old evidence.

Quote checks use the timestamp of the actual price fields being used. A recent trade timestamp cannot make an old bid/ask fresh by taking their maximum. Validate provider timestamp, local receive time, local clock, market/session identity and explicit real-time status. Missing or false real-time status blocks the live profile. Reject excessive future skew, backward time discontinuities, out-of-order evidence and stale cached data. Equal timestamps may represent an unchanged quote; a repeated fetch never refreshes its source age.

Working-branch implementation note: the common quote/account freshness check now validates the local clock, permits no more than two seconds of future skew, and is applied again at both ARM authorization boundaries. DSS and expected-entry evaluation prefer `quoteTime` for bid/ask freshness instead of a newer aggregate/trade `asOf`. The production PRETRADE live DSS and risk paths also require a valid local quote-receipt timestamp, consistent source/receipt clocks and `realtime: true`. This uses the existing five-second quote policy; it does not activate the draft three-second pilot value and does not apply a chart/trade-card age limit. Backward monotonic-clock detection, chart-source age and the complete fast-path preflight remain unimplemented requirements.

Follow-up review at `283ad90` found Date precision and legacy timestamp-input defects, plus missing persisted receipt/realtime evidence for final ARM revalidation. Final ARM currently rechecks source/account freshness, not the complete quote-evidence policy. These are open B2 prerequisites in the handoff; the initial passing tests do not establish their absence.

Completed bars require the expected session-aligned closed interval and complete source-minute coverage. A completed 5m bar naturally differs in age from a quote; use interval closure/continuity rules rather than a quote-age threshold. Include a calendar capable of identifying holidays and early closes, and reject an unknown session state. Forming or missing bars cannot substitute for completed evidence.

Machine checks establish timestamp, identity, continuity and explicitly encoded price conditions. They do not certify discretionary concepts such as “acceptance,” “higher low” or “failed bear break.” Such fields remain **Operator confirmation required** through the existing PRETRADE workflow.

## 4. Proposed pilot limits

These are conservative engineering defaults proposed for the shadow pilot, not measured capabilities or accepted trading policy. Version them together as `liveProfilePolicyVersion`; any change invalidates outstanding previews and requires a new trial cohort.

The operator has not selected a chart/trade-card stale-age rule. Continuing implementation does not approve these proposed values. Keep the live feature disabled with an explicit unconfigured-policy status until its policy is resolved; do not apply draft age limits to existing manual cards.

| Control | Proposed pilot value / behavior |
|---|---|
| Pane currency at preview/admission | Verified decision/entry pane source update at most 60 seconds old; unknown age blocks eligibility |
| Quote source age | At most 3 seconds at preflight and admission |
| Quote local receipt age | At most 3 seconds; fetching cannot renew source age |
| Future-clock tolerance | At most 2 seconds, with valid local wall/monotonic clocks; larger skew fails closed |
| Preview lifetime | Fixed hard expiry at earliest of initial preflight + 15 seconds, original chart/structural expiry and contract expiry; quote freshness is rechecked within this window |
| Chart receipt to visible usable preview | p95 target at most 30 seconds, including provider, local checks and browser delivery |
| Initial preview production deadline | 30 seconds from complete chart receipt; late output cannot produce an eligible preview. This deadline does not truncate an on-time preview's separate review window |
| Admission click to reconciled visible result | p95 target at most 5 seconds; freshness/authority gates still apply |
| Market displacement | Require a configured, setup-specific numeric bound and mandatory no-chase/invalidation tests; absent bounds block live eligibility |

Price displacement must not be reduced to an arbitrary universal dollar threshold. The implementation slice must define the exact reference price, direction, comparison operator and setup-specific bound in the canonical proposal/reviewed policy before admission is enabled. Stop distance cannot be silently tightened to manufacture a passing result. Shadow measurement may proceed while the displacement policy is unresolved, but admission stays disabled.

`sourceDataAsOf` denotes the depicted source update, not the open/close timestamp of the last completed bar. Validate completed-bar recency separately by expected session interval and continuity. A forming update can establish pane currency, but cannot satisfy completed structural evidence.

Freeze capture-price and initial-preflight displacement references; quote refresh cannot rebase them. The reviewed setup policy distinguishes current-price predicates from path-dependent invalidation predicates and specifies the observation interval, beginning at the relevant source observation and ending at admission. A path-dependent breach permanently invalidates that proposal, even after price returns. Missing coverage needed to exclude a breach blocks admission. A sampled quote or completed candle cannot prove an unsampled intrabar sequence; unsupported predicates require operator evidence or a no-admission result.

Refreshing a quote may renew a preflight only while the original chart, proposal and structural evidence remain valid. It cannot slide their original timestamps, contract validity or run identity forward. Material setup changes require fresh analysis and existing revision/supersession handling.

The fixed preview hard expiry is never extended by quote renewal. If that review window expires, start an explicit new review/preflight with still-valid underlying evidence; distinguish it visibly from the expired preview. Expired source evidence requires recapture/reanalysis. Initial preview production latency and subsequent review duration are measured separately.

## 5. Server preview contract

Preflight may persist an auditable preview record but must not mutate candidate, lifecycle, risk authorization, execution ownership or broker state. It invokes the same canonical validators and lineage checks that admission uses.

Route preflight outside the existing import handler's mutating validity-reconciliation preamble. Compute effective validity as a read-only projection and test that repeated preflight leaves authoritative candidate/lifecycle stores unchanged. Admission continues to perform its required reconciliation.

The server owns an opaque `previewId` and binds it to the exact proposed bundle/canonical content hash, candidate identity and version, chart hashes and data times, input revision, account scope, quote/bar evidence, policy version, relevant PRETRADE revisions/ownership fingerprint and absolute expiry. Client-supplied PASS flags, hashes or timestamps do not override server evidence. Add explicit PRETRADE preview session/origin authorization; existing candidate routes do not provide a session-token boundary, and the separate SOD session cannot be assumed to authorize PRETRADE. A preview ID is not a bearer authorization credential. Retain loopback-only access, bounded inputs and secret-safe diagnostics.

Each evidence refresh creates an immutable preview revision and atomically retires the previous revision from new acceptance. Acceptance names the exact revision. Once acceptance begins, refresh cannot replace that revision until its outcome resolves. Renewal preserves the proposal hash and fixed hard expiry. New evidence obtained during acceptance is appended to its record rather than rewriting the reviewed preview. Compatible price updates can be shown without changing the proposal; substantive changes require explicit new review.

Suggested presentation states are `ANALYZING`, `ELIGIBLE_FOR_ADMISSION`, `NO_SETUP`, `NEEDS_CONTEXT`, `STALE`, `BLOCKED`, `DISCARDED`, `ACCEPTING`, `ADMITTED` and `OUTCOME_UNKNOWN`. These are preview/run states, not additions to the PRETRADE lifecycle. `ELIGIBLE_FOR_ADMISSION` never means READY or ARMED.

The readable card shows symbol/direction/setup; capture and data ages; live quote and quote age; displacement; proposed location/trigger/invalidation/targets; deadline; selected account; and which structure checks require the operator. Show effective stop and final allowed quantity only when existing PRETRADE authority has actually produced them. Otherwise show **Calculated in PRETRADE**. Raw JSON, hashes and diagnostics belong in expandable details, not the primary decision surface.

## 6. Acceptance, idempotency and races

Allocate one durable server-owned acceptance identity with each immutable preview revision, bound to that revision and candidate hash. On **Accept into PRETRADE**, reserve that identity before external work. Obtain current market/account/ownership evidence, then recheck the preview and canonical state inside the shared admission transaction immediately before commit. Do not hold a critical section across provider/network calls. Recheck elapsed time after external work; an expired snapshot cannot be committed because it passed an earlier check.

Candidate mutation and its acceptance receipt commit in one PRETRADE state transaction, as specified in the implementation handoff. The chosen design adds a writer lock, validated store revisions/metadata, a shared ingress planner and durable commit/recovery classification. Calling current `importBundle()` and saving a receipt afterward is insufficient. Recovery determines committed versus not committed without repeating admission. While unresolved, block replacement acceptance for that candidate/version and show `OUTCOME_UNKNOWN`; an in-process lock alone is insufficient.

Atomicity concerns local state and evidence bounds; it cannot make the external market stop moving. Re-evaluate changed price/bar evidence against the frozen setup bounds. Crossed limits, changed substantive proposal, account mismatch, invalidated review, expired evidence, supersession or unresolved ownership returns an explicit non-admission result. Existing canonical supersession remains a separate informed action.

The response separates the durable admission receipt from current reconciled lifecycle state and its observation time. A new candidate that is already expired/blocked is never shown as currently actionable. Preserve historical receipt truth even if later lifecycle state changes.

Double clicks, lost responses and retries use the same durable acceptance identity. If a matching receipt already exists, return it and current state even if the preview has since expired; never re-admit or reset lifecycle. Changed payload under the same identity is a conflict. A restart or ambiguous timeout resolves the original intent before offering a new attempt. Persist unresolved outcomes as `OUTCOME_UNKNOWN`; no automatic provider retry or invented new candidate ID is allowed.

Preview discard and acceptance must be serialized against the same preview revision. If discard wins, later acceptance cannot admit. If acceptance has committed, discard cannot erase the receipt or pretend nothing was imported. Until the result is resolved, the UI offers **Check outcome**, not a misleading discard confirmation.

## 7. Discard and browser behavior

Before acceptance begins, **Discard preview** invalidates that preview server-side, clears the displayed proposal and confirms **Preview discarded — this preview imported nothing** after the server confirms no acceptance. This statement does not deny another earlier import of the same candidate. Preserve a bounded discard event with time, run/preview identity and optional reason. This event is not PRETRADE History and has no trading authority.

During analysis, cancellation invalidates the run's ability to create a preview and discards late output; best-effort transport abort does not imply upstream billing cancellation. A recovered or background response cannot resurrect a discarded preview.

Every visible preview identifies its run and revision. Other tabs consume authoritative status and cannot independently approve a discarded/expired preview. Editing input invalidates the previous result; late work for older revisions is ignored. Reload restores only authoritative current status with original timestamps. Resuming a hidden or sleeping tab performs a freshness check before acceptance is enabled.

For today's existing local-only preview, clearing its JSON or reloading discards only browser state. If Import has already been clicked, those actions do not undo admission. The new button and durable cancellation behavior described here are proposed features.

## 8. Readiness and measurement

Before the session, check the intended build/revision, PRETRADE connection, read-only broker/account match, provider configuration, authenticated market-data availability, real-time entitlement, supported session/calendar, storage/recovery health and execution ownership. Authentication errors become an explicit repair task before accepting chart runs. Do not expose credentials in readiness output. Full regression runs belong outside the trading interaction.

Capture immutable UTC evidence times and monotonic elapsed durations. Measure upload initiation to receipt separately; measure source-data/capture age to visible preview as well as the 30-second receipt-to-visible target. A provider's completion time alone is insufficient. Browser acknowledgments are telemetry and cannot extend eligibility.

Record build SHA, model/resolved model, reasoning effort, prompt/schema/policy versions, run/preview hashes, stage timings, result, rejection reason and recovery outcome. Redact credentials/account details. Do not put raw charts or unrestricted model prose in routine logs. Preserve bounded durable evidence needed for replay and review.

The latency denominator is all supported, fresh-input attempts, including timeouts and failures. Report valid-preview yield, correct no-setup/blocked outcomes and failure rates separately; fast rejection of every input is not success. Predeclare a useful-result target of at least 95% for eligible, adjudicated inputs. Timeouts/errors count as failures. Report median, nearest-rank p95, maximum and capture age with cohort size and raw stage evidence. Do not aggregate different model/policy/build variants to hide a slow configuration.

## 9. Acceptance tests and rollout

| Gate | Required evidence |
|---|---|
| Freshness | Future timestamp, invalid clock, delayed/null real-time flag, quote/trade-time mismatch, receipt/source age, clock jump, repeated stale quote, unknown capture time, fresh upload of old screenshot |
| Bars/session | Forming/missing/out-of-order minutes, expected closed 2m/5m bars, DST, holidays, early close, wrong symbol/timeframe/session |
| Preview authority | Forged/expired token, changed payload/account/policy, immutable content hash, current canonical validation, unsupported timeframe |
| Concurrent actions | Edit during generation, discard vs accept, two tabs, replay, reconnect, browser sleep, server restart, accept response loss, commit before timeout |
| Market change | No-chase/target/stop boundary crossing while model runs or operator reads; quote expires during preflight; unknown structure never auto-confirmed |
| Provider | Strict schema/resource/source checks, one attempt per run, no extra candidates, no new authority, late response and ambiguous failure |
| Downstream | Existing identity/integrity, supersession, trigger, DSS, risk, quantity-safety, review, ARM, ownership and lifecycle regression gates remain green |
| Observability | All stages measured; timeout/failure included; returned current state distinguished from admission receipt |

1. Approve the contract amendments and proposed pilot limits. Resolve the displacement-policy choice before enabling admission.
2. Implement and run deterministic offline tests plus affected regression/build/browser suites. Keep the live admission feature disabled by default.
3. Run at least 30 shadow attempts for a fixed configuration across representative market conditions, with no candidate import or ARM. Use independent operator review to check material numeric extraction and setup interpretation, including no-setup inputs. Zero material extraction errors, stale eligibility or authority violations are required; failures pause advancement. Thirty runs are a pilot gate, not statistical proof of a production p95 or error rate. Fixes reset the relevant cohort.
4. After the pilot gates pass, enable one supervised import-only trial with a fresh proposal and resolved setup policy. Verify the receipt and PRETRADE state.
5. Conduct a separately supervised lifecycle trial, with actual trigger/evidence and deliberate ARM. Manual broker activity is the operator's responsibility. A no-trade/expired outcome is valid evidence; never force a trade to finish a test.

Production qualification requires broader recorded evidence after the pilot, an independent safety review and an explicit release decision. Automated full SOD and Performance Intelligence remain separate roadmap work.

## 10. Delivery slices and model use

| Slice | Deliverable | Effort recommendation |
|---|---|---|
| A | Repository audit and contract | Existing Astra work completed; ordinary follow-up audit/documentation uses Sol / medium |
| B | Clock/quote/bar fixes with regression coverage | Sol / high; focused Astra review only for shared safety-policy changes |
| C | Preview store, idempotency, admission and discard races | Bounded Astra / high design review; Sol / high implements the concrete handoff |
| D | Readable card, readiness and telemetry | Sol / medium; Luna / medium for mechanical copy, links and documentation |
| E | Provider profile integration and qualification | Sol / high; escalate specific unresolved authority or recovery questions to Astra / high |
| Review | Independent review of implemented safety boundaries | Sol / high first; Astra / high only for unresolved critical questions, higher effort only if demonstrated need warrants it |

These settings govern development tasks and reflect the operator's September 21 preference to conserve Astra usage. Start with the lowest-cost suitable model; escalate for a concrete safety question, failed verification or demonstrated reasoning gap. Do not repeat completed exploration or use maximum effort by default. No assumed “95% of Astra” equivalence or account-usage savings is claimed. Production inference model/effort remains an evaluation decision and must be logged for each cohort. The active parent task's model setting is controlled in the app; a recommendation does not change it. Any delegated review must receive explicit scope, no browser/runtime mutation permission, and a bounded result request.

## 11. Decisions to approve

- Adopt the compact intraday profile and its limited evidence/research scope inside the existing architecture.
- Adopt the initial equities/RTH/5m–2m scope and proposed timing/clock limits for shadow qualification.
- Keep discretionary structure confirmation and exact ARM separate from candidate acceptance.
- Adopt server preview/admission/discard semantics and the staged acceptance gates.

The setup-specific displacement bound remains a named implementation prerequisite, not an invented trading recommendation. Approval of this document is not a claim that its features already exist or authorization to place broker orders.

## 12. Independent draft review

A bounded independent Astra/high review read this contract and the repository audit. Six findings were incorporated: path-dependent invalidation, trusted research/profile selection and historical compatibility, immutable quote-refresh revisions, admission/receipt crash recovery, pane-versus-bar timestamp semantics, and separation of production deadline from review lifetime. This is document review evidence; implementation and release review remain pending.

The subsequent repository-grounded design pass produced the September 21 implementation handoff with a concrete single-store commit protocol, session boundary, immutable operation identity, recovery rules and test matrix. A bounded independent Sol/high review of the two freshness commits identified follow-up defects recorded there. This does not activate any draft trading-age rule or certify the live workflow.
