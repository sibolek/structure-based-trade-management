function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function identity(candidate) {
  const candidateId = text(candidate?.candidateId);
  const contractVersion = Number(candidate?.contractVersion);
  if (!candidateId || !Number.isInteger(contractVersion) || contractVersion < 1) {
    const error = new Error("exact candidate identity is required");
    error.code = "INVALID_CANDIDATE_IDENTITY";
    throw error;
  }
  return { candidateId, contractVersion };
}

function candidatePath(candidate) {
  const { candidateId, contractVersion } = identity(candidate);
  return `/api/candidates/${encodeURIComponent(candidateId)}/versions/${contractVersion}`;
}

function defaultIdFactory() {
  if (typeof globalThis?.crypto?.randomUUID !== "function") {
    const error = new Error("secure operation identity generation is unavailable");
    error.code = "PRETRADE_OPERATION_ID_UNAVAILABLE";
    throw error;
  }
  return globalThis.crypto.randomUUID();
}

function createApiError(payload, response) {
  const message = text(payload?.error) || `HTTP ${response?.status ?? "ERROR"}`;
  const error = new Error(message);
  error.code = text(payload?.code) || "PRETRADE_API_REQUEST_FAILED";
  error.details = payload?.details ?? null;
  error.status = Number(response?.status) || null;
  error.payload = payload ?? null;
  return error;
}

export function createPretradeApiClient({
  baseUrl,
  fetchImpl = globalThis?.fetch,
  idFactory = defaultIdFactory,
  clock = () => new Date().toISOString(),
} = {}) {
  const root = text(baseUrl).replace(/\/$/, "");
  if (!root) throw new Error("pretrade baseUrl is required");
  if (typeof fetchImpl !== "function") throw new Error("pretrade fetch implementation is required");
  if (typeof idFactory !== "function") throw new Error("pretrade idFactory must be a function");
  if (typeof clock !== "function") throw new Error("pretrade clock must be a function");

  const operationId = (action) => `UI:${upper(action)}:${text(idFactory(action))}`;

  async function request(path, { method = "GET", body = undefined } = {}) {
    const options = { method, cache: "no-store" };
    if (body !== undefined) {
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(`${root}${path}`, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) throw createApiError(payload, response);
    if (payload?.brokerWriteAuthority === true) {
      const error = new Error("pretrade response attempted to grant broker-write authority");
      error.code = "PRETRADE_BROKER_WRITE_AUTHORITY_VIOLATION";
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function lifecycle(candidate, commandName, body = {}) {
    return request(`${candidatePath(candidate)}/commands/${encodeURIComponent(commandName)}`, {
      method: "POST",
      body: {
        operationId: operationId(commandName),
        expectedState: candidate.lifecycleState,
        expectedRevision: candidate.stateRevision,
        source: "OPERATOR",
        ...body,
      },
    });
  }

  return Object.freeze({
    snapshot() {
      return request("/api/candidates");
    },

    health() {
      return request("/health");
    },

    activate(candidate) {
      return lifecycle(candidate, "activate", {
        activationMode: "MANUAL",
        reason: "OPERATOR_ACTIVATION",
      });
    },

    returnToWaiting(candidate) {
      return lifecycle(candidate, "return-to-waiting", {
        operatorRequested: true,
        reason: "OPERATOR_RETURN_TO_WAITING",
      });
    },

    decline(candidate, { reasonCode = "OPERATOR_DECLINED", note = null } = {}) {
      return lifecycle(candidate, "decline", { reasonCode, note });
    },

    invalidate(candidate, { reasonCode = "OPERATOR_INVALIDATED", note = null } = {}) {
      return lifecycle(candidate, "invalidate", { reasonCode, note });
    },

    confirmManualTrigger(candidate, nodeId = "satisfaction") {
      const { candidateId, contractVersion } = identity(candidate);
      const evidenceId = operationId("manual-trigger");
      return request(`${candidatePath(candidate)}/trigger/evidence`, {
        method: "POST",
        body: {
          expectedState: candidate.lifecycleState,
          expectedRevision: candidate.stateRevision,
          evidence: {
            type: "MANUAL_EVENT",
            evidenceId,
            observedAt: clock(),
            candidateId,
            contractVersion,
            nodeId: text(nodeId) || "satisfaction",
            confirmed: true,
            actor: "OPERATOR",
          },
        },
      });
    },

    evaluatePermission(candidate, inputs = {}) {
      return request(`${candidatePath(candidate)}/permission/evaluate`, {
        method: "POST",
        body: {
          operationId: operationId("permission-evaluate"),
          expectedState: candidate.lifecycleState,
          expectedRevision: candidate.stateRevision,
          accountId: text(inputs.accountId),
          entryMode: upper(inputs.entryMode),
          triggerPrice: inputs.triggerPrice ?? null,
          operatorStructuralAssessment: inputs.operatorStructuralAssessment ?? null,
          operatorPermissionAssessment: inputs.operatorPermissionAssessment ?? null,
        },
      });
    },

    refreshReview(candidate) {
      return request(`${candidatePath(candidate)}/review/refresh`, {
        method: "POST",
        body: { operationId: operationId("review-refresh") },
      });
    },

    selectQuantity(candidate, reviewPackageId, selectedQuantity) {
      return request(`${candidatePath(candidate)}/review/quantity`, {
        method: "POST",
        body: {
          operationId: operationId("review-quantity"),
          reviewPackageId: text(reviewPackageId),
          selectedQuantity: Number(selectedQuantity),
        },
      });
    },

    acknowledgeCaution(candidate, reviewPackageId) {
      return request(`${candidatePath(candidate)}/review/caution-ack`, {
        method: "POST",
        body: {
          operationId: operationId("caution-ack"),
          reviewPackageId: text(reviewPackageId),
          acknowledged: true,
        },
      });
    },

    arm(candidate, inputs = {}) {
      return request(`${candidatePath(candidate)}/arm`, {
        method: "POST",
        body: {
          operationId: operationId("arm"),
          confirmArm: true,
          reviewPackageId: text(inputs.reviewPackageId),
          selectedQuantity: Number(inputs.selectedQuantity),
          confirmedDirection: upper(candidate.direction),
          accountId: text(inputs.accountId),
          entryMode: upper(inputs.entryMode),
          triggerPrice: inputs.triggerPrice ?? null,
          operatorStructuralAssessment: inputs.operatorStructuralAssessment ?? null,
          operatorPermissionAssessment: inputs.operatorPermissionAssessment ?? null,
        },
      });
    },

    listOcoGroups() {
      return request("/api/oco-groups");
    },

    createOco({ groupId = null, accountId, members } = {}) {
      const generatedGroupId = text(groupId) || `oco-${text(idFactory("oco-group"))}`;
      return request("/api/oco-groups", {
        method: "POST",
        body: {
          operationId: operationId("oco-create"),
          groupId: generatedGroupId,
          accountId: text(accountId),
          members: Array.isArray(members) ? members.map(identity) : [],
        },
      });
    },

    setOcoAccount(groupId, accountId) {
      return request(`/api/oco-groups/${encodeURIComponent(text(groupId))}/account`, {
        method: "POST",
        body: {
          operationId: operationId("oco-account"),
          accountId: text(accountId),
        },
      });
    },

    dissolveOco(groupId) {
      return request(`/api/oco-groups/${encodeURIComponent(text(groupId))}/dissolve`, {
        method: "POST",
        body: { operationId: operationId("oco-dissolve") },
      });
    },
  });
}
