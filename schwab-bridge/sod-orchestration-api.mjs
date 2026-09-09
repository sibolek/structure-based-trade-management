import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assertSodAnalysisProvider } from "./sod-analysis-provider.mjs";
import {
  prepareSodOrchestration,
  publishPreparedSodOrchestration,
  SOD_ORCHESTRATION_NO_CANDIDATES,
  SOD_ORCHESTRATION_PRETRADE_PREFLIGHT_REQUIRED,
  SOD_ORCHESTRATION_READY_TO_PUBLISH,
} from "./sod-orchestration-core.mjs";
import {
  DEFAULT_SOD_PRETRADE_URL,
  fetchSodPretradeSnapshot,
} from "./sod-pretrade-reader.mjs";

export const SOD_ORCHESTRATION_SERVICE = "executionos-v24-sod-orchestrator";
export const DEFAULT_SOD_ORCHESTRATION_HOST = "127.0.0.1";
export const DEFAULT_SOD_ORCHESTRATION_PORT = 8790;
export const MAX_SOD_ORCHESTRATION_BODY_BYTES = 1024 * 1024;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function text(value) {
  return String(value ?? "").trim();
}

function apiError(message, code = "SOD_ORCHESTRATION_API_ERROR") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateLoopbackOrigin(value) {
  let parsed;
  try {
    parsed = new URL(text(value));
  } catch {
    throw apiError("SOD orchestration allowed origin must be an absolute URL", "SOD_ORCHESTRATION_ORIGIN_INVALID");
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw apiError("SOD orchestration allowed origin must use loopback HTTP", "SOD_ORCHESTRATION_ORIGIN_INVALID");
  }
  return parsed.origin;
}

function validateLoopbackHost(value) {
  const host = text(value);
  if (!LOOPBACK_HOSTS.has(host)) {
    throw apiError("SOD orchestration service host must be loopback only", "SOD_ORCHESTRATION_HOST_INVALID");
  }
  return host;
}

function tokenMatches(expected, supplied) {
  const left = Buffer.from(text(expected), "utf8");
  const right = Buffer.from(text(supplied), "utf8");
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function corsHeaders(origin, allowedOrigin) {
  if (origin !== allowedOrigin) return {};
  return {
    "access-control-allow-origin": allowedOrigin,
    vary: "Origin",
  };
}

function json(res, statusCode, payload, { origin = null, allowedOrigin = null } = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...corsHeaders(origin, allowedOrigin),
  });
  res.end(body);
}

