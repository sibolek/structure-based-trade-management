import crypto from "node:crypto";

export const PRETRADE_PERMISSION_DECISION_SCHEMA_VERSION = 1;
export const PRETRADE_PERMISSION_DECISION_AUTHORITY = "PRETRADE_PERMISSION_DECISION";

const OUTCOMES = new Set(["READY", "CAUTION", "PASS"]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function decisionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function candidateContext(candidate) {
  return {
    setup: candidate?.setup ?? null,
    thesis: candidate?.thesis ?? null,
    entryConstraints: candidate?.entryConstraints ?? null,
    disqualifiers: candidate?.disqualifiers ?? null,
    noTradeConditions: candidate?.noTradeConditions ?? null,
    context: candidate?.context ?? null,
    catalyst: candidate?.catalyst ?? null,
    rating: candidate?.rating ?? null,
    morningPriority: candidate?.morningPriority ?? null,
  };
}

export class PreTradePermissionDecisionService {
  constructor({
    evaluator = null,
    clock = () => new Date().toISOString(),
    idFactory = () => crypto.randomUUID(),
  } = {}) {
    if (evaluator !== null && typeof evaluator !== "function") throw new Error("evaluator must be a function when supplied");
    if (typeof clock !== "function") throw new Error("clock must be a function");
    if (typeof idFactory !== "function") throw new Error("idFactory must be a function");
    this.evaluator = evaluator;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  async evaluate({ candidate, structuralValidity, dssResult, riskEvaluation, operatorAssessment = null } = {}) {
    if (!candidate || typeof candidate !== "object") throw decisionError("candidate is required", "PERMISSION_DECISION_CANDIDATE_REQUIRED");
    if (!structuralValidity || structuralValidity.status !== "VALID") throw decisionError("VALID structural evidence is required", "PERMISSION_DECISION_STRUCTURE_REQUIRED");
    if (!dssResult || upper(dssResult.status ?? dssResult.evaluation?.status) !== "VALID") throw decisionError("VALID DSS evidence is required", "PERMISSION_DECISION_DSS_REQUIRED");
    if (!riskEvaluation || upper(riskEvaluation.status) !== "VALID") throw decisionError("VALID Phase 4 evidence is required", "PERMISSION_DECISION_RISK_REQUIRED");

    const evaluatedAt = timestamp(this.clock());
    if (!evaluatedAt) throw decisionError("permission decision clock returned an invalid timestamp", "PERMISSION_DECISION_CLOCK_INVALID");
    const permissionDecisionId = text(this.idFactory());
    if (!permissionDecisionId) throw decisionError("permission decision idFactory returned an empty id", "PERMISSION_DECISION_ID_INVALID");

    const context = candidateContext(candidate);
    let raw;
    let source;
    if (this.evaluator) {
      raw = await this.evaluator(immutable({ candidate, structuralValidity, dssResult, riskEvaluation, context }));
      source = "TRUSTED_EVALUATOR";
    } else if (operatorAssessment && typeof operatorAssessment === "object") {
      raw = operatorAssessment;
      source = "OPERATOR";
    } else {
      return immutable({
        schemaVersion: PRETRADE_PERMISSION_DECISION_SCHEMA_VERSION,
        authority: PRETRADE_PERMISSION_DECISION_AUTHORITY,
        permissionDecisionId,
        candidateId: text(candidate.candidateId),
        contractVersion: Number(candidate.contractVersion),
        candidateContentHash: text(candidate.contentHash),
        kind: "BLOCKED_RETRYABLE",
        outcome: null,
        reasonCode: "PERMISSION_CONTEXT_ASSESSMENT_REQUIRED",
        reasonCodes: ["PERMISSION_CONTEXT_ASSESSMENT_REQUIRED"],
        evaluatedAt,
        source: "SYSTEM",
        contextHash: hash(context),
        context,
        provenance: null,
      });
    }

    const outcome = upper(raw?.outcome);
    if (!OUTCOMES.has(outcome)) throw decisionError("permission context outcome must be READY, CAUTION, or PASS", "INVALID_PERMISSION_DECISION");
    const reasonCodes = [...new Set((raw?.reasonCodes || []).map(upper).filter(Boolean))];
    const reasonCode = text(raw?.reasonCode) || reasonCodes[0] || null;
    if (outcome === "CAUTION" && reasonCodes.length === 0) {
      throw decisionError("CAUTION requires explicit reasonCodes", "INVALID_PERMISSION_DECISION");
    }
    if (outcome === "PASS" && !reasonCode) {
      throw decisionError("PASS requires explicit reason provenance", "INVALID_PERMISSION_DECISION");
    }

    return immutable({
      schemaVersion: PRETRADE_PERMISSION_DECISION_SCHEMA_VERSION,
      authority: PRETRADE_PERMISSION_DECISION_AUTHORITY,
      permissionDecisionId,
      candidateId: text(candidate.candidateId),
      contractVersion: Number(candidate.contractVersion),
      candidateContentHash: text(candidate.contentHash),
      kind: "OUTCOME",
      outcome,
      reasonCode,
      reasonCodes,
      evaluatedAt,
      source,
      contextHash: hash(context),
      context,
      provenance: source === "OPERATOR"
        ? {
            actor: text(raw?.actor) || "OPERATOR",
            note: text(raw?.note) || null,
          }
        : raw?.provenance ?? null,
    });
  }
}
