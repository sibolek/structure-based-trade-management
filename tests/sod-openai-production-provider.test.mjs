import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { Agent } from "undici";

import {
  createOpenAiResponsesFetchClient,
  createOpenAiSodProductionProvider,
  OPENAI_RESPONSES_URL,
  SOD_OPENAI_DISPATCHER_CLOSE_GRACE_MS,
  SOD_OPENAI_TRANSPORT_TIMEOUT_MARGIN_MS,
  deriveSodTransportTimeoutMs,
} from "../schwab-bridge/sod-openai-production-provider.mjs";
import { loadSodAnalysisProviderModule } from "../schwab-bridge/sod-orchestration-api.mjs";
import { normalizedRequest, resolvedChart, apiResponse } from "./helpers/sod-openai-fixture.mjs";
import { buildSodTransportErrorDiagnostics, sanitizeSodTransportDiagnostics } from "../schwab-bridge/sod-transport-diagnostics.mjs";

function namedTransportError(name, code, cause) {
  const error = new Error("private diagnostic message sk-live-secret https://private.example/path");
  Object.defineProperty(error, "name", { value: name, configurable: true });
  if (code) error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function rejectedFetch(error) {
  return async () => { throw error; };
}

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
      return new Response(JSON.stringify(expected), { status: 200 });
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

test("production provider reports missing key/model without fallback or network", async () => {
  const missingKey = createOpenAiSodProductionProvider({ env: {} });
  assert.deepEqual(missingKey.readiness(), { providerLoaded: true, providerConfigured: false, modelConfigured: false, timeoutMs: 600_000 });
  await assert.rejects(missingKey.generate(), { code: "SOD_OPENAI_API_KEY_REQUIRED" });
  const missingModel = createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: "sk-test" } });
  assert.equal(missingModel.readiness().modelConfigured, false);
  await assert.rejects(missingModel.generate(), { code: "SOD_OPENAI_MODEL_REQUIRED" });
  const configured = createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: "sk-test", EXECUTIONOS_SOD_OPENAI_MODEL: "gpt-test" },
    fetchImpl: async () => { throw new Error("must not call network"); } });
  assert.equal(configured.readiness().providerConfigured, true);
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
  const previousTimeout = process.env.EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS;
  process.env.OPENAI_API_KEY = "sk-test-loader";
  process.env.EXECUTIONOS_SOD_OPENAI_MODEL = "gpt-test";
  process.env.EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS = "123456";

  try {
    const provider = await loadSodAnalysisProviderModule(
      path.resolve("schwab-bridge/sod-openai-provider-module.mjs"),
    );
    assert.equal(typeof provider.generate, "function");
    assert.equal(provider.timeoutMs, 123456);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.EXECUTIONOS_SOD_OPENAI_MODEL;
    else process.env.EXECUTIONOS_SOD_OPENAI_MODEL = previousModel;
    if (previousTimeout === undefined) delete process.env.EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS;
    else process.env.EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS = previousTimeout;
  }
});

test("production timeout is bounded, configurable, and visible without a network probe", () => {
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "600001"]) {
    assert.throws(() => createOpenAiSodProductionProvider({ env: { EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS: value } }), { code: "SOD_OPENAI_TIMEOUT_INVALID" });
  }
  for (const value of [1, 120000, 600000]) {
    const p = createOpenAiSodProductionProvider({ env: { EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS: String(value) } });
    assert.equal(p.timeoutMs, value); assert.equal(p.readiness().timeoutMs, value);
  }
  assert.throws(() => createOpenAiResponsesFetchClient({ apiKey: "test", timeoutMs: 600001 }), { code: "SOD_OPENAI_TIMEOUT_INVALID" });
});

test("SOD transport timeout derivation is bounded and exact", () => {
  assert.equal(deriveSodTransportTimeoutMs(1), 1 + SOD_OPENAI_TRANSPORT_TIMEOUT_MARGIN_MS);
  assert.equal(deriveSodTransportTimeoutMs(600_000), 630_000);
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, 600_001]) {
    assert.throws(() => deriveSodTransportTimeoutMs(value), { code: "SOD_OPENAI_TIMEOUT_INVALID" });
  }
});

