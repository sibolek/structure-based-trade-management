# ExecutionOS Manual SOD / Ad-Hoc Local PAQ

**Date:** 2026-09-24

**Checkpoint under test:** `0ee5b27 feat(v2.4): unify manual SOD and ad-hoc intake`

**Decision:** **LOCAL MANUAL INTAKE QUALIFIED; PRODUCTION ADMISSION NOT CLEARED**

## Scope

This qualification covers the local, no-provider workflow that reads completed SOD and ad-hoc candidate packages for one explicit trading date, lets the operator select candidates, and submits only that selection to canonical PRETRADE admission.

It does not qualify automated report generation, OpenAI/provider integration, Schwab authentication, broker connectivity, production deployment, or the normal PRETRADE state files.

## Isolation

- UI: `127.0.0.1:4175`
- Disposable PRETRADE service: `127.0.0.1:18788`
- Restored-copy PRETRADE service: `127.0.0.1:18789`
- Manual package root and every durable state/repository path were under `/tmp/executionos-manual-paq.GSC4H1/`.
- The ordinary PRETRADE store was not read or written.
- No provider/OpenAI call, Schwab call, handoff, execution action, or broker write occurred.
- Health reported `readOnlyBrokerBoundary: true`, `brokerWriteAuthority: false`, and provider preview disabled.

## Acceptance exercise

The disposable `2026-09-24` date contained:

- one completed SOD candidate: `paq-sod-MSFT-2026-09-24`;
- one completed ad-hoc candidate: `paq-adhoc-NVDA-2026-09-24`;
- validity from `2026-09-24T00:00:00.000Z` through `2026-09-26T00:00:00.000Z`.

Observed through the real ExecutionOS UI and local API:

1. **Load is read-only.** Both candidates appeared with correct `SOD` / `AD-HOC` provenance. Both checkboxes began unchecked, the import count was zero, and PRETRADE still contained zero candidates.
2. **Selection is exact.** Only NVDA was selected. Import admitted exactly NVDA as `ACCEPTED / WAITING`. MSFT remained absent.
3. **Current state is distinguishable from the receipt.** The UI separately displayed `Receipt lifecycle: WAITING` and `Current PRETRADE lifecycle: WAITING`.
4. **No downstream authority was created.** The candidate had `armAuthorized: false`, `arm: null`, and no activation, permission, handoff, execution, or OCO state. Reviews, permission attempts, ARM operations, and OCO groups all remained empty. Provider previews/runs/messages and supersession authority collections remained empty.
5. **Retry is idempotent.** After restart, re-import returned `DUPLICATE` and the canonical candidate remained `WAITING`. Two concurrent identical submissions both returned `DUPLICATE`. Changed content under the same candidate identity/version returned `CONFLICT` and did not replace the canonical thesis.
6. **Backup/restore preserves the record.** A copy of the durable state and generation evidence loaded successfully on the isolated restored-copy service. It contained the same one `WAITING` candidate with no ARM authority.
7. **Local read boundary fails closed.** After the PAQ correction, a raw request with `Host: example.com` returned `403 HOST_NOT_ALLOWED`; a foreign Origin returned `403 ORIGIN_NOT_ALLOWED`; POST returned `405 METHOD_NOT_ALLOWED`.
8. **Publication and substitution regressions remain closed.** Completed candidates remain readable during private ad-hoc staging or incomplete SOD publication. Staging links/files, selected-date substitution, package-summary substitution, duplicate identities, manifest disagreement, and source-date mismatch fail closed.

## Automated evidence

- Focused manual-directory/import suite: **21/21 passed**.
- Manual candidate browser suite: **23/23 passed**.
- Full Node regression suite: **1,261/1,261 passed**.
- Production build: **passed**.
- `git diff --check`: **passed**.

## PAQ correction

The first boundary probe showed that the read-only directory endpoint accepted a foreign Host header. The endpoint was corrected to require a loopback Host, and a raw-HTTP regression now proves foreign Host rejection. The correction changes no candidate, lifecycle, ARM, execution, provider, or broker behavior.

## Open operational finding

Stopping the disposable PRETRADE process through the supervised PTY left its single-writer lock behind. Restart failed closed with `PRETRADE_WRITER_LOCKED`; the recorded PID was no longer running. Removing only that verified disposable stale lock allowed the persisted candidate to reload correctly.

This is not an authority escalation or candidate-integrity failure, but it keeps the **supervised lifecycle / restart operating procedure** gate open. Before production admission, qualify a supported graceful shutdown path and an explicit, auditable stale-lock recovery procedure (or implement equivalent safe lifecycle handling). Do not weaken the single-writer fence.

## Admission statement

The local manual SOD/ad-hoc intake is qualified for checkpointing and continued non-production use. Production admission remains disabled pending the broader authentication, policy, deployed-storage, latency, and supervised-lifecycle gates. The earlier provider-oriented PAQ documents do not describe this workflow and remain outside this qualification.
