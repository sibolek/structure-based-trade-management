# NinjaTrader account, position, working-order and fill monitor

`npm run ninjascript:monitor` is the requested counterpart to `schwab:monitor`. `npm run ninjatrader:monitor` is an alias. This is a Node command using NinjaTrader's hosted MCP service; it does not install a C# NinjaScript or change the experimental v4 indicator.

It reads accessible accounts, bootstraps current positions, baselines existing fills, prints newly observed fills once, and refreshes account/position/working-order snapshots. Working orders include broker-reported stop and limit orders, with order ID, side, quantity, type, status, stop/limit price and duration; changes appear in the next successful snapshot and in `/api/state.workingOrders`. Broker snapshots determine position state; fills are not replayed on top of a snapshot, which avoids double counting. The default poll interval is five seconds. After startup, console output is change-only: each account, position and working-order block prints only when its displayed values change. Observation timestamps and row ordering do not trigger logs; no periodic heartbeat is printed. New fills still print once. Disappeared orders are reconciled against structured broker order history. A confirmed cancellation prints `NINJATRADER ORDER CANCELLED`; an unresolved disappearance prints `NINJATRADER ORDER — STATUS UNCONFIRMED`, with its last status and observation time. Missing data never means a cancellation. Identical repeated errors stay quiet until the error changes or the monitor recovers. Status/staleness and order-coverage changes remain visible. API timestamps and polling continue unchanged. Account labels are masked in console/API output; raw vendor error bodies and credentials are not logged.

## Console format

Console output follows `schwab:monitor`: a startup banner, check-mark setup messages, and labeled blocks separated by dashed rules. Account equity and P&L display as currency with two decimals. Order/position/fill prices retain their source numeric precision. A plain Stop has no limit price, displayed as “Not applicable”; absent prices on types that use a limit remain “—”.

New fills use a `NEW NINJATRADER EXECUTION` block with account, environment, symbol, instruction, quantity, price, order/fill IDs, NinjaTrader fill time, detection time, and observed delay. Times include milliseconds and an explicit time-zone abbreviation; the default remains America/Denver. Delay is the local detection timestamp minus the source fill timestamp, and negative values are labeled clock skew.

The format does not add the Schwab-specific ARMED label, continuous-coverage claims, risk budget calculations, or inferred state transitions. NinjaTrader remains OBSERVING with the same read-only API, polling, change-only logging and permissions. New/changed blocks and removals print once; no heartbeat is added. Values rounded for currency presentation remain full precision in the API, and sub-cent changes that leave the rendered currency unchanged stay quiet.

## Faster order and position updates

The monitor subscribes to NinjaTrader's documented read-only `tradovate://orders` and `tradovate://positions` resource notifications. A notification wakes the monitor for an earlier snapshot instead of waiting for the next regular poll. The broker record still confirms the cancellation and the independent position snapshot still determines FLAT/LONG/SHORT. The notification itself never supplies trusted order status or proves flat. [Official resource subscription documentation](https://docs.ninjatrader.com/mcp/resources).

The startup line reports whether subscriptions were accepted or polling is being used. Regular polling stays enabled as fallback and reconciles missed notifications. Repeated notifications coalesce, with accelerated snapshots no more often than every five seconds (the first eligible update can wake immediately). An initial one-second guard and existing per-tool request spacing prevent startup bursts. API round trips, the broker publishing its status and an unresolved order-history recheck can still add delay; no subsecond or continuous-event coverage is claimed.

Accelerated snapshots refresh accounts, positions and working orders, but do not query fill history or delay regular fill polls. `lastFillSuccessfulAt` records the last successful full fill poll separately from snapshot refresh time. New fills keep their existing baseline/deduplication semantics and regular polling cadence. The 15-second minimum between repeated unresolved order-history reads and all error/429 cooldowns still apply. Notifications cannot bypass backoff. Existing poll settings and credentials are preserved.

Resource subscriptions are permitted only in explicit account-observation mode and only for the two fixed URIs above. The market-only client still denies subscriptions and account reads; order actions remain denied. A streaming GET has a 15-second connection/header timeout, while its established body remains open until disconnect/shutdown. An unavailable, rejected or broken stream leaves polling active. A failed active stream is retried through a new authenticated session at most once a minute during subsequent reads; ordinary session reconnects re-establish subscriptions. No additional browser consent is requested automatically.

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

The default market-data adapter still permits only its original four market/documentation tools. This monitor explicitly enables only **my_portfolio**, **fill_history**, **order_history**, and the fixed read-only resources **tradovate://account-list**, **tradovate://positions** and **tradovate://orders**, in addition to the existing market tools. Place/modify/cancel/close, risk changes, alerts, arbitrary resources and arbitrary RPC remain denied at the client and network boundaries.

