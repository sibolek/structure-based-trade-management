import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createPreTradePreviewApiHandler } from "../schwab-bridge/pretrade-preview-api.mjs";

function authority() {
  const calls = [];
  const store = {
    snapshot: () => ({ pretradePreviewOperations: [{ operationId: "op-1", previewId: "preview-1" }] }),
  };
  return {
    calls,
    store,
    readiness: () => ({ enabled: true }),
    create(input) { calls.push(["create", input]); return input; },
    list: () => [],
    status(id) { calls.push(["status", id]); return { preview: { previewId: id } }; },
    discard(input) { calls.push(["discard", input]); return { status: "DISCARDED" }; },
    async accept(input) { calls.push(["accept", input]); return { result: "ADMITTED" }; },
    async refresh(input) { calls.push(["refresh", input]); return { previewId: "preview-2" }; },
  };
}

async function invoke(handler, { method = "GET", url, body = null, origin = "http://localhost:5173", host = "127.0.0.1:8788", token = null, remoteAddress = "127.0.0.1", headers: extraHeaders = {} } = {}) {
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = { origin, host, ...(token ? { "x-pretrade-session": token } : {}), ...extraHeaders };
  req.socket = { remoteAddress };
  let statusCode = null;
  let headers = null;
  let output = "";
  const res = {
    writeHead(status, values) { statusCode = status; headers = values; },
    end(value = "") { output += value; },
  };
  const handled = await handler(req, res);
  return { handled, statusCode, headers, body: output ? JSON.parse(output) : null };
}

test("preview routes require exact origin, loopback, Host and per-boot session", async () => {
  const auth = authority();
  const handler = createPreTradePreviewApiHandler({
    authority: auth,
    expectedOrigin: "http://localhost:5173",
    tokenFactory: () => "session-secret",
  });
  const bootstrap = await invoke(handler, { url: "/api/pretrade-previews/session" });
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.body.sessionToken, "session-secret");
  assert.equal(bootstrap.headers["cache-control"], "no-store");

  for (const input of [
    { origin: "http://127.0.0.1:5173" },
    { host: "evil.example" },
    { remoteAddress: "192.0.2.10" },
  ]) {
    const result = await invoke(handler, { url: "/api/pretrade-previews/preview-1", token: "session-secret", ...input });
    assert.equal(result.statusCode, 403);
  }
  const missing = await invoke(handler, { url: "/api/pretrade-previews/preview-1" });
  assert.equal(missing.statusCode, 401);
  const fake = await invoke(handler, { url: "/api/pretrade-previews/preview-1", token: "fake" });
  assert.equal(fake.statusCode, 401);
  assert.equal(auth.calls.length, 0);
});

test("browser CORS preflight permits only the protected preview headers and methods", async () => {
  const auth = authority();
  const handler = createPreTradePreviewApiHandler({
    authority: auth,
    expectedOrigin: "http://localhost:5173",
    tokenFactory: () => "session-secret",
  });
  const allowed = await invoke(handler, {
    method: "OPTIONS",
    url: "/api/pretrade-previews/preview-1/accept",
    headers: {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, x-pretrade-session",
    },
  });
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(allowed.headers["access-control-allow-headers"], "content-type, x-pretrade-session");

  const rejected = await invoke(handler, {
    method: "OPTIONS",
    url: "/api/pretrade-previews/preview-1/accept",
    headers: {
      "access-control-request-method": "DELETE",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.body.code, "PREVIEW_PREFLIGHT_FORBIDDEN");
  assert.equal(auth.calls.length, 0);
});

test("browser cannot register trusted previews or assert evidence", async () => {
  const auth = authority();
  const handler = createPreTradePreviewApiHandler({
    authority: auth,
    expectedOrigin: "http://localhost:5173",
    tokenFactory: () => "session-secret",
  });
  const result = await invoke(handler, {
    method: "POST",
    url: "/api/pretrade-previews",
    token: "session-secret",
    body: { bundle: {}, researchPass: true, realtime: true, evidence: { valid: true } },
  });
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.code, "PREVIEW_REGISTRATION_INTERNAL_ONLY");
  assert.equal(auth.calls.length, 0);
});

test("protected status, discard, accept and outcome routes pass identifiers and intents only", async () => {
  const auth = authority();
  const handler = createPreTradePreviewApiHandler({
    authority: auth,
    expectedOrigin: "http://localhost:5173",
    tokenFactory: () => "session-secret",
  });
  const common = { token: "session-secret" };
  assert.equal((await invoke(handler, { url: "/api/pretrade-previews/preview-1", ...common })).statusCode, 200);
  assert.equal((await invoke(handler, { method: "POST", url: "/api/pretrade-previews/preview-1/discard", body: { operationId: "op-1" }, ...common })).statusCode, 200);
  assert.equal((await invoke(handler, { method: "POST", url: "/api/pretrade-previews/preview-1/accept", body: { operationId: "op-1", proposalHash: "hash", accountScope: "account" }, ...common })).statusCode, 200);
  assert.equal((await invoke(handler, { method: "POST", url: "/api/pretrade-previews/preview-1/refresh", body: { operationId: "op-1" }, ...common })).statusCode, 200);
  assert.equal((await invoke(handler, { url: "/api/pretrade-previews/operations/op-1", ...common })).statusCode, 200);
  assert.deepEqual(auth.calls, [
    ["status", "preview-1"],
    ["discard", { previewId: "preview-1", operationId: "op-1" }],
    ["accept", { previewId: "preview-1", operationId: "op-1", proposalHash: "hash", accountScope: "account" }],
    ["refresh", { previewId: "preview-1", operationId: "op-1" }],
    ["status", "preview-1"],
  ]);
});

test("accept cannot override route identity or supply browser evidence and failures project no raw details", async () => {
  const auth = authority();
  const handler = createPreTradePreviewApiHandler({ authority: auth, expectedOrigin: "http://localhost:5173", tokenFactory: () => "session-secret" });
  const intent = { operationId: "op-1", proposalHash: "hash", accountScope: "account" };
  for (const body of [{ ...intent, previewId: "other" }, { ...intent, evidence: { valid: true } }, [], null]) {
    const result = await invoke(handler, { method: "POST", url: "/api/pretrade-previews/preview-1/accept", token: "session-secret", body });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.code, "INVALID_PREVIEW_INTENT");
  }
  assert.equal(auth.calls.length, 0);
  auth.accept = async () => { throw Object.assign(new Error("private store path and raw quote"), { details: { rawEvidence: "secret" } }); };
  const result = await invoke(handler, { method: "POST", url: "/api/pretrade-previews/preview-1/accept", token: "session-secret", body: intent });
  assert.doesNotMatch(JSON.stringify(result.body), /private|rawEvidence|secret/);
});

test("preview route rejects missing origin and oversized bodies before any authority mutation", async () => {
  const auth = authority();
  const handler = createPreTradePreviewApiHandler({ authority: auth, expectedOrigin: "http://localhost:5173", tokenFactory: () => "session-secret", maxBodyBytes: 32 });
  assert.equal((await invoke(handler, { url: "/api/pretrade-previews/session", origin: "" })).statusCode, 403);
  assert.equal((await invoke(handler, { method: "POST", url: "/api/pretrade-previews/preview-1/accept", token: "session-secret", body: { operationId: "x".repeat(100) } })).statusCode, 413);
  assert.equal(auth.calls.length, 0);
});