function lifecycleDispatcher({ close = async () => {}, destroy = async () => {} } = {}) {
  return { dispatch() {}, close, destroy };
}

test("dedicated dispatcher is private to one SOD client, reused, and configured for both timeouts", async () => {
  const dispatcherOptions = [];
  const dispatchers = [];
  const fetchDispatchers = [];
  const client = createOpenAiResponsesFetchClient({
    apiKey: "test",
    timeoutMs: 120,
    dispatcherFactory: (options) => {
      dispatcherOptions.push(options);
      const dispatcher = lifecycleDispatcher();
      dispatchers.push(dispatcher);
      return dispatcher;
    },
    fetchImpl: async (_url, options) => {
      fetchDispatchers.push(options.dispatcher);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const first = await client.responses.create({ model: "test" });
  const second = await client.responses.create({ model: "test" });
  assert.equal(dispatcherOptions.length, 1);
  assert.deepEqual(dispatcherOptions[0], { headersTimeout: 30_120, bodyTimeout: 30_120 });
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, { ok: true });
  assert.strictEqual(fetchDispatchers[0], dispatchers[0]);
  assert.strictEqual(fetchDispatchers[1], dispatchers[0]);
  await client.close();
});

test("actual Node fetch honors the private SOD Agent dispatcher on a local fixture", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ fixture: "ok" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const client = createOpenAiResponsesFetchClient({
    apiKey: "test",
    timeoutMs: 1_000,
    fetchImpl: (_url, options) => globalThis.fetch(`http://127.0.0.1:${port}/responses`, options),
  });
  try {
    assert.deepEqual(await client.responses.create({ model: "test" }), { fixture: "ok" });
    await client.close();
  } finally {
    await client.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("default SOD dispatcher is an Undici Agent and other fetch clients remain untouched", async () => {
  let observed;
  const client = createOpenAiResponsesFetchClient({
    apiKey: "test",
    fetchImpl: async (_url, options) => {
      observed = options.dispatcher;
      return new Response("{}", { status: 200 });
    },
  });
  await client.responses.create({ model: "test" });
  assert.ok(observed instanceof Agent);
  assert.equal(typeof globalThis.fetch, "function");
  await client.close();
});

test("application AbortController remains authoritative before scaled transport fallback", async () => {
  let abortedAt;
  let transportOptions;
  const startedAt = performance.now();
  const client = createOpenAiResponsesFetchClient({
    apiKey: "test",
    timeoutMs: 15,
    dispatcherFactory: (options) => {
      transportOptions = options;
      return lifecycleDispatcher();
    },
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => { abortedAt = performance.now(); reject(new DOMException("aborted", "AbortError")); }, { once: true });
    }),
  });
  await assert.rejects(() => client.responses.create({ model: "test" }), { code: "SOD_OPENAI_TIMEOUT" });
  assert.ok(abortedAt - startedAt < transportOptions.headersTimeout);
  await client.close();
});

test("continuously arriving body data cannot extend the application total budget", async () => {
  let chunks = 0;
  const client = createOpenAiResponsesFetchClient({
    apiKey: "test",
    timeoutMs: 18,
    fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        const interval = setInterval(() => {
          chunks += 1;
          controller.enqueue(new TextEncoder().encode(" "));
        }, 2);
        signal.addEventListener("abort", () => {
          clearInterval(interval);
          controller.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      },
    })),
  });
  await assert.rejects(() => client.responses.create({ model: "test" }), failure => {
    assert.equal(failure.code, "SOD_OPENAI_TIMEOUT");
    assert.equal(failure.providerDiagnostics.applicationAbortObserved, true);
    assert.equal(failure.providerDiagnostics.phase, "BODY_READING");
    return true;
  });
  assert.ok(chunks > 0);
  await client.close();
});

