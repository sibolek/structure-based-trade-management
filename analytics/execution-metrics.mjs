export function mean(values) {
  const xs = values.map(Number).filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

export function median(values) {
  const xs = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function durationSeconds(trade) {
  const start = Date.parse(trade?.entryAt || trade?.firstFillAt || "");
  const end = Date.parse(trade?.exitAt || trade?.flatAt || "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 1000 : null;
}

export function outcomeFor(trade, epsilon = 1e-9) {
  const pnl = Number(trade?.realizedPnl ?? trade?.realizedGrossPnl);
  if (!Number.isFinite(pnl)) return "UNKNOWN";
  if (pnl > epsilon) return "WIN";
  if (pnl < -epsilon) return "LOSS";
  return "FLAT";
}

export function summarizeDurations(trades = []) {
  const completed = trades.filter((trade) => Number.isFinite(durationSeconds(trade)) && outcomeFor(trade) !== "UNKNOWN");
  const winners = completed.filter((trade) => outcomeFor(trade) === "WIN");
  const losers = completed.filter((trade) => outcomeFor(trade) === "LOSS");
  const flats = completed.filter((trade) => outcomeFor(trade) === "FLAT");
  const winnerSeconds = winners.map(durationSeconds);
  const loserSeconds = losers.map(durationSeconds);
  const winnerMean = mean(winnerSeconds);
  const winnerMedian = median(winnerSeconds);
  const loserMean = mean(loserSeconds);
  const loserMedian = median(loserSeconds);

  return {
    completedTrades: completed.length,
    winners: winners.length,
    losers: losers.length,
    flat: flats.length,
    winRate: winners.length + losers.length ? winners.length / (winners.length + losers.length) : null,
    winner: {
      meanSeconds: winnerMean,
      medianSeconds: winnerMedian,
      meanMinutes: winnerMean == null ? null : winnerMean / 60,
      medianMinutes: winnerMedian == null ? null : winnerMedian / 60,
    },
    loser: {
      meanSeconds: loserMean,
      medianSeconds: loserMedian,
      meanMinutes: loserMean == null ? null : loserMean / 60,
      medianMinutes: loserMedian == null ? null : loserMedian / 60,
    },
  };
}
