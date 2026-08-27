export function signedQuantity(instruction, quantity) {
  const qty = Number(quantity || 0);
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

function sideFor(quantity) {
  return quantity > 0 ? "LONG" : quantity < 0 ? "SHORT" : "FLAT";
}

function sameDirection(a, b) {
  return (a > 0 && b > 0) || (a < 0 && b < 0);
}

function weightedAverage(oldAvg, oldQty, fillPrice, addQty) {
  const denominator = Math.abs(oldQty) + Math.abs(addQty);
  if (!denominator) return 0;
  return ((Number(oldAvg || 0) * Math.abs(oldQty)) + (Number(fillPrice || 0) * Math.abs(addQty))) / denominator;
}

export function createSymbolState(symbol, initial = {}) {
  const rawQuantity = Number(initial.quantity || 0);
  const quantity = Number.isFinite(rawQuantity) ? rawQuantity : 0;
  const rawAveragePrice = Number(initial.averagePrice || 0);
  const averagePrice = quantity === 0 || !Number.isFinite(rawAveragePrice) ? 0 : rawAveragePrice;

  return {
    symbol,
    quantity,
    side: sideFor(quantity),
    averagePrice,
    realizedGrossPnl: Number(initial.realizedGrossPnl || 0),
    completedTrades: Number(initial.completedTrades || 0),
  };
}

export function applyExecution(state, fill) {
  const previousQty = Number(state.quantity || 0);
  const previousAvg = Number(state.averagePrice || 0);
  const delta = signedQuantity(fill.instruction, fill.quantity);
  const price = Number(fill.price || 0);
  const nextQty = previousQty + delta;

  let event = "NO_CHANGE";
  let closedQuantity = 0;
  let realizedGrossPnl = 0;
  let nextAvg = previousAvg;

  if (previousQty === 0 && nextQty !== 0) {
    event = "ENTRY";
    nextAvg = price;
  } else if (previousQty !== 0 && nextQty === 0) {
    event = "FLAT";
    closedQuantity = Math.min(Math.abs(delta), Math.abs(previousQty));
    if (previousQty > 0 && delta < 0) realizedGrossPnl = (price - previousAvg) * closedQuantity;
    if (previousQty < 0 && delta > 0) realizedGrossPnl = (previousAvg - price) * closedQuantity;
    nextAvg = 0;
  } else if (sameDirection(previousQty, nextQty)) {
    if (Math.abs(nextQty) > Math.abs(previousQty)) {
      event = "ADD";
      nextAvg = weightedAverage(previousAvg, previousQty, price, delta);
    } else if (Math.abs(nextQty) < Math.abs(previousQty)) {
      event = "PARTIAL";
      closedQuantity = Math.min(Math.abs(delta), Math.abs(previousQty));
      if (previousQty > 0 && delta < 0) realizedGrossPnl = (price - previousAvg) * closedQuantity;
      if (previousQty < 0 && delta > 0) realizedGrossPnl = (previousAvg - price) * closedQuantity;
    }
  } else if (previousQty !== 0 && nextQty !== 0 && !sameDirection(previousQty, nextQty)) {
    event = "REVERSAL";
    closedQuantity = Math.abs(previousQty);
    if (previousQty > 0 && delta < 0) realizedGrossPnl = (price - previousAvg) * closedQuantity;
    if (previousQty < 0 && delta > 0) realizedGrossPnl = (previousAvg - price) * closedQuantity;
    nextAvg = price;
  }

  const nextState = {
    ...state,
    quantity: nextQty,
    side: sideFor(nextQty),
    averagePrice: nextAvg,
    realizedGrossPnl: Number(state.realizedGrossPnl || 0) + realizedGrossPnl,
    completedTrades: Number(state.completedTrades || 0) + (event === "FLAT" || event === "REVERSAL" ? 1 : 0),
  };

  return {
    event,
    previousQuantity: previousQty,
    nextQuantity: nextQty,
    previousSide: sideFor(previousQty),
    nextSide: sideFor(nextQty),
    delta,
    closedQuantity,
    realizedGrossPnl,
    nextAveragePrice: nextAvg,
    state: nextState,
  };
}
