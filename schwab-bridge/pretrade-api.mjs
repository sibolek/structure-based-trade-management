import http from "node:http";
import { isAllowedLocalOrigin } from "./local-origin.mjs";
import { PreTradeStore, DEFAULT_PRETRADE_STATE_FILE } from "./pretrade-state.mjs";
import { PreTradeCandidateIngress } from "./pretrade-candidate-ingress.mjs";
import {
  ExecutionBoardHandoffRepository,
  DEFAULT_EXECUTION_BOARD_HANDOFF_FILE,
} from "./execution-board-handoff-repository.mjs";
import {
  ExecutionBoardHandoffDeliveryRepository,
  DEFAULT_EXECUTION_BOARD_HANDOFF_DELIVERY_FILE,
} from "./execution-board-handoff-delivery-repository.mjs";
import { createExecutionBoardHandoffApiHandler } from "./execution-board-handoff-api.mjs";

const HOST = process.env.EXECUTIONOS_V24_HOST || "127.0.0.1";
const PORT = Number(process.env.EXECUTIONOS_V24_PORT || 8788);
const STATE_FILE = process.env.EXECUTIONOS_V24_STATE_FILE || DEFAULT_PRETRADE_STATE_FILE;
const HANDOFF_FILE = process.env.EXECUTIONOS_V24_HANDOFF_FILE || DEFAULT_EXECUTION_BOARD_HANDOFF_FILE;
const HANDOFF_DELIVERY_FILE = process.env.EXECUTIONOS_V24_HANDOFF_DELIVERY_FILE || DEFAULT_EXECUTION_BOARD_HANDOFF_DELIVERY_FILE;
const MAX_BODY_BYTES = 1024 * 1024;

const store = new PreTradeStore({ filePath: STATE_FILE });
store.load();
const candidateIngress = new PreTradeCandidateIngress({ store });

const handoffRepository = new ExecutionBoardHandoffRepository({ filePath: HANDOFF_FILE });
handoffRepository.load();

const handoffDeliveryRepository = new ExecutionBoardHandoffDeliveryRepository({
  handoffRepository,
  filePath: HANDOFF_DELIVERY_FILE,
});
handoffDeliveryRepository.load();

const handleHandoffApi = createExecutionBoardHandoffApiHandler({
  handoffRepository,
  deliveryRepository: handoffDeliveryRepository,
  maxBodyBytes: MAX_BODY_BYTES,
});

function json(res, statusCode, payload, origin = null) {
  const body = JSON.stringify(payload);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  };
  if (origin && isAllowedLocalOrigin(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || null;

  if (req.method === "OPTIONS") {
    if (!origin || !isAllowedLocalOrigin(origin)) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.writeHead(204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-executionos-source",
      "access-control-max-age": "600",
      vary: "Origin",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, {
      ok: true,
      service: "executionos-v24-pretrade",
      readOnlyBrokerBoundary: true,
      stateFile: STATE_FILE,
      handoffFile: HANDOFF_FILE,
      handoffDeliveryFile: HANDOFF_DELIVERY_FILE,
      handoffTransportApi: true,
      brokerWriteAuthority: false,
    }, origin);
    return;
  }

  if (await handleHandoffApi(req, res)) return;

  if (req.method === "GET" && req.url === "/api/candidates") {
    json(res, 200, store.snapshot(), origin);
    return;
  }

  if (req.method === "POST" && req.url === "/api/candidates/import") {
    if (origin && !isAllowedLocalOrigin(origin)) {
      json(res, 403, { error: "origin not allowed" });
      return;
    }

    try {
      const payload = await readJson(req);
      const result = candidateIngress.importBundle(payload);
      json(res, 200, result, origin);
    } catch (error) {
      const statusCode = error?.code === "BODY_TOO_LARGE" ? 413 : 400;
      json(res, statusCode, { error: error.message, code: error.code || "IMPORT_ERROR" }, origin);
    }
    return;
  }

  json(res, 404, { error: "not found" }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`[ExecutionOS V2.4] Pre-trade API listening on http://${HOST}:${PORT}`);
  console.log(`[ExecutionOS V2.4] State file: ${STATE_FILE}`);
  console.log(`[ExecutionOS V2.4] Handoff file: ${HANDOFF_FILE}`);
  console.log(`[ExecutionOS V2.4] Handoff delivery file: ${HANDOFF_DELIVERY_FILE}`);
  console.log("[ExecutionOS V2.4] Candidate import is routed through authoritative ingress with revision/event provenance.");
  console.log("[ExecutionOS V2.4] Handoff transport API enabled; browser handoff creation is not exposed.");
  console.log("[ExecutionOS V2.4] Broker boundary remains read-only; this service does not place, replace, cancel, or flatten orders.");
});
