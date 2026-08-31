import { DssInputAssembler, DssInputAssemblyError } from "./dss-input-assembler.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class DssLiveInputAssembler {
  constructor({
    marketDataProvider,
    baseAssembler = null,
    now = () => Date.now(),
    ...baseOptions
  } = {}) {
    if (!marketDataProvider || typeof marketDataProvider.getQuote !== "function") {
      throw new Error("DssLiveInputAssembler requires a MarketDataProvider with getQuote()");
    }
    if (typeof now !== "function") throw new Error("now must be a function");
    if (baseAssembler && typeof baseAssembler.assemble !== "function") {
      throw new Error("baseAssembler must expose assemble()");
    }

    this.marketDataProvider = marketDataProvider;
    this.now = now;
    this.baseAssembler = baseAssembler || new DssInputAssembler({
      marketDataProvider,
      now,
      ...baseOptions,
    });
  }

  async assemble(args = {}) {
    const assembled = await this.baseAssembler.assemble(args);
    const symbol = text(assembled?.candidate?.symbol);
    if (!symbol) {
      throw new DssInputAssemblyError("assembled DSS input has no candidate symbol", {
        status: "ERROR",
        reasonCodes: ["INVALID_ASSEMBLED_CANDIDATE_SYMBOL"],
        stage: "FINAL_QUOTE",
      });
    }

    let finalQuote;
    try {
      finalQuote = await this.marketDataProvider.getQuote(symbol);
    } catch (error) {
      throw new DssInputAssemblyError(`final live quote refresh failed: ${error?.message || error}`, {
        status: "ERROR",
        reasonCodes: ["MARKET_DATA_PROVIDER_ERROR"],
        stage: "FINAL_QUOTE",
      });
    }

    const capturedAtMs = Number(this.now());
    if (!Number.isFinite(capturedAtMs)) {
      throw new DssInputAssemblyError("live input assembler clock must return epoch milliseconds", {
        status: "ERROR",
        reasonCodes: ["INVALID_DSS_INPUT_ASSEMBLY_CLOCK"],
        stage: "FINAL_QUOTE",
      });
    }

    const refreshed = clone(assembled);
    refreshed.marketSnapshot = refreshed.marketSnapshot && typeof refreshed.marketSnapshot === "object"
      ? refreshed.marketSnapshot
      : {};
    refreshed.marketSnapshot.quote = clone(finalQuote);
    refreshed.marketSnapshot.capturedAt = new Date(capturedAtMs).toISOString();
    refreshed.marketSnapshot.provider = text(this.marketDataProvider.source || finalQuote?.source || refreshed.marketSnapshot.provider || "UNKNOWN");
    refreshed.marketSnapshot.finalQuoteRefresh = {
      refreshedAt: new Date(capturedAtMs).toISOString(),
      source: text(finalQuote?.source || this.marketDataProvider.source || "UNKNOWN"),
    };

    refreshed.instrument = refreshed.instrument && typeof refreshed.instrument === "object"
      ? refreshed.instrument
      : {};
    refreshed.instrument.instrumentValueMetadata = refreshed.instrument.instrumentValueMetadata && typeof refreshed.instrument.instrumentValueMetadata === "object"
      ? refreshed.instrument.instrumentValueMetadata
      : {};

    const finalTick = finiteNumber(finalQuote?.tick);
    if (finalTick !== null && finalTick > 0) {
      refreshed.instrument.priceIncrement = finalTick;
      refreshed.instrument.metadataProvider = text(finalQuote?.source || this.marketDataProvider.source || "SCHWAB");
      refreshed.instrument.metadataVerified = true;
      refreshed.instrument.priceIncrementSource = "FINAL_LIVE_QUOTE_TICK";
    }

    const tickAmount = finiteNumber(finalQuote?.tickAmount);
    if (tickAmount !== null) refreshed.instrument.instrumentValueMetadata.tickAmount = tickAmount;
    const futureMultiplier = finiteNumber(finalQuote?.futureMultiplier);
    if (futureMultiplier !== null) refreshed.instrument.instrumentValueMetadata.futureMultiplier = futureMultiplier;
    if (!refreshed.instrument.instrumentType && finalQuote?.assetMainType) {
      refreshed.instrument.instrumentType = text(finalQuote.assetMainType) || null;
    }

    return deepFreeze(refreshed);
  }
}
