import { MarketDataProvider, normalizeBars } from "./market-data-provider.mjs";

const MARKET_DATA_BASE = "https://api.schwabapi.com/marketdata/v1";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number !== null) return number;
  }
  return null;
}

function iso(value) {
  const number = finite(value);
  return number === null ? null : new Date(number).toISOString();
}

function toMs(value, label) {
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`${label} must be a Date, epoch milliseconds, or ISO-compatible timestamp`);
}

export function normalizeSchwabQuote(payload, symbol, { receivedAtMs = Date.now() } = {}) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const root = payload && typeof payload === "object" ? payload : {};
  const entry = root[normalizedSymbol] || root[Object.keys(root).find((key) => key.toUpperCase() === normalizedSymbol)] || root;
  const quote = entry?.quote && typeof entry.quote === "object" ? entry.quote : entry;

  const bid = firstFinite(quote?.bidPrice, quote?.bid);
  const ask = firstFinite(quote?.askPrice, quote?.ask);
  const last = firstFinite(quote?.lastPrice, quote?.last, quote?.regularMarketLastPrice);
  const mark = firstFinite(quote?.mark, quote?.markPrice, bid !== null && ask !== null ? (bid + ask) / 2 : null);
  const quoteTimeMs = firstFinite(quote?.quoteTime, quote?.quoteTimeInLong, entry?.quoteTime);
  const tradeTimeMs = firstFinite(quote?.tradeTime, quote?.tradeTimeInLong, entry?.tradeTime);
  const asOfMs = Math.max(...[quoteTimeMs, tradeTimeMs].filter(Number.isFinite));

  return {
    symbol: normalizedSymbol,
    source: "SCHWAB",
    bid,
    ask,
    last,
    mark,
    quoteTime: iso(quoteTimeMs),
    tradeTime: iso(tradeTimeMs),
    asOf: Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null,
    receivedAt: new Date(receivedAtMs).toISOString(),
    assetMainType: entry?.assetMainType || entry?.assetType || null,
  };
}

export function normalizeSchwabCandles(payload, symbol, timeframe) {
  return normalizeBars(Array.isArray(payload?.candles) ? payload.candles : [], {
    symbol,
    timeframe,
    source: "SCHWAB",
  });
}

export class SchwabMarketDataProvider extends MarketDataProvider {
  constructor({ requestJson, now = () => Date.now(), baseUrl = MARKET_DATA_BASE } = {}) {
    super({ source: "SCHWAB" });
    if (typeof requestJson !== "function") throw new Error("SchwabMarketDataProvider requires requestJson(url)");
    this.requestJson = requestJson;
    this.now = now;
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
  }

  async getQuote(symbol) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    if (!normalizedSymbol) throw new Error("symbol is required");
    const url = new URL(`${this.baseUrl}/quotes`);
    url.searchParams.set("symbols", normalizedSymbol);
    url.searchParams.set("fields", "quote,reference");
    const payload = await this.requestJson(url.toString());
    return normalizeSchwabQuote(payload, normalizedSymbol, { receivedAtMs: this.now() });
  }

  async getMinuteBars(symbol, { startDate, endDate, extendedHours = true } = {}) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    if (!normalizedSymbol) throw new Error("symbol is required");
    if (startDate === undefined || endDate === undefined) throw new Error("startDate and endDate are required for minute bars");

    const url = new URL(`${this.baseUrl}/pricehistory`);
    url.searchParams.set("symbol", normalizedSymbol);
    url.searchParams.set("periodType", "day");
    url.searchParams.set("frequencyType", "minute");
    url.searchParams.set("frequency", "1");
    url.searchParams.set("startDate", String(toMs(startDate, "startDate")));
    url.searchParams.set("endDate", String(toMs(endDate, "endDate")));
    url.searchParams.set("needExtendedHoursData", String(Boolean(extendedHours)));
    url.searchParams.set("needPreviousClose", "false");

    const payload = await this.requestJson(url.toString());
    return normalizeSchwabCandles(payload, normalizedSymbol, "1m");
  }

  async getDailyBars(symbol, { periodType = "year", period = 1, extendedHours = false } = {}) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    if (!normalizedSymbol) throw new Error("symbol is required");

    const url = new URL(`${this.baseUrl}/pricehistory`);
    url.searchParams.set("symbol", normalizedSymbol);
    url.searchParams.set("periodType", periodType);
    url.searchParams.set("period", String(period));
    url.searchParams.set("frequencyType", "daily");
    url.searchParams.set("frequency", "1");
    url.searchParams.set("needExtendedHoursData", String(Boolean(extendedHours)));
    url.searchParams.set("needPreviousClose", "true");

    const payload = await this.requestJson(url.toString());
    return normalizeSchwabCandles(payload, normalizedSymbol, "1d");
  }
}
