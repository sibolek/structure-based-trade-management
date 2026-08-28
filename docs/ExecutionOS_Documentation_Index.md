# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-08-27  
**Repository:** `sibolek/structure-based-trade-management`  
**Purpose:** Provide one definitive map of ExecutionOS documentation across the repository, dated validation records, and exported user-facing artifacts.

---

## 1. Authority and precedence

When documents disagree, use this precedence:

1. **Current code and validated broker behavior** define what the running system actually does.
2. **`USER-GUIDE.md`** is the living operator reference for how to use the current system.
3. **Current architecture/project specification** governs architecture and major decisions; dated status fields inside older versions remain historical snapshots.
4. **`docs/ExecutionOS_EOD_Report.md`** is the dedicated operational/technical reference for EOD reconstruction, enrichment, matching, risk/R interpretation, and report limitations.
5. **`research/30-day-management-study/methodology.md`** is authoritative for historical analytics provenance and reconstruction boundaries.
6. **`DOCUMENTATION-STATUS.md`** explains which records are current versus historical.
7. Dated work-session and validation reports are evidence snapshots, not evergreen specifications.
8. Older specifications, milestone notes, and planning reports are historical records and must not override later authoritative documentation.

Historical documents should not be rewritten merely because later evidence changed the project. They remain dated evidence of what was known and decided at the time.

---

## 2. Current authoritative repository documentation

| Document | Repository location | Role | Authority |
|---|---|---|---|
| `USER-GUIDE.md` | Repository root | Living operator guide: setup, session startup, risk sizing, candidate creation, ARMED/LIVE behavior, lifecycle use, persistence, troubleshooting, security, CLI commands, and complete enriched-EOD workflow | **Current authoritative operator guide** |
| `docs/ExecutionOS_EOD_Report.md` | `docs/` | EOD trade reconstruction, History export/enrichment, ownership matching, risk/R formulas, carry-in protection, metrics, output, and validation | **Current authoritative EOD reference** |
| `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` | `docs/` | Architecture, empirical rationale, validated V2.3 design, analytics-preservation closeout, Trade Contract model, Management Governor target architecture, safety model | **Authoritative dated architecture record; embedded repository-status fields are historical** |
| `research/30-day-management-study/methodology.md` | `research/30-day-management-study/` | Technical provenance for duration, stop-management, historical R, MFE/counterfactual work, unresolved 19-trade sample boundary, anti-curve-fitting policy | **Current authoritative analytics provenance** |
| `DOCUMENTATION-STATUS.md` | Repository root | Distinguishes current authoritative records from historical/superseded records | **Current documentation-governance record** |
| `README.md` | Repository root | Operational overview and project entry point | **Current overview; defer to User Guide/EOD reference/spec for detail** |
| `research/30-day-management-study/README.md` | Research folder | Research-folder orientation and reproduction entry point | **Supporting research documentation** |
| `research/30-day-management-study/expected-results.json` | Research folder | Preserved numerical fingerprint for historical-study validation | **Historical benchmark artifact; not source data** |

---

## 3. Current implementation and release baseline

### Frozen execution release

The immutable validated execution-release reference is:

```text
v2.3.0
```

Annotated tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

The tag remains the frozen V2.3 execution reference even though current `main` has advanced with a reporting-only addition.

### Current `main`

PR #7 added the read-only End-of-Day reporting workflow after the frozen release tag and merged into `main` at:

```text
bedd70979a3b18844386bcf8f927fd8a1f62307f
```

Current `main` therefore contains:

- the frozen/validated V2.3 execution behavior;
- analytics-preservation tooling and evidence;
- read-only Schwab bridge/state reconstruction;
- ExecutionOS browser History;
- read-only EOD reporting and History enrichment.

The EOD addition does not add broker-write authority or change the validated production trade-state engine.

V3 has **not** started.

### Functional release-validation provenance

The V2.3 functional release gate was executed on the development lineage before final documentation/merge commits. Later documentation-only commits and merge commits should not be misdescribed as having rerun that functional gate.

The final tagged V2.3.0 tree was separately reconciled and verified before tagging.

---

## 4. End-of-Day reporting documentation boundary

The EOD workflow uses two sources:

1. **Schwab history** — broker-authoritative fills, flat-to-flat reconstruction, gross realized P/L, and broker trade statistics.
2. **ExecutionOS browser History export** — Trade Contract, setup, planned risk, R, ownership, and process enrichment.

