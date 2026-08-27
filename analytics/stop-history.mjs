function upper(value) { return String(value || "").toUpperCase(); }
function timeMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function eventTime(order) {
  return timeMs(order?.enteredTime) ?? timeMs(order?.closeTime) ?? timeMs(order?.cancelTime);
}

function isStopOrder(order) {
  return upper(order?.orderType).includes("STOP") && Number.isFinite(Number(order?.stopPrice));
}

function isClosingInstruction(trade, order) {
  const instruction = upper(order?.instruction);
  if (upper(trade?.direction) === "SHORT") return instruction === "BUY_TO_COVER" || instruction === "BUY";
  return instruction === "SELL";
}

function baseCandidate(trade, order) {
  if (String(order?.accountKey || "") !== String(trade?.accountKey || "")) return false;
  if (upper(order?.symbol) !== upper(trade?.symbol)) return false;
  if (upper(order?.positionEffect) !== "CLOSING") return false;
  return isClosingInstruction(trade, order) && isStopOrder(order);
}

function dedupeAndSort(rows) {
  const map = new Map();
  for (const order of rows) {
    const key = `${order.orderId}|${order.legId}|${order.stopPrice}|${order.enteredTime || ""}|${order.status || ""}`;
    if (!map.has(key)) map.set(key, order);
  }
  return [...map.values()].sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
}

export function strictStopSnapshotsForTrade(trade, snapshots = [], { includeRejected = false } = {}) {
  const entry = timeMs(trade?.entryAt);
  const exit = timeMs(trade?.exitAt);
  const parentIds = new Set((trade?.fills || []).map((fill) => String(fill?.orderId || "")).filter(Boolean));

  return dedupeAndSort(snapshots.filter((order) => {
    if (!baseCandidate(trade, order)) return false;
    if (!includeRejected && upper(order?.status) === "REJECTED") return false;
    const t = eventTime(order);
    if (!Number.isFinite(t) || !Number.isFinite(entry) || !Number.isFinite(exit)) return false;
    if (t >= entry && t <= exit) return true;
    const parentMatch = order.parentOrderId != null && parentIds.has(String(order.parentOrderId));
    return parentMatch && t >= entry - 10_000 && t < entry;
  }));
}

export function stopAtOrBeyondEntry(trade, stopPrice) {
  const entry = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const stop = Number(stopPrice);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? stop <= entry : stop >= entry;
}

export function stopTightens(trade, previousStop, newStop) {
  const previous = Number(previousStop);
  const next = Number(newStop);
  if (![previous, next].every(Number.isFinite)) return false;
  return upper(trade?.direction) === "SHORT" ? next < previous : next > previous;
}

export function historicalStopEventsForTrade(trade, snapshots = []) {
  const stops = strictStopSnapshotsForTrade(trade, snapshots, { includeRejected: true });
  return stops.map((order, index) => {
    const previous = index > 0 ? Number(stops[index - 1]?.stopPrice) : null;
    const next = Number(order?.stopPrice);
    const rejected = upper(order?.status) === "REJECTED";
    return {
      type: "STOP_ORDER_ACTION",
      timestamp: order?.enteredTime || order?.closeTime || order?.cancelTime || null,
      previousStop: Number.isFinite(previous) ? previous : null,
      newStop: next,
      status: upper(order?.status),
      orderId: order?.orderId ?? null,
      rejected,
      tightening: Number.isFinite(previous) ? stopTightens(trade, previous, next) : null,
      classification: stopAtOrBeyondEntry(trade, next) ? "BE_OR_PROFIT" : "OTHER",
    };
  });
}

export function productionStopEventsForTrade(trade, snapshots = []) {
  const stops = strictStopSnapshotsForTrade(trade, snapshots, { includeRejected: false });
  const events = [];
  for (let i = 1; i < stops.length; i += 1) {
    const previous = Number(stops[i - 1]?.stopPrice);
    const next = Number(stops[i]?.stopPrice);
    if (![previous, next].every(Number.isFinite) || previous === next) continue;
    events.push({
      type: "STOP_CHANGED",
      timestamp: stops[i]?.enteredTime || stops[i]?.closeTime || stops[i]?.cancelTime || null,
      previousStop: previous,
      newStop: next,
      status: upper(stops[i]?.status),
      orderId: stops[i]?.orderId ?? null,
      classification: stopAtOrBeyondEntry(trade, next) && stopTightens(trade, previous, next) ? "BE_OR_PROFIT" : "OTHER",
    });
  }
  return events;
}
