# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-08-27  
**Repository:** `sibolek/structure-based-trade-management`  
**Purpose:** Provide one definitive map of ExecutionOS documentation across the GitHub repository, the ChatGPT Library, and dated work-session artifacts.

---

## 1. Authority and precedence

When documents disagree, use this precedence:

1. **Current code and validated broker behavior** define what the running system actually does.
2. **ExecutionOS User Guide** is the living operator reference for how to use the current system.
3. **ExecutionOS Management Governor Project Specification v1.2** is the current architecture / project decision record.
4. **Research methodology** is authoritative for historical analytics provenance and reconstruction boundaries.
5. **Documentation Status** explains which records are current versus historical.
6. **Dated work-session and validation reports** are evidence snapshots, not evergreen specifications.
7. **Older specifications, milestone notes, and planning reports** are historical records and must not override later authoritative documentation.

Historical documents should not be rewritten merely because later evidence changed the project. They remain dated evidence of what was known and decided at the time.

---

## 2. Current authoritative repository documentation

| Document | Repository location | Branch / source | Role | Authority |
|---|---|---|---|---|
| `USER-GUIDE.md` | Repository root | `analytics-preservation-v23` | Living operator guide: setup, session startup, Schwab authorization, risk sizing, candidate creation, ARMED/LIVE behavior, lifecycle use, persistence, troubleshooting, security, CLI commands | **Current authoritative operator guide** |
| `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` | `docs/` | `analytics-preservation-v23` | Architecture, empirical rationale, validated V2.3 baseline, analytics-preservation closeout, Trade Contract model, Management Governor target architecture, safety model, V3 sequencing | **Current authoritative project specification** |
| `research/30-day-management-study/methodology.md` | `research/30-day-management-study/` | `analytics-preservation-v23` | Technical provenance for duration, stop-management, historical R, MFE/counterfactual work, unresolved 19-trade sample boundary, anti-curve-fitting policy | **Current authoritative analytics provenance** |
| `DOCUMENTATION-STATUS.md` | Repository root | `analytics-preservation-v23` | Distinguishes current authoritative records from historical/superseded records | **Current documentation-governance record** |
| `README.md` | Repository root | `analytics-preservation-v23` | Operational overview and project entry point | **Current overview; defer to User Guide / v1.2 spec for detail** |
| `research/30-day-management-study/README.md` | Research folder | `analytics-preservation-v23` | Research-folder orientation and reproduction entry point | **Supporting research documentation** |
| `research/30-day-management-study/expected-results.json` | Research folder | `analytics-preservation-v23` | Preserved numerical fingerprint for historical-study validation | **Historical benchmark artifact; not source data** |

### Current implementation baseline

The active V2.3 product branch is `v2-execution-system`. On 2026-08-27 it was advanced to commit:

`74a7bde8eb76cbcbb2f35f6bbf0a0c8da52f52e1` — **Handle broker reversals without false flat state**

That commit followed live and deterministic acceptance work for ENTRY, ADD, PARTIAL, FLAT, SHORT, concurrent candidate ownership, fragmented fills, and reversal semantics.

The Project Specification v1.2 remains the current architecture record, but its embedded V2.3 SHA/status snapshot predates this final reversal-hardening commit. Treat the specification's SHA as a dated snapshot, not as the current branch head.

---

## 3. Current Library exports

These are user-facing exports of the authoritative project material stored in the ChatGPT Library.

| Document | Library format(s) | Library location / status | Relationship to repository |
|---|---|---|---|
| ExecutionOS Project Specification v1.2 — 2026-08-26 | DOCX, PDF | `/ExecutionOS Framework/` | Export of current authoritative specification |
| ExecutionOS User Guide v1.0 — 2026-08-27 | PDF | `/ExecutionOS Framework/` | Export of living User Guide |
| `ExecutionOS_User_Guide.md` | Markdown | `/ExecutionOS Framework/` | Library copy of living guide |
| ExecutionOS Documentation Index | Markdown | `/ExecutionOS Framework/` | Cross-surface inventory; repository copy lives in `docs/` |

The repository Markdown should be treated as the maintainable source for repository-controlled documentation. PDF/DOCX versions are convenience exports unless explicitly designated otherwise.

