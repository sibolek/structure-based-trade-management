# NinjaTrader account, position, working-order and fill monitor

`npm run ninjascript:monitor` is the requested counterpart to `schwab:monitor`. `npm run ninjatrader:monitor` is an alias. This is a Node command using NinjaTrader's hosted MCP service; it does not install a C# NinjaScript or change the experimental v4 indicator.

It reads accessible accounts, bootstraps current positions, baselines existing fills, prints newly observed fills once, and refreshes account/position/working-order snapshots. Working orders include broker-reported stop and limit orders, with order ID, side, quantity, type, status, stop/limit price and duration; changes appear in the next successful snapshot and in `/api/state.workingOrders`. Broker snapshots determine position state; fills are not replayed on top of a snapshot, which avoids double counting. The default poll interval is five seconds. After startup, console output is change-only: each account, position and working-order block prints only when its displayed values change. Observation timestamps and row ordering do not trigger logs; no periodic heartbeat is printed. New fills still print once. Removed rows are explicitly reported as no longer reported, without inferring why an order disappeared. Identical repeated errors stay quiet until the error changes or the monitor recovers. Status/staleness and order-coverage changes remain visible. API timestamps and polling continue unchanged. Account labels are masked in console/API output; raw vendor error bodies and credentials are not logged.

## Console format

Console output follows `schwab:monitor`: a startup banner, check-mark setup messages, and labeled blocks separated by dashed rules. Account equity and P&L display as currency with two decimals. Order/position/fill prices retain their source numeric precision. A plain Stop has no limit price, displayed as “Not applicable”; absent prices on types that use a limit remain “—”.

New fills use a `NEW NINJATRADER EXECUTION` block with account, environment, symbol, instruction, quantity, price, order/fill IDs, NinjaTrader fill time, detection time, and observed delay. Times include milliseconds and an explicit time-zone abbreviation; the default remains America/Denver. Delay is the local detection timestamp minus the source fill timestamp, and negative values are labeled clock skew.

The format does not add the Schwab-specific ARMED label, continuous-coverage claims, risk budget calculations, or inferred state transitions. NinjaTrader remains OBSERVING with the same read-only API, polling, change-only logging and permissions. New/changed blocks and removals print once; no heartbeat is added. Values rounded for currency presentation remain full precision in the API, and sub-cent changes that leave the rendered currency unchanged stay quiet.

## Run

Use the ExecutionOS checkout:

```sh
cd /Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider
export EXECUTIONOS_NINJATRADER_ENV=live
export EXECUTIONOS_NINJATRADER_AUTH_DIR="$PWD/.executionos-ninjatrader-auth"
npm run ninjascript:monitor
```

Demo is the default if no environment is specified. Live and Demo have separate credentials, accounts, and identifiers. Press Ctrl+C to stop; SIGTERM/SIGHUP also release the API, SDK connection and private OAuth lock. No daemon, recurring task, launch agent or production service is installed.

Useful one-shot checks:

```sh
npm run ninjascript:monitor -- --check
npm run ninjascript:monitor -- --once
```

`--check` checks the portfolio/fill tool catalog without reading account values. `--once` performs an account/position/fill baseline, prints a masked summary and exits; it opens no local API. Existing fills at startup are suppressed as historical observations. Restarting creates a new baseline rather than replaying fills as new.

## Permissions

The default market-data adapter still permits only its original four market/documentation tools. This monitor explicitly enables only **my_portfolio**, **fill_history**, and the fixed read-only resources **tradovate://account-list** and **tradovate://positions**, in addition to the existing market tools. Place/modify/cancel/close, risk changes, alerts, arbitrary resources and arbitrary RPC remain denied at the client and network boundaries.

The monitor needs **Accounting:Read**, **Positions:Read**, and **Orders:Read**. The optional market-data relay also uses **Prices:Read** and **ContractLibrary:Read**. These are read permissions; Orders:Read is required by the portfolio/fill tools and does not permit orders to be changed.

The user's currently authorized Live connection passed these reads during validation. If another account/environment lacks access, stop the monitor and run:

```sh
npm run ninjascript:auth
```

