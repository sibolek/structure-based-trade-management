# ExecutionOS Schwab Bridge — Read-Only Proof of Concept

This bridge is intentionally separate from the React UI. Its job is to prove that ExecutionOS can authenticate with Schwab, read account data, and observe thinkorswim executions reliably before any live UI integration is attempted.

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

Not implemented yet:

- Order placement, replacement, or cancellation
- Transactions reconciliation
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

Expected output includes:

- Schwab authentication success
- number of authorized accounts
- masked account identifier
- current equity
- 0.5% maximum planned risk
- buying power
- open positions with quantity and average price

Open P/L is intentionally not displayed in this proof-of-concept output.

## ToS / Schwab fill monitor

Start the monitor before a normal thinkorswim trading session or before an execution you already intend to make:

```bash
npm run schwab:monitor
```

On startup the monitor:

1. authenticates with the existing local tokens,
2. discovers every authorized Schwab account,
3. retrieves recent orders,
4. records all already-existing execution legs as a baseline, and
5. prints `MONITOR ARMED`.

Existing fills are deliberately ignored. After the monitor is armed, each newly observed Schwab `EXECUTION` / `FILL` prints:

- masked account
- symbol
- order instruction
- fill quantity
- fill price
- order ID/status
- Schwab execution timestamp
- ExecutionOS first-observed timestamp
- observed delay in milliseconds

The default polling interval is 1000 ms. For controlled testing it can be changed locally with `SCHWAB_POLL_MS` in `.env.local`; the proof of concept constrains the value to 500–10000 ms.

Stop the monitor with `Ctrl+C`.

Observed delay is not pure network latency. It includes Schwab/ToS propagation time, API availability, request/response time, polling phase, and any clock difference between the local Mac and Schwab's execution timestamp. The purpose of this test is to measure the end-to-end delay that ExecutionOS would actually experience.

## Other commands

```bash
npm run schwab:status
npm run schwab:logout
```

`schwab:logout` deletes the local token file only. It does not revoke the app's authorization at Schwab.

## Token behavior

Schwab documents Trader API access tokens as valid for 30 minutes and refresh tokens as valid for 7 days. The bridge refreshes the access token when it is within two minutes of expiration. If a refresh token expires or is invalidated, run `npm run schwab:auth` again.

## Next milestone

After the ToS latency test:

1. Decide whether order polling is fast enough for live ExecutionOS awareness or should remain a journaling/reconciliation input.
2. Add transaction reconciliation using `types=TRADE`.
3. Build the separate NinjaTrader event adapter for futures.
4. Normalize both broker sources into one ExecutionOS trade/event model.
5. Only then connect broker events to the V2 live/review workflows.