The monitor needs **Accounting:Read**, **Positions:Read**, and **Orders:Read**. The optional market-data relay also uses **Prices:Read** and **ContractLibrary:Read**. These are read permissions; Orders:Read is required by the portfolio/fill tools and does not permit orders to be changed.

The user's currently authorized Live connection passed these reads during validation. If another account/environment lacks access, stop the monitor and run:

```sh
npm run ninjascript:auth
```

In browser consent, select View Account, View Positions, View Orders, Market Data and View Contracts. Keep Trade, Manage Risk and Manage Alerts off. Existing `v24:ninjatrader -- auth` remains the market-only setup flow. The monitor never automatically adds consent permissions or asks for a password. Token refresh uses the same private resource-bound OAuth store and atomic rotation as the adapter. Only one process owns that store at a time. Push subscriptions use this same client/session and credential owner.

## Local API and concurrent ExecutionOS market-data use

The default listener is **127.0.0.1:8789**, separate from Schwab's 8787 and PRETRADE's 8788:

| GET endpoint | Purpose |
| --- | --- |
| `/health` | Status, environment, last successful read and staleness; HTTP 503 when stale/degraded |
| `/api/state` | Masked accounts, positions, working orders, unresolved orders (`unconfirmedOrders`), recent terminal order confirmations (`orderEvents`, maximum 100), recent newly observed fills, baseline/status metadata |
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

- Working orders normally come from `my_portfolio.workingOrders[]`. If that beta projection omits the branch, the monitor reads `tradovate://orders` once per cycle. An explicit empty resource confirms no working orders. A nonempty or unknown resource shape does not establish account coverage; `accounts[].workingOrdersStatus` remains UNAVAILABLE. Last-known rows retain their original observation time and display as status unconfirmed. Overall `stale=false` applies to successful polling; check order coverage and row staleness separately.
- When a previously observed order disappears, the monitor queries `order_history` for its account and accepts only a structured terminal status matching its account, order ID, symbol and side. `Canceled`/`Cancelled`, `Filled`, `Rejected` and `Expired` are distinct confirmations. Ambiguous `Completed` stays Completed. `PendingCancel`, free-text cancel requests, or an absent history row never confirm cancellation. The history tool is optional; unavailable history leaves the order unconfirmed. No trade/manage permission is added.
- Reconciliation makes at most one history query per affected account per 15 seconds, only while known orders need resolution. It shares the recent UTC date window used by fills (previous/current dates through the following boundary). Older GTC records outside that window can remain unconfirmed; there is no complete journal or undocumented pagination claim. Missing orders are bounded at 1,000 and saturated 5,000-row history responses fail closed. New terminal confirmations publish only after the complete poll succeeds, and print once. The API retains at most 100 confirmations. Restarting baselines current orders and does not replay prior cancellations.
- A cancellation block includes the same-cycle broker position for that exact instrument: FLAT only when the complete independent position snapshot contains no open position for it; otherwise LONG/SHORT and quantity. Canceling an order does not flatten a position. This is position state when the confirmation was observed, not a claim about position state at the exchange cancellation instant. The event's `observedAt` is local detection time; `brokerOrderTime` is the broker record timestamp, not an asserted cancellation time.
- These are sampled snapshots, not an order lifecycle event stream. An order placed and completed between polls may appear only as a fill; startup cancellations are not backfilled. A reported Stop order does not establish adequate stop-loss coverage. Stop/limit values retain source prices, without inferred rollover, protective intent or rounding. No automatic ExecutionOS card binding is added.

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

Run `npm run v24:ninjatrader-test` for the monitor, adapter, security, HTTP relay and configuration tests. Real Live account discovery, portfolio reads, positions reconciliation and recent-fill baseline reads succeeded with masked/count-only verification output. The cancellation fix additionally checks omitted empty orders, structured terminal statuses, independent flat/open position state, delayed confirmation, atomic failed-cycle recovery, permission denials and change-only logging. A read-only Live check confirmed the reported order as Canceled, with independent empty orders and positions resources. Normalization/rendering of those captured responses is separately verified; the user subsequently reported successful cancellation output after restarting the updated monitor. Real new-fill arrival, normal scheduled token refresh, revocation, server throttling and disconnect recovery remain operational acceptance items; no test trade is required or authorized. See the delivered monitor validation record for exact test and live smoke results. The earlier monitor integration was merged through PR #22. The cancellation and push-update follow-ups preserve unrelated working-tree edits.


The cancellation and push-update regression suite passed 121 tests, including 90 NinjaTrader tests. Live orders/positions subscriptions were accepted, the SSE stream stayed open beyond 15 seconds, and the installed runner completed a regular fill poll before clean shutdown. No new order was requested for verification, and real notification-to-console latency has not been measured.

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
