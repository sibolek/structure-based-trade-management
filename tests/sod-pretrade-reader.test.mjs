import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLoopbackSodPretradeUrl,
  fetchSodPretradeSnapshot,
} from "../schwab-bridge/sod-pretrade-reader.mjs";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(payload);
    },
  };
}

test("SOD PRETRADE reader permits loopback HTTP only", () => {
  assert.equal(assertLoopbackSodPretradeUrl("http://127.0.0.1:8788").hostname, "127.0.0.1");
  assert.throws(
    () => assertLoopbackSodPretradeUrl("https://127.0.0.1:8788"),
    (error) => error.code === "SOD_PRETRADE_URL_NON_LOOPBACK",
  );
  assert.throws(
    () => assertLoopbackSodPretradeUrl("http://example.com:8788"),
    (error) => error.code === "SOD_PRETRADE_URL_NON_LOOPBACK",
  );
});

test("SOD PRETRADE reader performs only capability-checked GET requests", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method });
    if (String(url).endsWith("/health")) {
      return response({
        ok: true,
        service: "executionos-v24-pretrade",
        candidateContractVersioning: true,
        readOnlyBrokerBoundary: true,
        brokerWriteAuthority: false,
      });
    }
    if (String(url).endsWith("/api/candidates")) {
      return response({ candidates: [{ candidateId: "test", contractVersion: 1 }] });
    }
    return response({}, 404);
  };

  const result = await fetchSodPretradeSnapshot("http://127.0.0.1:8788", { fetchImpl });
  assert.equal(result.snapshot.candidates.length, 1);
  assert.deepEqual(calls.map((item) => item.method), ["GET", "GET"]);
});

test("SOD PRETRADE reader fails closed on capability or broker authority mismatch", async () => {
  const capabilityMismatch = async () => response({
    ok: true,
    service: "executionos-v24-pretrade",
    candidateContractVersioning: false,
    readOnlyBrokerBoundary: true,
    brokerWriteAuthority: false,
  });
  await assert.rejects(
    fetchSodPretradeSnapshot("http://127.0.0.1:8788", { fetchImpl: capabilityMismatch }),
    (error) => error.code === "SOD_PRETRADE_CAPABILITY_MISMATCH",
  );

  const brokerAuthority = async () => response({
    ok: true,
    service: "executionos-v24-pretrade",
    candidateContractVersioning: true,
    readOnlyBrokerBoundary: true,
    brokerWriteAuthority: true,
  });
  await assert.rejects(
    fetchSodPretradeSnapshot("http://127.0.0.1:8788", { fetchImpl: brokerAuthority }),
    (error) => error.code === "SOD_PRETRADE_BROKER_WRITE_AUTHORITY_VIOLATION",
  );
});
