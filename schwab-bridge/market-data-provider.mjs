export class MarketDataProvider {
  constructor({ source = "UNKNOWN" } = {}) {
    this.source = source;
  }

  async getQuote() {
    throw new Error("getQuote() is not implemented");
  }

  async getMinuteBars() {
    throw new Error("getMinuteBars() is not implemented");
  }

  async getDailyBars() {
    throw new Error("getDailyBars() is not implemented");
  }
}

export const EASTERN_TIME_ZONE = "America/New_York";

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoFromMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Date(number).toISOString() : null;
}

function zonedParts(timestamp, timeZone = EASTERN_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
  };
}

export function tradingDateKey(timestamp, { timeZone = EASTERN_TIME_ZONE } = {}) {
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return null;
  const parts = zonedParts(number, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function isRegularTradingHours(timestamp, { timeZone = EASTERN_TIME_ZONE } = {}) {
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return false;
  const parts = zonedParts(number, timeZone);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  return minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 16 * 60;
}

export function selectSessionBars(bars, {
  session = "ALL",
  tradingDate = null,
  timeZone = EASTERN_TIME_ZONE,
} = {}) {
  const normalizedSession = String(session || "ALL").toUpperCase();
  if (!["ALL", "RTH"].includes(normalizedSession)) {
    throw new Error("session must be ALL or RTH");
  }

  return (Array.isArray(bars) ? bars : [])
    .filter((bar) => Number.isFinite(Number(bar?.timestamp)))
    .filter((bar) => !tradingDate || tradingDateKey(bar.timestamp, { timeZone }) === tradingDate)
    .filter((bar) => normalizedSession === "ALL" || isRegularTradingHours(bar.timestamp, { timeZone }))
    .slice()
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

export function minuteContinuity(bars, { intervalMs = 60_000 } = {}) {
  const interval = Number(intervalMs);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("intervalMs must be a positive number");
  }

  const valid = (Array.isArray(bars) ? bars : [])
    .map((bar) => Number(bar?.timestamp))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const unique = [...new Set(valid.map((timestamp) => Math.floor(timestamp / interval) * interval))];
  if (!unique.length) {
    return {
      firstTimestamp: null,
      lastTimestamp: null,
      uniqueSlots: 0,
      duplicates: 0,
      missingSlots: 0,
      contiguous: false,
    };
  }

  const spanSlots = Math.floor((unique[unique.length - 1] - unique[0]) / interval) + 1;
  const missingSlots = Math.max(0, spanSlots - unique.length);

  return {
    firstTimestamp: unique[0],
    lastTimestamp: unique[unique.length - 1],
    uniqueSlots: unique.length,
    duplicates: Math.max(0, valid.length - unique.length),
    missingSlots,
    contiguous: missingSlots === 0,
  };
}

export function normalizeBar(input, { symbol, timeframe = "1m", source = "UNKNOWN" } = {}) {
  const bar = input && typeof input === "object" ? input : {};
  const timestamp = finite(bar.timestamp ?? bar.datetime ?? bar.time);
  const open = finite(bar.open);
  const high = finite(bar.high);
  const low = finite(bar.low);
  const close = finite(bar.close);
  const volume = finite(bar.volume) ?? 0;

  if (![timestamp, open, high, low, close].every(Number.isFinite)) return null;

  return {
    symbol: String(symbol || bar.symbol || "").toUpperCase(),
    timeframe,
    source,
    timestamp,
    time: isoFromMs(timestamp),
    open,
    high,
    low,
    close,
    volume,
  };
}

export function normalizeBars(inputs, options = {}) {
  if (!Array.isArray(inputs)) return [];
  return inputs
    .map((item) => normalizeBar(item, options))
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function aggregateMinuteBars(bars, { minutes = 2 } = {}) {
  const bucketMinutes = Number(minutes);
  if (!Number.isInteger(bucketMinutes) || bucketMinutes < 1) {
    throw new Error("minutes must be an integer >= 1");
  }

  const bucketMs = bucketMinutes * 60_000;
  const normalized = Array.isArray(bars)
    ? bars.filter((bar) => Number.isFinite(Number(bar?.timestamp))).slice().sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    : [];
  const groups = new Map();

  for (const bar of normalized) {
    const timestamp = Number(bar.timestamp);
    const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs;
    const list = groups.get(bucketStart) || [];
    list.push(bar);
    groups.set(bucketStart, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, list]) => {
      const ordered = list.slice().sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
      const uniqueSlots = new Set(ordered.map((bar) => Math.floor(Number(bar.timestamp) / 60_000)));
      return {
        symbol: ordered[0]?.symbol || "",
        timeframe: `${bucketMinutes}m`,
        source: ordered[0]?.source || "UNKNOWN",
        timestamp: bucketStart,
        time: new Date(bucketStart).toISOString(),
        open: Number(ordered[0].open),
        high: Math.max(...ordered.map((bar) => Number(bar.high))),
        low: Math.min(...ordered.map((bar) => Number(bar.low))),
        close: Number(ordered[ordered.length - 1].close),
        volume: ordered.reduce((sum, bar) => sum + Number(bar.volume || 0), 0),
        sampleCount: uniqueSlots.size,
        complete: uniqueSlots.size === bucketMinutes,
        lastSourceTimestamp: Number(ordered[ordered.length - 1].timestamp),
      };
    });
}

export function freshness(asOf, { nowMs = Date.now(), maxAgeMs } = {}) {
  const timestamp = typeof asOf === "string" ? Date.parse(asOf) : Number(asOf);
  const threshold = Number(maxAgeMs);
  if (!Number.isFinite(timestamp) || !Number.isFinite(threshold) || threshold < 0) {
    return {
      asOf: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      ageMs: null,
      maxAgeMs: Number.isFinite(threshold) ? threshold : null,
      isStale: true,
    };
  }

  const ageMs = Math.max(0, Number(nowMs) - timestamp);
  return {
    asOf: new Date(timestamp).toISOString(),
    ageMs,
    maxAgeMs: threshold,
    isStale: ageMs > threshold,
  };
}
