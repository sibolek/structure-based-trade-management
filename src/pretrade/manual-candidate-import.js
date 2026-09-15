// Presentation/input adapter only. PRETRADE remains the candidate authority.
export const MANUAL_IMPORT_MAX_BYTES = 768 * 1024;
const encoder = new TextEncoder();
function fail(message) { throw new Error(message); }

// Validate syntax, decoded duplicate keys and resource bounds before JSON.parse.
// No eval, executable imports, property assignment or filesystem paths.
export function parseCandidateJson(raw) {
  if (typeof raw !== "string" || encoder.encode(raw).length > MANUAL_IMPORT_MAX_BYTES) fail("JSON exceeds the 768 KiB limit.");
  let at = 0; let nodes = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(raw[at] || "x")) at++; };
  const token = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
  function primitive() {
    token.lastIndex = at;
    const match = token.exec(raw);
    if (!match) fail("Malformed JSON. Supply a JSON object, not code or a Markdown code block.");
    at = token.lastIndex;
    const value = JSON.parse(match[0]);
    if (typeof value === "number" && !Number.isFinite(value)) fail("JSON numbers must be finite.");
    if (encoder.encode(typeof value === "string" ? value : match[0]).length > 64 * 1024) fail("JSON value exceeds the 64 KiB limit.");
    return value;
  }
  function value(depth) {
    whitespace();
    if (++nodes > 25000 || depth > 48) fail("JSON exceeds the structural limits (depth 48 / 25,000 nodes).");
    const opener = raw[at];
    if (opener !== "{" && opener !== "[") { primitive(); return; }
    at++; whitespace();
    const closer = opener === "{" ? "}" : "]";
    const keys = new Set(); let count = 0;
    if (raw[at] === closer) { at++; return; }
    while (at < raw.length) {
      whitespace();
      if (++count > (opener === "{" ? 500 : 5000)) fail("JSON exceeds object or array limits.");
      if (opener === "{") {
        if (raw[at] !== '"') fail("Malformed JSON object key.");
        const key = primitive(); whitespace();
        if (keys.has(key)) fail("JSON contains a duplicate object key.");
        keys.add(key);
        if (raw[at++] !== ":") fail("Malformed JSON: expected a colon.");
      }
      value(depth + 1); whitespace();
      if (raw[at] === closer) { at++; return; }
      if (raw[at++] !== ",") fail("Malformed JSON: expected a comma.");
    }
    fail("Malformed JSON: incomplete object or array.");
  }
  value(0); whitespace();
  if (at !== raw.length) fail("Malformed JSON: unexpected trailing content.");
  return JSON.parse(raw);
}

export function prepareManualCandidateImport(raw) {
  const input = parseCandidateJson(raw);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Supply one candidate JSON object or a one-candidate bundle.");
  let body; let kind; let candidate;
  if (Object.hasOwn(input, "candidateId")) {
    candidate = input;
    if (typeof candidate.candidateId !== "string" || !candidate.candidateId.trim()) fail("An explicit candidateId is required; import never generates candidate identity.");
    if (!Number.isInteger(candidate.contractVersion) || candidate.contractVersion < 1) fail("A canonical standalone candidate requires contractVersion >= 1.");
    kind = "canonical";
    // Bundle identity is delivery metadata only; the supplied candidate is intact.
    body = { source: candidate.source ?? "AD_HOC_CHATGPT", bundleId: `manual:${JSON.stringify([candidate.candidateId, candidate.contractVersion])}`, ingressPolicy: "MANUAL_AUTHORIZED", candidates: [candidate] };
  } else {
    if (!Array.isArray(input.candidates) || input.candidates.length !== 1) fail("Import Candidate JSON accepts exactly one candidate at a time.");
    candidate = input.candidates[0];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("The candidate must be a JSON object.");
    kind = Object.hasOwn(input, "ingestionSchemaVersion") ? "manual-envelope" : "canonical";
    body = input; // Existing bundles/envelopes keep all supplied metadata unchanged.
  }
  if (kind === "canonical" && body.ingressPolicy !== "MANUAL_AUTHORIZED") fail("Manual import requires ingressPolicy MANUAL_AUTHORIZED. The supplied bundle was not changed; automated supersession is not approved here.");
  if (encoder.encode(JSON.stringify(body)).length > 1024 * 1024) fail("Wrapped JSON exceeds the PRETRADE 1 MiB request limit.");
  return { kind, body, candidate, source: candidate.source ?? body.source, sourceDate: candidate.sourceDate ?? body.sourceDate };
}

export async function readCandidateJsonFile(file) {
  if (!file || !/\.json$/i.test(file.name || "")) fail("Choose a .json file.");
  if (file.size > MANUAL_IMPORT_MAX_BYTES) fail("JSON exceeds the 768 KiB limit.");
  return file.text();
}

export function manualImportOutcomeLabel(status) {
  return ({ ACCEPTED: "Accepted", DUPLICATE: "Already imported — duplicate", CONFLICT: "Conflict — same version has different content", STALE: "Older version — not imported", ACTION_REQUIRED: "Supersession review required — not imported", REJECTED: "Invalid candidate — not imported" })[status] || "Import outcome unavailable";
}

export function manualImportError(error) {
  const code = /^[A-Z0-9_]{1,96}$/.test(error?.code || "") ? error.code : "PRETRADE_REQUEST_FAILED";
  if (code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR") return `${code}: Stored candidate integrity check failed. Import stopped.`;
  if (code.includes("AUTHORITY")) return `${code}: Runtime or authorization fields are prohibited. Import stopped.`;
  return `${code}: Import was not confirmed. Check PRETRADE connectivity and the candidate JSON. Retry the same contract to resolve an uncertain delivery.`;
}
