import http from "node:http";
import { isAllowedLocalOrigin } from "./local-origin.mjs";
import { PreTradeStore, DEFAULT_PRETRADE_STATE_FILE } from "./pretrade-state.mjs";
import { PreTradeCandidateIngress } from "./pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "./pretrade-lifecycle-coordinator.mjs";
import { createPreTradeLifecycleApiHandler } from "./pretrade-lifecycle-api.mjs";
import { PreTradeTriggerEngine } from "./pretrade-trigger-engine.mjs";
import { PreTradeTriggerPersistenceAuthority } from "./pretrade-trigger-persistence-authority.mjs";
import { PreTradeTriggerPersistenceMonitor } from "./pretrade-trigger-persistence-monitor.mjs";
import { createPreTradeTriggerApiHandler } from "./pretrade-trigger-api.mjs";
import { createSchwabReadOnlyRequestJson } from "./schwab-read-only-request.mjs";
import { SchwabMarketDataProvider } from "./schwab-market-data-provider.mjs";
import { RegNmsEquityPriceIncrementResolver } from "./reg-nms-equity-price-increment.mjs";
import { DssLiveInputAssembler } from "./dss-live-input-assembler.mjs";
import { DssRuntime } from "./dss-runtime.mjs";
import { DssPermissionService } from "./dss-permission-service.mjs";
import { SchwabAccountRiskProvider } from "./account-risk-provider.mjs";
import { SchwabInstrumentSizingMetadataProvider } from "./instrument-sizing-metadata-provider.mjs";
import {
  RiskEvaluationRepository,
  DEFAULT_RISK_EVALUATION_FILE,
} from "./risk-evaluation-repository.mjs";
import { RiskSizingPermissionService } from "./risk-sizing-permission-service.mjs";
import { PreTradeStructuralValidityService } from "./pretrade-structural-validity.mjs";
import {
  PreTradePermissionAttemptRepository,
  DEFAULT_PRETRADE_PERMISSION_ATTEMPT_FILE,
} from "./pretrade-permission-attempt-repository.mjs";
import { PreTradePermissionPipeline } from "./pretrade-permission-pipeline.mjs";
import { createPreTradePermissionApiHandler } from "./pretrade-permission-api.mjs";
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
const RISK_EVALUATION_FILE = process.env.EXECUTIONOS_V24_RISK_EVALUATION_FILE || DEFAULT_RISK_EVALUATION_FILE;
const PERMISSION_ATTEMPT_FILE = process.env.EXECUTIONOS_V24_PERMISSION_ATTEMPT_FILE || DEFAULT_PRETRADE_PERMISSION_ATTEMPT_FILE;
const HANDOFF_FILE = process.env.EXECUTIONOS_V24_HANDOFF_FILE || DEFAULT_EXECUTION_BOARD_HANDOFF_FILE;
const HANDOFF_DELIVERY_FILE = process.env.EXECUTIONOS_V24_HANDOFF_DELIVERY_FILE || DEFAULT_EXECUTION_BOARD_HANDOFF_DELIVERY_FILE;
const MAX_BODY_BYTES = 1024 * 1024;

const store = new PreTradeStore({ filePath: STATE_FILE });
store.load();
const candidateIngress = new PreTradeCandidateIngress({ store });
const lifecycleCoordinator = new PreTradeLifecycleCoordinator({ store });
lifecycleCoordinator.reconcileAllValidity({ source: "STARTUP_VALIDITY_RECONCILIATION" });

const triggerEngine = new PreTradeTriggerEngine({ store, lifecycleCoordinator });
const triggerPersistenceAuthority = new PreTradeTriggerPersistenceAuthority({ store });
const triggerPersistenceMonitor = new PreTradeTriggerPersistenceMonitor({
  store,
  persistenceAuthority: triggerPersistenceAuthority,
});
const triggerRecovery = triggerEngine.recoverAll();
const handleTriggerApi = createPreTradeTriggerApiHandler({
  triggerEngine,
  persistenceMonitor: triggerPersistenceMonitor,
  lifecycleCoordinator,
  maxBodyBytes: MAX_BODY_BYTES,
});
const handleLifecycleApi = createPreTradeLifecycleApiHandler({
  coordinator: lifecycleCoordinator,
  maxBodyBytes: MAX_BODY_BYTES,
});

