import { applyExecution, createSymbolState } from "./trade-state.mjs";

const MATCH_WINDOW_MS = 5 * 60 * 1000;

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function effectPriority(effect) {
  const normalized = String(effect || "").toUpperCase();
  if (normalized === "CLOSING") return 0;
  if (normalized === "OPENING") return 1;
  return 2;
}

function compareExecutionRows(a, b) {
  const timeDiff = Date.parse(a.time || "") - Date.parse(b.time || "");
  if (timeDiff !== 0) return timeDiff;
  const effectDiff = effectPriority(a.positionEffect) - effectPriority(b.positionEffect);
  if (effectDiff !== 0) return effectDiff;
  const accountDiff = String(a.accountKey || "").localeCompare(String(b.accountKey || ""));
  if (accountDiff !== 0) return accountDiff;
  return String(a.orderId ?? "").localeCompare(String(b.orderId ?? ""), undefined, { numeric: true });
}

function cycleKey(row) {
  return `${row.accountKey || "A?"}|${String(row.symbol || "?").toUpperCase()}`;
}

function newCycle(row, result, openingQuantity = null, openingPrice = null) {
  const qty = openingQuantity ?? Math.abs(result.nextQuantity);
  const price = openingPrice ?? Number(row.price);
  return {
    accountKey: row.accountKey || "A?",
    symbol: String(row.symbol || "?").toUpperCase(),
    direction: result.nextSide,
    startedAt: row.time,
    endedAt: null,
    peakQuantity: Math.abs(result.nextQuantity),
    entryQuantity: qty,
    entryValue: qty * price,
    exitQuantity: 0,
    exitValue: 0,
    grossPnl: 0,
    executionLegs: 1,
    partialExits: 0,
    adds: 0,
    reversalEnded: false,
    status: "OPEN",
  };
}

function finalizeCycle(cycle, row, reversed = false) {
  return {
    ...cycle,
    endedAt: row.time,
    entryVwap: cycle.entryQuantity ? cycle.entryValue / cycle.entryQuantity : null,
    exitVwap: cycle.exitQuantity ? cycle.exitValue / cycle.exitQuantity : null,
    reversalEnded: reversed,
    status: reversed ? "REVERSAL" : "CLOSED",
  };
}

function openCycleSnapshot(cycle) {
  return {
    ...cycle,
    entryVwap: cycle.entryQuantity ? cycle.entryValue / cycle.entryQuantity : null,
    exitVwap: cycle.exitQuantity ? cycle.exitValue / cycle.exitQuantity : null,
    status: "OPEN",
  };
}