For an enriched report, the operator must keep Vite running, ensure completed trades are in ExecutionOS History, and download:

```text
http://localhost:5173/eod-export.html
```

before running:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

The full operator sequence is authoritative in `USER-GUIDE.md`. The technical/reporting semantics are authoritative in `docs/ExecutionOS_EOD_Report.md`.

---

## 5. Current Library / exported document copies

User-facing exports may exist outside the repository, including PDF/DOCX/Markdown copies of the Project Specification, User Guide, Documentation Index, validation reports, and work-session reports.

Repository Markdown should be treated as the maintainable source for repository-controlled living documentation unless a specific exported artifact is explicitly designated otherwise.

Older exported User Guide or Documentation Index copies may predate the EOD reporting addition and `v2.3.0` tag. They should not override current repository documentation.

---

## 6. Dated validation and work-session records

| Document | Date | Status | Purpose |
|---|---|---|---|
| `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf` | 2026-08-23 | **Historical snapshot** | Pre-live architecture, Sunday validation state, Monday live-test plan, latency criteria |
| `ExecutionOS_Work_Session_Report_2026-08-27` | 2026-08-27 | **Dated acceptance record** | Aug. 27 V2.3 edge testing, reversal defect/fix, regressions, deferred items |
| PR #7 description / validation record | 2026-08-27 | **Dated EOD acceptance record** | 19/19 analytics, 10/10 trade-state, build, real 8/27 EOD reconciliation, HTML validation |

Dated reports do not supersede the living User Guide or dedicated EOD reference for normative operation.

---

## 7. Historical / superseded project documents

| Document | Status | Use |
|---|---|---|
| `V2-MILESTONE-1.md` | **Historical** | Original V2 stateful-execution prototype design record |
| ExecutionOS Project Specification original 2026-08-26 edition | **Superseded** | Earlier project snapshot retained for provenance |
| ExecutionOS Project Specification v1.1 | **Superseded by v1.2** | Post-V2.3-validation decision history |
| ExecutionOS Project Specification v1.2 repository status | **Dated snapshot** | Architecture remains important; branch/PR/tag status reflects 26 Aug context |
| ExecutionOS Architecture, Validation & Monday Plan — 2026-08-23 | **Superseded as current guidance** | Retained as pre-live evidence |
| Earlier branch-local README/User Guide states | **Implementation-era snapshots** | Do not use instead of current `main` documentation |

Do not delete these simply because they are old. Their value is historical traceability.

---

## 8. Pull requests as project records

### PR #1 — V2.3 execution-system release merge

- Branch: `v2-execution-system`
- Base: `main`
- Status: **merged**
- Records the broker-aware V2.3 execution system.

### PR #2 — analytics preservation

- Status: **merged**
- Preserves analytics modules, methodology, historical reconstruction evidence, and the unresolved 19-trade provenance boundary.

### PR #3 — useful pre-V2 documentation preservation

- Status: **merged**
- Preserved execution-discipline Markdown without importing obsolete UI wiring.

### PR #4 — history-only reconciliation

- Status: **merged**
- Reconciled `main` history into the V2.3 lineage without changing the V2.3 tree.

### PR #5 — V2.3 release-documentation closeout

- Status: **merged**
- Closed pre-release living-document gaps.

### PR #6 — post-merge V2.3 documentation finalization

- Status: **merged**
- Finalized documentation after V2.3 reached `main`.

### PR #7 — read-only End-of-Day reporting

- Branch: `eod-report-v1`
- Base: `main`
- Status: **merged**
- Merge commit: `bedd70979a3b18844386bcf8f927fd8a1f62307f`
- Added Schwab flat-to-flat EOD reconstruction, browser-History enrichment, planned risk/R reporting, context protection, terminal/HTML output, and deterministic tests.
- Validated with 19/19 analytics tests, 10/10 trade-state tests, production build, real 27 Aug reconciliation, and HTML visual review.

---

## 9. Research evidence and reproducibility artifacts

The `research/30-day-management-study/` folder contains prose methodology plus deterministic analysis, diagnostics, tests, and benchmark artifacts.

Important classes include:

