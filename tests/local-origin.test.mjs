import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedLocalOrigin } from "../schwab-bridge/local-origin.mjs";

test("allows localhost UI origins on dynamic ports", () => {
  assert.equal(isAllowedLocalOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedLocalOrigin("http://localhost:5174"), true);
  assert.equal(isAllowedLocalOrigin("http://127.0.0.1:4173"), true);
  assert.equal(isAllowedLocalOrigin("http://127.0.0.1:5199"), true);
});

test("rejects non-loopback and non-http origins", () => {
  assert.equal(isAllowedLocalOrigin("https://localhost:5173"), false);
  assert.equal(isAllowedLocalOrigin("http://example.com:5173"), false);
  assert.equal(isAllowedLocalOrigin("not-an-origin"), false);
  assert.equal(isAllowedLocalOrigin(null), false);
});
