import {
  EASTERN_TIME_ZONE,
  isRegularTradingHours,
  tradingDateKey,
} from "./market-data-provider.mjs";

export const WILDER_ATR_METHOD = "WILDER_RMA";
export const WILDER_ATR_PERIOD = 14;
export const ATR_RECONSTRUCTION_COMPLETED_RTH_SESSIONS = 20;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number`);
  }
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be an integer >= 1`);
  }
  return number;
}

function normalizeBar(bar) {
  const timestamp = finiteNumber(bar?.timestamp, "bar.timestamp");
  const open = finiteNumber(bar?.open, "bar.open");
  const high = finiteNumber(bar?.high, "bar.high");
  const low = finiteNumber(bar?.low, "bar.low");
  const close = finiteNumber(bar?.close, "bar.close");

  if (high < low) throw new Error("bar.high must be >= bar.low");
  if (open < low || open > high) throw new Error("bar.open must be within bar range");
  if (close < low || close > high) throw new Error("bar.close must be within bar range");
  if (bar?.complete === false) throw new Error("forming/incomplete bars cannot enter Wilder ATR");

  return {
    ...bar,
    timestamp,
    open,
    high,
    low,
    close,
  };
}

export function trueRange(bar, {
  previousClose = null,
  isSessionFirst = false,
} = {}) {
  const normalized = normalizeBar(bar);
  const highLow = normalized.high - normalized.low;

  if (isSessionFirst || !Number.isFinite(Number(previousClose))) {
    return highLow;
  }

  const priorClose = Number(previousClose);
  return Math.max(
    highLow,
    Math.abs(normalized.high - priorClose),
    Math.abs(normalized.low - priorClose),
  );
}

export function wilderAtrSeries(trueRanges, { period = WILDER_ATR_PERIOD } = {}) {
  const normalizedPeriod = positiveInteger(period, "period");
  const values = Array.isArray(trueRanges)
    ? trueRanges.map((value, index) => {
        const number = finiteNumber(value, `trueRanges[${index}]`);
        if (number < 0) throw new Error(`trueRanges[${index}] must be >= 0`);
        return number;
      })
    : [];

  if (values.length < normalizedPeriod) {
    return {
      method: WILDER_ATR_METHOD,
      period: normalizedPeriod,
      observationCount: values.length,
      seedAtr: null,
      currentAtr: null,
      atrSeries: [],
    };
  }

  const seedAtr = values
    .slice(0, normalizedPeriod)
    .reduce((sum, value) => sum + value, 0) / normalizedPeriod;

  const atrSeries = [{
    observationIndex: normalizedPeriod - 1,
    atr: seedAtr,
  }];

  let currentAtr = seedAtr;
  for (let index = normalizedPeriod; index < values.length; index += 1) {
    currentAtr = ((currentAtr * (normalizedPeriod - 1)) + values[index]) / normalizedPeriod;
    atrSeries.push({ observationIndex: index, atr: currentAtr });
  }

  return {
    method: WILDER_ATR_METHOD,
    period: normalizedPeriod,
    observationCount: values.length,
    seedAtr,
    currentAtr,
    atrSeries,
  };
}

export function reconstructWilderAtr(bars, {
  period = WILDER_ATR_PERIOD,
  timeZone = EASTERN_TIME_ZONE,
  requireRth = true,
} = {}) {
  const normalizedPeriod = positiveInteger(period, "period");
  const normalizedBars = (Array.isArray(bars) ? bars : [])
    .map(normalizeBar)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!normalizedBars.length) {
    return {
      method: WILDER_ATR_METHOD,
      period: normalizedPeriod,
      observationCount: 0,
      seedAtr: null,
      currentAtr: null,
      latestTimestamp: null,
      latestTradingDate: null,
      trueRanges: [],
      atrSeries: [],
    };
  }

  for (let index = 1; index < normalizedBars.length; index += 1) {
    if (normalizedBars[index].timestamp === normalizedBars[index - 1].timestamp) {
      throw new Error("duplicate bar timestamps cannot enter Wilder ATR reconstruction");
    }
  }

  const trueRanges = [];
  let previousTradingDate = null;
  let previousClose = null;

  for (const bar of normalizedBars) {
    if (requireRth && !isRegularTradingHours(bar.timestamp, { timeZone })) {
      throw new Error("non-RTH bars cannot enter V2.4 Wilder ATR reconstruction");
    }

    const currentTradingDate = tradingDateKey(bar.timestamp, { timeZone });
    if (!currentTradingDate) throw new Error("bar trading date could not be resolved");

    const isSessionFirst = previousTradingDate !== currentTradingDate;
    trueRanges.push(trueRange(bar, { previousClose, isSessionFirst }));

    previousTradingDate = currentTradingDate;
    previousClose = bar.close;
  }

  const atr = wilderAtrSeries(trueRanges, { period: normalizedPeriod });
  const latestBar = normalizedBars[normalizedBars.length - 1];

  return {
    ...atr,
    latestTimestamp: latestBar.timestamp,
    latestTradingDate: tradingDateKey(latestBar.timestamp, { timeZone }),
    trueRanges,
  };
}