test("finite scaled transport fallback remains available when a fixture suppresses application cancellation", async () => {
  let transportOptions;
  const client = createOpenAiResponsesFetchClient({
    apiKey: "test",
    timeoutMs: 600_000,
    dispatcherFactory: (options) => {
      transportOptions = options;
      return lifecycleDispatcher();
    },
    abortControllerFactory: () => {
      const controller = new AbortController();
      // Deliberately suppress only the fixture's application cancellation.
      controller.abort = () => {};
      return controller;
    },
    // A deliberately non-cooperative transport fixture ignores signal and
    // emits the equivalent timeout after a scaled delay.
    fetchImpl: async () => new Promise((_, reject) => {
      setTimeout(() => reject(namedTransportError("HeadersTimeoutError", "UND_ERR_HEADERS_TIMEOUT")), 12);
    }),
  });
  await assert.rejects(() => client.responses.create({ model: "test" }), failure => {
    assert.equal(failure.code, "SOD_OPENAI_NETWORK_FAILED");
    assert.equal(failure.providerDiagnostics.transportCode, "UND_ERR_HEADERS_TIMEOUT");
    assert.equal(failure.providerDiagnostics.applicationAbortObserved, false);
    assert.ok(transportOptions.headersTimeout > 300_000);
    return true;
  });
  await client.close();
});

test("scaled header/body stalls cannot fire before the configured application budget", async () => {
  const observed = [];
  for (const phase of ["headers", "body"]) {
    const client = createOpenAiResponsesFetchClient({
      apiKey: "test",
      timeoutMs: 600_000,
      dispatcherFactory: (options) => {
        observed.push({ phase, options });
        return lifecycleDispatcher();
      },
      fetchImpl: async () => new Response("{}"),
    });
    await client.close();
  }
  for (const { options } of observed) {
    assert.equal(options.headersTimeout, 630_000);
    assert.equal(options.bodyTimeout, 630_000);
    assert.ok(options.headersTimeout > 300_000);
    assert.ok(options.bodyTimeout > 300_000);
  }
});

test("dispatcher cleanup is idempotent and force-destroys a stalled graceful close", async () => {
  let closeCalls = 0;
  let destroyCalls = 0;
  const client = createOpenAiResponsesFetchClient({
    apiKey: "test",
    shutdownAllowanceMs: 5,
    dispatcherFactory: () => lifecycleDispatcher({
      close: () => { closeCalls++; return new Promise(() => {}); },
      destroy: async () => { destroyCalls++; },
    }),
  });
  const first = client.close();
  const second = client.close();
  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  assert.equal(closeCalls, 1);
  assert.equal(destroyCalls, 1);
  await assert.rejects(() => client.responses.create({}), { code: "SOD_OPENAI_DISPATCHER_CLOSED" });
});

test("dispatcher close rejection destroys the pool and propagates cleanup failure", async () => {
  let destroyed = 0;
  const expected = new Error("close failed");
  const client = createOpenAiResponsesFetchClient({
    apiKey: "test",
    dispatcherFactory: () => lifecycleDispatcher({ close: async () => { throw expected; }, destroy: async () => { destroyed++; } }),
  });
  await assert.rejects(client.close(), expected);
  assert.equal(destroyed, 1);
});

for (const phase of ["REQUEST_STARTED", "HEADERS_RECEIVED", "BODY_READING"]) {
  test(`timeout preserves last observed ${phase} and only safe diagnostics through the provider`, async () => {
    let calls = 0;
    const provider = createOpenAiSodProductionProvider({
      env: { OPENAI_API_KEY: "secret", EXECUTIONOS_SOD_OPENAI_MODEL: "test", EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS: "30" },
      fetchImpl: async (_url, { signal }) => {
        calls++;
        if (phase === "REQUEST_STARTED") return new Promise((_, reject) => {
          const keepAlive = setTimeout(() => reject(new Error("test deadline")), 1000);
          signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(new Error("secret /private/path")); }, { once: true });
        });
        const body = new ReadableStream({ start(controller) {
          if (phase === "BODY_READING") controller.enqueue(new TextEncoder().encode('{"id":'));
          const keepAlive = setTimeout(() => controller.error(new Error("test deadline")), 1000);
          signal.addEventListener("abort", () => { clearTimeout(keepAlive); controller.error(new Error("secret body failure")); }, { once: true });
        } });
        return new Response(body, { headers: { "x-request-id": "req_safe", "authorization": "secret" } });
      },
    });
    await assert.rejects(provider.generate(normalizedRequest(), { resolveChart: async () => resolvedChart() }), error => {
      assert.equal(error.code, "SOD_OPENAI_TIMEOUT");
      assert.equal(error.providerDiagnostics.errorCode, error.code);
      assert.equal(error.providerDiagnostics.phase, phase);
      assert.equal(error.providerDiagnostics.timeoutMs, 30);
      assert.ok(error.providerDiagnostics.elapsedMs >= 0);
      assert.equal(error.providerDiagnostics.requestId, phase === "REQUEST_STARTED" ? undefined : "req_safe");
      assert.doesNotMatch(JSON.stringify(error), /secret|private/);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("HTTP failure retains safe request ID through adapter sanitization", async () => {
  const p = createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: "test", EXECUTIONOS_SOD_OPENAI_MODEL: "test" },
    fetchImpl: async () => new Response("private upstream body", { status: 429, headers: { "x-request-id": "req_limited" } }) });
  await assert.rejects(p.generate(normalizedRequest(), { resolveChart: async () => resolvedChart() }), e => {
    assert.equal(e.code, "SOD_OPENAI_RATE_LIMITED");
    assert.equal(e.providerDiagnostics.requestId, "req_limited");
    assert.equal(e.providerDiagnostics.httpStatus, 429);
    assert.doesNotMatch(JSON.stringify(e), /private/); return true;
  });
});