In browser consent, select View Account, View Positions, View Orders, Market Data and View Contracts. Keep Trade, Manage Risk and Manage Alerts off. Existing `v24:ninjatrader -- auth` remains the market-only setup flow. The monitor never automatically adds consent permissions or asks for a password. Token refresh uses the same private resource-bound OAuth store and atomic rotation as the adapter. Only one process owns that store at a time.

## Local API and concurrent ExecutionOS market-data use

The default listener is **127.0.0.1:8789**, separate from Schwab's 8787 and PRETRADE's 8788:

| GET endpoint | Purpose |
| --- | --- |
| `/health` | Status, environment, last successful read and staleness; HTTP 503 when stale/degraded |
| `/api/state` | Masked accounts, positions, working orders, recent newly observed fills, baseline/status metadata |
| `/api/market-data/quote?symbol=%2FMESZ26` | Quote through the verified exact-contract provider |
| `/api/market-data/minute?symbol=%2FMESZ26&startDate=...&endDate=...` | Minute bars; ISO timestamps and optional extendedHours=true/false |
| `/api/market-data/daily?symbol=%2FMESZ26` | Daily bars; optional periodType/period or explicit dates |

All writes are rejected. Host headers are checked against the bound loopback address; browser origins are restricted to the local listener or an explicitly configured local UI origin. There is no wildcard CORS. The API returns only normalized allowlisted fields, not raw account names, tokens, login information, or complete vendor payloads. Local OS processes can read the loopback API, like the existing monitor's local API; do not expose it through a tunnel or bind it publicly.

The monitor is the single OAuth owner. To let PRETRADE read NinjaTrader market data while the monitor is running, set these in the terminal that will start PRETRADE through its existing procedure:

```sh
export EXECUTIONOS_NINJATRADER_CONFIG="$PWD/docs/ninjatrader-market-data.live-verified.json"
export EXECUTIONOS_NINJATRADER_MONITOR_URL="http://127.0.0.1:8789"
```

That routes mapped NinjaTrader symbols through the monitor's read-only relay instead of opening a second credential owner. Environment, exact contract and configuration fingerprint must match; there is no fallback to another environment or broker after a relay failure. Original quote source/receipt times survive the relay. Schwab symbols keep their existing provider. NinjaTrader quotes remain blocked from risk/ARM permission. No ordinary ExecutionOS process was restarted and no saved settings were changed during implementation.

When the relay URL is unset, the adapter retains its prior direct-connection behavior and exclusive auth-store lock. Do not run the direct adapter and monitor against the same private store simultaneously. CLI auth/discovery/probe commands also require that store, so stop the monitor before using them, or read market data through the relay.

Live mode defaults its relay to the verified MES mapping if no market config path is provided. Demo can run account observation without a market relay until a Demo mapping is supplied. Accounts/positions/fills do not depend on the MES mapping; each reported contract retains its exact vendor symbol, with no inferred front month or rollover.

## Configuration

| Environment variable | Default / meaning |
| --- | --- |
| EXECUTIONOS_NINJATRADER_ENV | demo; explicitly select live to use the existing Live authorization |
| EXECUTIONOS_NINJATRADER_AUTH_DIR | Private auth directory in this checkout; existing explicit override preserved |
| EXECUTIONOS_NINJATRADER_POLL_MS | 5000; valid range 2000–60000, no overlapping cycles |
| EXECUTIONOS_NINJATRADER_MONITOR_PORT | 8789; independent of Schwab/PRETRADE settings |
| EXECUTIONOS_NINJATRADER_TIME_ZONE | America/Denver; console display only, source fill timestamps stay ISO UTC |
| EXECUTIONOS_NINJATRADER_MONITOR_ACCOUNTS | Optional comma-separated exact account names or opaque IDs; otherwise all accessible active accounts, maximum ten |
| EXECUTIONOS_NINJATRADER_MONITOR_ORIGIN | Optional exact local UI origin, e.g. http://localhost:5173; no value permits cross-origin browser access by default |
| EXECUTIONOS_NINJATRADER_CONFIG | Optional verified market mapping; Live defaults to the supplied MES profile |
| EXECUTIONOS_NINJATRADER_MONITOR_URL | Set only on consumers to use the running monitor's loopback market-data relay |

If there are more than ten accounts, explicitly select a smaller set. Selection is checked against the server's accessible account list. Account discovery occurs at startup; restart deliberately to include newly added accounts.

