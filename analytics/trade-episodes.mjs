function signedQuantity(instruction, quantity) {
  const qty = Math.abs(Number(quantity || 0));
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  switch (String(instruction || "").toUpperCase()) {
    case "BUY":
    case "BUY_TO_COVER":
      return qty;
    case "SELL":
    case "SELL_SHORT":
      return -qty;
    default:
      return 0;
  }
}

function sideForSignedQuantity(value) {
  return value > 0 ? "LONG" : value < 0 ? "SHORT" : "FLAT";
}

function tradeDay(value, timeZone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function effectRank(value) {
  const effect = String(value || "").toUpperCase();
  if (effect === "CLOSING") return 0;
  if (effect === "OPENING") return 1;
  return 2;
}

function looksEquityLike(row) {
  const assetType = String(row?.assetType || row?.instrumentType || "").toUpperCase();
  if (assetType.includes("OPTION")) return false;
  if (assetType.includes("EQUITY")) return true;
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.\-]{0,7}$/.test(symbol);
}

function vwap(fills) {
  let dollars = 0;
  let quantity = 0;
  for (const fill of fills || []) {
    const qty = Math.abs(Number(fill.quantity || 0));
    const price = Number(fill.price);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price)) continue;
    dollars += qty * price;
    quantity += qty;
  }
  return quantity ? dollars / quantity : null;
}

function compactFill(row, quantityOverride = null) {
  return {
    orderId: row.orderId,
    time: row.time,
    instruction: row.instruction,
    positionEffect: row.positionEffect || "",
    quantity: quantityOverride ?? Math.abs(Number(row.quantity || 0)),
    price: Number(row.price),
  };
}

function createEpisode(row, group, sequence, quantity) {
  const signed = signedQuantity(row.instruction, quantity);
  const side = sideForSignedQuantity(signed);
  const fill = compactFill(row, Math.abs(quantity));
  return {
    id: `${group.day}:${group.accountKey}:${group.symbol}:${sequence}`,
    accountKey: group.accountKey,
    symbol: group.symbol,
    assetType: row.assetType || row.instrumentType || "",
    tradingDay: group.day,
    direction: side,
    entryAt: row.time,
    firstFillAt: row.time,
    initialOrderId: row.orderId,
    initialFills: [fill],
    openingFills: [fill],
    closingFills: [],
    quantity: Math.abs(quantity),
    peakQuantity: Math.abs(quantity),
    averagePrice: Number(row.price),
    realizedGrossPnl: 0,
    fills: [fill],
  };
}

function finalizeEpisode(active, exitAt) {
  const initialQuantity = active.initialFills.reduce((sum, fill) => sum + Math.abs(Number(fill.quantity || 0)), 0);
  return {
    id: active.id,
    accountKey: active.accountKey,
    symbol: active.symbol,
    assetType: active.assetType,
    tradingDay: active.tradingDay,
    direction: active.direction,
    entryAt: active.entryAt,
    firstFillAt: active.firstFillAt,
    exitAt,
    flatAt: exitAt,
    entryPrice: vwap(active.initialFills),
    entryVWAP: vwap(active.openingFills),
    exitVWAP: vwap(active.closingFills),
    initialQuantity,
    peakQuantity: active.peakQuantity,
    realizedPnl: active.realizedGrossPnl,
    realizedGrossPnl: active.realizedGrossPnl,
    initialOrderId: active.initialOrderId,
    fills: active.fills,
  };
}

function canStartEpisode(row) {
  const effect = String(row.positionEffect || "").toUpperCase();
  const instruction = String(row.instruction || "").toUpperCase();
  if (effect === "CLOSING") return false;
  if (effect === "OPENING") return true;
  return instruction === "BUY" || instruction === "SELL_SHORT";
}

function sameDirection(active, signed) {
  return (active.direction === "LONG" && signed > 0) || (active.direction === "SHORT" && signed < 0);
}

