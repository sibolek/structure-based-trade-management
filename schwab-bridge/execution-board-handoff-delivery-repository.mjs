import fs from "node:fs";
import path from "node:path";
import {
  blockExecutionBoardHandoffDelivery,
  claimExecutionBoardHandoffDelivery,
  createPendingExecutionBoardHandoffDelivery,
  deliverExecutionBoardHandoffDelivery,
  validateExecutionBoardHandoffDeliveryContract,
} from "./execution-board-handoff-delivery.mjs";

export const EXECUTION_BOARD_HANDOFF_DELIVERY_REPOSITORY_SCHEMA_VERSION = 1;
export const DEFAULT_EXECUTION_BOARD_HANDOFF_DELIVERY_FILE = ".executionos-v24-execution-board-handoff-deliveries.json";

function text(value) {
  return String(value ?? "").trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function repositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function emptyState() {
  return {
    schemaVersion: EXECUTION_BOARD_HANDOFF_DELIVERY_REPOSITORY_SCHEMA_VERSION,
    updatedAt: null,
    deliveries: [],
  };
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    schemaVersion: EXECUTION_BOARD_HANDOFF_DELIVERY_REPOSITORY_SCHEMA_VERSION,
    updatedAt: text(source.updatedAt) || null,
    deliveries: Array.isArray(source.deliveries)
      ? source.deliveries
        .filter((value) => value && typeof value === "object")
        .map((value) => immutable(value))
      : [],
  };
}