## Observation integrity and limits

- Working orders are requested through the existing `my_portfolio` call (`workingOrders[]`), with no extra requests or write permissions. An explicit empty array proves only that this broker snapshot reported no working orders. An omitted branch is marked `accounts[].workingOrdersStatus=UNAVAILABLE`; previous orders are retained with `stale=true` and their original observation time. It never means zero orders or confirmed cancellation. An explicit array sets CURRENT and `workingOrdersObservedAt`. Overall `stale=false` applies to successful polling; check the separate order status/row staleness as well. Invalid order payloads fail the full cycle.
- These are sampled snapshots, not an order lifecycle event stream. An order placed and completed between polls may appear only as a fill. Removal from a working snapshot alone does not distinguish a fill, cancellation, expiry, or rejection. A reported Stop order does not establish that a position has adequate stop-loss coverage. Stop/limit values are source prices, without inferred instrument rollover, protective intent, or price rounding. No automatic ExecutionOS card binding is added.

- Existing fills in the rolling date window are baselined and not announced as new. Each subsequent fill is keyed by environment/account/stable fill ID, with a fingerprint that detects corrections. A corrected ID requires a restart/rebaseline rather than a second execution announcement.
- Fill queries cover the previous/current UTC calendar dates, with an upper boundary on the following date to overlap exchange-session boundaries. This is bounded recent-history polling, not a complete historical journal. Histories saturating the local 5000-record guard fail closed; there is no undocumented pagination or truncation claim. The seen set is pruned outside that rolling interval and bounded in memory.
- Account, position and fill timestamps retain their distinct meanings. Portfolio observations are request snapshots, not an atomic exchange-time position/fill sequence. Positions are replaced by current broker snapshots on each successful cycle, including removals; an absent field alone never proves flat. The beta can omit an empty projected positions branch, so the monitor confirms it against the independent positions resource before publishing an empty position list.
- A failed cycle publishes none of its partial observations and advances no fill deduplication state. Prior data remains visible with DEGRADED/stale status. Last successful observation time is separate from an error/status update. Data becomes stale even if the process silently stops polling. Delayed/unknown market marks remain labeled as such; missing account net liquidation stays unavailable rather than being reconstructed from cash.
- The SDK serializes calls and retains the existing per-tool spacing/429 cooldown. The monitor applies bounded retry backoff and resets a failed transport before retrying where appropriate. No concurrent poll loop or trading write is introduced.
- Raw private account/fill response samples used for local verification are not included in deliverables or committed fixtures. Unit fixtures are synthetic. The existing static public-market sample remains separate.

## ExecutionOS boundary

This monitor publishes **source=NINJATRADER**, **readOnly=true**, **executionEnabled=false**, **executionOwnershipVerified=false**, and **continuousFillCoverageVerified=false**. It does not label itself ARMED or emit Schwab execution-coverage certificates. It does not compute a new risk limit, authorize an account, import/arm candidates, link a fill to an ExecutionOS trade, or change an order.

The existing ExecutionOS execution screens and ownership journal use Schwab-specific evidence. The new observations are available in this monitor/API; automatic NinjaTrader execution-card fill binding is not enabled by this command. That integration needs its own source/provenance work rather than relabeling NinjaTrader data as Schwab data. The local market-data relay is wired into the existing provider factory and preserves its permission barrier.

## Validation

Run `npm run v24:ninjatrader-test` for the monitor, adapter, security, HTTP relay and configuration tests. Real Live account discovery, portfolio reads, positions reconciliation and recent-fill baseline reads succeeded with masked/count-only verification output. Real new-fill arrival, long-duration token refresh, revocation, server throttling and disconnect recovery remain operational acceptance items; no test trade is required or authorized. See the delivered monitor validation record for exact test and live smoke results. Changes remain uncommitted and preserve the existing unrelated working-tree edits.


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

Main integration compatibility: NinjaTrader CLI probe evidence uses `ninjatrader-quote-evidence.mjs`, isolated from the existing Schwab provider/freshness code. This preserves the original NinjaTrader source/receipt/realtime checks without requiring the unrelated feature-branch clock-hardening changes. The helper is diagnostic data validation and grants no trading authority.
