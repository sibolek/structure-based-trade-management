export const V24_ROUTER_LOOP_DELAY_MS = 500;
export const V24_ROUTER_STALE_TOLERANCE_CYCLES = 6;
export const V24_ROUTER_STALE_AFTER_MS =
  V24_ROUTER_LOOP_DELAY_MS * V24_ROUTER_STALE_TOLERANCE_CYCLES;

const INTENTIONAL_NONSTALE_STATES = new Set([
  "WAITING_FOR_SCHWAB",
  "WAITING_FOR_PRETRADE",
  "WAITING_FOR_ROUTER_LOCK",
  "PAUSED",
  "BLOCKED",
  "ERROR",

  // Temporary acceptance-only state. Decision 22A removes this when
  // the final default-on/negative-kill-switch transition is accepted.
  "DISABLED_PENDING_ACCEPTANCE",
]);

function timestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function isV24RouterHeartbeatStale({
  leader,
  status,
  lastHeartbeatAt,
  now = Date.now(),
  staleAfterMs = V24_ROUTER_STALE_AFTER_MS,
} = {}) {
  if (!leader) return false;

  const currentStatus = String(status || "").trim().toUpperCase();
  if (currentStatus === "STALE") return true;
  if (INTENTIONAL_NONSTALE_STATES.has(currentStatus)) return false;
  if (currentStatus !== "RUNNING") return false;

  const heartbeatAt = timestampMs(lastHeartbeatAt);
  if (heartbeatAt === null) return false;

  const currentTime = Number(now);
  const tolerance = Number(staleAfterMs);
  if (!Number.isFinite(currentTime) || !Number.isFinite(tolerance) || tolerance < 0) {
    return false;
  }

  return currentTime - heartbeatAt > tolerance;
}

export function deriveV24RouterHealthStatus(options = {}) {
  return isV24RouterHeartbeatStale(options)
    ? "STALE"
    : String(options.status || "").trim().toUpperCase();
}
