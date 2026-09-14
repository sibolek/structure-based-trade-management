import assert from "node:assert/strict";
import test from "node:test";
import { runSodLiveAcceptance, sodLiveAcceptanceConfiguration, assertSodLiveAcceptanceResult } from "../schwab-bridge/sod-live-acceptance.mjs";

test("live gate is explicit opt-in and missing configuration is sanitized without a network request", async () => {
  await assert.rejects(runSodLiveAcceptance({}), { code: "SOD_LIVE_ACCEPTANCE_OPT_IN_REQUIRED" });
  const result = await runSodLiveAcceptance({ EXECUTIONOS_SOD_LIVE_ACCEPTANCE: "1", OPENAI_API_KEY: "must-not-appear" });
  assert.equal(result.status, "BLOCKED"); assert.ok(result.missing.includes("EXECUTIONOS_SOD_OPENAI_MODEL"));
  assert.equal(JSON.stringify(result).includes("must-not-appear"), false);
  assert.equal(sodLiveAcceptanceConfiguration({}).optedIn, false);
});
test("controlled live gate rejects candidates before downstream publication", () => {
  assert.doesNotThrow(() => assertSodLiveAcceptanceResult({ candidateProposals: [] }));
  assert.throws(() => assertSodLiveAcceptanceResult({ candidateProposals: [{}] }), { code: "SOD_LIVE_ACCEPTANCE_UNEXPECTED_CANDIDATES" });
});

test("acceptance initialization failure closes an owned provider before store teardown", async () => {
  let closed = 0;
  const env = {
    EXECUTIONOS_SOD_LIVE_ACCEPTANCE: "1",
    OPENAI_API_KEY: "test",
    EXECUTIONOS_SOD_OPENAI_MODEL: "gpt-test",
    EXECUTIONOS_SOD_RUN_STORE: "/tmp/sod-run-store",
    EXECUTIONOS_SOD_CHART_STORE: "/tmp/sod-chart-store",
    EXECUTIONOS_CANDIDATE_INBOX: "/tmp/sod-inbox",
    EXECUTIONOS_SOD_ACCEPTANCE_CHART: "/tmp/acceptance.png",
  };
  await assert.rejects(
    () => runSodLiveAcceptance(env, {
      createProvider: () => ({
        close: async () => { closed++; },
      }),
      createStore: () => { throw Object.assign(new Error("store init failed"), { code: "SOD_STORE_INIT_FAILED" }); },
    }),
    { code: "SOD_STORE_INIT_FAILED" },
  );
  assert.equal(closed, 1);
});
