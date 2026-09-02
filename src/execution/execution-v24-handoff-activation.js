import { evaluateExecutionBoardHandoffAdmission } from "../../schwab-bridge/execution-board-handoff-admission.mjs";
import {
  EXECUTION_V23_STORE_KEY,
  buildPreparedV24LocalInstallation,
  readV24LocalInstallation,
} from "./execution-v24-local-installation.js";
import {
  assertV24HandoffRetirementAllowsActivation,
  bindAndPersistV24ExecutionListeningAtGuarded,
  persistPreparedV24LocalInstallationGuarded,
  readV24Retirement,
  requestV24Retirement,
} from "./execution-v24-retirement.js";

export const V24_HANDOFF_ACTIVATION_STATUSES = Object.freeze([
  "WAITING_FOR_BROKER_PROOF",
  "PREPARED",
  "LISTENING_ACK_PENDING",
  "BLOCK_ACK_PENDING",
  "RETIREMENT_ACTIVE",
  "DELIVERED",
  "BLOCKED",
  "RECONCILIATION_REQUIRED",
]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function activationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function immutable(value) {
  return Object.freeze(structuredClone(value));
}

function result(status, extra = {}) {
  return immutable({ status, ...extra });
}

function normalizeEnvelope(value) {
  const envelope = value && typeof value === "object" ? value : {};
  if (!envelope.handoff || !envelope.delivery) {
    throw activationError("handoff activation envelope requires handoff and delivery", "INVALID_V24_HANDOFF_ACTIVATION_INPUT");
  }
  return { handoff: envelope.handoff, delivery: envelope.delivery };
}

function requireTransport(transport) {
  const required = ["claim", "acknowledge", "block"];
  if (!transport || required.some((name) => typeof transport[name] !== "function")) {
    throw activationError("compatible handoff transport is required", "V24_HANDOFF_TRANSPORT_REQUIRED");
  }
  return transport;
}

function readStore(storage, storeKey) {
  try {
    const raw = storage?.getItem?.(storeKey);
    if (!raw) return { candidates: [], liveTrades: [], history: [], v24Installations: [], v24Retirements: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("store root must be an object");
    return {
      ...parsed,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      liveTrades: Array.isArray(parsed.liveTrades) ? parsed.liveTrades : [],
      v24Installations: Array.isArray(parsed.v24Installations) ? parsed.v24Installations : [],
      v24Retirements: Array.isArray(parsed.v24Retirements) ? parsed.v24Retirements : [],
    };
  } catch (error) {
    throw activationError(`local execution store could not be read: ${error.message}`, "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
}

function localOwnedSymbols(store, { excludeHandoffId = null } = {}) {
  const symbols = new Set();
  const retirements = new Map(
    store.v24Retirements.map((item) => [text(item?.handoffId), upper(item?.status)]),
  );

  for (const candidate of store.candidates) {
    const symbol = upper(candidate?.originalPlan?.symbol ?? candidate?.v24?.symbol);
    if (symbol) symbols.add(symbol);
  }
  for (const trade of store.liveTrades) {
    const symbol = upper(trade?.originalPlan?.symbol ?? trade?.v24?.symbol);
    if (symbol) symbols.add(symbol);
  }
  if (store.draft?.mode === "EDIT") {
    const symbol = upper(store.draft?.originalPlan?.symbol ?? store.draft?.plan?.symbol);
    if (symbol) symbols.add(symbol);
  }
  for (const installation of store.v24Installations) {
    if (excludeHandoffId && text(installation?.handoffId) === text(excludeHandoffId)) continue;
    if (!["PREPARED", "LISTENING"].includes(upper(installation?.status))) continue;
    if (retirements.get(text(installation?.handoffId)) === "RETIRED") continue;
    const symbol = upper(installation?.symbol);
    if (symbol) symbols.add(symbol);
  }

  return Object.freeze([...symbols].sort());
}

async function blockDelivery({ transport, handoffId, receiverId, reason }) {
  try {
    const response = await transport.block(handoffId, receiverId, reason);
    return result("BLOCKED", {
      reason,
      handoffId,
      delivery: response?.delivery ?? null,
    });
  } catch (error) {
    return result("BLOCK_ACK_PENDING", {
      reason,
      handoffId,
      transportError: error?.code || error?.message || String(error),
    });
  }
}

function ensureClaimOwner(delivery, receiverId) {
  if (upper(delivery?.status) !== "CLAIMED") {
    throw activationError(`handoff delivery must be CLAIMED, received ${delivery?.status || "unknown"}`, "INVALID_V24_HANDOFF_ACTIVATION_STATE");
  }
  if (text(delivery?.claimedBy) !== text(receiverId)) {
    throw activationError("claimed handoff belongs to another receiver", "EXECUTION_BOARD_HANDOFF_CLAIM_RECEIVER_MISMATCH");
  }
}

function proposalAfterClaim(value, delivery) {
  const proposed = isoTimestamp(value);
  const claimedAt = isoTimestamp(delivery?.claimedAt);
  if (!proposed || !claimedAt || Date.parse(proposed) < Date.parse(claimedAt)) {
    throw activationError("proposed executionListeningAt must be at or after claimedAt", "V24_EXECUTION_LISTENING_AT_INVALID");
  }
  return proposed;
}

function brokerThrough(brokerState) {
  return isoTimestamp(brokerState?.executionCoverage?.currentThrough);
}

export async function advanceV24HandoffActivation({
  envelope,
  brokerState,
  receiverId,
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_V23_STORE_KEY,
  proposedExecutionListeningAt = null,
  transport,
  now = () => new Date().toISOString(),
} = {}) {
  const receiver = text(receiverId);
  if (!receiver) throw activationError("receiverId is required", "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");
  const api = requireTransport(transport);
  let { handoff, delivery } = normalizeEnvelope(envelope);
  const handoffId = text(handoff.handoffId);
  if (!handoffId) throw activationError("handoffId is required", "INVALID_V24_HANDOFF_ACTIVATION_INPUT");

  if (upper(delivery.status) === "PENDING") {
    const claimed = await api.claim(handoffId, receiver);
    ({ handoff, delivery } = normalizeEnvelope(claimed));
  }

  if (upper(delivery.status) === "BLOCKED") {
    return result("BLOCKED", { handoffId, reason: delivery.blockReason || null, delivery });
  }

  const local = readV24LocalInstallation({ storage, storeKey, handoffId });

  if (upper(delivery.status) === "DELIVERED") {
    if (!local || upper(local.status) !== "LISTENING") {
      return result("RECONCILIATION_REQUIRED", {
        handoffId,
        reason: "DELIVERED_HANDOFF_MISSING_LOCALLY",
      });
    }
    if (text(delivery.executionListeningAt) !== text(local.executionListeningAt)) {
      throw activationError("delivered handoff conflicts with local listening boundary", "HANDOFF_ACK_CONTENT_CONFLICT");
    }
    return result("DELIVERED", { handoffId, executionListeningAt: local.executionListeningAt, delivery });
  }

  ensureClaimOwner(delivery, receiver);

  const retirement = readV24Retirement({ storage, storeKey, handoffId });
  if (retirement) {
    if (upper(retirement.status) === "RETIRED") {
      return blockDelivery({
        transport: api,
        handoffId,
        receiverId: receiver,
        reason: "V24_HANDOFF_RETIRED",
      });
    }
    return result("RETIREMENT_ACTIVE", {
      handoffId,
      retirementStatus: retirement.status,
    });
  }

  if (local && upper(local.status) === "LISTENING") {
    try {
      const acknowledged = await api.acknowledge(handoffId, receiver, local.executionListeningAt);
      const ackDelivery = acknowledged?.delivery;
      if (
        upper(ackDelivery?.status) !== "DELIVERED"
        || text(ackDelivery?.executionListeningAt) !== text(local.executionListeningAt)
      ) {
        throw activationError("ACK did not preserve the exact local listening boundary", "HANDOFF_ACK_CONTENT_CONFLICT");
      }
      return result("DELIVERED", {
        handoffId,
        executionListeningAt: local.executionListeningAt,
        delivery: ackDelivery,
      });
    } catch (error) {
      return result("LISTENING_ACK_PENDING", {
        handoffId,
        executionListeningAt: local.executionListeningAt,
        transportError: error?.code || error?.message || String(error),
      });
    }
  }

  let prepared = local;
  if (!prepared) {
    const initialStore = readStore(storage, storeKey);
    const initialRequiredThrough = brokerThrough(brokerState) || handoff.createdAt;
    const initialAdmission = evaluateExecutionBoardHandoffAdmission({
      handoff,
      brokerState,
      executionOwnedSymbols: localOwnedSymbols(initialStore),
      requiredThrough: initialRequiredThrough,
    });

    if (!initialAdmission.admitted) {
      return blockDelivery({
        transport: api,
        handoffId,
        receiverId: receiver,
        reason: initialAdmission.reason,
      });
    }

    assertV24HandoffRetirementAllowsActivation({ storage, storeKey, handoffId });
    prepared = persistPreparedV24LocalInstallationGuarded({
      storage,
      storeKey,
      installation: buildPreparedV24LocalInstallation({
        handoff,
        receiverId: receiver,
        preparedAt: now(),
      }),
    });
  }

  if (upper(prepared.status) !== "PREPARED") {
    throw activationError("local handoff is neither PREPARED nor LISTENING", "INVALID_V24_HANDOFF_ACTIVATION_STATE");
  }

  const proposed = proposalAfterClaim(proposedExecutionListeningAt || now(), delivery);
  const through = brokerThrough(brokerState);
  if (!through || Date.parse(through) < Date.parse(proposed)) {
    return result("WAITING_FOR_BROKER_PROOF", {
      handoffId,
      proposedExecutionListeningAt: proposed,
      brokerCurrentThrough: through,
    });
  }

  const finalStore = readStore(storage, storeKey);
  const finalAdmission = evaluateExecutionBoardHandoffAdmission({
    handoff,
    brokerState,
    executionOwnedSymbols: localOwnedSymbols(finalStore, { excludeHandoffId: handoffId }),
    requiredThrough: proposed,
  });

  if (!finalAdmission.admitted) {
    requestV24Retirement({
      storage,
      storeKey,
      handoffId,
      receiverId: receiver,
      requestedAt: proposed,
      reason: `SYSTEM_FINAL_ADMISSION_BLOCK:${finalAdmission.reason}`,
    });
    return blockDelivery({
      transport: api,
      handoffId,
      receiverId: receiver,
      reason: finalAdmission.reason,
    });
  }

  const listening = bindAndPersistV24ExecutionListeningAtGuarded({
    storage,
    storeKey,
    handoffId,
    executionListeningAt: proposed,
  });

  try {
    const acknowledged = await api.acknowledge(handoffId, receiver, listening.executionListeningAt);
    const ackDelivery = acknowledged?.delivery;
    if (
      upper(ackDelivery?.status) !== "DELIVERED"
      || text(ackDelivery?.executionListeningAt) !== text(listening.executionListeningAt)
    ) {
      throw activationError("ACK did not preserve the exact persisted listening boundary", "HANDOFF_ACK_CONTENT_CONFLICT");
    }
    return result("DELIVERED", {
      handoffId,
      executionListeningAt: listening.executionListeningAt,
      delivery: ackDelivery,
    });
  } catch (error) {
    return result("LISTENING_ACK_PENDING", {
      handoffId,
      executionListeningAt: listening.executionListeningAt,
      transportError: error?.code || error?.message || String(error),
    });
  }
}
