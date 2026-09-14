import crypto from "node:crypto";

export const SOD_RESEARCH_DIAGNOSTIC_LIMITS = Object.freeze({ mismatches: 8, extractedSources: 16, observedLinks: 8, actionObservations: 16, urlInspectionChars: 4096, bytes: 32768 });
const L = SOD_RESEARCH_DIAGNOSTIC_LIMITS;
const CATEGORIES = new Set(["VIX", "FUTURES", "INDEX", "RATES", "CRUDE", "MACRO_EVENT", "EARNINGS", "COMPANY_CATALYST", "OTHER"]);
const REASONS = new Set(["INVALID_URL", "SOURCE_NOT_IN_WEB_SEARCH_SET", "EMPTY_EXTRACTED_SOURCE_SET"]);
const LOCATIONS = new Set(["WEB_SEARCH_ACTION_URL", "MESSAGE_URL_CITATION"]);
const ACTION_TYPES = new Set(["search", "open_page", "find_in_page"]);
const ACTION_STATUSES = new Set(["in_progress", "searching", "completed", "failed", "incomplete"]);
const ACTION_REASONS = new Set(["QUALIFIED_PAGE_ACTION", "ACTION_TYPE_NOT_QUALIFIED", "STATUS_NOT_COMPLETED", "INVALID_URL"]);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const count = value => Number.isInteger(value) && value >= 0 && value <= 10_000_000 ? value : 0;
const HASH_FIELDS = ["rawSha256", "canonicalSha256", "hostSha256", "pathSha256", "decodedPathSha256", "querySha256", "decodedQuerySha256"];
const FLAGS = ["valid", "oversized", "fragmentPresent", "utmRemoved", "trailingSlashRemoved", "hostnameCaseNormalized", "percentEncodingPresent", "queryRetained", "credentialsPresent"];

// No URL text, host, path, query key/value, fragment, or userinfo crosses this boundary.
// Component hashes allow equality comparisons even when a URL component contains a secret.
function urlEvidence(value, canonical) {
  const raw = typeof value === "string" ? value.trim() : "";
  const result = { valid: Boolean(canonical), rawSha256: hash(raw), rawLength: raw.length,
    ...(canonical ? { canonicalSha256: hash(canonical) } : {}),
    oversized: raw.length > L.urlInspectionChars || (canonical?.length || 0) > L.urlInspectionChars };
  if (result.oversized) return result;
  try {
    const original = new URL(raw);
    result.fragmentPresent = Boolean(original.hash);
    result.credentialsPresent = Boolean(original.username || original.password);
    result.percentEncodingPresent = /%[0-9a-f]{2}/i.test(raw);
    if (!canonical) return result;
    const normalized = new URL(canonical);
    result.scheme = normalized.protocol === "https:" ? "https" : "http";
    result.hostSha256 = hash(normalized.host);
    result.pathSha256 = hash(normalized.pathname);
    try { result.decodedPathSha256 = hash(decodeURIComponent(normalized.pathname)); } catch { /* invalid escapes remain distinguishable by path hash */ }
    result.querySha256 = hash(normalized.search);
    try { result.decodedQuerySha256 = hash(decodeURIComponent(normalized.search)); } catch { /* diagnostic only; matching still uses the unchanged canonical URL */ }
    result.pathLength = normalized.pathname.length;
    result.queryLength = normalized.search.length;
    result.utmRemoved = [...original.searchParams.keys()].some(k => k.toLowerCase().startsWith("utm_"));
    result.trailingSlashRemoved = original.pathname !== normalized.pathname;
    const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(raw)?.[1]?.split("@").at(-1) || "";
    result.hostnameCaseNormalized = /[A-Z]/.test(authority);
    result.queryRetained = Boolean(normalized.search);
  } catch { /* invalid URLs retain fingerprints only */ }
  return result;
}

function sanitizeUrl(value) {
  const result = {};
  for (const key of HASH_FIELDS) if (typeof value?.[key] === "string" && /^[a-f0-9]{64}$/.test(value[key])) result[key] = value[key];
  for (const key of FLAGS) if (typeof value?.[key] === "boolean") result[key] = value[key];
  for (const key of ["rawLength", "pathLength", "queryLength"]) if (Number.isInteger(value?.[key])) result[key] = count(value[key]);
  if (["http", "https"].includes(value?.scheme)) result.scheme = value.scheme;
  return result;
}

