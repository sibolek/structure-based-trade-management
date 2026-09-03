import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readExecutionBoardStore,
  transactExecutionBoardStore,
} from "../src/execution/execution-board-store-repository.js";
import {
  readV23ExecutionProjection,
  transactV23ExecutionProjection,
} from "../src/execution/execution-v23-store-authority.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function v24Record(id, phase = "LIVE") {
  return {
    id,
    origin: "V24_HANDOFF",
    phase,
    v24: { handoffId: `handoff-${id}` },
    originalPlan: { symbol: "NVDA", direction: "LONG" },
  };
}

test("legacy V2.3 projection hides V2.4 LIVE and History records while canonical store retains them", () => {
  const storage = memoryStorage();
  transactExecutionBoardStore({
    storage,
    mutate: (store) => ({
      ...store,
      liveTrades: [{ id: "legacy-live", phase: "LIVE" }, v24Record("v24-live")],
      history: [{ id: "legacy-history" }, v24Record("v24-history", "REVIEW")],
    }),
  });

  const projection = readV23ExecutionProjection({ storage });
  assert.deepEqual(projection.liveTrades.map((item) => item.id), ["legacy-live"]);
  assert.deepEqual(projection.history.map((item) => item.id), ["legacy-history"]);

  const canonical = readExecutionBoardStore({ storage });
  assert.equal(canonical.liveTrades.filter((item) => item.origin === "V24_HANDOFF").length, 1);
  assert.equal(canonical.history.filter((item) => item.origin === "V24_HANDOFF").length, 1);
});

test("legacy V2.3 mutations cannot erase canonical V2.4 LIVE or History records", () => {
  const storage = memoryStorage();
  transactExecutionBoardStore({
    storage,
    mutate: (store) => ({
      ...store,
      liveTrades: [{ id: "legacy-live", phase: "LIVE" }, v24Record("v24-live")],
      history: [{ id: "legacy-history" }, v24Record("v24-history", "REVIEW")],
    }),
  });

  transactV23ExecutionProjection({
    storage,
    updater: (projection) => ({
      ...projection,
      liveTrades: projection.liveTrades.map((item) => ({ ...item, currentState: "THREATENED" })),
      history: [...projection.history, { id: "legacy-history-2" }],
    }),
  });

  const canonical = readExecutionBoardStore({ storage });
  assert.equal(canonical.liveTrades.some((item) => item.id === "v24-live"), true);
  assert.equal(canonical.history.some((item) => item.id === "v24-history"), true);
  assert.equal(canonical.liveTrades.find((item) => item.id === "legacy-live").currentState, "THREATENED");
});

test("App mounts one top-level V2.4 router plus separate authorization and LIVE boards", () => {
  const app = source("src/App.jsx");
  assert.match(app, /useV24ExecutionRouter\(\{ broker, pretrade \}\)/);
  assert.match(app, /<V24AuthorizedTradesBoard broker=\{broker\} v24Router=\{v24Router\} \/>/);
  assert.match(app, /<V24LiveExecutionBoard \/>/);
});

test("runtime hook uses an exclusive Web Lock so StrictMode or another tab cannot run concurrent routers", () => {
  const hook = source("src/hooks/useV24ExecutionRouter.js");
  assert.match(hook, /executionos-v24-runtime-router/);
  assert.match(hook, /lockManager\.request\(ROUTER_LOCK_NAME, \{ mode: "exclusive" \}/);
  assert.match(hook, /proposedBoundaries = useRef\(new Map\(\)\)/);
});

test("runtime router feature gate defaults disabled when enable flag is unset", () => {
  const hook = source("src/hooks/useV24ExecutionRouter.js");
  assert.match(hook, /VITE_EXECUTIONOS_V24_ROUTER_ENABLED/);
  assert.match(hook, /\|\| "false"/);
  assert.match(hook, /DISABLED_PENDING_ACCEPTANCE/);
  assert.match(hook, /if \(!ROUTER_ENABLED\) return undefined/);
});

test("V2.4 live card uses effective-stop authority and frozen ARM-time max risk", () => {
  const card = source("src/components/V24LiveTradeCard.jsx");
  assert.match(card, /executionStop\(trade\)/);
  assert.match(card, /executionStructuralInvalidation\(trade\)/);
  assert.match(card, /executionAuthorizedMaxDollarRisk\(trade\)/);
  assert.match(card, /LIVE_RECONCILIATION_REQUIRED/);
  assert.match(card, /Do not tighten the effective stop/);
});

test("V2.4 pre-fill board exposes DISCARD but no authorization EDIT action", () => {
  const board = source("src/components/V24AuthorizedTradesBoard.jsx");
  assert.match(board, /requestV24Retirement/);
  assert.match(board, /<Trash2[^>]*\/>\s*DISCARD/);
  assert.doesNotMatch(board, />EDIT</);
  assert.match(board, /Broker orders, if any, are unchanged/);
});


test("runtime hook uses stage-specific service waiting instead of an all-or-nothing gate", () => {
  const hook = source("src/hooks/useV24ExecutionRouter.js");

  assert.match(hook, /WAITING_FOR_SCHWAB/);
  assert.match(hook, /WAITING_FOR_PRETRADE/);
  assert.doesNotMatch(hook, /WAITING_FOR_SERVICES/);

  assert.match(
    hook,
    /const transport = pretradeReady\s*\?\s*createV24HandoffTransport[\s\S]*?: null;/,
  );

  assert.match(
    hook,
    /if \(!brokerReady\)[\s\S]*?continue;/,
  );
});
