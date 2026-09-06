import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("browser publishes canonical Execution store evidence without deriving FREE or OWNED", () => {
  const app = source("src/App.jsx");
  const publisher = source("src/hooks/useExecutionOwnershipPublisher.js");
  const client = source("src/pretrade/pretrade-api-client.js");

  assert.match(app, /useExecutionOwnershipPublisher/);
  assert.match(app, /useExecutionOwnershipPublisher\(\{ pretrade \}\)/);

  assert.match(publisher, /readExecutionBoardStore/);
  assert.match(publisher, /subscribeExecutionBoardStore/);
  assert.match(publisher, /kind: "SNAPSHOT"/);
  assert.match(publisher, /kind: "HEARTBEAT"/);
  assert.match(publisher, /EXECUTION_CANONICAL_STORE/);
  assert.doesNotMatch(publisher, /executionOwnedSymbolsForHandoffAdmission/);
  assert.doesNotMatch(publisher, /status:\s*["']FREE["']/);
  assert.doesNotMatch(publisher, /status:\s*["']OWNED["']/);

  assert.match(client, /publishExecutionOwnership/);
  assert.match(client, /x-executionos-source/);
  assert.doesNotMatch(client, /execution-ownership\/[^"'`]*free/i);
  assert.doesNotMatch(client, /execution-ownership\/[^"'`]*owned/i);
});

test("ownership publisher reacts to canonical store changes and uses heartbeat polling only as freshness support", () => {
  const publisher = source("src/hooks/useExecutionOwnershipPublisher.js");
  assert.match(publisher, /listener: \(snapshot\) => queueLatestSnapshot\(snapshot\)/);
  assert.match(publisher, /PUBLISH_INTERVAL_MS = 500/);
  assert.match(publisher, /publishedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(publisher, /PRETRADE owns freshness from server receive time/);
});
