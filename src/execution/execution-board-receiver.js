export const EXECUTION_BOARD_RECEIVER_ID_STORAGE_KEY = "executionos-v23-receiver-id";

function text(value) {
  return String(value ?? "").trim();
}

function receiverError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw receiverError(
      "durable browser storage is required for Execution Board receiver identity",
      "EXECUTION_BOARD_RECEIVER_STORAGE_UNAVAILABLE",
    );
  }
  return storage;
}

function defaultUuidFactory() {
  const randomUUID = globalThis?.crypto?.randomUUID;
  if (typeof randomUUID !== "function") {
    throw receiverError(
      "crypto.randomUUID() is required to create Execution Board receiver identity",
      "EXECUTION_BOARD_RECEIVER_UUID_UNAVAILABLE",
    );
  }
  return randomUUID.call(globalThis.crypto);
}

export function readExecutionBoardReceiverId({
  storage = globalThis?.localStorage,
  storageKey = EXECUTION_BOARD_RECEIVER_ID_STORAGE_KEY,
} = {}) {
  const durableStorage = requireStorage(storage);
  try {
    return text(durableStorage.getItem(storageKey)) || null;
  } catch (error) {
    throw receiverError(
      `Execution Board receiver identity could not be read: ${error.message}`,
      "EXECUTION_BOARD_RECEIVER_STORAGE_UNAVAILABLE",
    );
  }
}

export function getOrCreateExecutionBoardReceiverId({
  storage = globalThis?.localStorage,
  storageKey = EXECUTION_BOARD_RECEIVER_ID_STORAGE_KEY,
  uuidFactory = defaultUuidFactory,
} = {}) {
  const durableStorage = requireStorage(storage);
  const existing = readExecutionBoardReceiverId({ storage: durableStorage, storageKey });
  if (existing) return existing;

  const receiverId = text(uuidFactory());
  if (!receiverId) {
    throw receiverError(
      "generated Execution Board receiver identity is empty",
      "EXECUTION_BOARD_RECEIVER_ID_INVALID",
    );
  }

  try {
    durableStorage.setItem(storageKey, receiverId);
    const readBack = text(durableStorage.getItem(storageKey));
    if (readBack !== receiverId) {
      throw new Error("receiver identity readback mismatch");
    }
  } catch (error) {
    throw receiverError(
      `Execution Board receiver identity could not be persisted exactly: ${error.message}`,
      "EXECUTION_BOARD_RECEIVER_PERSISTENCE_FAILED",
    );
  }

  return receiverId;
}
