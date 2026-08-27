import { initialRiskDollars } from "./r-metrics.mjs";

function entryMs(trade) {
  const value = Date.parse(trade?.entryAt || trade?.firstFillAt || "");
  return Number.isFinite(value) ? value : null;
}

function sampleMs(sample) {
  const value = Date.parse(sample?.timestamp || sample?.at || "");
  return Number.isFinite(value) ? value : null;
}

function favorablePrice(direction, sample) {
  if (direction === "SHORT") return Number(sample?.low ?? sample?.last ?? sample?.price);
  return Number(sample?.high ?? sample?.last ?? sample?.price);
}

function adversePrice(direction, sample) {
  if (direction === "SHORT") return Number(sample?.high ?? sample?.last ?? sample?.price);
  return Number(sample?.low ?? sample?.last ?? sample?.price);
}

function pnlAtPrice(trade, price) {
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const quantity = Number(trade?.initialQuantity ?? trade?.quantity);
  const direction = String(trade?.direction || "LONG").toUpperCase();
  if (![entry, quantity, price].every(Number.isFinite) || quantity <= 0) return null;
  return (direction === "SHORT" ? entry - price : price - entry) * quantity;
}

export function computeLegacyWindowExcursions(trade, marketSamples = [], windowsSec = [300, 600, 900, 1800, 3600]) {
  const start = entryMs(trade);
  if (!Number.isFinite(start)) return {};
  const direction = String(trade?.direction || "LONG").toUpperCase();
  const result = {};

  for (const windowSec of windowsSec) {
    const samples = marketSamples.filter((sample) => {
      const at = sampleMs(sample);
      return Number.isFinite(at) && at >= start && at <= start + windowSec * 1000;
    });
    const favorable = samples.map((sample) => favorablePrice(direction, sample)).filter(Number.isFinite);
    const adverse = samples.map((sample) => adversePrice(direction, sample)).filter(Number.isFinite);
    const favorablePnl = favorable.map((value) => pnlAtPrice(trade, value)).filter(Number.isFinite);
    const adversePnl = adverse.map((value) => pnlAtPrice(trade, value)).filter(Number.isFinite);
    const mfe = favorablePnl.length ? Math.max(0, ...favorablePnl) : null;
    const mae = adversePnl.length ? Math.min(0, ...adversePnl) : null;
    result[windowSec] = { mfeDollars: mfe, maeDollars: mae };
  }

  return result;
}

export function computeScalingAwareExcursions(trade, telemetry = []) {
  const risk = initialRiskDollars(trade);
  const totals = telemetry
    .map((point) => Number(point?.realizedPnl || 0) + Number(point?.unrealizedPnl || 0))
    .filter(Number.isFinite);
  if (!totals.length) return { mfeDollars: null, maeDollars: null, mfeR: null, maeR: null };
  const mfeDollars = Math.max(0, ...totals);
  const maeDollars = Math.min(0, ...totals);
  return {
    mfeDollars,
    maeDollars,
    mfeR: Number.isFinite(risk) && risk > 0 ? mfeDollars / risk : null,
    maeR: Number.isFinite(risk) && risk > 0 ? maeDollars / risk : null,
  };
}

export function aggregateMfeWindows(rows = [], windowsSec = [300, 600, 900, 1800, 3600]) {
  const aggregate = {};
  for (const windowSec of windowsSec) {
    const values = rows.map((row) => Number(row?.excursions?.[windowSec]?.mfeDollars)).filter(Number.isFinite);
    aggregate[windowSec] = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  }
  return aggregate;
}