test("completed envelope with invalid analysis retains its request ID without changing validation failure", async () => {
  const response = apiResponse(); response.output = [];
  const p = createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: "test", EXECUTIONOS_SOD_OPENAI_MODEL: "test" },
    fetchImpl: async () => new Response(JSON.stringify(response), { headers: { "x-request-id": "req_invalid_analysis" } }) });
  await assert.rejects(p.generate(normalizedRequest(), { resolveChart: async () => resolvedChart() }), e => {
    assert.match(e.code, /^SOD_OPENAI_/);
    assert.equal(e.providerDiagnostics.errorCode, e.code);
    assert.equal(e.providerDiagnostics.phase, "RESPONSE_PARSED");
    assert.equal(e.providerDiagnostics.requestId, "req_invalid_analysis"); return true;
  });
});

test("delayed response within budget validates; timer is cleared after success", async () => {
  let aborted = false, calls = 0;
  const p = createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: "test", EXECUTIONOS_SOD_OPENAI_MODEL: "test" }, timeoutMs: 100,
    fetchImpl: async (_url, { signal }) => {
      calls++; signal.addEventListener("abort", () => { aborted = true; });
      await new Promise(resolve => setTimeout(resolve, 5));
      return new Response(JSON.stringify(apiResponse()));
    } });
  const result = await p.generate(normalizedRequest(), { resolveChart: async () => resolvedChart() });
  assert.equal(result.generationMetadata.localValidation, true);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(aborted, false); assert.equal(calls, 1);
});

test("a response arriving after abort cannot become a successful result", async () => {
  let calls = 0;
  const c = createOpenAiResponsesFetchClient({ apiKey: "test", timeoutMs: 1, fetchImpl: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 20)); return new Response('{}');
  } });
  await assert.rejects(c.responses.create({}), { code: "SOD_OPENAI_TIMEOUT" });
  assert.equal(calls, 1);
});

test("diagnostics whitelist rejects unsafe values, unobserved phases and arbitrary payload fields", () => {
  assert.equal(sanitizeSodTransportDiagnostics({ phase: "CONNECTION_ESTABLISHED", requestId: "req_bad /secret", timeoutMs: Infinity,
    elapsedMs: -1, errorCode: "private", httpStatus: 999, authorization: "secret", body: "secret" }), null);
  assert.deepEqual(sanitizeSodTransportDiagnostics({ phase: "BODY_RECEIVED", errorCode: "SOD_OPENAI_RESPONSE_INVALID", requestId: "req_safe", body: "secret" }),
    { phase: "BODY_RECEIVED", errorCode: "SOD_OPENAI_RESPONSE_INVALID", requestId: "req_safe" });
});

