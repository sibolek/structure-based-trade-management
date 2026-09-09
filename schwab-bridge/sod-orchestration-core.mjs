import { invokeSodAnalysisProvider } from "./sod-analysis-provider.mjs";
import { buildCanonicalSodCandidateBundle } from "./sod-candidate-export.mjs";
import { resolveSodCandidateBundleLineage } from "./sod-candidate-lineage.mjs";
import { publishCandidateBundleAtomically } from "./sod-candidate-publisher.mjs";
import {
  publicationIntentsForLineage,
  SOD_PUBLICATION_PRETRADE_PREFLIGHT_REQUIRED,
} from "./sod-publication-intent.mjs";

export const SOD_ORCHESTRATION_NO_CANDIDATES = "NO_CANDIDATES";
export const SOD_ORCHESTRATION_READY_TO_PUBLISH = "READY_TO_PUBLISH";
export const SOD_ORCHESTRATION_PRETRADE_PREFLIGHT_REQUIRED = "PRETRADE_PREFLIGHT_REQUIRED";

function text(value) {
  return String(value ?? "").trim();
}

function orchestrationError(message, code = "SOD_ORCHESTRATION_ERROR", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function safeBundleTimestamp(value) {
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) {
    throw orchestrationError("Orchestration clock returned invalid timestamp", "SOD_ORCHESTRATION_CLOCK_INVALID");
  }
  return new Date(parsed).toISOString().replace(/[:.]/g, "-");
}

function priorCandidatesFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.candidates)) {
    throw orchestrationError(
      "SOD orchestration requires authoritative PRETRADE candidate snapshot",
      "SOD_ORCHESTRATION_PRETRADE_SNAPSHOT_INVALID",
    );
  }
  return snapshot.candidates;
}

function analysisProjection(invocation) {
  return {
    report: invocation.result.report,
    dashboard: invocation.result.dashboard,
    generationMetadata: invocation.result.generationMetadata,
  };
}

export async function prepareSodOrchestration({
  provider,
  request,
  pretradeSnapshot,
  clock = () => new Date().toISOString(),
  bundleIdFactory = ({ sourceDate, generatedAt }) => `sod-${sourceDate}-a-plus-trades-${safeBundleTimestamp(generatedAt)}`,
} = {}) {
  const priorCandidates = priorCandidatesFromSnapshot(pretradeSnapshot);
  const invocation = await invokeSodAnalysisProvider(provider, request);
  const generatedAt = text(clock());
  safeBundleTimestamp(generatedAt);

  if (invocation.result.candidateProposals.length === 0) {
    return {
      status: SOD_ORCHESTRATION_NO_CANDIDATES,
      sourceDate: invocation.request.sourceDate,
      generationMode: invocation.request.generationMode,
      generatedAt,
      analysis: analysisProjection(invocation),
      bundle: null,
      lineage: [],
      publicationIntents: [],
      requiresPretradePreflight: false,
    };
  }

  const bundleId = text(bundleIdFactory({
    sourceDate: invocation.request.sourceDate,
    generatedAt,
    generationMode: invocation.request.generationMode,
  }));
  if (!bundleId) {
    throw orchestrationError("SOD orchestration bundleIdFactory returned empty id", "SOD_ORCHESTRATION_BUNDLE_ID_INVALID");
  }

  const exported = buildCanonicalSodCandidateBundle({
    sourceDate: invocation.request.sourceDate,
    generatedAt,
    bundleId,
    candidates: invocation.result.candidateProposals,
  }, {
    clock: () => generatedAt,
    automatedPublication: true,
  });

  const resolved = resolveSodCandidateBundleLineage(exported, priorCandidates);
  const publicationIntents = publicationIntentsForLineage(resolved.lineage);
  const requiresPretradePreflight = publicationIntents.some((item) => (
    item.publicationIntent === SOD_PUBLICATION_PRETRADE_PREFLIGHT_REQUIRED
  ));

  return {
    status: requiresPretradePreflight
      ? SOD_ORCHESTRATION_PRETRADE_PREFLIGHT_REQUIRED
      : SOD_ORCHESTRATION_READY_TO_PUBLISH,
    sourceDate: invocation.request.sourceDate,
    generationMode: invocation.request.generationMode,
    generatedAt,
    analysis: analysisProjection(invocation),
    bundle: resolved.bundle,
    lineage: resolved.lineage,
    publicationIntents,
    requiresPretradePreflight,
  };
}

export async function publishPreparedSodOrchestration({
  prepared,
  inboxPath,
  idFactory,
} = {}) {
  if (!prepared || typeof prepared !== "object") {
    throw orchestrationError("Prepared SOD orchestration is required", "SOD_ORCHESTRATION_PREPARED_INVALID");
  }
  if (prepared.status === SOD_ORCHESTRATION_NO_CANDIDATES) {
    throw orchestrationError(
      "SOD orchestration contains no A+ candidates and has nothing to publish",
      "SOD_ORCHESTRATION_NO_CANDIDATES",
    );
  }
  if (!prepared.bundle) {
    throw orchestrationError("Prepared SOD orchestration bundle is required", "SOD_ORCHESTRATION_PREPARED_INVALID");
  }
  if (prepared.requiresPretradePreflight === true) {
    throw orchestrationError(
      "Revised SOD candidate requires authoritative PRETRADE supersession preflight before publication",
      "SOD_ORCHESTRATION_PRETRADE_PREFLIGHT_REQUIRED",
      {
        candidates: Array.isArray(prepared.publicationIntents)
          ? prepared.publicationIntents.filter((item) => item.pretradePreflightRequired)
          : [],
      },
    );
  }

  return publishCandidateBundleAtomically({
    inboxPath,
    bundle: prepared.bundle,
    ...(idFactory ? { idFactory } : {}),
  });
}
