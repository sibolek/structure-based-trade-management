# ExecutionOS V2.4 SOD Transport Timeout Correction

Status: implemented, offline-verified, uncommitted. Gate V was not run.

The proof run `7572354f-8aec-4da1-9e3e-97503f228f8d` recorded an Undici
`UND_ERR_HEADERS_TIMEOUT` at 302.271 seconds while the application budget was
600 seconds. Its three journal files remain byte-for-byte unchanged.

## Scoped implementation

The runtime dependency is pinned to `undici: 7.24.4` in `package.json` and
`package-lock.json`. `createOpenAiResponsesFetchClient` creates one private
Undici `Agent` per client instance:

```js
new Agent({ headersTimeout: T + 30_000, bodyTimeout: T + 30_000 })
```

The same dispatcher is reused for every request from that client and is passed
only as the individual Node `fetch` call's `dispatcher` option. No global
dispatcher was changed, and no other ExecutionOS HTTP client was changed.

`deriveSodTransportTimeoutMs(T)` accepts the existing validated application
range of 1 through 600,000 ms, checks safe integer arithmetic, and returns
`T + 30,000`. The existing application `AbortController` still fires at
exactly `T`; transport timeouts are only the lower-layer safety fallback.

## Cleanup ownership

The client exposes idempotent asynchronous `close()`. It first awaits
`Agent.close()` and, after the fixed five-second shutdown allowance or a close
failure, calls `Agent.destroy()`. A closed client rejects new requests with
`SOD_OPENAI_DISPATCHER_CLOSED`. The analysis provider and production provider
delegate close to this client.

The opt-in acceptance CLI now establishes provider ownership before store
initialization and closes the provider before closing the run store in its
`finally` path. This covers store/chart initialization failures after provider
construction without adding process signal handlers or redesigning the
orchestrator service lifecycle.

The constructor's dispatcher, shutdown-allowance, and abort-controller seams
are offline-test dependency injection only; production defaults are fixed and
are not environment configuration knobs.

## Validation

- focused SOD provider and acceptance tests: **35 pass**;
- SOD orchestrator aggregate: **219 pass**;
- provider hardening: **69 pass**;
- run-integrity: **39 pass**;
- candidate-feed regression: **49 pass**;
- manual-ingestion regression: **69 pass**;
- execution-ownership regression: **25 pass**;
- full Node regression: **1,157 pass**;
- browser suite: **28 pass**;
- production build: **PASS** (`1,626` modules transformed);
- `git diff --check`: **PASS**.

The tests exercise a real local Node `fetch` with the dedicated Agent and
deterministic scaled fixtures for application-abort precedence, header/body
fallbacks, continuous response data, Agent reuse, idempotent close, forced
destroy, redaction, and acceptance initialization cleanup. Existing retry,
ambiguity, provenance, candidate, PRETRADE, publication, renderer, and
authority behavior remains covered by the regression suites.

No OpenAI request was made, no live SOD service was restarted, and no transport
policy other than the SOD client's two derived Undici timeouts changed. The
proof run journal hashes remain:

```text
00000001.json  3ef1ab52267cb6f993c96b947db11c7e2fc76f5c4683d4235ee00f4e9fbdec2c
00000002.json  ed7f3b10790766cd21d9a6461a71430d08f9068759ba13a20fb2cec7a12643b1
00000003.json  337d56da3f1577cbaac3e61b2c27711bc63b7c48e911fe10dde2544d568ec888
```

Acceptance Matrix A–U is **PASS** on this offline evidence. Gate V remains
unrun pending review.
