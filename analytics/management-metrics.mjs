import { mean, median, outcomeFor } from "./execution-metrics.mjs";

function ageSeconds(trade, event) {
  const entry = Date.parse(trade?.entryAt || trade?.firstFillAt || "");
  const at = Date.parse(event?.timestamp || event?.at || "");
  return Number.isFinite(entry) && Number.isFinite(at) && at >= entry ? (at - entry) / 1000 : null;
}

export function isStopTightening(trade, event) {
  if (String(event?.type || "").toUpperCase() !== "STOP_CHANGED") return false;
  const direction = String(trade?.direction || "LONG").toUpperCase();
  const previous = Number(event?.previousStop);
  const next = Number(event?.newStop);
  if (![previous, next].every(Number.isFinite)) return false;
  return direction === "SHORT" ? next < previous : next > previous;
}

export function isBreakevenOrProfitStop(trade, event) {
  if (String(event?.classification || "").toUpperCase() === "BE_OR_PROFIT") return true;
  if (!isStopTightening(trade, event)) return false;
  const direction = String(trade?.direction || "LONG").toUpperCase();
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const next = Number(event?.newStop);
  if (![entry, next].every(Number.isFinite)) return false;
  return direction === "SHORT" ? next <= entry : next >= entry;
}

export function firstProtectiveStopMove(trade, { mode = "BE_OR_PROFIT", eventField = "managementEvents" } = {}) {
  const events = Array.isArray(trade?.[eventField]) ? trade[eventField] : [];
  const predicate = mode === "TIGHTENING" ? isStopTightening : isBreakevenOrProfitStop;
  return events
    .filter((event) => predicate(trade, event))
    .map((event) => ({ ...event, entryAgeSec: ageSeconds(trade, event) }))
    .filter((event) => Number.isFinite(event.entryAgeSec))
    .sort((a, b) => a.entryAgeSec - b.entryAgeSec)[0] || null;
}

function summarizeRows(rows, { mode, eventField }) {
  const winnerMoves = rows.filter((row) => row.outcome === "WIN" && row.first);
  const loserMoves = rows.filter((row) => row.outcome === "LOSS" && row.first);
  const winnerAges = winnerMoves.map((row) => row.first.entryAgeSec);

  return {
    mode,
    eventField,
    winnersWithProtectiveMove: winnerMoves.length,
    losersWithProtectiveMove: loserMoves.length,
    medianWinnerMoveSec: median(winnerAges),
    meanWinnerMoveSec: mean(winnerAges),
    winnersMovedWithin60Sec: winnerMoves.filter((row) => row.first.entryAgeSec <= 60).length,
    winnersMovedWithin120Sec: winnerMoves.filter((row) => row.first.entryAgeSec <= 120).length,
    pctMovedWithin60Sec: winnerMoves.length ? winnerMoves.filter((row) => row.first.entryAgeSec <= 60).length / winnerMoves.length : null,
    pctMovedWithin120Sec: winnerMoves.length ? winnerMoves.filter((row) => row.first.entryAgeSec <= 120).length / winnerMoves.length : null,
  };
}

export function summarizeStopMovements(trades = [], options = {}) {
  const eventField = options.eventField || "managementEvents";
  const mode = options.mode || "BE_OR_PROFIT";
  const rows = trades.map((trade) => ({
    trade,
    first: firstProtectiveStopMove(trade, { mode, eventField }),
    outcome: outcomeFor(trade),
  }));
  return summarizeRows(rows, { mode, eventField });
}

export function firstHistoricalBeProfitAction(trade) {
  const events = Array.isArray(trade?.historicalManagementEvents) ? trade.historicalManagementEvents : [];
  return events
    .filter((event) => String(event?.type || "").toUpperCase() === "STOP_ORDER_ACTION")
    .filter((event) => String(event?.classification || "").toUpperCase() === "BE_OR_PROFIT")
    .map((event) => ({ ...event, entryAgeSec: ageSeconds(trade, event) }))
    .filter((event) => Number.isFinite(event.entryAgeSec))
    .sort((a, b) => a.entryAgeSec - b.entryAgeSec)[0] || null;
}

export function summarizeHistoricalStopActions(trades = []) {
  const rows = trades.map((trade) => ({
    trade,
    first: firstHistoricalBeProfitAction(trade),
    outcome: outcomeFor(trade),
  }));
  return summarizeRows(rows, {
    mode: "HISTORICAL_ORDER_ACTION",
    eventField: "historicalManagementEvents",
  });
}
