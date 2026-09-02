export const EXECUTION_BOARD_HANDOFF_DELIVERY_SCHEMA_VERSION = 1;
export const EXECUTION_BOARD_HANDOFF_DELIVERY_STATUSES = Object.freeze([
  "PENDING",
  "CLAIMED",
  "DELIVERED",
  "BLOCKED",
]);

const STATUS_SET = new Set(EXECUTION_BOARD_HANDOFF_DELIVERY_STATUSES);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) return new Date(number).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function deliveryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireValidDelivery(delivery) {
  const contract = validateExecutionBoardHandoffDeliveryContract(delivery);
  if (!contract.valid) {
    throw deliveryError(
      `Execution Board handoff delivery contract is invalid: ${contract.errors.join("; ")}`,
      "INVALID_EXECUTION_BOARD_HANDOFF_DELIVERY",
    );
  }
  return delivery;
}

export function validateExecutionBoardHandoffDeliveryContract(delivery) {
  const value = delivery && typeof delivery === "object" ? delivery : {};
  const errors = [];
  const status = upper(value.status);
  const handoffId = text(value.handoffId);
  const createdAt = isoTimestamp(value.createdAt);
  const claimedBy = text(value.claimedBy);
  const claimedAt = isoTimestamp(value.claimedAt);
  const executionListeningAt = isoTimestamp(value.executionListeningAt);
  const deliveredAt = isoTimestamp(value.deliveredAt);
  const blockedAt = isoTimestamp(value.blockedAt);
  const blockReason = upper(value.blockReason);

  if (Number(value.schemaVersion) !== EXECUTION_BOARD_HANDOFF_DELIVERY_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
  if (!handoffId) errors.push("handoffId is required");
  if (!createdAt) errors.push("createdAt is invalid");
  if (!STATUS_SET.has(status)) errors.push("status is invalid");

  if (status === "PENDING") {
    if (claimedBy || claimedAt) errors.push("PENDING delivery cannot have claim provenance");
    if (executionListeningAt || deliveredAt) errors.push("PENDING delivery cannot have delivery provenance");
    if (blockedAt || blockReason) errors.push("PENDING delivery cannot have block provenance");
  }

  if (status === "CLAIMED") {
    if (!claimedBy || !claimedAt) errors.push("CLAIMED delivery requires claim provenance");
    if (executionListeningAt || deliveredAt) errors.push("CLAIMED delivery cannot have delivery provenance");
    if (blockedAt || blockReason) errors.push("CLAIMED delivery cannot have block provenance");
  }

  if (status === "DELIVERED") {
    if (!claimedBy || !claimedAt) errors.push("DELIVERED delivery requires claim provenance");
    if (!executionListeningAt || !deliveredAt) errors.push("DELIVERED delivery requires listening and delivery timestamps");
    if (blockedAt || blockReason) errors.push("DELIVERED delivery cannot have block provenance");
  }

  if (status === "BLOCKED") {
    if (!claimedBy || !claimedAt) errors.push("BLOCKED delivery requires claim provenance");
    if (!blockedAt || !blockReason) errors.push("BLOCKED delivery requires block provenance");
    if (executionListeningAt || deliveredAt) errors.push("BLOCKED delivery cannot have delivery provenance");
  }

  const createdMs = createdAt ? Date.parse(createdAt) : null;
  const claimedMs = claimedAt ? Date.parse(claimedAt) : null;
  const listeningMs = executionListeningAt ? Date.parse(executionListeningAt) : null;
  const deliveredMs = deliveredAt ? Date.parse(deliveredAt) : null;
  const blockedMs = blockedAt ? Date.parse(blockedAt) : null;

  if (createdMs !== null && claimedMs !== null && claimedMs < createdMs) {
    errors.push("claimedAt cannot precede createdAt");
  }
  if (claimedMs !== null && listeningMs !== null && listeningMs < claimedMs) {
    errors.push("executionListeningAt cannot precede claimedAt");
  }
  if (listeningMs !== null && deliveredMs !== null && deliveredMs < listeningMs) {
    errors.push("deliveredAt cannot precede executionListeningAt");
  }
  if (claimedMs !== null && blockedMs !== null && blockedMs < claimedMs) {
    errors.push("blockedAt cannot precede claimedAt");
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

export function createPendingExecutionBoardHandoffDelivery({ handoffId, createdAt = Date.now() } = {}) {
  const normalizedHandoffId = text(handoffId);
  const normalizedCreatedAt = isoTimestamp(createdAt);
  if (!normalizedHandoffId) {
    throw deliveryError("handoffId is required", "EXECUTION_BOARD_HANDOFF_DELIVERY_ID_REQUIRED");
  }
  if (!normalizedCreatedAt) {
    throw deliveryError("delivery createdAt is invalid", "EXECUTION_BOARD_HANDOFF_DELIVERY_CREATED_AT_INVALID");
  }

  return immutable(requireValidDelivery({
    schemaVersion: EXECUTION_BOARD_HANDOFF_DELIVERY_SCHEMA_VERSION,
    handoffId: normalizedHandoffId,
    status: "PENDING",
    createdAt: normalizedCreatedAt,
    claimedBy: null,
    claimedAt: null,
    executionListeningAt: null,
    deliveredAt: null,
    blockedAt: null,
    blockReason: null,
  }));
}

export function claimExecutionBoardHandoffDelivery(delivery, {
  receiverId,
  claimedAt = Date.now(),
} = {}) {
  requireValidDelivery(delivery);
  const receiver = text(receiverId);
  if (!receiver) {
    throw deliveryError("receiverId is required", "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");
  }

  if (delivery.status === "CLAIMED") {
    if (text(delivery.claimedBy) === receiver) return immutable(delivery);
    throw deliveryError(
      "handoff is already claimed by another Execution Board receiver",
      "EXECUTION_BOARD_HANDOFF_ALREADY_CLAIMED",
    );
  }
  if (delivery.status === "DELIVERED" || delivery.status === "BLOCKED") {
    throw deliveryError("terminal handoff delivery cannot be claimed", "EXECUTION_BOARD_HANDOFF_DELIVERY_TERMINAL");
  }
  if (delivery.status !== "PENDING") {
    throw deliveryError("handoff delivery is not claimable", "EXECUTION_BOARD_HANDOFF_DELIVERY_NOT_CLAIMABLE");
  }

  const normalizedClaimedAt = isoTimestamp(claimedAt);
  if (!normalizedClaimedAt) {
    throw deliveryError("claimedAt is invalid", "EXECUTION_BOARD_HANDOFF_CLAIMED_AT_INVALID");
  }

  return immutable(requireValidDelivery({
    ...structuredClone(delivery),
    status: "CLAIMED",
    claimedBy: receiver,
    claimedAt: normalizedClaimedAt,
  }));
}

export function deliverExecutionBoardHandoffDelivery(delivery, {
  receiverId,
  executionListeningAt,
  deliveredAt = Date.now(),
} = {}) {
  requireValidDelivery(delivery);
  const receiver = text(receiverId);
  const normalizedListeningAt = isoTimestamp(executionListeningAt);
  if (!receiver) {
    throw deliveryError("receiverId is required", "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");
  }
  if (!normalizedListeningAt) {
    throw deliveryError("executionListeningAt is required", "EXECUTION_LISTENING_AT_REQUIRED");
  }

  if (delivery.status === "DELIVERED") {
    if (
      text(delivery.claimedBy) === receiver
      && isoTimestamp(delivery.executionListeningAt) === normalizedListeningAt
    ) {
      return immutable(delivery);
    }
    throw deliveryError(
      "delivery acknowledgment conflicts with frozen delivery provenance",
      "HANDOFF_ACK_CONTENT_CONFLICT",
    );
  }
  if (delivery.status === "BLOCKED") {
    throw deliveryError("blocked handoff delivery cannot be delivered", "EXECUTION_BOARD_HANDOFF_DELIVERY_TERMINAL");
  }
  if (delivery.status !== "CLAIMED") {
    throw deliveryError("handoff must be claimed before delivery", "EXECUTION_BOARD_HANDOFF_NOT_CLAIMED");
  }
  if (text(delivery.claimedBy) !== receiver) {
    throw deliveryError(
      "delivery receiver does not own the handoff claim",
      "EXECUTION_BOARD_HANDOFF_CLAIM_RECEIVER_MISMATCH",
    );
  }

  const normalizedDeliveredAt = isoTimestamp(deliveredAt);
  if (!normalizedDeliveredAt) {
    throw deliveryError("deliveredAt is invalid", "EXECUTION_BOARD_HANDOFF_DELIVERED_AT_INVALID");
  }

  return immutable(requireValidDelivery({
    ...structuredClone(delivery),
    status: "DELIVERED",
    executionListeningAt: normalizedListeningAt,
    deliveredAt: normalizedDeliveredAt,
  }));
}

export function blockExecutionBoardHandoffDelivery(delivery, {
  receiverId,
  reason,
  blockedAt = Date.now(),
} = {}) {
  requireValidDelivery(delivery);
  const receiver = text(receiverId);
  const blockReason = upper(reason);
  if (!receiver) {
    throw deliveryError("receiverId is required", "EXECUTION_BOARD_RECEIVER_ID_REQUIRED");
  }
  if (!blockReason) {
    throw deliveryError("block reason is required", "EXECUTION_BOARD_HANDOFF_BLOCK_REASON_REQUIRED");
  }

  if (delivery.status === "BLOCKED") {
    if (text(delivery.claimedBy) === receiver && upper(delivery.blockReason) === blockReason) {
      return immutable(delivery);
    }
    throw deliveryError(
      "block request conflicts with frozen block provenance",
      "EXECUTION_BOARD_HANDOFF_BLOCK_CONTENT_CONFLICT",
    );
  }
  if (delivery.status === "DELIVERED") {
    throw deliveryError("delivered handoff cannot be blocked", "EXECUTION_BOARD_HANDOFF_DELIVERY_TERMINAL");
  }
  if (delivery.status !== "CLAIMED") {
    throw deliveryError("handoff must be claimed before blocking", "EXECUTION_BOARD_HANDOFF_NOT_CLAIMED");
  }
  if (text(delivery.claimedBy) !== receiver) {
    throw deliveryError(
      "block receiver does not own the handoff claim",
      "EXECUTION_BOARD_HANDOFF_CLAIM_RECEIVER_MISMATCH",
    );
  }

  const normalizedBlockedAt = isoTimestamp(blockedAt);
  if (!normalizedBlockedAt) {
    throw deliveryError("blockedAt is invalid", "EXECUTION_BOARD_HANDOFF_BLOCKED_AT_INVALID");
  }

  return immutable(requireValidDelivery({
    ...structuredClone(delivery),
    status: "BLOCKED",
    blockedAt: normalizedBlockedAt,
    blockReason,
  }));
}
