import crypto from "node:crypto";

export const PRETRADE_STRUCTURAL_VALIDITY_SCHEMA_VERSION = 1;
export const PRETRADE_STRUCTURAL_VALIDITY_AUTHORITY = "PRETRADE_STRUCTURAL_VALIDITY";

const STATUSES = new Set(["VALID", "INVALID", "BLOCKED"]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function structuralError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedTime(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizedAssessment(raw, { candidate, evaluatedAt, evaluationId, source }) {
  const assessment = raw && typeof raw === "object" ? raw : {};
  const status = upper(assessment.status);
  if (!STATUSES.has(status)) {
    throw structuralError("structural validity status must be VALID, INVALID, or BLOCKED", "INVALID_STRUCTURAL_VALIDITY_STATUS");
  }

  const candidateStructural = candidate?.structuralInvalidation && typeof candidate.structuralInvalidation === "object"
    ? candidate.structuralInvalidation
    : {};
  const resolvedPrice = finitePositive(assessment.resolvedPrice ?? candidateStructural.price);
  const reasonCodes = [...new Set((assessment.reasonCodes || []).map(upper).filter(Boolean))];

  if (status === "VALID" && resolvedPrice === null) {
    return immutable({
      schemaVersion: PRETRADE_STRUCTURAL_VALIDITY_SCHEMA_VERSION,
      authority: PRETRADE_STRUCTURAL_VALIDITY_AUTHORITY,
      structuralEvaluationId: evaluationId,
      candidateId: text(candidate?.candidateId),
      contractVersion: Number(candidate?.contractVersion),
      candidateContentHash: text(candidate?.contentHash),
      status: "BLOCKED",
      reasonCodes: ["STRUCTURAL_REFERENCE_UNRESOLVED"],
      evaluatedAt,
      source,
      resolvedPrice: null,
      evidenceReference: assessment.evidenceReference ?? null,
      provenance: assessment.provenance ?? null,
    });
  }

  if (["INVALID", "BLOCKED"].includes(status) && reasonCodes.length === 0) {
    reasonCodes.push(status === "INVALID" ? "STRUCTURE_INVALID" : "STRUCTURAL_EVIDENCE_UNAVAILABLE");
  }

  return immutable({
    schemaVersion: PRETRADE_STRUCTURAL_VALIDITY_SCHEMA_VERSION,
    authority: PRETRADE_STRUCTURAL_VALIDITY_AUTHORITY,
    structuralEvaluationId: evaluationId,
    candidateId: text(candidate?.candidateId),
    contractVersion: Number(candidate?.contractVersion),
    candidateContentHash: text(candidate?.contentHash),
    status,
    reasonCodes,
    evaluatedAt,
    source,
    resolvedPrice,
    evidenceReference: assessment.evidenceReference ?? null,
    provenance: assessment.provenance ?? null,
  });
}

export class PreTradeStructuralValidityService {
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

  async evaluate({ candidate, operatorAssessment = null } = {}) {
    if (!candidate || typeof candidate !== "object") {
      throw structuralError("candidate is required", "STRUCTURAL_VALIDITY_CANDIDATE_REQUIRED");
    }
    const evaluatedAt = normalizedTime(this.clock());
    if (!evaluatedAt) throw structuralError("structural validity clock returned an invalid timestamp", "STRUCTURAL_VALIDITY_CLOCK_INVALID");
    const evaluationId = text(this.idFactory());
    if (!evaluationId) throw structuralError("structural validity idFactory returned an empty id", "STRUCTURAL_VALIDITY_ID_INVALID");

    let raw;
    let source;
    if (this.evaluator) {
      raw = await this.evaluator(immutable(candidate));
      source = "TRUSTED_EVALUATOR";
    } else if (operatorAssessment && typeof operatorAssessment === "object") {
      raw = {
        ...operatorAssessment,
        provenance: {
          ...(operatorAssessment.provenance && typeof operatorAssessment.provenance === "object" ? operatorAssessment.provenance : {}),
          actor: text(operatorAssessment.actor) || "OPERATOR",
          note: text(operatorAssessment.note) || null,
        },
      };
      source = "OPERATOR";
    } else {
      raw = {
        status: "BLOCKED",
        reasonCodes: ["STRUCTURAL_VALIDITY_REQUIRES_OPERATOR_OR_TRUSTED_EVALUATOR"],
        resolvedPrice: candidate?.structuralInvalidation?.price ?? null,
      };
      source = "SYSTEM";
    }

    const result = normalizedAssessment(raw, { candidate, evaluatedAt, evaluationId, source });
    if (result.candidateId !== text(candidate.candidateId) || result.contractVersion !== Number(candidate.contractVersion)) {
      throw structuralError("structural validity identity mismatch", "STRUCTURAL_VALIDITY_IDENTITY_MISMATCH");
    }
    return result;
  }

  dssInputs(candidate, evaluation) {
    if (!evaluation || evaluation.authority !== PRETRADE_STRUCTURAL_VALIDITY_AUTHORITY) {
      throw structuralError("authoritative structural validity evaluation is required", "STRUCTURAL_VALIDITY_AUTHORITY_REQUIRED");
    }
    if (upper(evaluation.status) !== "VALID" || finitePositive(evaluation.resolvedPrice) === null) {
      throw structuralError("VALID structural evaluation with resolvedPrice is required for DSS", "STRUCTURAL_VALIDITY_NOT_READY_FOR_DSS");
    }
    return immutable({
      structuralInvalidationDefinition: structuredClone(candidate.structuralInvalidation),
      structureEvaluation: {
        status: "VALID",
        evaluatedAt: evaluation.evaluatedAt,
        evaluationReference: evaluation.structuralEvaluationId,
        resolvedPrice: evaluation.resolvedPrice,
        evidenceReference: evaluation.evidenceReference,
        provenance: evaluation.provenance,
      },
    });
  }
}
