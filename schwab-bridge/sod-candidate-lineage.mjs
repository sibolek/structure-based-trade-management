import {
  assertCanonicalCandidateIntegrity,
  canonicalCandidateContent,
  normalizeCanonicalCandidateProposal,
  SOD_A_PLUS_TRADES_SOURCE,
} from "./pretrade-candidate-contract.mjs";
import { contentHash } from "./pretrade-state.mjs";

export const SOD_LINEAGE_NEW = "NEW";
export const SOD_LINEAGE_UNCHANGED = "UNCHANGED";
export const SOD_LINEAGE_REVISED = "REVISED";
export const SOD_LINEAGE_SOURCE_DATE_CONFLICT = "SOD_LINEAGE_SOURCE_DATE_CONFLICT";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function lineageError(message, code = "SOD_CANDIDATE_LINEAGE_INVALID", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizedLineageProposal(input) {
  const proposal = input && typeof input === "object" ? clone(input) : {};
  const candidateId = text(proposal.candidateId);
  if (!candidateId) {
    throw lineageError(
      "Automated SOD lineage requires an explicit stable candidateId",
      "SOD_LINEAGE_CANDIDATE_ID_REQUIRED",
    );
  }

  // Lineage, not the analysis/export layer, owns the final contract version.
  // A valid placeholder keeps canonical normalization deterministic before
  // NEW / UNCHANGED / REVISED is resolved against authoritative prior state.
  proposal.contractVersion = 1;
  proposal.source = upper(proposal.source || SOD_A_PLUS_TRADES_SOURCE);

  const result = normalizeCanonicalCandidateProposal(proposal, {
    bundleSource: SOD_A_PLUS_TRADES_SOURCE,
  });
  if (result.errors.length) {
    throw lineageError(
      `SOD lineage proposal ${candidateId} failed canonical validation: ${result.errors.join("; ")}`,
      "SOD_LINEAGE_PROPOSAL_INVALID",
      { candidateId, errors: result.errors },
    );
  }
  return result.normalized;
}

function substantiveContent(candidate) {
  const content = canonicalCandidateContent(candidate);

  // These two fields express publication identity/time, not trading substance.
  // generatedAt alone must never create a new candidate revision, while the
  // resolver itself determines contractVersion from prior authoritative state.
  delete content.contractVersion;
  delete content.generatedAt;
  return content;
}

export function candidateSubstantiveHash(candidate) {
  return contentHash(substantiveContent(candidate));
}

function priorVersionsFor(candidateId, priorCandidates) {
  const matches = (Array.isArray(priorCandidates) ? priorCandidates : [])
    .filter((candidate) => text(candidate?.candidateId) === candidateId);

  const seenVersions = new Set();
  for (const candidate of matches) {
    const version = Number(candidate?.contractVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw lineageError(
        `Prior candidate ${candidateId} has invalid contractVersion`,
        "SOD_LINEAGE_PRIOR_INVALID",
        { candidateId, contractVersion: candidate?.contractVersion ?? null },
      );
    }
    if (seenVersions.has(version)) {
      throw lineageError(
        `Prior candidate ${candidateId} contains duplicate contractVersion ${version}`,
        "SOD_LINEAGE_PRIOR_VERSION_CONFLICT",
        { candidateId, contractVersion: version },
      );
    }
    seenVersions.add(version);

    if (upper(candidate?.source) !== SOD_A_PLUS_TRADES_SOURCE) {
      throw lineageError(
        `Prior candidate ${candidateId} does not belong to ${SOD_A_PLUS_TRADES_SOURCE}`,
        "SOD_LINEAGE_PRIOR_SOURCE_CONFLICT",
        { candidateId, source: candidate?.source ?? null },
      );
    }

    const integrity = assertCanonicalCandidateIntegrity(candidate);
    if (!integrity.canonical) {
      throw lineageError(
        `Prior candidate ${candidateId} is not an authoritative canonical candidate`,
        "SOD_LINEAGE_PRIOR_NOT_CANONICAL",
        { candidateId, contractVersion: version },
      );
    }
  }

  return matches.sort((left, right) => Number(left.contractVersion) - Number(right.contractVersion));
}

function assertSameSourceDate(candidateId, proposalSourceDate, versions) {
  const conflicting = [...new Set(
    versions
      .map((candidate) => text(candidate?.sourceDate))
      .filter((sourceDate) => sourceDate !== proposalSourceDate),
  )];
  if (!conflicting.length) return;

  throw lineageError(
    `SOD candidateId ${candidateId} cannot cross sourceDate/session identity boundaries`,
    SOD_LINEAGE_SOURCE_DATE_CONFLICT,
    {
      candidateId,
      proposalSourceDate,
      priorSourceDates: conflicting,
    },
  );
}

export function resolveSodCandidateLineage(proposalInput, priorCandidates = []) {
  const proposal = normalizedLineageProposal(proposalInput);
  const candidateId = proposal.candidateId;
  const versions = priorVersionsFor(candidateId, priorCandidates);

  // SOD candidate identity is scoped to one source/trade date. Reusing the same
  // candidateId on another date is an identity collision, not a substantive
  // revision. Fail closed rather than silently extending lineage across sessions.
  assertSameSourceDate(candidateId, proposal.sourceDate, versions);

  const proposalSubstantiveHash = candidateSubstantiveHash(proposal);

  if (!versions.length) {
    const candidate = {
      ...proposal,
      contractVersion: 1,
    };
    return {
      classification: SOD_LINEAGE_NEW,
      candidateId,
      contractVersion: 1,
      priorContractVersion: null,
      candidate,
      substantiveHash: proposalSubstantiveHash,
      priorSubstantiveHash: null,
      reusedPriorContract: false,
    };
  }

  const prior = versions.at(-1);
  const priorContract = canonicalCandidateContent(prior);
  const priorSubstantiveHash = candidateSubstantiveHash(priorContract);

  if (proposalSubstantiveHash === priorSubstantiveHash) {
    return {
      classification: SOD_LINEAGE_UNCHANGED,
      candidateId,
      contractVersion: Number(prior.contractVersion),
      priorContractVersion: Number(prior.contractVersion),
      candidate: priorContract,
      substantiveHash: priorSubstantiveHash,
      priorSubstantiveHash,
      reusedPriorContract: true,
    };
  }

  const nextVersion = Number(prior.contractVersion) + 1;
  const candidate = {
    ...proposal,
    contractVersion: nextVersion,
  };
  return {
    classification: SOD_LINEAGE_REVISED,
    candidateId,
    contractVersion: nextVersion,
    priorContractVersion: Number(prior.contractVersion),
    candidate,
    substantiveHash: proposalSubstantiveHash,
    priorSubstantiveHash,
    reusedPriorContract: false,
  };
}

export function resolveSodCandidateBundleLineage(bundle, priorCandidates = []) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw lineageError("SOD lineage bundle must be a JSON object", "SOD_LINEAGE_BUNDLE_INVALID");
  }
  if (upper(bundle.source) !== SOD_A_PLUS_TRADES_SOURCE) {
    throw lineageError(
      `SOD lineage bundle source must equal ${SOD_A_PLUS_TRADES_SOURCE}`,
      "SOD_LINEAGE_BUNDLE_SOURCE_INVALID",
    );
  }
  if (!Array.isArray(bundle.candidates) || bundle.candidates.length === 0) {
    throw lineageError("SOD lineage bundle requires at least one candidate", "SOD_LINEAGE_BUNDLE_INVALID");
  }

  const ids = bundle.candidates.map((candidate) => text(candidate?.candidateId));
  const duplicateIds = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))];
  if (duplicateIds.length) {
    throw lineageError(
      `SOD lineage bundle contains duplicate candidateId values: ${duplicateIds.join(", ")}`,
      "SOD_LINEAGE_BUNDLE_DUPLICATE_ID",
      { duplicateIds },
    );
  }

  const resolutions = bundle.candidates.map((candidate) => resolveSodCandidateLineage(candidate, priorCandidates));
  return {
    bundle: {
      ...clone(bundle),
      candidates: resolutions.map((resolution) => resolution.candidate),
    },
    lineage: resolutions.map((resolution) => ({
      classification: resolution.classification,
      candidateId: resolution.candidateId,
      contractVersion: resolution.contractVersion,
      priorContractVersion: resolution.priorContractVersion,
      substantiveHash: resolution.substantiveHash,
      priorSubstantiveHash: resolution.priorSubstantiveHash,
      reusedPriorContract: resolution.reusedPriorContract,
    })),
  };
}
