import { v24OwnershipView } from "../execution/execution-v24-active-ownership.js";

export const PRETRADE_UI_ACTIVE_STATES = Object.freeze([
  "WAITING",
  "PRETRADE_TRIGGER_EVALUATING",
  "PERMISSION_EVALUATING",
  "READY",
  "CAUTION",
]);

export const PRETRADE_UI_TERMINAL_UNARMED_STATES = Object.freeze([
  "PASS",
  "EXPIRED",
  "INVALIDATED",
  "DECLINED",
  "SUPERSEDED",
  "OCO_CANCELLED",
  "RETIRED",
]);

const ACTIVE = new Set(PRETRADE_UI_ACTIVE_STATES);
const TERMINAL = new Set(PRETRADE_UI_TERMINAL_UNARMED_STATES);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

export function pretradeCandidateKey(candidateOrId, contractVersion = null) {
  const candidateId = typeof candidateOrId === "object"
    ? text(candidateOrId?.candidateId)
    : text(candidateOrId);
  const version = Number(
    typeof candidateOrId === "object"
      ? candidateOrId?.contractVersion
      : contractVersion,
  );
  return candidateId && Number.isInteger(version) && version > 0
    ? `${candidateId}:v${version}`
    : null;
}

function reviewMap(state) {
  const result = new Map();
  for (const review of Array.isArray(state?.reviews) ? state.reviews : []) {
    const key = pretradeCandidateKey(review);
    if (key) result.set(key, review);
  }
  return result;
}

function ocoMap(state) {
  const result = new Map();
  for (const group of Array.isArray(state?.ocoGroups) ? state.ocoGroups : []) {
    if (!["ACTIVE", "COMMITTING"].includes(upper(group?.status))) continue;
    for (const member of Array.isArray(group?.members) ? group.members : []) {
      const key = pretradeCandidateKey(member);
      if (key && !result.has(key)) result.set(key, group);
    }
  }
  return result;
}

function executionProjection(candidate, executionStore) {
  const handoffId = text(candidate?.arm?.handoffId);
  if (!handoffId || !executionStore) {
    return {
      handoffId: handoffId || null,
      executionState: "UNAVAILABLE",
      ownershipReleased: false,
      projectionAvailable: false,
      view: null,
    };
  }

  const view = v24OwnershipView(executionStore, handoffId);
  if (view.history) {
    return {
      handoffId,
      executionState: "HISTORY",
      ownershipReleased: true,
      projectionAvailable: true,
      view,
    };
  }

  if (upper(view.retirement?.status) === "RETIRED") {
    return {
      handoffId,
      executionState: "RETIRED",
      ownershipReleased: true,
      projectionAvailable: true,
      view,
    };
  }

  const lifecycleState = upper(view.lifecycle?.status);
  if (lifecycleState) {
    return {
      handoffId,
      executionState: lifecycleState,
      ownershipReleased: false,
      projectionAvailable: true,
      view,
    };
  }

  const liveState = upper(view.liveTrade?.phase || view.liveTrade?.currentState);
  if (liveState) {
    return {
      handoffId,
      executionState: liveState === "REVIEW" ? "LIVE" : liveState,
      ownershipReleased: false,
      projectionAvailable: true,
      view,
    };
  }

  const installationState = upper(view.installation?.status);
  if (installationState) {
    return {
      handoffId,
      executionState: installationState,
      ownershipReleased: false,
      projectionAvailable: true,
      view,
    };
  }

  return {
    handoffId,
    executionState: "UNAVAILABLE",
    ownershipReleased: false,
    projectionAvailable: false,
    view,
  };
}

function decorate(candidate, reviews, groups, extra = {}) {
  const key = pretradeCandidateKey(candidate);
  return {
    candidate,
    review: key ? reviews.get(key) || null : null,
    ocoGroup: key ? groups.get(key) || null : null,
    projectionWarning: null,
    ...extra,
  };
}

export function projectPretradeWorkspace(pretradeState, executionStore = null) {
  const candidates = Array.isArray(pretradeState?.candidates) ? pretradeState.candidates : [];
  const reviews = reviewMap(pretradeState);
  const groups = ocoMap(pretradeState);
  const active = [];
  const authorizedExecution = [];
  const history = [];

  for (const candidate of candidates) {
    const lifecycleState = upper(candidate?.lifecycleState);

    if (ACTIVE.has(lifecycleState)) {
      active.push(decorate(candidate, reviews, groups));
      continue;
    }

    if (lifecycleState === "ARMED") {
      const execution = executionProjection(candidate, executionStore);
      const item = decorate(candidate, reviews, groups, { execution });
      if (execution.ownershipReleased) history.push(item);
      else authorizedExecution.push(item);
      continue;
    }

    if (TERMINAL.has(lifecycleState)) {
      history.push(decorate(candidate, reviews, groups));
      continue;
    }

    // Unknown states are never silently hidden. Keep them operator-visible in
    // Active with an explicit projection warning and no mutation authority.
    active.push(decorate(candidate, reviews, groups, {
      projectionWarning: "UNRECOGNIZED_LIFECYCLE_STATE",
    }));
  }

  return {
    active,
    authorizedExecution,
    history,
    counts: {
      active: active.length,
      authorizedExecution: authorizedExecution.length,
      history: history.length,
      total: candidates.length,
    },
  };
}
