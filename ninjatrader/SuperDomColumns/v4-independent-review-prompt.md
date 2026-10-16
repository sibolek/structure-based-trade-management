# Optional independent review — v4 build 2026-10-16.1 EXP

Review the complete source, current guide, source-scope verification, rollback fixture, reproducible test fixtures and checkpoint notes. This is a review prompt, not a completed review or authorization to install, change settings, submit orders, commit or push.

Focus on last-qualification snapshot identity, immutable qualification fields, terminal outcome updates, bounded memory, generation/reset handling, replay clock behavior, logging-off behavior, tooltip UI-thread access, display-space measurement, side/price clipping and serialized-settings compatibility. Check that historical markers cannot imply continuing active qualification. Verify calculation-core parity with the 2026-10-15.1 rollback source and independently reproduce any issue.

Also review the retained depth/execution reconciliation, confirmation and quote-gate rules. Distinguish operational detection from participant intent and predictive claims. A locked-quote suppression does not alone establish a false positive or exchange-book lock.

Report findings with exact lines and concrete reproduction. Local C# 5/API-shape tests do not establish proprietary NinjaTrader compilation or WPF rendering correctness. User runtime observations support only the specific behaviors documented in the checkpoint notes. No calibration/accuracy or independent review clearance is implied.
