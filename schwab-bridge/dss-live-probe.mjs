import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DssLiveInputAssembler } from "./dss-live-input-assembler.mjs";
import { DssInputAssemblyError } from "./dss-input-assembler.mjs";
import { evaluateDss } from "./dss-evaluator.mjs";
import { SchwabMarketDataProvider } from "./schwab-market-data-provider.mjs";

const ACCESS_SAFETY_MS = 30_000;

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function price(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6).replace(/0+$/, "").replace(/\.$/, "") : "—";
}

function ageMs(timestamp, nowMs) {
  const parsed = Date.parse(String(timestamp || ""));
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null;
}

function ageLabel(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function parseLiveProbeArgs(argv = []) {
  const [symbolRaw, directionRaw, structuralPriceRaw] = argv;
  const symbol = upper(symbolRaw);
  const direction = upper(directionRaw);
  const structuralPrice = finiteNumber(structuralPriceRaw);

  if (!symbol || !["LONG", "SHORT"].includes(direction) || structuralPrice === null) {
    const error = new Error("Usage: npm run v24:dss-live-probe -- SYMBOL LONG|SHORT STRUCTURAL_PRICE");
    error.code = "INVALID_DSS_LIVE_PROBE_ARGS";
    throw error;
  }

  return Object.freeze({ symbol, direction, structuralPrice });
}

export function buildLiveProbeContext({ symbol, direction, structuralPrice, evaluatedAt } = {}) {
  const normalizedSymbol = upper(symbol);
  const normalizedDirection = upper(direction);
  const resolvedPrice = finiteNumber(structuralPrice);
  const timestamp = text(evaluatedAt);
  if (!normalizedSymbol || !["LONG", "SHORT"].includes(normalizedDirection) || resolvedPrice === null || Number.isNaN(Date.parse(timestamp))) {
    throw new Error("valid symbol, direction, structuralPrice, and evaluatedAt are required");
  }

  const identitySeed = {
    sourceId: "DSS_LIVE_PROBE",
    symbol: normalizedSymbol,
    direction: normalizedDirection,
    structuralPrice: resolvedPrice,
  };

  return Object.freeze({
    candidate: Object.freeze({
      candidateId: `dss-live-probe-${normalizedSymbol}-${normalizedDirection}`,
      sourceId: "DSS_LIVE_PROBE",
      contractVersion: 1,
      candidateContentHash: hash(identitySeed),
      symbol: normalizedSymbol,
      direction: normalizedDirection,
    }),
    structuralInvalidationDefinition: Object.freeze({
      referenceType: "LIVE_PROBE_SYNTHETIC_PRICE",
      rule: "operator-supplied synthetic structural price for read-only DSS capability probing",
      reason: "diagnostic probe only; not an ExecutionOS trade authorization",
      sourceTimeframe: "5m",
      resolutionMode: "STATIC_PROBE",
    }),
    structureEvaluation: Object.freeze({
      status: "VALID",
      evaluatedAt: timestamp,
      evaluationReference: "DSS_LIVE_PROBE_OPERATOR_INPUT",
      resolvedPrice,
      evidenceReference: "CLI_STRUCTURAL_PRICE_ARGUMENT",
    }),
  });
}

export async function runDssLiveProbe({
  marketDataProvider,
  symbol,
  direction,
  structuralPrice,
  now = () => Date.now(),
  snapshotIdFactory = () => crypto.randomUUID(),
  dssEvaluationIdFactory = () => crypto.randomUUID(),
} = {}) {
  if (!marketDataProvider) throw new Error("marketDataProvider is required");
  if (typeof now !== "function") throw new Error("now must be a function");

  const contextTimeMs = Number(now());
  if (!Number.isFinite(contextTimeMs)) throw new Error("probe clock must return epoch milliseconds");
  const context = buildLiveProbeContext({
    symbol,
    direction,
    structuralPrice,
    evaluatedAt: new Date(contextTimeMs).toISOString(),
  });

  const assembler = new DssLiveInputAssembler({
    marketDataProvider,
    now,
    snapshotIdFactory,
  });
  const input = await assembler.assemble(context);
  const evaluationNowMs = Number(now());
  if (!Number.isFinite(evaluationNowMs)) throw new Error("probe clock must return epoch milliseconds");
  const evaluation = evaluateDss(input, {
    nowMs: evaluationNowMs,
    idFactory: dssEvaluationIdFactory,
  });

  return Object.freeze({ input, evaluation, evaluationNowMs });
}

function readCurrentAccessToken() {
  const authDir = path.resolve(process.env.EXECUTIONOS_SCHWAB_AUTH_DIR || process.cwd());
  const tokenPath = path.join(authDir, ".schwab-tokens.json");
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`No Schwab token store found at ${tokenPath}. Set EXECUTIONOS_SCHWAB_AUTH_DIR to the checkout that owns Schwab auth.`);
  }
  const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  if (!tokens?.accessToken) throw new Error("Schwab token store has no access token.");
  const expiresAt = Date.parse(tokens.accessExpiresAt || "");
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt - ACCESS_SAFETY_MS) {
    throw new Error("Schwab access token is expired or near expiry. Refresh it through the existing Schwab monitor/auth flow, then rerun this read-only probe.");
  }
  return { accessToken: tokens.accessToken, expiresAt, authDir };
}