function sanitizeActionObservation(value) {
  if (!value || typeof value !== "object") return null;
  const reason = ACTION_REASONS.has(value.reason) ? value.reason : "ACTION_TYPE_NOT_QUALIFIED";
  const result = {
    actionType: ACTION_TYPES.has(value.actionType) ? value.actionType : (value.actionType ? "OTHER" : null),
    status: ACTION_STATUSES.has(value.status) ? value.status : (value.status ? "OTHER" : null),
    eligible: reason === "QUALIFIED_PAGE_ACTION" && value.eligible === true,
    reason,
  };
  if (value.url !== null && value.url !== undefined) result.url = sanitizeUrl(value.url);
  return result;
}

export function sanitizeSodResearchDiagnostics(value) {
  if (value?.version !== 1 || value.validatorStage !== "RESEARCH_SOURCE_MEMBERSHIP") return null;
  const result = { version: 1, validatorStage: "RESEARCH_SOURCE_MEMBERSHIP", redirectResolution: "NOT_PERFORMED",
    mismatchCount: count(value.mismatchCount), extractedSourceCount: count(value.extractedSourceCount),
    observedLinkCount: count(value.observedLinkCount), extraction: {}, mismatches: [], extractedSources: [], observedLinks: [], actionObservations: [] };
  for (const key of ["webSearchCallCount", "missingSourcesArrayCount", "rawSourceCount", "invalidSourceCount", "duplicateSourceCount", "distinctSourceCount",
    "sourceArrayRawCount", "sourceArrayDistinctCount", "qualifyingPageActionCount", "qualifyingPageActionDistinctCount",
    "combinedAuthoritativeDistinctCount", "actionObservationCount", "rejectedActionObservationCount"]) result.extraction[key] = count(value.extraction?.[key]);
  for (const item of (Array.isArray(value.mismatches) ? value.mismatches : []).slice(0, L.mismatches)) {
    if (!REASONS.has(item?.reason)) continue;
    result.mismatches.push({ researchIndex: count(item.researchIndex), sourceUrlIndex: count(item.sourceUrlIndex),
      category: CATEGORIES.has(item.category) ? item.category : "OTHER", reason: item.reason, url: sanitizeUrl(item.url) });
  }
  result.extractedSources = (Array.isArray(value.extractedSources) ? value.extractedSources : []).slice(0, L.extractedSources).map(sanitizeUrl);
  for (const item of (Array.isArray(value.observedLinks) ? value.observedLinks : []).slice(0, L.observedLinks)) {
    if (LOCATIONS.has(item?.location)) result.observedLinks.push({ location: item.location, url: sanitizeUrl(item.url) });
  }
  result.actionObservations = (Array.isArray(value.actionObservations) ? value.actionObservations : [])
    .slice(0, L.actionObservations).map(sanitizeActionObservation).filter(Boolean);
  const markTruncation = () => {
    result.mismatchesTruncated = result.mismatchCount > result.mismatches.length;
    result.extractedSourcesTruncated = result.extractedSourceCount > result.extractedSources.length;
    result.observedLinksTruncated = result.observedLinkCount > result.observedLinks.length;
    result.actionObservationsTruncated = result.extraction.actionObservationCount > result.actionObservations.length;
  };
  markTruncation();
  while (Buffer.byteLength(JSON.stringify(result)) > L.bytes) {
    const list = [result.observedLinks, result.extractedSources, result.mismatches, result.actionObservations].find(items => items.length);
    if (!list) return null;
    list.pop(); markTruncation();
  }
  return result;
}

