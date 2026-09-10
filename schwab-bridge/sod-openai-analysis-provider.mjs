export const SOD_OPENAI_SETUP_KEYS = Object.freeze([
  "BREAKOUT_PULLBACK",
  "VWAP_RECLAIM",
  "LIQUIDITY_SWEEP_REVERSAL",
  "TREND_PULLBACK",
  "SECOND_ENTRY_CONTINUATION",
  "MTR_REVERSAL",
  "OPENING_DRIVE_PULLBACK",
  "OPENING_SPIKE_FAILURE",
  "RANGE_BREAKOUT",
  "COMPRESSION_BREAKOUT",
  "MICRO_CHANNEL_PULLBACK",
  "WEDGE_REVERSAL",
  "MEASURED_MOVE_CONTINUATION",
  "FINAL_FLAG_REVERSAL",
]);

const SETUP_KEYS = new Set(SOD_OPENAI_SETUP_KEYS);
const DIRECTIONS = new Set(["LONG", "SHORT"]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function providerError(message, code = "SOD_OPENAI_PROVIDER_INVALID", details = null) {
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

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildDeterministicSodCandidateId({
  sourceDate,
  symbol,
  direction,
  setupKey,
} = {}) {
  const normalizedSourceDate = text(sourceDate);
  if (!validSourceDate(normalizedSourceDate)) {
    throw providerError(
      "Deterministic SOD candidate identity requires exact sourceDate YYYY-MM-DD",
      "SOD_OPENAI_CANDIDATE_SOURCE_DATE_INVALID",
    );
  }

  const normalizedSymbol = upper(symbol);
  const symbolSlug = slug(normalizedSymbol);
  if (!normalizedSymbol || !symbolSlug) {
    throw providerError(
      "Deterministic SOD candidate identity requires symbol",
      "SOD_OPENAI_CANDIDATE_SYMBOL_INVALID",
    );
  }

  const normalizedDirection = upper(direction);
  if (!DIRECTIONS.has(normalizedDirection)) {
    throw providerError(
      "Deterministic SOD candidate identity direction must be LONG or SHORT",
      "SOD_OPENAI_CANDIDATE_DIRECTION_INVALID",
      { direction: normalizedDirection || null },
    );
  }

  const normalizedSetupKey = upper(setupKey);
  if (!SETUP_KEYS.has(normalizedSetupKey)) {
    throw providerError(
      `Unsupported SOD setupKey ${normalizedSetupKey || "<empty>"}`,
      "SOD_OPENAI_SETUP_KEY_UNSUPPORTED",
      { setupKey: normalizedSetupKey || null },
    );
  }

  return `sod-${normalizedSourceDate}-${symbolSlug}-${slug(normalizedSetupKey)}-${normalizedDirection.toLowerCase()}`;
}

export function assignDeterministicSodCandidateIds({
  sourceDate,
  candidateProposals,
} = {}) {
  if (!Array.isArray(candidateProposals)) {
    throw providerError(
      "OpenAI SOD candidate proposals must be an array",
      "SOD_OPENAI_CANDIDATE_PROPOSALS_INVALID",
    );
  }

  const assigned = candidateProposals.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw providerError(
        `OpenAI SOD candidate ${index} must be an object`,
        "SOD_OPENAI_CANDIDATE_INVALID",
        { index },
      );
    }

    if (hasOwn(candidate, "candidateId") || hasOwn(candidate, "candidateKey")) {
      throw providerError(
        `OpenAI SOD candidate ${index} may not author candidate identity`,
        "SOD_OPENAI_CANDIDATE_IDENTITY_AUTHORITY_FORBIDDEN",
        { index },
      );
    }

    const candidateId = buildDeterministicSodCandidateId({
      sourceDate,
      symbol: candidate.symbol,
      direction: candidate.direction,
      setupKey: candidate.setupKey,
    });

    // setupKey is private transport metadata used only to construct stable identity.
    // It is intentionally removed before the proposal crosses the generic provider boundary.
    const { setupKey: _setupKey, candidateKey: _candidateKey, ...proposal } = candidate;
    return {
      candidateId,
      ...structuredClone(proposal),
    };
  });

  const ids = assigned.map((candidate) => candidate.candidateId);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) {
    throw providerError(
      `OpenAI SOD analysis produced ambiguous duplicate candidate identity: ${duplicateIds.join(", ")}`,
      "SOD_OPENAI_CANDIDATE_ID_COLLISION",
      { duplicateIds },
    );
  }

  return assigned;
}
