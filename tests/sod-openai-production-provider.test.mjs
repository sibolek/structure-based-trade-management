import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createOpenAiResponsesFetchClient,
  createOpenAiSodProductionProvider,
  OPENAI_RESPONSES_URL,
} from "../schwab-bridge/sod-openai-production-provider.mjs";
import { loadSodAnalysisProviderModule } from "../schwab-bridge/sod-orchestration-api.mjs";

function responseHeaders(requestId = "req_test") {
  return {
    get(name) {
      return String(name).toLowerCase() === "x-request-id" ? requestId : null;
    },
  };
}

test("production fetch client posts only to the fixed OpenAI Responses endpoint", async () => {
  const calls = [];
  const apiKey = "sk-test-production-secret";
  const expected = { id: "resp_test", status: "completed" };
  const client = createOpenAiResponsesFetchClient({
    apiKey,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: responseHeaders(),
        async json() {
          return expected;
        },
      };
    },
  });

  const payload = { model: "gpt-test", input: "test", store: false };
  const result = await client.responses.create(payload);

  assert.deepEqual(result, expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OPENAI_RESPONSES_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${apiKey}`);
  assert.equal(calls[0].options.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test("production fetch client never exposes upstream response bodies in HTTP errors", async () => {
  const apiKey = "sk-test-do-not-leak";
  const client = createOpenAiResponsesFetchClient({
    apiKey,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers: responseHeaders("req_private"),
      async json() {
        return { error: { message: `bad key ${apiKey}` } };
      },
    }),
  });

  await assert.rejects(
    () => client.responses.create({ model: "gpt-test" }),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.requestId, "req_private");
      assert.doesNotMatch(error.message, /sk-test-do-not-leak/);
      assert.doesNotMatch(error.message, /bad key/i);
      return true;
    },
  );
});

test("production provider requires explicit server API key and model with no silent fallback", () => {
  assert.throws(
    () => createOpenAiSodProductionProvider({ env: {} }),
    (error) => error.code === "SOD_OPENAI_API_KEY_REQUIRED",
  );
  assert.throws(
    () => createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: "sk-test" } }),
    (error) => error.code === "SOD_OPENAI_MODEL_REQUIRED",
  );

  const provider = createOpenAiSodProductionProvider({
    env: {
      OPENAI_API_KEY: "sk-test",
      EXECUTIONOS_SOD_OPENAI_MODEL: "gpt-test",
    },
    fetchImpl: async () => {
      throw new Error("network must not be touched during construction");
    },
  });
  assert.equal(typeof provider.generate, "function");
});

test("production provider rejects missing fetch and invalid timeout configuration", () => {
  const env = {
    OPENAI_API_KEY: "sk-test",
    EXECUTIONOS_SOD_OPENAI_MODEL: "gpt-test",
  };
  assert.throws(
    () => createOpenAiSodProductionProvider({ env, fetchImpl: null }),
    (error) => error.code === "SOD_OPENAI_FETCH_REQUIRED",
  );
  assert.throws(
    () => createOpenAiSodProductionProvider({ env, timeoutMs: 0 }),
    (error) => error.code === "SOD_OPENAI_TIMEOUT_INVALID",
  );
});

test("existing SOD orchestration module loader accepts the production OpenAI provider entry", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.EXECUTIONOS_SOD_OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "sk-test-loader";
  process.env.EXECUTIONOS_SOD_OPENAI_MODEL = "gpt-test";

  try {
    const provider = await loadSodAnalysisProviderModule(
      path.resolve("schwab-bridge/sod-openai-provider-module.mjs"),
    );
    assert.equal(typeof provider.generate, "function");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.EXECUTIONOS_SOD_OPENAI_MODEL;
    else process.env.EXECUTIONOS_SOD_OPENAI_MODEL = previousModel;
  }
});
