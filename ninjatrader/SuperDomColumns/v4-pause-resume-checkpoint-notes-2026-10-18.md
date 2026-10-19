# v4 pause/recheck publication checkpoint — October 18, 2026

Build **2026-10-16.5 EXP** follows committed compact-summary checkpoint `7673cc9` (16.3). This publication includes the intermediate 16.4 diagnostic guide/package and exact 16.3/16.4 rollback source text, the 16.5 complete source, current guide/reference, reproducible tests and fresh publication validation. Original and v3 scripts are byte-preserved. Unrelated untracked files are excluded.

Source SHA-256: `7a4e923094f1fdabdf1293027c268e847ed3399b6c372f6ab8b9a412892b1cf1`.

The quote gate still requires confirmed L2 bid < ask. The optional policy retains only already-qualified events as paused; rechecks current support before resumption; and preserves original identity, price, qualification time, metrics and display deadline. Candidates remain suppressed on quote interruption. The policy defaults to False; the guide instructs True for testing. Changing it rebuilds the detector context. No numerical threshold or rolling P/S arithmetic was changed.

Fresh publication validation on October 18: **443 scenarios passed; 0 failed**, all 15 groups. C# 5 with .NET 10 and API-shaped stubs, not native NinjaTrader assemblies. The enabled-versus-strict 1,500-callback numeric P/S trace and existing differential/oracle checks are included. Build-specific guide layout evidence is retained; links in the publication copies are checked separately. No new code changes were made during publication.

## Live evidence supplied after package creation

The user ran 16.5 in NinjaTrader and supplied a screenshot and an ES DEC26 log. Generation 2, event 10, Sell Initiative at 7691.25 qualified at NT-local 2026-10-16 13:43:31.248; paused at 13:43:31.672; resumed at 13:43:31.682; paused again at 13:43:32.646; and was suppressed at 13:43:32.656 with `Quote recovery evidence no longer qualifies`. At that recovery snapshot the only blocker was `DominanceBelowMinimum`: 435 sell-classified versus 193 buy-classified contracts (about 69.3%) versus the configured 70% minimum. Original qualification metrics remain separately frozen at 383 contracts / 73%.

Across the pasted 285.720-second interval there were 307 additional measured pauses; all recovered, with no new depth continuity failures, invalid depth, or flow resets. This supports one pause/resume/recheck example. Four absorption candidates did not qualify. It does not establish native compiler/WPF certification, installed-source hash identity, causation of the book transitions, performance, predictive accuracy or profitability. Keep settings stable and collect more qualified examples before tuning.

Candidate manifests and older source bundles preserve their historical creation-time status flags and validation limits. In particular, installed/committed/pushed=False describes creation, not current publication, and an old statement that no new live capture was reviewed predates the user evidence above. The current index, current publication-validation block, containing Git commit and remote branch supersede those historical publication-state fields.

No platform installation, automatic order submission, alert/audio change, threshold tuning, main-branch merge, or new independent Astra review was performed for this checkpoint. The recent audio investigation identified the user's prior Time & Sales Block alert sound=OrderPending as a likely source; no code edit resulted.