// Permission evaluation uses only read-only Schwab GET requests. Access tokens are
// read lazily and are never refreshed or written by this service.
const requestJson = createSchwabReadOnlyRequestJson();
const marketDataProvider = new SchwabMarketDataProvider({ requestJson, now: () => Date.now() });
const dssInputAssembler = new DssLiveInputAssembler({
  marketDataProvider,
  instrumentMetadataResolver: new RegNmsEquityPriceIncrementResolver({ now: () => Date.now() }),
  now: () => Date.now(),
});
const dssRuntime = new DssRuntime({ store, now: () => Date.now() });
const dssPermissionService = new DssPermissionService({
  store,
  inputAssembler: dssInputAssembler,
  runtime: dssRuntime,
});
const accountRiskProvider = new SchwabAccountRiskProvider({ requestJson, now: () => Date.now() });
const instrumentSizingMetadataProvider = new SchwabInstrumentSizingMetadataProvider({ marketDataProvider });
const riskEvaluationRepository = new RiskEvaluationRepository({ filePath: RISK_EVALUATION_FILE });
riskEvaluationRepository.load();
const riskSizingPermissionService = new RiskSizingPermissionService({
  store,
  marketDataProvider,
  accountRiskProvider,
  instrumentSizingMetadataProvider,
  riskEvaluationRepository,
  now: () => Date.now(),
});

// No discretionary structural rule is guessed. Until a trusted deterministic
// evaluator is registered for a candidate's structure family, the explicit
// operator structural assessment path is the fail-closed fallback.
const structuralValidityService = new PreTradeStructuralValidityService();
const permissionAttemptRepository = new PreTradePermissionAttemptRepository({ filePath: PERMISSION_ATTEMPT_FILE });
permissionAttemptRepository.load();
const permissionPipeline = new PreTradePermissionPipeline({
  store,
  lifecycleCoordinator,
  structuralValidityService,
  dssPermissionService,
  riskSizingPermissionService,
  riskEvaluationRepository,
  attemptRepository: permissionAttemptRepository,
});
const permissionRecovery = permissionPipeline.recoverAll();
const handlePermissionApi = createPreTradePermissionApiHandler({
  permissionPipeline,
  lifecycleCoordinator,
  maxBodyBytes: MAX_BODY_BYTES,
});

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

function statusForPreTradeError(error) {
  const code = String(error?.code || "").trim();
  if (code === "BODY_TOO_LARGE") return 413;
  if (
    code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR"
    || code === "CANDIDATE_VALIDITY_UNVERIFIABLE"
    || code === "EACCES"
    || code === "ENOSPC"
    || code === "EROFS"
    || code === "EIO"
  ) return 500;
  return 400;
}

