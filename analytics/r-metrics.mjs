import { mean, median, outcomeFor } from "./execution-metrics.mjs";

export function initialRiskDollars(trade) {
  const explicit = Number(trade?.initialRisk ?? trade?.plannedRisk);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const stop = Number(trade?.initialStop ?? trade?.structuralStop);
  const quantity = Number(trade?.initialQuantity ?? trade?.quantity);
  if (![entry, stop, quantity].every(Number.isFinite) || quantity <= 0 || entry === stop) return null;
  return Math.abs(entry - stop) * quantity;
}

export function realizedR(trade) {
  const risk = initialRiskDollars(trade);
  const pnl = Number(trade?.realizedPnl ?? trade?.realizedGrossPnl);
  return Number.isFinite(risk) && risk > 0 && Number.isFinite(pnl) ? pnl / risk : null;
}

export function summarizeRMultiples(trades = []) {
  const rows = trades.map((trade) => ({ trade, outcome: outcomeFor(trade), r: realizedR(trade) })).filter((row) => Number.isFinite(row.r));
  const winners = rows.filter((row) => row.outcome === "WIN");
  const losers = rows.filter((row) => row.outcome === "LOSS");
  const winnerRs = winners.map((row) => row.r);
  const loserRs = losers.map((row) => row.r);

  return {
    tradesWithInitialRisk: rows.length,
    winners: winners.length,
    losers: losers.length,
    winner: { meanR: mean(winnerRs), medianR: median(winnerRs) },
    loser: { meanR: mean(loserRs), medianR: median(loserRs) },
    winnersBelowHalfR: winners.filter((row) => row.r < 0.5).length,
    winnersBelowOneR: winners.filter((row) => row.r < 1).length,
    pctWinnersBelowHalfR: winners.length ? winners.filter((row) => row.r < 0.5).length / winners.length : null,
    pctWinnersBelowOneR: winners.length ? winners.filter((row) => row.r < 1).length / winners.length : null,
    losersAtOrBeyondMinusOneR: losers.filter((row) => row.r <= -1).length,
    pctLosersAtOrBeyondMinusOneR: losers.length ? losers.filter((row) => row.r <= -1).length / losers.length : null,
  };
}
