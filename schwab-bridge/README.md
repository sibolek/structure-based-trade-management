# ExecutionOS Schwab Bridge — Read-Only Proof of Concept

This bridge is intentionally separate from the React UI. Its first job is to prove that ExecutionOS can authenticate with Schwab and read account data reliably before any live UI integration is attempted.

## Scope

Implemented now:

- Schwab OAuth authorization-code flow
- Local access/refresh token storage
- Automatic access-token refresh near the 30-minute expiration
- Authorized account discovery
- Current balances
- Current positions
- Automatic 0.5% risk-budget calculation

Not implemented in this proof of concept:

- Order placement, replacement, or cancellation
- ToS fill monitoring
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

## Other commands

```bash
npm run schwab:status
npm run schwab:logout
```

`schwab:logout` deletes the local token file only. It does not revoke the app's authorization at Schwab.

## Token behavior

Schwab documents Trader API access tokens as valid for 30 minutes and refresh tokens as valid for 7 days. The bridge refreshes the access token when it is within two minutes of expiration. If a refresh token expires or is invalidated, run `npm run schwab:auth` again.

## Next milestone

After account access is proven on the user's Mac:

1. Poll recent Schwab orders and inspect `orderActivityCollection` execution fills.
2. Measure latency between a manual thinkorswim fill and first API observation.
3. Add transaction reconciliation using `types=TRADE`.
4. Only then connect the bridge to ExecutionOS V2 live/review workflows.