test("Undici header timeout retains only its normalized transport cause", async () => {
  const error = namedTransportError("TypeError", undefined,
    namedTransportError("HeadersTimeoutError", "UND_ERR_HEADERS_TIMEOUT"));
  const client = createOpenAiResponsesFetchClient({ apiKey: "secret", fetchImpl: rejectedFetch(error) });
  await assert.rejects(() => client.responses.create({}), failure => {
    assert.equal(failure.code, "SOD_OPENAI_NETWORK_FAILED");
    assert.deepEqual(failure.providerDiagnostics.causeChain, [
      { depth: 0, class: "TypeError", code: "OTHER" },
      { depth: 1, class: "HeadersTimeoutError", code: "UND_ERR_HEADERS_TIMEOUT" },
    ]);
    assert.equal(failure.providerDiagnostics.exceptionClass, "TypeError");
    assert.equal(failure.providerDiagnostics.causeClass, "HeadersTimeoutError");
    assert.equal(failure.providerDiagnostics.transportCode, "UND_ERR_HEADERS_TIMEOUT");
    assert.equal(failure.providerDiagnostics.headersObserved, false);
    assert.equal(failure.providerDiagnostics.applicationAbortObserved, false);
    assert.equal(failure.providerDiagnostics.phase, "REQUEST_STARTED");
    assert.doesNotMatch(JSON.stringify(failure), /private diagnostic|sk-live-secret|private\.example/);
    return true;
  });
});

test("Undici body timeout after response headers records the observed response boundary", async () => {
  const body = new ReadableStream({ start(controller) {
    controller.error(namedTransportError("BodyTimeoutError", "UND_ERR_BODY_TIMEOUT"));
  } });
  const client = createOpenAiResponsesFetchClient({
    apiKey: "secret",
    fetchImpl: async () => new Response(body, { status: 200, headers: { "x-request-id": "req_body_timeout" } }),
  });
  await assert.rejects(() => client.responses.create({}), failure => {
    assert.equal(failure.code, "SOD_OPENAI_NETWORK_FAILED");
    assert.equal(failure.providerDiagnostics.transportCode, "UND_ERR_BODY_TIMEOUT");
    assert.equal(failure.providerDiagnostics.exceptionClass, "BodyTimeoutError");
    assert.equal(failure.providerDiagnostics.causeClass, "OTHER");
    assert.equal(failure.providerDiagnostics.headersObserved, true);
    assert.equal(failure.providerDiagnostics.applicationAbortObserved, false);
    assert.equal(failure.providerDiagnostics.phase, "HEADERS_RECEIVED");
    assert.equal(failure.providerDiagnostics.requestId, "req_body_timeout");
    return true;
  });
});

test("socket/reset, DNS, and TLS transport codes remain allowlisted without changing classification", async () => {
  for (const [name, code] of [
    ["SocketError", "UND_ERR_SOCKET"],
    ["Error", "ECONNRESET"],
    ["Error", "EPIPE"],
    ["Error", "ENOTFOUND"],
    ["Error", "EAI_AGAIN"],
    ["Error", "DEPTH_ZERO_SELF_SIGNED_CERT"],
  ]) {
    const client = createOpenAiResponsesFetchClient({ apiKey: "secret", fetchImpl: rejectedFetch(namedTransportError(name, code)) });
    await assert.rejects(() => client.responses.create({}), failure => {
      assert.equal(failure.code, "SOD_OPENAI_NETWORK_FAILED");
      assert.equal(failure.providerDiagnostics.transportCode, code);
      assert.equal(failure.providerDiagnostics.exceptionClass, name);
      assert.equal(failure.providerDiagnostics.headersObserved, false);
      return true;
    });
  }
});

test("an independent AbortError is a network failure, while the application abort remains a timeout", async () => {
  const independent = createOpenAiResponsesFetchClient({
    apiKey: "secret",
    fetchImpl: rejectedFetch(namedTransportError("AbortError")),
  });
  await assert.rejects(() => independent.responses.create({}), failure => {
    assert.equal(failure.code, "SOD_OPENAI_NETWORK_FAILED");
    assert.equal(failure.providerDiagnostics.exceptionClass, "AbortError");
    assert.equal(failure.providerDiagnostics.applicationAbortObserved, false);
    return true;
  });

  const application = createOpenAiResponsesFetchClient({
    apiKey: "secret",
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(namedTransportError("AbortError")), { once: true });
    }),
  });
  await assert.rejects(() => application.responses.create({}), failure => {
    assert.equal(failure.code, "SOD_OPENAI_TIMEOUT");
    assert.equal(failure.providerDiagnostics.exceptionClass, "AbortError");
    assert.equal(failure.providerDiagnostics.applicationAbortObserved, true);
    assert.equal(failure.providerDiagnostics.headersObserved, false);
    return true;
  });
});

