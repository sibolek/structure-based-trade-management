import test from "node:test";
import assert from "node:assert/strict";

import {
  V24_ROUTER_INVALID_DISABLE_CONFIG,
  interpretV24RouterDisableConfig,
} from "../src/execution/execution-v24-router-config.js";

test("Decision 22A unset emergency switch enables router by default", () => {
  assert.deepEqual(
    interpretV24RouterDisableConfig(undefined),
    {
      enabled: true,
      status: "STARTING",
      error: "",
    },
  );
});

test("Decision 22A explicit false keeps normal router enabled", () => {
  assert.deepEqual(
    interpretV24RouterDisableConfig("false"),
    {
      enabled: true,
      status: "STARTING",
      error: "",
    },
  );
});

test("Decision 22A explicit true pauses orchestration without enabling router", () => {
  assert.deepEqual(
    interpretV24RouterDisableConfig("true"),
    {
      enabled: false,
      status: "PAUSED",
      error: "",
    },
  );
});

test("Decision 22A malformed nonempty switch fails closed as BLOCKED", () => {
  assert.deepEqual(
    interpretV24RouterDisableConfig("yes"),
    {
      enabled: false,
      status: "BLOCKED",
      error: V24_ROUTER_INVALID_DISABLE_CONFIG,
    },
  );
});
