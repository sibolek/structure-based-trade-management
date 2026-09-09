import {
  SOD_LINEAGE_NEW,
  SOD_LINEAGE_REVISED,
  SOD_LINEAGE_UNCHANGED,
} from "./sod-candidate-lineage.mjs";

export const SOD_PUBLICATION_NEW = "NEW_PUBLICATION";
export const SOD_PUBLICATION_EXACT_REPLAY = "EXACT_REPLAY";
export const SOD_PUBLICATION_PRETRADE_PREFLIGHT_REQUIRED = "PRETRADE_SUPERSESSION_PREFLIGHT_REQUIRED";

function publicationError(message, details = null) {
  const error = new Error(message);
  error.code = "SOD_PUBLICATION_INTENT_INVALID";
  if (details) error.details = details;
  return error;
}

export function publicationIntentForLineage(lineage) {
  const classification = String(lineage?.classification ?? "").trim().toUpperCase();
  const candidateId = String(lineage?.candidateId ?? "").trim();
  const contractVersion = Number(lineage?.contractVersion);

  if (!candidateId || !Number.isInteger(contractVersion) || contractVersion < 1) {
    throw publicationError("SOD publication intent requires resolved candidate identity and version", {
      candidateId: candidateId || null,
      contractVersion: Number.isFinite(contractVersion) ? contractVersion : null,
    });
  }

  if (classification === SOD_LINEAGE_NEW) {
    return {
      candidateId,
      contractVersion,
      lineageClassification: classification,
      publicationIntent: SOD_PUBLICATION_NEW,
      pretradePreflightRequired: false,
      finalAuthority: "PRETRADE",
    };
  }

  if (classification === SOD_LINEAGE_UNCHANGED) {
    return {
      candidateId,
      contractVersion,
      lineageClassification: classification,
      publicationIntent: SOD_PUBLICATION_EXACT_REPLAY,
      pretradePreflightRequired: false,
      finalAuthority: "PRETRADE",
    };
  }

  if (classification === SOD_LINEAGE_REVISED) {
    return {
      candidateId,
      contractVersion,
      lineageClassification: classification,
      publicationIntent: SOD_PUBLICATION_PRETRADE_PREFLIGHT_REQUIRED,
      pretradePreflightRequired: true,
      finalAuthority: "PRETRADE",
    };
  }

  throw publicationError(`Unsupported SOD lineage classification: ${classification || "EMPTY"}`, {
    candidateId,
    contractVersion,
    classification: classification || null,
  });
}

export function publicationIntentsForLineage(lineageItems) {
  if (!Array.isArray(lineageItems)) {
    throw publicationError("SOD publication intents require a lineage array");
  }
  return lineageItems.map(publicationIntentForLineage);
}