---

## 4. Dated validation and work-session records

| Document | Date | Format(s) | Status | Purpose |
|---|---|---|---|---|
| `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf` | 2026-08-23 | PDF | **Historical snapshot** | Pre-live architecture, Sunday validation state, Monday live-test plan, latency acceptance criteria |
| `ExecutionOS_Work_Session_Report_2026-08-27` | 2026-08-27 | DOCX, PDF, HTML | **Current dated acceptance record** | Records the Aug. 27 V2.3 edge testing, reversal defect/fix, regression results, commit/push checkpoint, and deferred items |

The Aug. 27 work-session report is evidence of what was tested and changed that day. It does not supersede the User Guide or Project Specification for normative behavior.

---

## 5. Historical / superseded project documents

| Document | Status | Use |
|---|---|---|
| `V2-MILESTONE-1.md` | **Historical** | Original V2 stateful-execution prototype design record; predates broker-aware V2.3 |
| ExecutionOS Project Specification — original 2026-08-26 edition | **Superseded** | Earlier project snapshot retained for provenance |
| ExecutionOS Project Specification v1.1 — 2026-08-26 | **Superseded by v1.2** | Valuable post-V2.3-validation rebaseline and decision history |
| ExecutionOS Architecture, Validation & Monday Plan — 2026-08-23 | **Superseded as current guidance** | Retained as dated pre-live evidence |
| Earlier README / branch-local documentation on `v2-execution-system` | **Implementation-era snapshot** | Do not use instead of the documentation-preservation branch's current User Guide / README |

Do not delete these simply because they are old. Their value is historical traceability.

---

## 6. Pull requests as project records

### PR #1 — V2 execution-system development

- Branch: `v2-execution-system`
- Base: `main`
- Status as of 2026-08-27: **open, draft, unmerged**
- Current head after reversal hardening: `74a7bde8eb76cbcbb2f35f6bbf0a0c8da52f52e1`
- Its description still reflects older V2.1 framing and is therefore **not the current documentation authority**.
- Do not merge, retarget, or rewrite release history without explicit approval and deliberate main reconciliation.

### PR #2 — analytics preservation

- Branch: `analytics-preservation-v23`
- Base: `v2-execution-system`
- Status as of 2026-08-27: **open, draft, unmerged**
- Preserves analytics modules, research methodology, historical reconstruction evidence, documentation updates, and the unresolved 19-trade provenance boundary.
- Its conversation and diff are valuable research provenance, but normative system guidance belongs in the User Guide and Project Specification.

---

## 7. Research evidence and reproducibility artifacts

The `research/30-day-management-study/` folder contains more than prose documentation. It also contains deterministic analysis, diagnostics, tests, and benchmark artifacts.

Important classes include:

- `methodology.md` — authoritative research provenance.
- `expected-results.json` — preserved historical numerical fingerprint.
- `run-study.mjs` and related analytics scripts — reproduction / validation tooling.
- diagnostic scripts for duration, initial-risk/R basis, minute-bar alignment, NVDA stop provenance, fast-winner sampling, and market-data validation.
- local raw/normalized/enriched broker data and Schwab minute-history caches — intentionally **Git-ignored and not documentation**.

The project must preserve the distinction between:
- historical evidence,
- reconstruction methodology,
- reproducible code,
- local sensitive/raw data,
- and current production semantics.

---

## 8. Library-only / conversation-produced artifacts

The ChatGPT Library contains generated files that may not exist in the repository.

Known ExecutionOS project artifacts include:

- `ExecutionOS_Project_Specification_2026-08-26.pdf`
- `ExecutionOS_Project_Specification_2026-08-26.docx`
- duplicate historical PDF copy of the original specification
- `ExecutionOS_Project_Specification_v1.1_2026-08-26.pdf`
- `ExecutionOS_Project_Specification_v1.2_2026-08-26.docx`
- `ExecutionOS_Project_Specification_v1.2_2026-08-26.pdf`
- `ExecutionOS_User_Guide.md`
- `ExecutionOS_User_Guide_v1.0_2026-08-27.pdf`
- `ExecutionOS_Architecture_Validation_and_Monday_Plan_2026-08-23.pdf`
- `ExecutionOS_Work_Session_Report_2026-08-27.docx`
- `ExecutionOS_Work_Session_Report_2026-08-27.pdf`
- `ExecutionOS_Work_Session_Report_2026-08-27.html`