function failPreTradeRequest(res, error, origin = null, fallbackCode = "PRETRADE_API_ERROR") {
  json(res, statusForPreTradeError(error), {
    error: error.message,
    code: error.code || fallbackCode,
    details: error.details || null,
  }, origin);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || null;
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = requestUrl.pathname;

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

  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, {
      ok: true,
      service: "executionos-v24-pretrade",
      readOnlyBrokerBoundary: true,
      stateFile: STATE_FILE,
      riskEvaluationFile: RISK_EVALUATION_FILE,
      permissionAttemptFile: PERMISSION_ATTEMPT_FILE,
      handoffFile: HANDOFF_FILE,
      handoffDeliveryFile: HANDOFF_DELIVERY_FILE,
      candidateIngressAuthority: true,
      candidateContractVersioning: true,
      candidateValidityAuthority: true,
      triggerContractAuthority: true,
      triggerEngineAuthority: true,
      triggerEvidenceApi: true,
      triggerPersistenceAuthority: true,
      triggerRecoveryBlocked: triggerRecovery.filter((item) => item.status === "RECOVERY_BLOCKED").length,
      structuralValidityAuthority: true,
      permissionAttemptAuthority: true,
      permissionPipelineAuthority: true,
      permissionEvaluationApi: true,
      permissionRecoveryBlocked: permissionRecovery.filter((item) => item.status === "RECOVERY_BLOCKED").length,
      lifecycleCommandApi: true,
      handoffTransportApi: true,
      brokerWriteAuthority: false,
    }, origin);
    return;
  }

  if (pathname.startsWith("/api/candidates")) {
    try {
      lifecycleCoordinator.reconcileAllValidity({ source: "REQUEST_VALIDITY_RECONCILIATION" });
    } catch (error) {
      failPreTradeRequest(res, error, origin, "VALIDITY_RECONCILIATION_ERROR");
      return;
    }
  }

  if (await handleTriggerApi(req, res)) return;
  if (await handlePermissionApi(req, res)) return;
  if (await handleLifecycleApi(req, res)) return;
  if (await handleHandoffApi(req, res)) return;

  if (req.method === "GET" && pathname === "/api/candidates") {
    try {
      json(res, 200, {
        ...lifecycleCoordinator.snapshot(),
        permissionAttempts: permissionAttemptRepository.snapshot().attempts,
      }, origin);
    } catch (error) {
      failPreTradeRequest(res, error, origin, "CANDIDATE_SNAPSHOT_ERROR");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/candidates/import") {
    if (origin && !isAllowedLocalOrigin(origin)) {
      json(res, 403, { error: "origin not allowed" });
      return;
    }

    try {
      const payload = await readJson(req);
      const result = candidateIngress.importBundle(payload);
      const validityReconciliation = lifecycleCoordinator.reconcileAllValidity({
        source: "INGRESS_VALIDITY_RECONCILIATION",
      });
      json(res, 200, { ...result, validityReconciliation }, origin);
    } catch (error) {
      failPreTradeRequest(res, error, origin, "IMPORT_ERROR");
    }
    return;
  }

  json(res, 404, { error: "not found" }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`[ExecutionOS V2.4] Pre-trade API listening on http://${HOST}:${PORT}`);
  console.log(`[ExecutionOS V2.4] State file: ${STATE_FILE}`);
  console.log(`[ExecutionOS V2.4] Risk evaluation file: ${RISK_EVALUATION_FILE}`);
  console.log(`[ExecutionOS V2.4] Permission attempt file: ${PERMISSION_ATTEMPT_FILE}`);
  console.log(`[ExecutionOS V2.4] Handoff file: ${HANDOFF_FILE}`);
  console.log(`[ExecutionOS V2.4] Handoff delivery file: ${HANDOFF_DELIVERY_FILE}`);
  console.log("[ExecutionOS V2.4] Candidate import is routed through authoritative ingress with immutable contract/version provenance.");
  console.log("[ExecutionOS V2.4] Exact candidate validity is reconciled before PRETRADE candidate operations.");
  console.log("[ExecutionOS V2.4] Trigger contracts are versioned and evaluated by the authoritative durable trigger engine.");
  console.log("[ExecutionOS V2.4] Trigger persistence is monitored separately from pre-satisfaction trigger progress.");
  console.log(`[ExecutionOS V2.4] Trigger startup recovery inspected ${triggerRecovery.length} persisted runtime record(s).`);
  console.log("[ExecutionOS V2.4] Canonical permission entry cannot bypass trigger-engine satisfaction.");
  console.log("[ExecutionOS V2.4] Permission attempts bind structural validity, DSS, exact account/entry evidence, Phase 4, and outcome immutably.");
  console.log(`[ExecutionOS V2.4] Permission startup recovery inspected ${permissionRecovery.length} persisted attempt record(s).`);
  console.log("[ExecutionOS V2.4] Canonical READY/CAUTION/PASS and permission blockers are permission-pipeline authority only.");
  console.log("[ExecutionOS V2.4] Schwab permission reads are GET-only and never refresh or write OAuth tokens.");
  console.log("[ExecutionOS V2.4] PRETRADE lifecycle mutations are exposed only as intent-specific authoritative commands.");
  console.log("[ExecutionOS V2.4] Handoff transport API enabled; browser handoff creation is not exposed.");
  console.log("[ExecutionOS V2.4] Broker boundary remains read-only; this service does not place, replace, cancel, or flatten orders.");
});
