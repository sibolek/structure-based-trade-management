# NinjaTrader market-data adapter — implementation and setup

Verified against public first-party documentation and unauthenticated discovery on **October 19, 2026**. This implementation is installed but **disabled by default**. Authenticated **Live MES market-data reads are now verified** after the user completed browser OAuth. Two consecutive real Live token renewals are now verified in separate processes. Full production acceptance, revocation handling and comparison with the native subscribed feed remain open. See the October 19 Live validation addendum.

## What was implemented

`NinjaTraderMarketDataProvider` implements the existing `MarketDataProvider` methods: `getQuote`, `getMinuteBars`, and `getDailyBars`. The optional factory routes only configured, exact futures contracts to it. All other symbols retain the existing Schwab implementation. A failure on a configured NinjaTrader contract never silently falls back to Schwab.

PRETRADE's data assembler receives the configured provider. Risk sizing and instrument-sizing permission quotes receive a separate guarded provider: NinjaTrader symbols throw `NINJATRADER_DATA_ONLY_PERMISSION_DISABLED`, which the existing risk service treats as unavailable quote evidence. Schwab symbols retain their existing path. No NinjaTrader account balance is read or combined with a Schwab account, and NinjaTrader quotes cannot authorize ARM through this integration. Existing Schwab auth, settings, risk rules, and order pathways were not changed.

The default market-data MCP client permits only `describe`, `search_contracts`, `market_snapshot`, and `market_history`. The separately requested `ninjascript:monitor` explicitly adds read-only account/position/fill observation; see `ExecutionOS_NinjaTrader_Monitor.md` for its narrow tool/resource allowlist and permissions. The same allowlist is enforced at the outgoing JSON-RPC boundary. Account, position, order, alert, risk-setting, subscription, and arbitrary resource tools remain excluded from the default market-data client. Tool annotations cannot expand this allowlist. Sampling and elicitation capabilities are not enabled.

## Official service and compatibility

