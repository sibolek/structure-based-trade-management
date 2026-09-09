export const SOD_ANALYSIS_SCHEMA_VERSION = 1;
export const SOD_GENERATION_INITIAL = "INITIAL";
export const SOD_GENERATION_REFRESH = "REFRESH";

const GENERATION_MODES = new Set([SOD_GENERATION_INITIAL, SOD_GENERATION_REFRESH]);
const FORBIDDEN_PROVIDER_CANDIDATE_FIELDS = new Set([
  "contractVersion",
  "generatedAt",
  "source",
  "sourceDate",
  "lineage",
  "lineageClassification",
  "publicationIntent",
  "publicationEligibility",
  "lifecycleState",
  "stateRevision",
  "status",
  "armAuthorized",
  "arm",
  "handoff",
  "permissionOutcome",
  "riskEvaluation",
  "selectedQuantity",
  "executionState",
]);
const FORBIDDEN_REQUEST_PATH_FIELDS = new Set([
  "outputPath",
  "destinationPath",
  "inboxPath",
  "candidateInboxPath",
  "pretradeStateFile",
]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function contractError(message, code = "SOD_ANALYSIS_CONTRACT_INVALID", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function validSourceDate(value) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

function assertNoForbiddenRequestPaths(input) {
  for (const field of FORBIDDEN_REQUEST_PATH_FIELDS) {
    if (input?.[field] !== undefined && input?.[field] !== null && input?.[field] !== "") {
      throw contractError(
        `SOD analysis request may not control orchestration filesystem field ${field}`,
        "SOD_ANALYSIS_REQUEST_PATH_FORBIDDEN",
        { field },
      );
    }
  }
}

function normalizeChart(chart, index) {
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) {
    throw contractError(`SOD chart ${index} must be an object`, "SOD_ANALYSIS_CHART_INVALID", { index });
  }
  if (chart.path !== undefined || chart.filePath !== undefined || chart.outputPath !== undefined) {
    throw contractError(
      `SOD chart ${index} may use only orchestrator-issued contentRef, not filesystem paths`,
      "SOD_ANALYSIS_CHART_PATH_FORBIDDEN",
      { index },
    );
  }
  const chartId = text(chart.chartId);
  const contentRef = text(chart.contentRef);
  if (!chartId || !contentRef) {
    throw contractError(
      `SOD chart ${index} requires chartId and orchestrator-issued contentRef`,
      "SOD_ANALYSIS_CHART_INVALID",
      { index },
    );
  }
  return {
    chartId,
    contentRef,
    symbol: upper(chart.symbol) || null,
    timeframe: text(chart.timeframe) || null,
    label: text(chart.label) || null,
  };
}

export function buildSodAnalysisRequest(input = {}) {
  assertNoForbiddenRequestPaths(input);
  const sourceDate = text(input.sourceDate);
  if (!validSourceDate(sourceDate)) {
    throw contractError("SOD analysis sourceDate must be exact YYYY-MM-DD", "SOD_ANALYSIS_SOURCE_DATE_INVALID");
  }
  const generationMode = upper(input.generationMode || SOD_GENERATION_INITIAL);
  if (!GENERATION_MODES.has(generationMode)) {
    throw contractError(`Unsupported SOD generationMode ${generationMode}`, "SOD_ANALYSIS_MODE_INVALID");
  }
  if (!Array.isArray(input.charts) || input.charts.length === 0) {
    throw contractError("SOD analysis requires at least one chart reference", "SOD_ANALYSIS_CHARTS_REQUIRED");
  }

  return {
    schemaVersion: SOD_ANALYSIS_SCHEMA_VERSION,
    sourceDate,
    generationMode,
    charts: input.charts.map(normalizeChart),
    marketContext: input.marketContext && typeof input.marketContext === "object"
      ? structuredClone(input.marketContext)
      : null,
    priorSodRef: text(input.priorSodRef) || null,
  };
}

function assertCandidateProposalAuthority(candidate, index) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw contractError(`SOD analysis candidate ${index} must be an object`, "SOD_ANALYSIS_RESULT_INVALID", { index });
  }
  for (const field of FORBIDDEN_PROVIDER_CANDIDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)) {
      throw contractError(
        `SOD analysis provider may not establish ${field} for candidate ${index}`,
        "SOD_ANALYSIS_PROVIDER_AUTHORITY_VIOLATION",
        { index, field },
      );
    }
  }
  if (!text(candidate.candidateId)) {
    throw contractError(
      `SOD analysis candidate ${index} requires explicit stable candidateId`,
      "SOD_ANALYSIS_CANDIDATE_ID_REQUIRED",
      { index },
    );
  }
}

export function normalizeSodAnalysisResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw contractError("SOD analysis provider result must be an object", "SOD_ANALYSIS_RESULT_INVALID");
  }
  if (!Array.isArray(result.candidateProposals)) {
    throw contractError("SOD analysis result requires candidateProposals array", "SOD_ANALYSIS_RESULT_INVALID");
  }
  result.candidateProposals.forEach(assertCandidateProposalAuthority);

  return {
    schemaVersion: SOD_ANALYSIS_SCHEMA_VERSION,
    candidateProposals: structuredClone(result.candidateProposals),
    report: result.report && typeof result.report === "object" ? structuredClone(result.report) : null,
    dashboard: result.dashboard && typeof result.dashboard === "object" ? structuredClone(result.dashboard) : null,
    generationMetadata: result.generationMetadata && typeof result.generationMetadata === "object"
      ? structuredClone(result.generationMetadata)
      : null,
  };
}

export function assertSodAnalysisProvider(provider) {
  if (!provider || typeof provider !== "object" || typeof provider.generate !== "function") {
    throw contractError(
      "SOD analysis provider must expose async generate(request)",
      "SOD_ANALYSIS_PROVIDER_INVALID",
    );
  }
  return provider;
}

export async function invokeSodAnalysisProvider(provider, requestInput) {
  const trustedProvider = assertSodAnalysisProvider(provider);
  const request = buildSodAnalysisRequest(requestInput);
  const result = await trustedProvider.generate(request);
  return {
    request,
    result: normalizeSodAnalysisResult(result),
  };
}
