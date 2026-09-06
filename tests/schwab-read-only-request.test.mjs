import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSchwabReadOnlyRequestJson } from "../schwab-bridge/schwab-read-only-request.mjs";

function authDir(tokens) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-read-only-auth-"));
  fs.writeFileSync(path.join(dir, ".schwab-tokens.json"), `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  return dir;
}

test("read-only helper performs GET with current access token and never mutates token store", async () => {
  const dir = authDir({
    accessToken: "token-1",
    accessExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const before = fs.readFileSync(path.join(dir, ".schwab-tokens.json"), "utf8");
  const calls = [];
  const requestJson = createSchwabReadOnlyRequestJson({
    authDir: dir,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ ok: true }); },
      };
    },
  });
  const result = await requestJson("https://api.schwabapi.com/marketdata/v1/quotes");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer token-1");
  const after = fs.readFileSync(path.join(dir, ".schwab-tokens.json"), "utf8");
  assert.equal(after, before);
});

test("missing or stale access token fails before any network request", async () => {
  const dir = authDir({
    accessToken: "expired-token",
    accessExpiresAt: new Date(Date.now() - 1_000).toISOString(),
  });
  let calls = 0;
  const requestJson = createSchwabReadOnlyRequestJson({
    authDir: dir,
    fetchImpl: async () => { calls += 1; throw new Error("must not be called"); },
  });
  await assert.rejects(requestJson("https://api.schwabapi.com/trader/v1/accounts"), (error) => error.code === "SCHWAB_ACCESS_TOKEN_STALE");
  assert.equal(calls, 0);
});