export function buildSodResearchDiagnostics({ mismatches, mismatchCount, actualSourceUrls, response, normalizeUrl, sourceInfo = null }) {
  const extraction = { webSearchCallCount: 0, missingSourcesArrayCount: 0, rawSourceCount: 0, invalidSourceCount: 0, duplicateSourceCount: 0, distinctSourceCount: 0,
    sourceArrayRawCount: 0, sourceArrayDistinctCount: 0, qualifyingPageActionCount: 0, qualifyingPageActionDistinctCount: 0,
    combinedAuthoritativeDistinctCount: actualSourceUrls.length, actionObservationCount: 0, rejectedActionObservationCount: 0 };
  const seen = new Set(), rawExamples = new Map(), observedLinks = [], actionObservations = [];
  let observedLinkCount = 0;
  const observe = (location, raw) => {
    if (typeof raw !== "string") return;
    observedLinkCount++;
    if (observedLinks.length < L.observedLinks) observedLinks.push({ location, url: urlEvidence(raw, normalizeUrl(raw)) });
  };
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type === "web_search_call") {
      extraction.webSearchCallCount++;
      if (!Array.isArray(item?.action?.sources)) extraction.missingSourcesArrayCount++;
      for (const source of Array.isArray(item?.action?.sources) ? item.action.sources : []) {
        extraction.rawSourceCount++;
        const normalized = normalizeUrl(source?.url);
        if (!normalized) { extraction.invalidSourceCount++; continue; }
        if (seen.has(normalized)) extraction.duplicateSourceCount++;
        else { seen.add(normalized); if (rawExamples.size < L.extractedSources) rawExamples.set(normalized, source.url); }
      }
      observe("WEB_SEARCH_ACTION_URL", item?.action?.url);
    }
    if (item?.type === "message") for (const content of Array.isArray(item.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        if (annotation?.type === "url_citation") observe("MESSAGE_URL_CITATION", annotation.url);
      }
    }
  }
  extraction.sourceArrayRawCount = extraction.rawSourceCount;
  extraction.sourceArrayDistinctCount = seen.size;
  extraction.distinctSourceCount = seen.size;
  if (sourceInfo) {
    extraction.webSearchCallCount = count(sourceInfo.webSearchCallCount);
    extraction.sourceArrayRawCount = count(sourceInfo.sourceArrayRawCount ?? extraction.sourceArrayRawCount);
    extraction.sourceArrayDistinctCount = count(sourceInfo.sourceArrayDistinctCount ?? sourceInfo.sourceArrayUrls?.length ?? extraction.sourceArrayDistinctCount);
    extraction.qualifyingPageActionCount = count(sourceInfo.qualifyingPageActionCount ?? sourceInfo.pageActionObservations?.filter(item => item.eligible).length ?? 0);
    extraction.qualifyingPageActionDistinctCount = count(sourceInfo.qualifyingPageActionDistinctCount ?? sourceInfo.pageActionUrls?.length ?? 0);
    extraction.combinedAuthoritativeDistinctCount = count(sourceInfo.sourceUrls?.length ?? actualSourceUrls.length);
    extraction.actionObservationCount = count(sourceInfo.pageActionObservations?.length ?? 0);
    extraction.rejectedActionObservationCount = count(sourceInfo.pageActionObservations?.filter(item => !item.eligible).length ?? 0);
    for (const item of sourceInfo.pageActionObservations || []) {
      if (actionObservations.length >= L.actionObservations) break;
      const observation = { ...item };
      if (item.url !== null && item.url !== undefined) observation.url = urlEvidence(item.url, item.normalizedUrl);
      delete observation.normalizedUrl;
      actionObservations.push(observation);
    }
  }
  return sanitizeSodResearchDiagnostics({ version: 1, validatorStage: "RESEARCH_SOURCE_MEMBERSHIP", mismatchCount,
    extractedSourceCount: actualSourceUrls.length, observedLinkCount, extraction,
    mismatches: mismatches.map(item => ({ researchIndex: item.index, sourceUrlIndex: item.sourceUrlIndex, category: item.category,
      reason: !item.normalized ? "INVALID_URL" : actualSourceUrls.length === 0 ? "EMPTY_EXTRACTED_SOURCE_SET" : "SOURCE_NOT_IN_WEB_SEARCH_SET",
      url: urlEvidence(item.sourceUrl, item.normalized) })),
    extractedSources: actualSourceUrls.slice(0, L.extractedSources).map(url => urlEvidence(rawExamples.get(url) || url, url)), observedLinks, actionObservations });
}
