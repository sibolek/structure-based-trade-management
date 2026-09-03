import test from "node:test";
import assert from "node:assert/strict";

import {
  V24_ROUTER_LOOP_DELAY_MS,
  V24_ROUTER_STALE_AFTER_MS,
  V24_ROUTER_STALE_TOLERANCE_CYCLES,
  deriveV24RouterHealthStatus,
  isV24RouterHeartbeatStale,
} from "../src/execution/execution-v24-router-health.js";

const HEARTBEAT = "2026-09-03T20:00:00.000Z";
const HEARTBEAT_MS = Date.parse(HEARTBEAT);

test("router stale threshold is derived from loop cadence and tested tolerance cycles", () => {
  assert.equal(
    V24_ROUTER_STALE_AFTER_MS,
    V24_ROUTER_LOOP_DELAY_MS * V24_ROUTER_STALE_TOLERANCE_CYCLES,
  );
  assert.equal(V24_ROUTER_STALE_AFTER_MS > V24_ROUTER_LOOP_DELAY_MS, true);
});

test("healthy RUNNING heartbeat remains RUNNING through the tolerance boundary", () => {
  assert.equal(isV24RouterHeartbeatStale({
    leader: true,
    status: "RUNNING",
    lastHeartbeatAt: HEARTBEAT,
    now: HEARTBEAT_MS + V24_ROUTER_STALE_AFTER_MS,
  }), false);

  assert.equal(deriveV24RouterHealthStatus({
    leader: true,
    status: "RUNNING",
    lastHeartbeatAt: HEARTBEAT,
    now: HEARTBEAT_MS + V24_ROUTER_STALE_AFTER_MS,
  }), "RUNNING");
});

test("RUNNING leader becomes STALE only after heartbeat exceeds cadence tolerance", () => {
  assert.equal(isV24RouterHeartbeatStale({
    leader: true,
    status: "RUNNING",
    lastHeartbeatAt: HEARTBEAT,
    now: HEARTBEAT_MS + V24_ROUTER_STALE_AFTER_MS + 1,
  }), true);

  assert.equal(deriveV24RouterHealthStatus({
    leader: true,
    status: "RUNNING",
    lastHeartbeatAt: HEARTBEAT,
    now: HEARTBEAT_MS + V24_ROUTER_STALE_AFTER_MS + 1,
  }), "STALE");
});

test("classified dependency waiting does not become STALE during a long outage", () => {
  for (const status of [
    "WAITING_FOR_SCHWAB",
    "WAITING_FOR_PRETRADE",
    "WAITING_FOR_ROUTER_LOCK",
  ]) {
    assert.equal(isV24RouterHeartbeatStale({
      leader: status !== "WAITING_FOR_ROUTER_LOCK",
      status,
      lastHeartbeatAt: HEARTBEAT,
      now: HEARTBEAT_MS + 24 * 60 * 60 * 1000,
    }), false);
  }
});

test("classified PAUSED BLOCKED and ERROR states remain explicit rather than becoming STALE", () => {
  for (const status of ["PAUSED", "BLOCKED", "ERROR"]) {
    assert.equal(deriveV24RouterHealthStatus({
      leader: true,
      status,
      lastHeartbeatAt: HEARTBEAT,
      now: HEARTBEAT_MS + 24 * 60 * 60 * 1000,
    }), status);
  }
});

test("passive tab cannot infer stale leadership or become a second leader from heartbeat age", () => {
  assert.equal(isV24RouterHeartbeatStale({
    leader: false,
    status: "WAITING_FOR_ROUTER_LOCK",
    lastHeartbeatAt: HEARTBEAT,
    now: HEARTBEAT_MS + 24 * 60 * 60 * 1000,
  }), false);
});