export class ExecutionBoardHandoffDeliveryRepository {
  constructor({
    handoffRepository,
    filePath = DEFAULT_EXECUTION_BOARD_HANDOFF_DELIVERY_FILE,
    clock = () => new Date().toISOString(),
  } = {}) {
    if (!handoffRepository || typeof handoffRepository.getById !== "function") {
      throw new Error("ExecutionBoardHandoffDeliveryRepository requires handoffRepository.getById()");
    }
    if (typeof clock !== "function") throw new Error("clock must be a function");
    this.handoffRepository = handoffRepository;
    this.filePath = path.resolve(filePath);
    this.clock = clock;
    this.state = emptyState();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.state = normalizeState(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.state = emptyState();
    }
    this.#assertPersistedContracts();
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  save() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  register(handoffId) {
    const normalizedId = text(handoffId);
    if (!normalizedId) {
      throw repositoryError("handoffId is required", "EXECUTION_BOARD_HANDOFF_DELIVERY_ID_REQUIRED");
    }

    this.#requireKnownHandoff(normalizedId);
    const existing = this.state.deliveries.find((item) => text(item?.handoffId) === normalizedId);
    if (existing) return immutable(existing);

    const createdAt = this.#nowIso("EXECUTION_BOARD_HANDOFF_DELIVERY_CLOCK_INVALID");
    const delivery = createPendingExecutionBoardHandoffDelivery({
      handoffId: normalizedId,
      createdAt,
    });
    this.state.deliveries.push(delivery);
    this.#persistMutation({
      rollback: () => this.state.deliveries.pop(),
      errorCode: "EXECUTION_BOARD_HANDOFF_DELIVERY_PERSISTENCE_ERROR",
      errorMessage: "Execution Board handoff delivery persistence failed",
    });
    return immutable(delivery);
  }

  getById(handoffId) {
    const normalizedId = text(handoffId);
    if (!normalizedId) {
      throw repositoryError("handoffId is required", "EXECUTION_BOARD_HANDOFF_DELIVERY_ID_REQUIRED");
    }
    const found = this.state.deliveries.find((item) => text(item?.handoffId) === normalizedId);
    if (!found) {
      throw repositoryError(
        `Execution Board handoff delivery ${normalizedId} was not found`,
        "EXECUTION_BOARD_HANDOFF_DELIVERY_NOT_FOUND",
      );
    }
    return immutable(found);
  }

  listByStatus(status = null) {
    const normalizedStatus = text(status).toUpperCase();
    return this.state.deliveries
      .filter((item) => !normalizedStatus || text(item?.status).toUpperCase() === normalizedStatus)
      .map((item) => immutable(item));
  }

  claim(handoffId, receiverId) {
    return this.#replace(handoffId, (current) => {
      if (current.status === "CLAIMED" && text(current.claimedBy) === text(receiverId)) {
        return immutable(current);
      }
      return claimExecutionBoardHandoffDelivery(current, {
        receiverId,
        claimedAt: this.#nowIso("EXECUTION_BOARD_HANDOFF_DELIVERY_CLOCK_INVALID"),
      });
    });
  }

  deliver(handoffId, { receiverId, executionListeningAt } = {}) {
    return this.#replace(handoffId, (current) => {
      if (current.status === "DELIVERED") {
        return deliverExecutionBoardHandoffDelivery(current, {
          receiverId,
          executionListeningAt,
        });
      }
      return deliverExecutionBoardHandoffDelivery(current, {
        receiverId,
        executionListeningAt,
        deliveredAt: this.#nowIso("EXECUTION_BOARD_HANDOFF_DELIVERY_CLOCK_INVALID"),
      });
    });
  }

  block(handoffId, { receiverId, reason } = {}) {
    return this.#replace(handoffId, (current) => {
      if (current.status === "BLOCKED") {
        return blockExecutionBoardHandoffDelivery(current, {
          receiverId,
          reason,
        });
      }
      return blockExecutionBoardHandoffDelivery(current, {
        receiverId,
        reason,
        blockedAt: this.#nowIso("EXECUTION_BOARD_HANDOFF_DELIVERY_CLOCK_INVALID"),
      });
    });
  }

  #replace(handoffId, transition) {
    const normalizedId = text(handoffId);
    if (!normalizedId) {
      throw repositoryError("handoffId is required", "EXECUTION_BOARD_HANDOFF_DELIVERY_ID_REQUIRED");
    }
    this.#requireKnownHandoff(normalizedId);
    const index = this.state.deliveries.findIndex((item) => text(item?.handoffId) === normalizedId);
    if (index < 0) {
      throw repositoryError(
        `Execution Board handoff delivery ${normalizedId} was not found`,
        "EXECUTION_BOARD_HANDOFF_DELIVERY_NOT_FOUND",
      );
    }

    const previous = this.state.deliveries[index];
    const next = transition(previous);
    if (JSON.stringify(next) === JSON.stringify(previous)) return immutable(previous);

    this.state.deliveries[index] = next;
    this.#persistMutation({
      rollback: () => {
        this.state.deliveries[index] = previous;
      },
      errorCode: "EXECUTION_BOARD_HANDOFF_DELIVERY_PERSISTENCE_ERROR",
      errorMessage: "Execution Board handoff delivery persistence failed",
    });
    return immutable(next);
  }

  #persistMutation({ rollback, errorCode, errorMessage }) {
    const previousUpdatedAt = this.state.updatedAt;
    try {
      this.state.updatedAt = this.#nowIso("EXECUTION_BOARD_HANDOFF_DELIVERY_CLOCK_INVALID");
      this.save();
    } catch (error) {
      rollback();
      this.state.updatedAt = previousUpdatedAt;
      if (error?.code === "EXECUTION_BOARD_HANDOFF_DELIVERY_CLOCK_INVALID") throw error;
      throw repositoryError(errorMessage, errorCode);
    }
  }

  #nowIso(errorCode) {
    const value = this.clock();
    const parsed = Date.parse(String(value ?? ""));
    if (!Number.isFinite(parsed)) {
      throw repositoryError("repository clock returned an invalid timestamp", errorCode);
    }
    return new Date(parsed).toISOString();
  }

  #requireKnownHandoff(handoffId) {
    try {
      return this.handoffRepository.getById(handoffId);
    } catch (error) {
      if (error?.code === "EXECUTION_BOARD_HANDOFF_NOT_FOUND") {
        throw repositoryError(
          `Execution Board handoff ${handoffId} does not exist`,
          "EXECUTION_BOARD_HANDOFF_DELIVERY_ORPHANED",
        );
      }
      throw error;
    }
  }

  #assertPersistedContracts() {
    const seen = new Set();
    for (const delivery of this.state.deliveries) {
      const contract = validateExecutionBoardHandoffDeliveryContract(delivery);
      if (!contract.valid) {
        throw repositoryError(
          `persisted Execution Board handoff delivery is invalid: ${contract.errors.join("; ")}`,
          "CORRUPT_EXECUTION_BOARD_HANDOFF_DELIVERY_REPOSITORY",
        );
      }
      const handoffId = text(delivery.handoffId);
      if (seen.has(handoffId)) {
        throw repositoryError(
          `persisted handoffId ${handoffId} is duplicated`,
          "CORRUPT_EXECUTION_BOARD_HANDOFF_DELIVERY_REPOSITORY",
        );
      }
      seen.add(handoffId);
      try {
        this.#requireKnownHandoff(handoffId);
      } catch {
        throw repositoryError(
          `persisted delivery references unknown handoff ${handoffId}`,
          "CORRUPT_EXECUTION_BOARD_HANDOFF_DELIVERY_REPOSITORY",
        );
      }
    }
  }
}