function readJson(req, maxBytes = MAX_SOD_ORCHESTRATION_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(apiError("SOD orchestration request body too large", "SOD_ORCHESTRATION_BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(apiError("SOD orchestration request contains invalid JSON", "SOD_ORCHESTRATION_INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function safeErrorMessage(error, inboxPath) {
  let message = text(error?.message) || "SOD orchestration request failed";
  const inbox = text(inboxPath);
  if (inbox) message = message.split(path.resolve(inbox)).join("[candidate-inbox]");
  return message;
}

function preparedResponse(prepared) {
  return {
    status: prepared.status,
    sourceDate: prepared.sourceDate,
    generationMode: prepared.generationMode,
    generatedAt: prepared.generatedAt,
    analysis: prepared.analysis,
    bundle: prepared.bundle,
    lineage: prepared.lineage,
    publicationIntents: prepared.publicationIntents,
    requiresPretradePreflight: prepared.requiresPretradePreflight,
  };
}

function publicationResponse(publication) {
  if (!publication) return null;
  return {
    publicationId: publication.publicationId,
    finalName: publication.finalName,
    sha256: publication.sha256,
    byteLength: publication.byteLength,
  };
}

export function createSodOrchestrationApiServer({
  provider,
  inboxPath,
  allowedOrigin,
  pretradeUrl = DEFAULT_SOD_PRETRADE_URL,
  fetchImpl = globalThis.fetch,
  clock = () => new Date().toISOString(),
  publicationIdFactory = undefined,
  sessionToken = crypto.randomBytes(32).toString("hex"),
} = {}) {
  const trustedProvider = assertSodAnalysisProvider(provider);
  const configuredInbox = text(inboxPath);
  if (!configuredInbox) throw apiError("SOD candidate inbox must be configured", "SOD_ORCHESTRATION_INBOX_REQUIRED");
  const exactAllowedOrigin = validateLoopbackOrigin(allowedOrigin);
  if (!text(sessionToken)) throw apiError("SOD orchestration session token is required", "SOD_ORCHESTRATION_SESSION_INVALID");

  const server = http.createServer(async (req, res) => {
    const origin = text(req.headers.origin) || null;
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;

    if (req.method === "OPTIONS") {
      if (origin !== exactAllowedOrigin) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(204, {
        "access-control-allow-origin": exactAllowedOrigin,
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-executionos-sod-session",
        "access-control-max-age": "600",
        vary: "Origin",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      json(res, 200, {
        ok: true,
        service: SOD_ORCHESTRATION_SERVICE,
        providerConfigured: true,
        pretradeAccess: "READ_ONLY_HTTP",
        candidatePublication: "ATOMIC_INBOX_ONLY",
        lifecycleAuthority: false,
        armAuthority: false,
        executionAuthority: false,
        brokerWriteAuthority: false,
      }, { origin, allowedOrigin: exactAllowedOrigin });
      return;
    }

    if (req.method === "GET" && pathname === "/api/sod/session") {
      if (origin !== exactAllowedOrigin) {
        json(res, 403, { error: "SOD_ORCHESTRATION_ORIGIN_FORBIDDEN" });
        return;
      }
      json(res, 200, {
        service: SOD_ORCHESTRATION_SERVICE,
        sessionToken,
      }, { origin, allowedOrigin: exactAllowedOrigin });
      return;
    }

    if (req.method === "POST" && pathname === "/api/sod/generate") {
      if (origin !== exactAllowedOrigin) {
        json(res, 403, { error: "SOD_ORCHESTRATION_ORIGIN_FORBIDDEN" });
        return;
      }
      if (!tokenMatches(sessionToken, req.headers["x-executionos-sod-session"])) {
        json(res, 403, { error: "SOD_ORCHESTRATION_SESSION_FORBIDDEN" }, {
          origin,
          allowedOrigin: exactAllowedOrigin,
        });
        return;
      }

      try {
        const request = await readJson(req);
        const { snapshot } = await fetchSodPretradeSnapshot(pretradeUrl, { fetchImpl });
        const prepared = await prepareSodOrchestration({
          provider: trustedProvider,
          request,
          pretradeSnapshot: snapshot,
          clock,
        });

        let publication = null;
        if (prepared.status === SOD_ORCHESTRATION_READY_TO_PUBLISH) {
          publication = await publishPreparedSodOrchestration({
            prepared,
            inboxPath: configuredInbox,
            ...(publicationIdFactory ? { idFactory: publicationIdFactory } : {}),
          });
        } else if (
          prepared.status !== SOD_ORCHESTRATION_PRETRADE_PREFLIGHT_REQUIRED
          && prepared.status !== SOD_ORCHESTRATION_NO_CANDIDATES
        ) {
          throw apiError(
            `Unsupported SOD orchestration status ${prepared.status}`,
            "SOD_ORCHESTRATION_STATUS_INVALID",
          );
        }

        json(res, 200, {
          ...preparedResponse(prepared),
          publication: publicationResponse(publication),
          brokerWriteAuthority: false,
        }, { origin, allowedOrigin: exactAllowedOrigin });
      } catch (error) {
        json(res, error?.code === "SOD_ORCHESTRATION_BODY_TOO_LARGE" ? 413 : 400, {
          error: error?.code || "SOD_ORCHESTRATION_API_ERROR",
          message: safeErrorMessage(error, configuredInbox),
          brokerWriteAuthority: false,
        }, { origin, allowedOrigin: exactAllowedOrigin });
      }
      return;
    }

    json(res, 404, { error: "NOT_FOUND" }, { origin, allowedOrigin: exactAllowedOrigin });
  });

  return Object.freeze({
    server,
    allowedOrigin: exactAllowedOrigin,
    sessionToken,
  });
}

export async function loadSodAnalysisProviderModule(modulePath) {
  const configured = text(modulePath);
  if (!configured) {
    throw apiError("EXECUTIONOS_SOD_PROVIDER_MODULE is required", "SOD_ORCHESTRATION_PROVIDER_MODULE_REQUIRED");
  }
  const resolved = path.resolve(configured);
  const loaded = await import(pathToFileURL(resolved).href);
  return assertSodAnalysisProvider(loaded.default || loaded.provider);
}

async function main() {
  const host = validateLoopbackHost(process.env.EXECUTIONOS_SOD_HOST || DEFAULT_SOD_ORCHESTRATION_HOST);
  const port = Number(process.env.EXECUTIONOS_SOD_PORT || DEFAULT_SOD_ORCHESTRATION_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw apiError("EXECUTIONOS_SOD_PORT must be an integer from 1 to 65535", "SOD_ORCHESTRATION_PORT_INVALID");
  }

  const provider = await loadSodAnalysisProviderModule(process.env.EXECUTIONOS_SOD_PROVIDER_MODULE);
  const api = createSodOrchestrationApiServer({
    provider,
    inboxPath: process.env.EXECUTIONOS_CANDIDATE_INBOX,
    allowedOrigin: process.env.EXECUTIONOS_SOD_ALLOWED_ORIGIN,
    pretradeUrl: process.env.EXECUTIONOS_PRETRADE_URL || DEFAULT_SOD_PRETRADE_URL,
  });

  api.server.listen(port, host, () => {
    console.log(`[ExecutionOS SOD] ${SOD_ORCHESTRATION_SERVICE} listening on http://${host}:${port}`);
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`[ExecutionOS SOD] ${error.code || "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  });
}