export function reconstructDailyTrades(executionLegs = [], { date = localDateKey(), symbol = null } = {}) {
  const targetSymbol = symbol ? String(symbol).toUpperCase() : null;
  const rows = executionLegs
    .filter((row) => localDateKey(row.time) === date)
    .filter((row) => !targetSymbol || String(row.symbol || "").toUpperCase() === targetSymbol)
    .sort(compareExecutionRows);

  const states = new Map();
  const cycles = new Map();
  const completedTrades = [];
  const incompleteActivity = [];
  const warnedKeys = new Set();
  const warnings = [];

  for (const row of rows) {
    const key = cycleKey(row);
    const current = states.get(key) || createSymbolState(String(row.symbol || "?").toUpperCase());
    const activeCycle = cycles.get(key) || null;
    const effect = String(row.positionEffect || "").toUpperCase();

    if (current.quantity === 0 && !activeCycle && effect === "CLOSING") {
      incompleteActivity.push({ ...row, reason: "POSITION_OPENED_BEFORE_REPORT_WINDOW" });
      if (!warnedKeys.has(key)) {
        warnedKeys.add(key);
        warnings.push(`${row.symbol}: first same-day activity is CLOSING, so P/L for that pre-existing position cannot be reconstructed from the daily window.`);
      }
      continue;
    }

    const result = applyExecution(current, row);
    states.set(key, result.state);

    let cycle = activeCycle;
    if (result.event === "ENTRY") {
      cycle = newCycle(row, result);
      cycles.set(key, cycle);
      continue;
    }

    if (!cycle) {
      incompleteActivity.push({ ...row, reason: "NO_ACTIVE_RECONSTRUCTED_CYCLE" });
      continue;
    }

    cycle.executionLegs += 1;
    cycle.peakQuantity = Math.max(cycle.peakQuantity, Math.abs(result.nextQuantity), Math.abs(result.previousQuantity));

    if (result.event === "ADD") {
      const added = Math.abs(result.delta);
      cycle.entryQuantity += added;
      cycle.entryValue += added * Number(row.price);
      cycle.adds += 1;
    }

    if (result.event === "PARTIAL" || result.event === "FLAT" || result.event === "REVERSAL") {
      const closed = Number(result.closedQuantity || 0);
      if (closed > 0) {
        cycle.exitQuantity += closed;
        cycle.exitValue += closed * Number(row.price);
        cycle.grossPnl += Number(result.realizedGrossPnl || 0);
      }
      if (result.event === "PARTIAL") cycle.partialExits += 1;
    }

    if (result.event === "FLAT" || result.event === "REVERSAL") {
      completedTrades.push(finalizeCycle(cycle, row, result.event === "REVERSAL"));
      cycles.delete(key);

      if (result.event === "REVERSAL" && result.nextQuantity !== 0) {
        const residual = Math.abs(result.nextQuantity);
        cycles.set(key, newCycle(row, result, residual, Number(result.nextAveragePrice)));
      }
    }
  }

  const openTrades = [...cycles.values()].map(openCycleSnapshot);
  return { date, symbol: targetSymbol, rows, completedTrades, openTrades, incompleteActivity, warnings };
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function plannedRiskFromHistory(trade) {
  const entry = safeNumber(trade?.risk?.expectedEntry);
  const stop = safeNumber(trade?.originalPlan?.structuralStop);
  const size = safeNumber(trade?.risk?.intendedSize);
  if ([entry, stop, size].some((value) => value == null) || size <= 0) return null;
  return Math.abs(entry - stop) * size;
}

function executionStateStats(decisions = []) {
  let threatened = 0;
  let invalid = 0;
  let validAfterThreat = 0;
  let threatSeen = false;
  for (const item of decisions) {
    const state = String(item?.state || "").toUpperCase();
    if (state === "THREATENED") {
      threatened += 1;
      threatSeen = true;
    } else if (state === "INVALID") {
      invalid += 1;
    } else if (state === "VALID" && threatSeen) {
      validAfterThreat += 1;
      threatSeen = false;
    }
  }
  return { threatened, invalid, validAfterThreat };
}

export function enrichWithExecutionOs(trades = [], executionOsPayload, { date = localDateKey() } = {}) {
  if (!executionOsPayload || !Array.isArray(executionOsPayload.history)) {
    return { trades: trades.map((trade) => ({ ...trade, executionOs: null })), matched: 0, unmatchedHistory: [], exportLoaded: false };
  }

  const history = executionOsPayload.history.filter((trade) => localDateKey(trade.completedAt) === date);
  const used = new Set();
  const enriched = trades.map((trade, tradeIndex) => ({ ...trade, _tradeIndex: tradeIndex, executionOs: null }));
  const unmatchedHistory = [];

  for (const historyTrade of history) {
    const symbol = String(historyTrade?.originalPlan?.symbol || "").toUpperCase();
    const direction = String(historyTrade?.originalPlan?.direction || "").toUpperCase();
    const entryMs = Date.parse(historyTrade?.broker?.entryDetectedAt || "");

    const candidates = enriched
      .filter((trade) => !used.has(trade._tradeIndex) && trade.symbol === symbol && trade.direction === direction)
      .map((trade) => ({ trade, delta: Number.isFinite(entryMs) ? Math.abs(Date.parse(trade.startedAt) - entryMs) : Infinity }))
      .filter((item) => item.delta <= MATCH_WINDOW_MS)
      .sort((a, b) => a.delta - b.delta);

    if (!candidates.length) {
      unmatchedHistory.push(historyTrade);
      continue;
    }

    const match = candidates[0].trade;
    used.add(match._tradeIndex);
    const plannedRisk = plannedRiskFromHistory(historyTrade);
    const structuralStop = safeNumber(historyTrade?.originalPlan?.structuralStop);
    const actualEntryRisk = structuralStop != null && match.entryVwap != null
      ? Math.abs(match.entryVwap - structuralStop) * match.peakQuantity
      : null;
    const rMultiple = plannedRisk && plannedRisk > 0 ? match.grossPnl / plannedRisk : null;

    match.executionOs = {
      id: historyTrade.id,
      setup: historyTrade?.originalPlan?.setup || "",
      timeframe: historyTrade?.originalPlan?.timeframe || "",
      thesis: historyTrade?.originalPlan?.thesis || "",
      trigger: historyTrade?.originalPlan?.trigger || "",
      invalidation: historyTrade?.originalPlan?.invalidation || "",
      structuralStop,
      target: historyTrade?.originalPlan?.target || "",
      management: historyTrade?.originalPlan?.management || "",
      expectedEntry: safeNumber(historyTrade?.risk?.expectedEntry),
      intendedSize: safeNumber(historyTrade?.risk?.intendedSize),
      plannedRisk,
      actualEntryRisk,
      rMultiple,
      exitClassification: historyTrade?.exit?.classification || "",
      exitReason: historyTrade?.exit?.reason || "",
      decisions: Array.isArray(historyTrade?.decisions) ? historyTrade.decisions : [],
      stateStats: executionStateStats(historyTrade?.decisions),
      completedAt: historyTrade.completedAt,
    };
  }

  return {
    trades: enriched.map(({ _tradeIndex, ...trade }) => trade),
    matched: used.size,
    unmatchedHistory,
    exportLoaded: true,
  };
}

export function summarizeReport({ completedTrades = [], openTrades = [], incompleteActivity = [], executionExportLoaded = false } = {}) {
  const realizedCycles = [...completedTrades, ...openTrades];
  const grossPnl = realizedCycles.reduce((sum, trade) => sum + Number(trade.grossPnl || 0), 0);
  const winners = completedTrades.filter((trade) => trade.grossPnl > 0);
  const losers = completedTrades.filter((trade) => trade.grossPnl < 0);
  const flats = completedTrades.filter((trade) => trade.grossPnl === 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.grossPnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.grossPnl, 0));
  const owned = completedTrades.filter((trade) => trade.executionOs);
  const plannedRisks = owned.map((trade) => trade.executionOs.plannedRisk).filter((value) => Number.isFinite(value));
  const rValues = owned.map((trade) => trade.executionOs.rMultiple).filter((value) => Number.isFinite(value));
  const stateStats = owned.reduce((acc, trade) => {
    acc.threatened += trade.executionOs.stateStats.threatened;
    acc.invalid += trade.executionOs.stateStats.invalid;
    acc.validAfterThreat += trade.executionOs.stateStats.validAfterThreat;
    return acc;
  }, { threatened: 0, invalid: 0, validAfterThreat: 0 });

  return {
    completed: completedTrades.length,
    open: openTrades.length,
    winners: winners.length,
    losers: losers.length,
    flats: flats.length,
    winRate: completedTrades.length ? winners.length / completedTrades.length : null,
    grossPnl,
    averageWinner: winners.length ? grossProfit / winners.length : null,
    averageLoser: losers.length ? -grossLoss / losers.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    largestWinner: winners.length ? Math.max(...winners.map((trade) => trade.grossPnl)) : null,
    largestLoser: losers.length ? Math.min(...losers.map((trade) => trade.grossPnl)) : null,
    contextIncomplete: incompleteActivity.length > 0,
    incompleteExecutionLegs: incompleteActivity.length,
    executionExportLoaded,
    executionOwnedTrades: owned.length,
    brokerOnlyTrades: executionExportLoaded ? completedTrades.length - owned.length : null,
    totalPlannedRisk: plannedRisks.length ? plannedRisks.reduce((a, b) => a + b, 0) : null,
    averagePlannedRisk: plannedRisks.length ? plannedRisks.reduce((a, b) => a + b, 0) / plannedRisks.length : null,
    maxPlannedRisk: plannedRisks.length ? Math.max(...plannedRisks) : null,
    totalR: rValues.length ? rValues.reduce((a, b) => a + b, 0) : null,
    averageR: rValues.length ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null,
    bestR: rValues.length ? Math.max(...rValues) : null,
    worstR: rValues.length ? Math.min(...rValues) : null,
    stateStats,
  };
}
