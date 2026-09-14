import { sanitizeSodResearchDiagnostics } from "./sod-research-diagnostics.mjs";
import { sanitizeSodCandidateSemanticDiagnostics } from "./sod-candidate-diagnostics.mjs";
// Observations only: these phases never imply delivery or remote completion.
const PHASES = new Set(["REQUEST_STARTED", "HEADERS_RECEIVED", "BODY_READING", "BODY_RECEIVED", "RESPONSE_PARSED"]);
const EXCEPTION_CLASSES = new Set([
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError",
  "AbortError", "DOMException", "HeadersTimeoutError", "BodyTimeoutError", "ConnectTimeoutError", "SocketError",
  "RequestAbortedError", "ResponseContentLengthMismatchError", "HeadersOverflowError", "InvalidArgumentError", "ConnectError",
]);
const TRANSPORT_CODES = new Set([
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_ABORTED",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH", "UND_ERR_RES_EXCEEDED_MAX_SIZE", "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH", "UND_ERR_DESTROYED",
  "ECONNRESET", "EPIPE", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH",
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "CERT_REVOKED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED", "ERR_TLS_DH_PARAM_SIZE",
  "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION", "ERR_SSL_TLSV1_ALERT_UNKNOWN_CA",
  "ERR_SSL_TLSV1_ALERT_HANDSHAKE_FAILURE", "ERR_SSL_EC_KEY_TOO_SMALL",
]);
const VERSION_PATTERN = /^v?\d{1,3}(?:\.\d{1,3}){0,3}(?:[-+][a-z0-9.-]{1,16})?$/i;
export const SOD_OPENAI_MAX_TIMEOUT_MS = 600_000;

function normalizeExceptionClass(value) {
  return EXCEPTION_CLASSES.has(value) ? value : "OTHER";
}

function normalizeTransportCode(value) {
  return TRANSPORT_CODES.has(value) ? value : "OTHER";
}

function errorClass(error) {
  try {
    const name = typeof error?.name === "string" ? error.name : typeof error?.constructor?.name === "string" ? error.constructor.name : "";
    return normalizeExceptionClass(name);
  } catch {
    return "OTHER";
  }
}

function errorCode(error) {
  try {
    return normalizeTransportCode(typeof error?.code === "string" ? error.code : "");
  } catch {
    return "OTHER";
  }
}

function errorNode(error, depth) {
  return { depth, class: errorClass(error), code: errorCode(error) };
}

export function buildSodTransportErrorDiagnostics(error) {
  const causeChain = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === "object" && causeChain.length < 2 && !seen.has(current)) {
    seen.add(current);
    causeChain.push(errorNode(current, causeChain.length));
    try { current = current.cause; } catch { current = null; }
  }
  return {
    exceptionClass: causeChain[0]?.class || "OTHER",
    causeClass: causeChain[1]?.class || "OTHER",
    transportCode: causeChain.find(node => node.code !== "OTHER")?.code || "OTHER",
    causeChain,
  };
}

function safeVersion(value) {
  return typeof value === "string" && value.length <= 32 && VERSION_PATTERN.test(value) ? value : null;
}

export function sanitizeSodTransportDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  const result = {};
  if (/^SOD_[A-Z_]{3,80}$/.test(value.errorCode || "")) result.errorCode = value.errorCode;
  if (PHASES.has(value.phase)) result.phase = value.phase;
  if (typeof value.headersObserved === "boolean") result.headersObserved = value.headersObserved;
  if (typeof value.applicationAbortObserved === "boolean") result.applicationAbortObserved = value.applicationAbortObserved;
  if (Number.isInteger(value.timeoutMs) && value.timeoutMs > 0 && value.timeoutMs <= SOD_OPENAI_MAX_TIMEOUT_MS) result.timeoutMs = value.timeoutMs;
  if (Number.isInteger(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs <= 2_147_483_647) result.elapsedMs = value.elapsedMs;
  if (/^req_[a-zA-Z0-9_-]{1,124}$/.test(value.requestId || "") && value.headersObserved !== false) result.requestId = value.requestId;
  if (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) result.httpStatus = value.httpStatus;
  if (Object.hasOwn(value, "exceptionClass")) result.exceptionClass = normalizeExceptionClass(value.exceptionClass);
  if (Object.hasOwn(value, "causeClass")) result.causeClass = normalizeExceptionClass(value.causeClass);
  if (Object.hasOwn(value, "transportCode")) result.transportCode = normalizeTransportCode(value.transportCode);
  if (Array.isArray(value.causeChain)) {
    result.causeChain = value.causeChain.slice(0, 2).map((node, depth) => ({
      depth,
      class: EXCEPTION_CLASSES.has(node?.class) ? node.class : "OTHER",
      code: TRANSPORT_CODES.has(node?.code) ? node.code : "OTHER",
    }));
  }
  const nodeVersion = safeVersion(value.nodeVersion);
  const undiciVersion = safeVersion(value.undiciVersion);
  if (nodeVersion) result.nodeVersion = nodeVersion;
  if (undiciVersion) result.undiciVersion = undiciVersion;
  if (result.errorCode === "SOD_OPENAI_RESEARCH_SOURCE_MISMATCH") {
    const semantic = sanitizeSodResearchDiagnostics(value.semantic);
    if (semantic) result.semantic = semantic;
  }
  if (result.errorCode === "SOD_OPENAI_CANDIDATE_SEMANTICS_INVALID") {
    const semantic = sanitizeSodCandidateSemanticDiagnostics(value.semantic);
    if (semantic) result.semantic = semantic;
  }
  return Object.keys(result).length ? result : null;
}