The official service is **beta/pre-release**, rather than generally available. It is a hosted HTTPS service, not an NT8 local add-on. No NinjaTrader Desktop installation, running desktop instance, or minimum NT8 build is specified for this service. An MCP client needs Streamable HTTP and OAuth support. This implementation uses the official MCP TypeScript SDK, pinned to `1.32.1`, and is tested here with Node 24. No local NinjaScript, custom indicators, chart state, or experimental pulling/stacking v4 code is read or modified. The remote service does not establish access to desktop-only accounts or data. [Official overview](https://docs.ninjatrader.com/mcp), [connection requirements](https://docs.ninjatrader.com/mcp/connect).

| Environment | Fixed endpoint | Authorization server |
| --- | --- | --- |
| Demo | `https://mcp-demo.tradovateapi.com/mcp` | `https://demo.tradovateapi.com` |
| Live | `https://mcp-live.tradovateapi.com/mcp` | `https://live.tradovateapi.com` |

Endpoints are pinned in code; credentials cannot be redirected to another environment or origin. Live authorization metadata also returned HTTP 200 for both environments: the browser consent page is `https://web.ninjatrader.com/oauth?env=demo` (or `env=live`), separately from the API token/registration issuer; this browser-only exception is explicitly checked in code. Both protected-resource discovery endpoints returned HTTP 200 with matching resource, issuer, and `mcp:connect` scope. Unauthenticated Demo initialize, tool discovery, and describe requests returned HTTP 401. These results verify reachability and the auth boundary, not account eligibility or data entitlement. [Official server URLs](https://docs.ninjatrader.com/mcp/connect).

The service documents live quotes, historical Minute/Daily/Tick bars, contract search, and market-depth snapshots. This adapter uses quotes and one-minute/daily history only. These are request/response snapshots, not a tick-stream subscription. Current resource change notifications cover accounts, positions, and orders; there is no documented market-quote resource stream to use here. [Tool catalog](https://docs.ninjatrader.com/mcp/tools), [resources and subscriptions](https://docs.ninjatrader.com/mcp/resources).

## Authentication and permissions

OAuth 2.1 uses browser consent, PKCE, resource discovery, and an audience bound to the selected MCP URL. The connection scope is `mcp:connect`; fine-grained permissions are selected separately on the consent screen. Approve **Prices:Read** and **ContractLibrary:Read** only. Do not approve Trade (`Orders:FullAccess`), Manage Alerts, or Manage Risk Settings. This adapter does not need profile, accounting, position, or order read permission. The adapter cannot attest to the user's consent choices from `mcp:connect` alone; the local allowlist remains enforced even if broader permissions were previously granted. [Official authentication and access model](https://docs.ninjatrader.com/mcp/authentication).

Access tokens last approximately 80 minutes and refresh tokens approximately 26 hours. The client refreshes before the saved expiry, includes the MCP resource audience, and atomically saves rotated refresh tokens. Failed refresh retains the last saved credentials. Expired/revoked refresh authorization requires another browser sign-in. Browser authorization and subsequent authenticated Live data reads have succeeded. Refresh rotation is covered by local tests and two actual Live renewals in separate processes; revocation and sustained operation across the normal expiry boundary remain open. [Token lifecycle](https://docs.ninjatrader.com/mcp/authentication).

Auth state is stored separately from Schwab, in an explicitly supplied absolute directory with mode `0700`; environment-specific token files are `0600`. A process lock prevents concurrent token rotation. Do not share this directory with another client. Symlink token files/directories and group/world-readable files are refused. Tokens and vendor error bodies are not printed. Network calls permit only the selected official MCP origin and matching auth origin, reject redirects, and use bounded request timeouts.

## Setup: authorize and inspect before enabling

Run from the ExecutionOS checkout. Install the pinned dependencies with `npm ci --ignore-scripts`. Use a private auth directory outside source control, for example:

```sh
export EXECUTIONOS_NINJATRADER_ENV=demo
export EXECUTIONOS_NINJATRADER_AUTH_DIR="$PWD/.executionos-ninjatrader-auth"
npm run v24:ninjatrader -- auth
```

The command prints a sign-in URL and listens on **127.0.0.1:8791/callback** for up to three minutes. Open the URL in a desktop browser on the same machine, review read-only permissions, and approve. State and a single authorization code are required. The callback listener never binds publicly. This flow depends on the beta server supporting registration of this public OAuth client/loopback callback; if onboarding rejects registration, a server-approved registration is a blocker rather than a reason to substitute broker credentials. Live uses a separate explicit environment and token store file. No environment is switched automatically.

Inspect the permitted tool schemas and exact output formats:

```sh
npm run v24:ninjatrader -- discover
npm run v24:ninjatrader -- describe index
npm run v24:ninjatrader -- search MES
```

Then use the exact topic names returned by `describe index` to inspect snapshot/history field meanings, response shapes, units, bar timestamp anchors, limits, and daily session conventions. `describe TOPIC` accepts a selected topic. `snapshot CONTRACT` retrieves a market-only sample after exact contract resolution. For example, `snapshot MESZ6` is illustrative only; resolve the actual contract first. Discovery returns only the four allowlisted tools even if the server offers trading tools. This process never calls portfolio or order tools.

**A verified Live MES mapping is now supplied in `docs/ninjatrader-market-data.live-verified.json`.** It maps `/MESZ26` to the authenticated contract `MESZ6`, remains data-only, and does not activate itself. To use it in the same shell after authorization, set `EXECUTIONOS_NINJATRADER_CONFIG="$PWD/docs/ninjatrader-market-data.live-verified.json"`. The probe then runs with `npm run v24:ninjatrader -- probe /MESZ26`.

**Do not simply relabel the unverified example configuration as verified.** Public documentation lists key inputs but does not publish full snapshot/history output schemas; those must be inspected on the authenticated beta server. The synthetic test fixture is not vendor evidence. `symbols` is currently sent as an array and history uses documented key names `symbol`, `barType`, `barSize`, `from`, `to`, and `count`; actual discovered JSON schemas are validated before tool calls. An incompatible beta input schema fails closed and requires a reviewed adapter change.

Copy `docs/ninjatrader-market-data.example.json` to `.ninjatrader-config.json`. Replace all placeholder JSON Pointer paths using the authenticated outputs. Set `bindingStatus` to `VERIFIED_FROM_AUTHENTICATED_DISCOVERY` only after those checks. Supply exact instruments, for example the illustrative entry:

```json
{
  "/MESZ26": { "contract": "MESZ6", "exchangeTimeZone": "America/Chicago" }
}
```

ExecutionOS keys require a slash-prefixed full contract with month code and two-digit year. The external contract must match product, month, and year. Root-only aliases (`MES`), continuous contracts, automatic front-month selection, and silent rollover are unsupported. Review and update mappings explicitly at rollover. The response itself must echo the exact mapped contract. Quote bindings select an array containing exactly one matching record; history bindings select a contract field at the payload root and a bars array. Optional quote bindings `tick`, `tickAmount`, and `futureMultiplier` can map numeric contract specifications for the existing analysis interface; absent values remain null and are never inferred. Different vendor nesting is supported through explicit JSON Pointers; prose, ambiguous records, and other shapes fail closed. If the actual output cannot satisfy these contracts, extend the binding with a real sample and regression test before enabling.

Once bindings are verified, test without starting PRETRADE:

```sh
export EXECUTIONOS_NINJATRADER_CONFIG="$PWD/.ninjatrader-config.json"
npm run v24:ninjatrader -- probe /MESZ26
```

The probe reads one quote, the last hour of minute bars, and daily bars. It reports timestamps, entitlement/freshness evidence, bar counts, and `executionEnabled: false`. Its `liveIntegrationVerified` field stays false: a single successful request is not full acceptance. Outside active hours an old last quote can legitimately fail the live freshness check. Environment in the config must match the CLI environment. Stop the CLI before starting PRETRADE, since they share an exclusive auth-store lock.

When the monitor owns OAuth, also set `EXECUTIONOS_NINJATRADER_MONITOR_URL` to its loopback URL so PRETRADE uses the read-only market relay without a second auth-store owner. To opt in for the normal PRETRADE process, set the config/auth-directory variables in **that process's environment** and start it through its existing supported launch procedure. No `.env` files or persisted settings were edited. The service uses the config's environment; the CLI also requires its environment selector to match. Leave `EXECUTIONOS_NINJATRADER_CONFIG` unset to retain the original Schwab-only factory behavior. Rollback requires unsetting that one variable and restarting through the existing procedure; no account/order state is migrated.

## Time, sessions, integrity, and rate control

- Timestamps accept an explicitly configured numeric epoch-millisecond format or ISO text with `Z`/offset. Seconds, naive desktop-local times, date-only strings, numeric strings, nulls, and receipt-time substitution are rejected. Local receipt time is separate from provider quote time. Authenticated quote/history responses use `dataFeedMode`: only `RealTime` maps to true, `Delayed` maps to false, and missing/unknown values map to null. Legacy explicitly bound boolean fixtures remain supported. No truthy-string coercion is used.
- Minute timestamps can be explicitly bound to bar start or end; end timestamps are shifted back one minute. Daily timestamps are preserved. The verified API labels Daily bars at UTC midnight by trading date; `timestampAnchor: "trade-date"` records `sessionTradingDate` and `TRADING_DATE_LABEL`. DSS uses that label without converting it to the previous New York calendar day. Explicit session-start bindings remain supported. The adapter never infers daily dates from the macOS timezone. Provider sessions, daily anchors, and daylight-saving boundaries need authenticated acceptance checks.
- `extendedHours: true` retains overnight bars. `false` uses the existing ExecutionOS New York RTH calendar, including its holiday/unsupported-family fail-closed rules. This is ExecutionOS's analysis session, not a claim that futures close at the equity RTH boundary. Exchange timezone metadata is explicit; the user's Denver/UI timezone does not alter timestamps or sessions.
- Bars must have finite numeric OHLCV, valid ranges, nonnegative volume, unique aligned minute slots, matching contracts, and the requested bar type/size. Authenticated history splits volume into `upVolume`/`downVolume`; both nonnegative integer components are required and summed, without interpreting that sum as proof of trader intent. Gaps remain visible; missing bars are never manufactured. Count-limit saturation and oversized windows fail rather than returning silently truncated history. Requests use `from`/`to` without `count`, as the authenticated tool documents those modes as mutually exclusive. No pagination is invented. Smaller responses still require downstream continuity checks. Forming bars remain distinguishable by their start timestamp and the existing aggregation/time-closure checks.
- Daily `periodType` accepts day/month/year with positive integer `period`; its rolling request window uses 1/31/366 days respectively. Explicit `startDate`/`endDate` are also supported. This does not substitute local aggregation for provider session-defined daily bars.
- Vendor rate budgets are per tool; exact numeric ceilings are not publicly stated. Local tool calls serialize and are spaced at least one second per tool. HTTP 429 honors `Retry-After` with at least a 60-second cooldown and no automatic retry loop. Tool-level errors also impose a cooldown. These are local conservative controls, not a claim about vendor quotas. Authentication failures never fall back to another environment/source. [Official rate-limit description](https://docs.ninjatrader.com/mcp/tools).

## Validation and remaining acceptance

Locally verified: SDK JSON/SSE transport, initialization/session headers, paginated allowlisted discovery, input-schema validation, denied write/account RPCs, origin/environment boundaries, 429 cooldown, PKCE callback/state validation, private locked token storage, resource-bound refresh and rotation/failure preservation, exact instrument routing, quote evidence, OHLCV validation, timestamp conversion, RTH/DST/holiday behavior, unchanged Schwab defaults, and the data-only permission barrier. The suite includes synthetic fixtures and a static recorded first-party market-only fixture. Run `npm run v24:ninjatrader-test` for these checks.

Also run: existing market-data, Schwab read-only request, DSS assembly/live-probe, account-risk, instrument metadata, risk-sizing service, and process-lifecycle tests; `npm run build` verifies the app still builds. See the delivered validation record for exact results. Dependency versions already present in the lockfile were retained. The dependency audit reports existing application/tooling advisories; none name the newly added SDK or its new dependency entries. No unrelated upgrade/fix was applied.

Remaining acceptance uses the authenticated **hosted NinjaTrader service**, not a running NT8 instance:

1. OAuth issuance and authenticated Live market-data access succeeded. Confirm the granted permissions in authorized-app settings; the local allowlist remains independently enforced. Real refresh/revocation checks remain open.
2. Live snapshot/history schemas, MESZ6 mapping, RealTime entitlement, minute-start timestamps and daily trade-date labels were observed and mapped. Other instruments/environments, wider history limits, DST/holiday/rollover behavior and independent feed comparison still require acceptance. Unknown mappings stay disabled.
3. Comparison with the user's subscribed NinjaTrader feed during an active session: bid/ask/last and source times, minute OHLCV, historical daily bars, DST/overnight boundaries, rollover, and applicable holiday schedules.
4. Real disconnect, expired-token, revoked-access, and throttling behavior. No destructive call is needed or permitted for acceptance.

Authenticated Live MES quotes and minute/daily history reads succeeded. Account data was not requested. Trading authority and full production acceptance are not claimed. No orders or order modifications were enabled or sent. No v4 source files were touched.

## Precise failure handling

| Error | Meaning / next action |
| --- | --- |
| `NINJATRADER_OUTPUT_BINDING_REQUIRED` | No authenticated, reviewed response mapping. Keep disabled and inspect schemas. |
| `NINJATRADER_AUTHORIZATION_REQUIRED` | No saved NinjaTrader token. Run the auth command with beta access. |
| `NINJATRADER_REAUTHORIZE_REQUIRED...` | Refresh/consent is no longer usable. Saved credentials were preserved; explicitly reauthorize. |
| `NINJATRADER_CONNECT_FAILED_CHECK_AUTH_AND_BETA_ACCESS` | SDK/vendor connection failed; error body withheld. Verify beta access, consent, and connectivity. |
| `NINJATRADER_REQUIRED_TOOL_UNAVAILABLE` | Tool hidden/missing, usually permission or beta toolset mismatch. |
| `NINJATRADER_TOOL_INPUT_SCHEMA_MISMATCH` | Current beta input differs from adapter assumptions. Review discovery and update with a test. |
| `NINJATRADER_AUTH_STORE_NOT_WRITABLE` | The process cannot create the private lock file. Check local filesystem/sandbox permissions; this is distinct from another process owning the store. |
| `NINJATRADER_AUTH_STORE_LOCKED` | Another owner holds the private store. Stop that process through its normal lifecycle. After a crash, inspect the recorded PID and remove only a proven-dead lock; it is never automatically stolen. |
| `NINJATRADER_RATE_LIMIT_COOLDOWN` | Wait until the server/local cooldown has elapsed before another read. |
| `NINJATRADER_HISTORY_WINDOW_TOO_LARGE` / truncation | Request smaller windows or review actual history limits. |
| `NINJATRADER_DATA_ONLY_PERMISSION_DISABLED` | Intentional data-only boundary; NinjaTrader execution permission is outside this implementation. |



## Automatic token refresh recovery

The client now manages refresh as a non-interactive operation, separate from browser consent. It discovers and validates the selected issuer/resource/token endpoint, sends the documented JSON refresh body with the MCP resource audience and saved client ID, validates the token response, and atomically saves any rotated refresh token. If a response omits a replacement refresh token, the previous refresh token is retained. The SDK still handles MCP protocol/session framing, but cannot independently start consent or rotate credentials behind this owner; Bearer credentials are attached only to the pinned MCP endpoint.

Refresh begins five minutes before access expiry. Market-data 429 cooldowns do not block authentication discovery or refresh. Temporary network/5xx/malformed-response refresh failures retry with a minimum 15-second spacing, respecting refresh-endpoint Retry-After on 429. An unexpired access token can continue serving successful reads during a temporary refresh outage; once expired, the client marks reads unavailable until renewal succeeds. A token-specific rejection (`invalid_token`/`invalid_grant`, including error bodies returned with HTTP 200) is distinguished from a temporary outage, cached to avoid retry storms, and never overwrites credentials or opens consent automatically. A 401 during an established MCP read causes a serialized reconnect/refresh through the monitor owner. Store-write and configuration failures fail closed.

Verify token renewal immediately, without waiting for access expiry:

```sh
# Stop the running monitor with Ctrl+C first: only one process may own refresh tokens.
npm run ninjascript:monitor -- --refresh-check
```

This one-shot command forces one real refresh, persists rotated credentials privately, checks authenticated portfolio/fill tool availability, then exits without polling accounts or starting an API. It does not open a browser or change permissions. Reauthorization is appropriate only for missing/rejected refresh credentials or missing read grants; temporary refresh outages no longer print a blanket reauthorization instruction. Real renewal verification and the diagnosis of any server rejection are recorded separately in the refresh validation report.

Live follow-up: the installed refresh-check passed twice in separate processes, without browser authorization, and a subsequent Live monitor/relay smoke passed. The monitor and credential lock were released after validation. This confirms immediate renewal and persisted token reuse; the original rejected grant's cause remains unproven and a normal 75-minute scheduled renewal has not yet been observed.