function requestJsonWithAccessToken(accessToken) {
  return async (url) => {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const body = await response.text();
    let payload;
    try {
      payload = body ? JSON.parse(body) : {};
    } catch {
      payload = { raw: body };
    }
    if (!response.ok) {
      const message = payload?.message || payload?.error_description || payload?.error || body || "unknown error";
      throw new Error(`Schwab market-data request failed (${response.status}): ${message}`);
    }
    return payload;
  };
}

function printReport({ args, result, authDir, expiresAt }) {
  const { input, evaluation, evaluationNowMs } = result;
  const quote = input.marketSnapshot.quote || {};
  const integrity = input.marketSnapshot.sourceIntegrity || {};
  const instrument = input.instrument || {};
  const quoteAge = ageMs(quote.asOf, evaluationNowMs);

  console.log("\nExecutionOS V2.4 Phase 3 live DSS assembly probe");
  console.log("================================================================================");
  console.log(`Symbol/direction: ${args.symbol} ${args.direction}`);
  console.log(`Probe structure:  ${price(args.structuralPrice)} — SYNTHETIC OPERATOR INPUT, NOT TRADE AUTHORITY`);
  console.log(`Auth source:      ${authDir}`);
  console.log(`Access expires:   ${new Date(expiresAt).toISOString()}`);
  console.log("Token behavior:   READ ONLY — this probe does not refresh or write OAuth tokens");
  console.log("");
  console.log(`Quote:            bid ${price(quote.bid)} · ask ${price(quote.ask)} · last ${price(quote.last)} · mark ${price(quote.mark)}`);
  console.log(`Quote as-of:      ${quote.asOf || "—"} · age at DSS ${ageLabel(quoteAge)}`);
  console.log(`Final refresh:    ${input.marketSnapshot.finalQuoteRefresh?.refreshedAt || "—"}`);
  console.log(`Instrument:       ${instrument.instrumentType || quote.assetMainType || "—"}`);
  console.log(`Schwab tick:      ${price(quote.tick)}`);
  console.log(`Price increment:  ${price(instrument.priceIncrement)} · source ${instrument.priceIncrementSource || "UNVERIFIED / UNAVAILABLE"}`);
  console.log(`Tick amount:      ${price(instrument.instrumentValueMetadata?.tickAmount)}`);
  console.log(`Multiplier:       ${price(instrument.instrumentValueMetadata?.futureMultiplier)}`);
  console.log("");
  console.log(`ATR sessions:     ${integrity.completedRthSessionsIncluded ?? "—"}/${integrity.requiredCompletedRthSessions ?? "—"} completed RTH`);
  console.log(`Evaluation sess.: ${integrity.evaluationSession || evaluation.evaluationSession || "—"}`);
  console.log(`Execution bars:   ${input.marketSnapshot.executionBars?.length ?? 0} complete 2m RTH bars`);
  console.log(`DSS status:       ${evaluation.status}`);
  console.log(`Reason codes:     ${evaluation.reasonCodes?.length ? evaluation.reasonCodes.join(", ") : "none"}`);
  console.log(`ATR(14,2m):       ${price(evaluation.atrValue)}`);
  console.log(`Raw buffer:       ${price(evaluation.rawVolatilityBuffer)}`);
  console.log(`Effective stop:   ${price(evaluation.effectiveStop)}`);
  console.log(`DSS evaluation:   ${evaluation.dssEvaluationId}`);
  console.log("");
  console.log("Boundary:         NO Phase 4 sizing · NO READY/CAUTION/PASS · NO ARM · NO broker write");
  console.log("Purpose:          market-data / metadata / deterministic Phase 3 capability validation only\n");
}

async function main() {
  const args = parseLiveProbeArgs(process.argv.slice(2));
  const { accessToken, expiresAt, authDir } = readCurrentAccessToken();
  const provider = new SchwabMarketDataProvider({
    requestJson: requestJsonWithAccessToken(accessToken),
    now: () => Date.now(),
  });

  try {
    const result = await runDssLiveProbe({
      marketDataProvider: provider,
      ...args,
      now: () => Date.now(),
    });
    printReport({ args, result, authDir, expiresAt });
    if (result.evaluation.status === "BLOCKED") process.exitCode = 2;
    if (result.evaluation.status === "ERROR") process.exitCode = 1;
  } catch (error) {
    if (error instanceof DssInputAssemblyError) {
      console.error("\nExecutionOS V2.4 Phase 3 live DSS assembly probe");
      console.error("================================================================================");
      console.error(`Assembly status:  ${error.status}`);
      console.error(`Assembly stage:   ${error.stage}`);
      console.error(`Reason codes:     ${error.reasonCodes.join(", ")}`);
      console.error(`Message:          ${error.message}`);
      if (error.details) console.error(`Details:          ${JSON.stringify(error.details)}`);
      console.error("Boundary:         READ ONLY — no ARM, sizing, or broker write occurred.\n");
      process.exitCode = error.status === "BLOCKED" ? 2 : 1;
      return;
    }
    throw error;
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    console.error(`\n✗ ${error.message}\n`);
    process.exitCode = 1;
  });
}