- `methodology.md` — authoritative research provenance;
- `expected-results.json` — preserved numerical fingerprint;
- study runners / reconstruction scripts;
- diagnostics for duration, initial-risk/R basis, stop provenance, minute alignment, fast-winner sampling, and market-data validation;
- local raw/normalized/enriched broker data and Schwab minute-history caches — intentionally Git-ignored and not documentation.

The project must preserve the distinction between:

- historical evidence;
- reconstruction methodology;
- reproducible code;
- local sensitive/raw data;
- current production semantics;
- current EOD reporting output.

---

## 10. What is not guaranteed to be preserved as a standalone document

Not every useful explanation from development chats is necessarily exported as a formal file.

Examples include:

- step-by-step terminal interpretation;
- debugging discussion;
- intermediate architecture reasoning;
- command-by-command acceptance guidance;
- explanations later summarized into formal documents.

If a chat decision becomes important enough to affect architecture, operation, safety, analytics provenance, reporting accuracy, or release status, promote it into the appropriate authoritative file rather than relying on chat memory.

---

## 11. Maintenance rules

Update this index when any of the following occurs:

- a new authoritative specification or User Guide version is created;
- the EOD reporting workflow materially changes;
- a historical document is superseded;
- an important validation/work-session record is produced;
- documentation moves between repository and exported/library surfaces;
- a major pull request is merged or materially repurposed;
- a release tag is created/replaced;
- a V3 branch is explicitly authorized and created;
- a new research study replaces or extends the preserved benchmark;
- a chat decision becomes important enough to require permanent documentation.

### Do not

- treat a dated planning report as current operating policy;
- overwrite historical records to make them agree with newer evidence;
- claim unresolved historical sample membership has been recovered;
- treat an EOD reconstructed P/L total as definitive whole-account P/L when context warnings exist;
- fabricate ExecutionOS ownership/planned risk/R for broker-only trades;
- commit credentials, tokens, private account identifiers, raw private broker history, or private ExecutionOS EOD exports;
- let an old PR description or branch README silently supersede the current User Guide / EOD reference.

---

## 12. Quick reference — where to look first

| Question | First source |
|---|---|
| How do I operate ExecutionOS today? | `USER-GUIDE.md` |
| How do I generate an accurate enriched EOD report? | `USER-GUIDE.md` Section 16 / after-session checklist |
| What exactly does the EOD reporter compute and what are its limitations? | `docs/ExecutionOS_EOD_Report.md` |
| What is the architecture / Governor direction? | Project Specification v1.2, interpreted as a dated architecture record |
| What does the historical analytics evidence actually support? | `research/30-day-management-study/methodology.md` |
| Which documents are current versus historical? | `DOCUMENTATION-STATUS.md` + this index |
| What code state is the frozen V2.3 execution release? | annotated tag `v2.3.0` |
| What code state is the current operational system? | current `main` |
| What remains unresolved in the 19-trade market study? | research methodology + Project Specification v1.2 |

---

## 13. Current project-documentation snapshot

As of **2026-08-27**:

- V2.3 execution behavior is release-validated and frozen under annotated tag `v2.3.0` at `baabb75f36050599f20e6c89e8db2f1f7d7769a1`.
- PRs #1–#6 completed the V2.3 execution, preservation, reconciliation, and release-documentation sequence.
- PR #7 added and merged the read-only EOD reporting workflow at `bedd70979a3b18844386bcf8f927fd8a1f62307f`.
- EOD reporting was validated with the expanded 19-test analytics suite, the 10-test trade-state suite, production build, real broker-history reconciliation, ExecutionOS History ownership enrichment, and HTML review.
- The User Guide now documents the required ExecutionOS History download before an enriched EOD report is generated.
- Project Specification v1.2 remains preserved as a dated architecture record; its embedded unmerged/untagged status is historical and should not be rewritten in place.
- V3 has not started.
- Exact same-poll cross-symbol execution remains deferred/non-blocking before future broker-write or automated simultaneous-entry capability.
- A true live cross-zero Schwab reversal was not obtained because thinkorswim rejected the attempted cross-zero action; deterministic engine behavior and the actual UI reversal transition path were validated without falsely claiming a live broker reversal.

---

**Maintenance principle:** If a future contributor cannot answer “what is authoritative, what is historical, how do I reproduce the evidence, and what data is required for an accurate EOD report?” from this file and the linked authoritative records, update the documentation before adding more architecture.