export function reconstructSameDayEpisodes(executionLegs = [], options = {}) {
  const timeZone = options.timeZone || "America/New_York";
  const includeNonEquity = options.includeNonEquity === true;
  const diagnostics = {
    inputExecutionLegs: executionLegs.length,
    eligibleExecutionLegs: 0,
    invalidExecutionLegs: 0,
    carryInClosuresIgnored: 0,
    incompleteEpisodesIgnored: 0,
    oppositeOpeningAnomalies: 0,
  };

  const groups = new Map();
  for (const row of executionLegs) {
    if (!includeNonEquity && !looksEquityLike(row)) continue;
    const day = tradeDay(row.time, timeZone);
    const quantity = Math.abs(Number(row.quantity || 0));
    const price = Number(row.price);
    const signed = signedQuantity(row.instruction, quantity);
    if (!day || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || signed === 0) {
      diagnostics.invalidExecutionLegs += 1;
      continue;
    }
    diagnostics.eligibleExecutionLegs += 1;
    const accountKey = String(row.accountKey || "A?");
    const symbol = String(row.symbol || "?").toUpperCase();
    const key = `${accountKey}|${symbol}|${day}`;
    if (!groups.has(key)) groups.set(key, { accountKey, symbol, day, rows: [] });
    groups.get(key).rows.push(row);
  }

  const trades = [];
  for (const group of groups.values()) {
    group.rows.sort((a, b) => {
      const timeDiff = Date.parse(a.time) - Date.parse(b.time);
      if (timeDiff) return timeDiff;
      const effectDiff = effectRank(a.positionEffect) - effectRank(b.positionEffect);
      if (effectDiff) return effectDiff;
      return String(a.orderId || "").localeCompare(String(b.orderId || ""));
    });

    let active = null;
    let sequence = 1;

    for (const row of group.rows) {
      let remaining = Math.abs(Number(row.quantity || 0));
      const signed = signedQuantity(row.instruction, remaining);
      const effect = String(row.positionEffect || "").toUpperCase();

      if (!active) {
        if (!canStartEpisode(row)) {
          diagnostics.carryInClosuresIgnored += 1;
          continue;
        }
        active = createEpisode(row, group, sequence, remaining);
        continue;
      }

      if (sameDirection(active, signed)) {
        if (effect === "CLOSING") {
          diagnostics.oppositeOpeningAnomalies += 1;
          continue;
        }
        const fill = compactFill(row, remaining);
        const oldQty = active.quantity;
        const newQty = oldQty + remaining;
        active.averagePrice = ((active.averagePrice * oldQty) + (Number(row.price) * remaining)) / newQty;
        active.quantity = newQty;
        active.peakQuantity = Math.max(active.peakQuantity, newQty);
        active.openingFills.push(fill);
        active.fills.push(fill);
        if (String(row.orderId) === String(active.initialOrderId)) active.initialFills.push(fill);
        continue;
      }

      const closeQty = Math.min(remaining, active.quantity);
      if (closeQty > 0) {
        const price = Number(row.price);
        const pnlPerShare = active.direction === "LONG" ? price - active.averagePrice : active.averagePrice - price;
        active.realizedGrossPnl += pnlPerShare * closeQty;
        active.quantity -= closeQty;
        const closeFill = compactFill(row, closeQty);
        active.closingFills.push(closeFill);
        active.fills.push(closeFill);
        remaining -= closeQty;
      }

      if (active.quantity === 0) {
        trades.push(finalizeEpisode(active, row.time));
        sequence += 1;
        active = null;
      }

      if (remaining > 0 && effect !== "CLOSING") {
        active = createEpisode(row, group, sequence, remaining);
      }
    }

    if (active) diagnostics.incompleteEpisodesIgnored += 1;
  }

  trades.sort((a, b) => Date.parse(a.entryAt) - Date.parse(b.entryAt));
  return { trades, diagnostics, timeZone };
}