test("response headers observed followed by a socket body failure preserves the safe request ID", async () => {
  const body = new ReadableStream({ start(controller) {
    controller.error(namedTransportError("SocketError", "UND_ERR_SOCKET"));
  } });
  const client = createOpenAiResponsesFetchClient({
    apiKey: "secret",
    fetchImpl: async () => new Response(body, { headers: { "x-request-id": "req_socket_body" } }),
  });
  await assert.rejects(() => client.responses.create({}), failure => {
    assert.equal(failure.providerDiagnostics.headersObserved, true);
    assert.equal(failure.providerDiagnostics.requestId, "req_socket_body");
    assert.equal(failure.providerDiagnostics.phase, "HEADERS_RECEIVED");
    assert.equal(failure.providerDiagnostics.transportCode, "UND_ERR_SOCKET");
    return true;
  });
});

test("unknown exception and code values normalize to OTHER and never retain raw error data", () => {
  const details = buildSodTransportErrorDiagnostics(namedTransportError(
    "PrivateLibraryError", "PRIVATE_TRANSPORT_CODE",
    namedTransportError("PrivateCause", "PRIVATE_CAUSE_CODE"),
  ));
  assert.deepEqual(details, {
    exceptionClass: "OTHER",
    causeClass: "OTHER",
    transportCode: "OTHER",
    causeChain: [
      { depth: 0, class: "OTHER", code: "OTHER" },
      { depth: 1, class: "OTHER", code: "OTHER" },
    ],
  });
  const sanitized = sanitizeSodTransportDiagnostics({
    errorCode: "SOD_OPENAI_NETWORK_FAILED", exceptionClass: "PrivateLibraryError", causeClass: "PrivateCause",
    transportCode: "PRIVATE_TRANSPORT_CODE", causeChain: details.causeChain,
    requestId: "req_safe", headersObserved: false,
  });
  assert.equal(sanitized.exceptionClass, "OTHER");
  assert.equal(sanitized.causeClass, "OTHER");
  assert.equal(sanitized.transportCode, "OTHER");
  assert.equal(sanitized.requestId, undefined);
  assert.doesNotMatch(JSON.stringify(sanitized), /Private|PRIVATE|secret|authorization|https?:/i);
});

test("cause diagnostics are capped at two entries and choose the first allowlisted code", () => {
  const third = namedTransportError("Error", "ENOTFOUND");
  const second = namedTransportError("Error", "EPIPE", third);
  const first = namedTransportError("TypeError", "PRIVATE_CODE", second);
  const details = buildSodTransportErrorDiagnostics(first);
  assert.equal(details.causeChain.length, 2);
  assert.deepEqual(details.causeChain, [
    { depth: 0, class: "TypeError", code: "OTHER" },
    { depth: 1, class: "Error", code: "EPIPE" },
  ]);
  assert.equal(details.transportCode, "EPIPE");
});

test("diagnostic fields remain bounded and prohibited transport material is excluded", () => {
  const long = "x".repeat(10_000);
  const value = sanitizeSodTransportDiagnostics({
    errorCode: "SOD_OPENAI_NETWORK_FAILED", phase: "REQUEST_STARTED", headersObserved: false,
    applicationAbortObserved: false, exceptionClass: "TypeError", causeClass: "Error", transportCode: "ECONNRESET",
    causeChain: Array.from({ length: 20 }, (_, depth) => ({ depth, class: "Error", code: "ECONNRESET", message: long })),
    nodeVersion: "v24.15.0", undiciVersion: "7.24.4", requestId: "req_safe",
    message: long, stack: long, url: "https://secret.example/" + long, hostname: "secret.example",
    authorization: "Bearer sk-live-secret", headers: { authorization: "Bearer sk-live-secret" }, body: long,
  });
  const json = JSON.stringify(value);
  assert.ok(Buffer.byteLength(json) < 2_000);
  assert.equal(value.causeChain.length, 2);
  assert.doesNotMatch(json, /sk-live-secret|secret\.example|authorization|Bearer|https?:|message|stack|body/i);
});
