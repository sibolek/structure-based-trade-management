import crypto from "node:crypto";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finitePositive(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function metadataVersion(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function blocked(reasonCode, partial = {}) {
  return immutable({
    ...partial,
    status: "BLOCKED",
    reasonCodes: [reasonCode],
  });
}

function normalizedObservedAt(quote) {
  const timestamp = finiteTimestamp(quote?.receivedAt ?? quote?.asOf ?? quote?.quoteTime);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

function exactProduct(left, right, expected) {
  const scale = 1_000_000_000;
  return Math.round(left * right * scale) === Math.round(expected * scale);
}

export function normalizeSchwabInstrumentSizingMetadata(symbol, quote, {
  currency = "USD",
} = {}) {
  const normalizedSymbol = upper(symbol || quote?.symbol);
  const assetMainType = upper(quote?.assetMainType);
  const source = upper(quote?.source) || "SCHWAB";
  const instrumentCurrency = upper(currency);
  const observedAt = normalizedObservedAt(quote);

  const base = {
    symbol: normalizedSymbol || null,
    metadataSource: `${source}_QUOTE`,
    metadataObservedAt: observedAt,
  };

  if (!normalizedSymbol || !quote || typeof quote !== "object") {
    return blocked("INSTRUMENT_METADATA_UNAVAILABLE", base);
  }

  if (!["EQUITY", "FUTURE"].includes(assetMainType)) {
    return blocked("UNSUPPORTED_ASSET_TYPE", {
      ...base,
      sourceAssetMainType: assetMainType || null,
    });
  }

  if (!instrumentCurrency) {
    return blocked("INSTRUMENT_METADATA_INVALID", {
      ...base,
      assetType: assetMainType,
    });
  }

  if (assetMainType === "EQUITY") {
    const metadata = {
      assetType: "EQUITY",
      symbol: normalizedSymbol,
      currency: instrumentCurrency,
      minimumQuantity: 1,
      quantityIncrement: 1,
      metadataSource: `${source}_QUOTE`,
      metadataObservedAt: observedAt,
    };
    return immutable({
      ...metadata,
      metadataVersion: metadataVersion(metadata),
      status: "VALID",
      reasonCodes: [],
    });
  }

  const tickSize = finitePositive(quote?.tick);
  const tickValue = finitePositive(quote?.tickAmount);
  const pointValue = finitePositive(quote?.futureMultiplier);
  if (tickSize === null || tickValue === null) {
    return blocked("INSTRUMENT_METADATA_INVALID", {
      ...base,
      assetType: "FUTURE",
      currency: instrumentCurrency,
      tickSize,
      tickValue,
      pointValue,
    });
  }

  if (pointValue !== null && !exactProduct(tickSize, pointValue, tickValue)) {
    return blocked("INSTRUMENT_METADATA_INCONSISTENT", {
      ...base,
      assetType: "FUTURE",
      currency: instrumentCurrency,
      tickSize,
      tickValue,
      pointValue,
    });
  }

  const metadata = {
    assetType: "FUTURE",
    symbol: normalizedSymbol,
    currency: instrumentCurrency,
    minimumQuantity: 1,
    quantityIncrement: 1,
    tickSize,
    tickValue,
    pointValue,
    metadataSource: `${source}_QUOTE`,
    metadataObservedAt: observedAt,
  };
  return immutable({
    ...metadata,
    metadataVersion: metadataVersion(metadata),
    status: "VALID",
    reasonCodes: [],
  });
}

export class SchwabInstrumentSizingMetadataProvider {
  constructor({ marketDataProvider, currency = "USD" } = {}) {
    if (!marketDataProvider || typeof marketDataProvider.getQuote !== "function") {
      throw new Error("SchwabInstrumentSizingMetadataProvider requires marketDataProvider.getQuote()");
    }
    this.marketDataProvider = marketDataProvider;
    this.currency = upper(currency);
  }

  async getInstrumentSizingMetadata(symbol) {
    const normalizedSymbol = upper(symbol);
    if (!normalizedSymbol) {
      return blocked("INSTRUMENT_METADATA_UNAVAILABLE", {
        symbol: null,
        metadataSource: "SCHWAB_QUOTE",
        metadataObservedAt: null,
      });
    }

    let quote;
    try {
      quote = await this.marketDataProvider.getQuote(normalizedSymbol);
    } catch {
      return blocked("INSTRUMENT_METADATA_UNAVAILABLE", {
        symbol: normalizedSymbol,
        metadataSource: "SCHWAB_QUOTE",
        metadataObservedAt: null,
      });
    }

    return normalizeSchwabInstrumentSizingMetadata(normalizedSymbol, quote, {
      currency: this.currency,
    });
  }
}
