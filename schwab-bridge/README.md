# ExecutionOS Schwab Bridge — Read-Only Proof of Concept

This bridge is intentionally separate from the React UI. Its job is to prove that ExecutionOS can authenticate with Schwab, read account data, observe thinkorswim executions reliably, reconstruct trade state, and analyze execution quality before any live UI integration is attempted.

## Scope

Implemented now:

- Schwab OAuth authorization-code flow
- Local access/refresh token storage
- Automatic access-token refresh near the 30-minute expiration
- Authorized account discovery
- Current balances
- Current positions
- Automatic 0.5% risk-budget calculation
- Read-only order polling
- Detection of new `EXECUTION` / `FILL` execution legs
- Observed fill-latency measurement using Schwab execution timestamps
- Historical orders / TRADE transaction verification
- Historical ENTRY / ADD / PARTIAL / FLAT / REVERSAL state replay
- Offline execution VWAP and fragmented-fill analytics
- Reference slippage versus available limit and stop prices
- Credential lifecycle test across the 30-minute access-token boundary

Not implemented yet:

- Order placement, replacement, or cancellation
- Live NBBO capture / true market-order slippage versus bid/ask
- React UI integration
- NinjaTrader integration

## Security model

- Schwab brokerage username/password are entered only on Schwab's authorization site.
- Client ID and Client Secret live in the local `.env.local` file.
- OAuth tokens live in local `.schwab-tokens.json`.
- Both files are ignored by Git.
- The bridge never sends the Client Secret to React/browser code.
- The Schwab app was registered with an order-write limit of zero for this read-only phase.

## Setup

From the repository root:

1. Copy the template:

   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` and replace the placeholders with the Client ID and Client Secret from the Schwab Developer Portal. Keep the callback exactly as registered:

   ```text
   https://127.0.0.1:8182
   ```

3. Verify the files are ignored:

   ```bash
   git check-ignore .env.local .schwab-tokens.json
   ```

## First authorization

Run:

```bash
npm run schwab:auth
```

The bridge opens Schwab's OAuth authorization page. Log into Schwab there and choose the account(s) ExecutionOS may read.

Schwab redirects to the registered `https://127.0.0.1:8182` URL. This proof of concept does not run a local HTTPS callback server yet, so the page may fail to load. Copy the complete redirected URL from the browser address bar and paste it into the terminal when prompted.

The bridge extracts the authorization code and exchanges it for access and refresh tokens using Schwab's token endpoint.

## Test account access

After authorization:

```bash
npm run schwab:account
```

Expected output includes Schwab authentication success, number of authorized accounts, masked account identifier, current equity, 0.5% maximum planned risk, buying power, and open positions with quantity and average price.

Open P/L is intentionally not displayed in this proof-of-concept output.

## ToS / Schwab fill monitor

Start the monitor before a normal thinkorswim trading session or before an execution you already intend to make:

```bash
npm run schwab:monitor
```

On startup the monitor authenticates, discovers authorized accounts, retrieves recent orders, records already-existing execution legs as a baseline, then prints `MONITOR ARMED`.

Existing fills are deliberately ignored. Each newly observed Schwab `EXECUTION` / `FILL` prints masked account, symbol, order instruction, fill quantity, fill price, order ID/status, Schwab execution timestamp, ExecutionOS first-observed timestamp, and observed delay in milliseconds.

The default polling interval is 1000 ms. For controlled testing it can be changed locally with `SCHWAB_POLL_MS` in `.env.local`; the proof of concept constrains the value to 500–10000 ms.

Stop the monitor with `Ctrl+C`.

Observed delay is not pure network latency. It includes Schwab/ToS propagation time, API availability, request/response time, polling phase, and any clock difference between the local Mac and Schwab's execution timestamp.

## Historical verification and replay

Verify historical Schwab orders against TRADE transactions:

```bash
npm run schwab:history -- --days=7
npm run schwab:history -- --days=30 --symbol=NVDA
```

Replay historical fills through the trade-state engine:

```bash
npm run schwab:replay -- --days=7 --symbol=MRVL
```

Historical replay assumes each symbol is flat at the beginning of the selected window. Choose a window whose first fill is a known opening execution when validating state logic.

## Offline execution / slippage analytics

Run:

```bash
npm run schwab:slippage -- --days=7
```

Optional filters:

```bash
npm run schwab:slippage -- --days=30 --symbol=AMD
npm run schwab:slippage -- --days=7 --fragmented-only
```

For each executed order leg, the analyzer reports:

- total filled quantity
- number of execution fragments
- execution VWAP
- directionally best and worst fill
- best-to-worst fill-price range
- quantity-weighted standard deviation of fragment prices
- reference slippage versus an available single-leg limit price
- reference slippage versus an available single-leg stop price
- per-share and aggregate-dollar reference impact

Positive reference-slippage values are adverse; negative values represent price improvement.

Important: fill-price dispersion does **not** prove that fragmentation itself caused slippage. Market orders also have no valid historical NBBO benchmark in the current bridge. True market-order slippage versus the contemporaneous bid/ask will be added only after the live ToS latency test determines the correct quote-capture architecture.

Multi-leg orders deliberately do not compare an order-level strategy price with a single execution leg.

## Credential lifecycle test

Run:

```bash
npm run schwab:token-test
```

The default test runs 40 minutes, uses the harmless read-only `GET /accounts/accountNumbers` endpoint every 60 seconds, and verifies that account access survives an automatic access-token refresh. It also reports the age of the original authorization and the estimated remaining time in Schwab's documented seven-day refresh-token window. Tokens themselves are never printed.

## Other commands

```bash
npm run schwab:status
npm run schwab:logout
```

`schwab:logout` deletes the local token file only. It does not revoke the app's authorization at Schwab.

## Token behavior

Schwab documents Trader API access tokens as valid for 30 minutes and refresh tokens as valid for 7 days. The bridge refreshes the access token when it is within two minutes of expiration. If a refresh token expires or is invalidated, run `npm run schwab:auth` again.

## Next milestone

After the live ToS latency test:

1. Decide whether order polling is fast enough for live ExecutionOS awareness or should remain a journaling/reconciliation input.
2. Design live NBBO/reference-price capture and true market-order slippage measurement around the observed latency.
3. Build the separate NinjaTrader event adapter for futures.
4. Normalize both broker sources into one ExecutionOS trade/event model.
5. Connect broker events and execution-quality data to the V2 live/review workflows.