There are also pasted source texts, screenshots, terminal captures, account-statement inputs, and other working evidence. Those are **supporting source material**, not authoritative project documentation unless incorporated into one of the records above.

---

## 9. What is not guaranteed to be preserved as a standalone document

Not every useful explanation from the original long chat or the current chat was necessarily exported as a file.

Examples may include:
- step-by-step terminal interpretation,
- debugging discussion,
- intermediate architecture reasoning,
- command-by-command acceptance guidance,
- explanations that were later summarized into formal documents.

For project continuity, prefer the formal documents and repository history above. If a past chat discussion becomes important enough to affect architecture, operation, safety, analytics provenance, or release status, promote that decision into the appropriate authoritative file rather than relying on chat memory.

---

## 10. Documentation consistency resolution

On 2026-08-27, the living User Guide and README were aligned with the actual V2.3 preparation/execution sequence:

`READ -> PLAN -> RISK -> ARM -> TRIGGER -> HOLD -> UPDATE -> EXIT -> REVIEW`

This matches the Project Specification model: risk permission is established before the Trade Contract is armed; the live broker trigger occurs only after preparation is complete.

---

## 11. Maintenance rules

Update this index when any of the following occurs:

- a new authoritative specification or User Guide version is created;
- a historical document is superseded;
- an important work-session / validation report is produced;
- documentation moves between Library and repository;
- PR #1 or PR #2 is merged, closed, or materially repurposed;
- V2.3 is reconciled / tagged;
- a V3 branch is explicitly authorized and created;
- a new research study replaces or extends the preserved historical benchmark;
- an inline chat decision becomes important enough to require permanent project documentation.

### Do not

- treat a dated planning report as current operating policy;
- overwrite historical records to make them agree with newer evidence;
- claim unresolved historical sample membership has been recovered;
- commit raw broker credentials, tokens, account identifiers, or sensitive local research caches;
- allow PR descriptions or old branch READMEs to silently supersede the current User Guide / Project Specification.

---

## 12. Quick-reference: where to look first

| Question | First source |
|---|---|
| How do I operate ExecutionOS today? | `USER-GUIDE.md` |
| What is the current architecture / roadmap / safety boundary? | Project Specification v1.2 |
| What does the historical analytics evidence actually support? | `research/30-day-management-study/methodology.md` |
| Which documents are current versus historical? | `DOCUMENTATION-STATUS.md` + this index |
| What happened in the Aug. 27 final V2.3 edge-hardening session? | `ExecutionOS_Work_Session_Report_2026-08-27` |
| What did we know before the first live Schwab test? | Aug. 23 Architecture / Validation / Monday Plan |
| What code state is the current V2.3 product branch on? | `v2-execution-system` Git history / current branch head |
| What remains unresolved in the 19-trade market study? | Research methodology + Project Specification v1.2 |

---

## 13. Current project-documentation snapshot

As of **2026-08-27**:

- V2.3 product hardening is preserved on `v2-execution-system`.
- The reversal UI fix is committed and pushed at `74a7bde`.
- The analytics-preservation work remains on `analytics-preservation-v23`.
- PR #1 and PR #2 remain open, draft, and unmerged.
- The User Guide, Project Specification v1.2, research methodology, Documentation Status, dated validation report, and Aug. 27 work-session report together provide sufficient formal documentation to continue the project without relying on reconstructed conversational memory.
- Exact same-poll cross-symbol execution remains deferred/non-blocking for the current manual/read-only V2.3 scope and should be revisited before broker-write or automated simultaneous-entry capability.
- A true live cross-zero Schwab reversal was not obtained because the broker platform rejected the attempted reverse action; deterministic engine behavior and the actual UI transition path were validated without falsely claiming a live broker reversal.

---

**Maintenance principle:** If a future contributor cannot answer “what is authoritative, what is historical, and where is the evidence?” from this file, update the index before adding more architecture.
