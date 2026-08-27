function upper(value) { return String(value || "").toUpperCase(); }
function timeMs(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : null;
}

function isStopOrder(order) {
  return upper(order?.orderType).includes("STOP") && Number.isFinite(Number(order?.stopPrice));
}

function isAccepted(order) {
  return upper(order?.status) !== "REJECTED";
}

function isClosingInstruction(trade, order) {
  const instruction = upper(order?.instruction);
  if (upper(trade?.direction) === "SHORT") return instruction === "BUY_TO_COVER" || instruction === "BUY";
  return instruction === "SELL";
}

function lossSideOfBasis(direction, basis, stopPrice) {
  const entry = Number(basis);
  const stop = Number(stopPrice);
  if (![entry, stop].every(Number.isFinite)) return false;
  return upper(direction) === "SHORT" ? stop > entry : stop < entry;
}

export function acceptedHistoricalStopsInEpisode(trade, snapshots = []) {
  const entry = timeMs(trade?.entryAt);
  const exit = timeMs(trade?.exitAt);
  if (![entry, exit].every(Number.isFinite)) return [];

  return snapshots
    .filter((order) => {
      if (String(order?.accountKey || "") !== String(trade?.accountKey || "")) return false;
      if (upper(order?.symbol) !== upper(trade?.symbol)) return false;
      if (upper(order?.positionEffect) !== "CLOSING") return false;
      if (!isAccepted(order) || !isStopOrder(order) || !isClosingInstruction(trade, order)) return false;
      const entered = timeMs(order?.enteredTime);
      return Number.isFinite(entered) && entered >= entry && entered <= exit;
    })
    .sort((a, b) => timeMs(a?.enteredTime) - timeMs(b?.enteredTime));
}

/**
 * Best reconstructible historical initial-risk rule recovered from the 30-day study fingerprint.
 *
 * Population rule:
 *   The first accepted closing stop observed inside the flat-to-flat episode must already be
 *   on the loss side of the episode's blended opening-fill VWAP. If it is not, original risk
 *   is considered non-defensible from the retained order history and the trade is excluded.
 *
 * R denominator:
 *   abs(episode entryVWAP - first accepted loss-side stop) * peakQuantity.
 *
 * This is a historical-reproduction convention, not the production TradeContract risk model.
 * It is intentionally not special-cased to force the preserved 54.2% loser-threshold statistic.
 */
export function recoverHistoricalInitialRisk(trade, snapshots = []) {
  const entryVWAP = Number(trade?.entryVWAP ?? trade?.entryPrice);
  const peakQuantity = Number(trade?.peakQuantity ?? trade?.initialQuantity ?? trade?.quantity);
  if (!Number.isFinite(entryVWAP) || !Number.isFinite(peakQuantity) || peakQuantity <= 0) return null;

  const first = acceptedHistoricalStopsInEpisode(trade, snapshots)[0] || null;
  if (!first || !lossSideOfBasis(trade?.direction, entryVWAP, first?.stopPrice)) return null;

  const initialStop = Number(first.stopPrice);
  const initialRisk = Math.abs(entryVWAP - initialStop) * peakQuantity;
  if (!Number.isFinite(initialRisk) || initialRisk <= 0) return null;

  return {
    initialStop,
    initialRisk,
    historicalRiskBasis: {
      populationBasis: "FIRST_ACCEPTED_IN_EPISODE_STOP_LOSS_SIDE_OF_EPISODE_VWAP",
      entryBasis: "EPISODE_OPENING_FILL_VWAP",
      quantityBasis: "PEAK_EPISODE_QUANTITY",
      stopEnteredAt: first.enteredTime || null,
      stopStatus: upper(first.status),
    },
  };
}
