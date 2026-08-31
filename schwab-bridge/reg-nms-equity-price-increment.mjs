import { EASTERN_TIME_ZONE } from "./market-data-provider.mjs";

export const REG_NMS_RULE_612_POLICY_ID = "SEC_REG_NMS_RULE_612";
export const VARIABLE_MPI_FIRST_TRADING_DATE = "2026-11-02";
export const LEGACY_NMS_INCREMENT_AT_OR_ABOVE_ONE = 0.01;

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

function firstPositive(...values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null && number > 0) return number;
  }
  return null;
}

function tradingDate(timestamp) {
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(number));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function unverified(reason, details = {}) {
  return Object.freeze({
    verified: false,
    provider: REG_NMS_RULE_612_POLICY_ID,
    priceIncrement: null,
    reason,
    details: Object.freeze({ ...details }),
  });
}

function hasNmsListingEvidence(quote) {
  const quoteType = upper(quote?.quoteType);
  const exchange = text(quote?.exchange);
  const exchangeName = text(quote?.exchangeName);
  const otcMarketTier = text(quote?.otcMarketTier);
  return quoteType === "NBBO"
    && Boolean(exchange || exchangeName)
    && !otcMarketTier;
}

export class RegNmsEquityPriceIncrementResolver {
  constructor({ now = () => Date.now() } = {}) {
    if (typeof now !== "function") throw new Error("now must be a function");
    this.now = now;
  }

  async getInstrumentMetadata(symbol, { quote } = {}) {
    const nowMs = Number(this.now());
    if (!Number.isFinite(nowMs)) {
      throw new Error("Reg NMS resolver clock must return epoch milliseconds");
    }

    const date = tradingDate(nowMs);
    const instrumentType = upper(quote?.assetMainType);
    const referencePrice = firstPositive(quote?.mark, quote?.last, quote?.bid, quote?.ask);
    const evidence = {
      symbol: upper(symbol),
      tradingDate: date,
      quoteType: upper(quote?.quoteType) || null,
      exchange: text(quote?.exchange) || null,
      exchangeName: text(quote?.exchangeName) || null,
      assetMainType: instrumentType || null,
      assetSubType: upper(quote?.assetSubType) || null,
      otcMarketTier: text(quote?.otcMarketTier) || null,
      referencePrice,
    };

    if (instrumentType !== "EQUITY") {
      return unverified("UNSUPPORTED_INSTRUMENT_TYPE", evidence);
    }

    if (!hasNmsListingEvidence(quote)) {
      return unverified("NMS_LISTING_NOT_VERIFIED", evidence);
    }

    if (referencePrice === null || referencePrice < 1) {
      return unverified("SUB_DOLLAR_EQUITY_NOT_SUPPORTED", evidence);
    }

    if (!date || date >= VARIABLE_MPI_FIRST_TRADING_DATE) {
      return unverified("VARIABLE_MPI_SOURCE_REQUIRED", {
        ...evidence,
        variableMpiFirstTradingDate: VARIABLE_MPI_FIRST_TRADING_DATE,
      });
    }

    return Object.freeze({
      verified: true,
      provider: REG_NMS_RULE_612_POLICY_ID,
      instrumentType: "EQUITY",
      priceIncrement: LEGACY_NMS_INCREMENT_AT_OR_ABOVE_ONE,
      instrumentValueMetadata: Object.freeze({
        regulatoryPolicyId: REG_NMS_RULE_612_POLICY_ID,
        regulatoryRegime: "PRE_VARIABLE_MPI_RULE_612",
        minimumPricingIncrement: LEGACY_NMS_INCREMENT_AT_OR_ABOVE_ONE,
        variableMpiFirstTradingDate: VARIABLE_MPI_FIRST_TRADING_DATE,
        verificationEvidence: Object.freeze(evidence),
      }),
    });
  }
}
