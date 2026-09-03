export const EXECUTION_BOARD_STORE_KEY = "execution-v23-store";
export const EXECUTION_BOARD_STORE_SCHEMA_VERSION = 1;
export const EXECUTION_BOARD_STORE_WRITER_LOCK_NAME = "executionos-execution-board-store-writer";

const listenersByKey = new Map();

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

function storeError(message, code = "LOCAL_EXECUTION_PERSISTENCE_FAILED") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw storeError("durable local execution storage is unavailable");
  }
  return storage;
}

function array(value) {
  return Array.isArray(value) ? structuredClone(value) : [];
}

function revision(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

export function normalizeExecutionBoardStore(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw storeError("local execution store root must be an object");
  }

  const normalized = {
    ...structuredClone(raw),
    storeSchemaVersion: EXECUTION_BOARD_STORE_SCHEMA_VERSION,
    storeRevision: revision(raw.storeRevision),
    draft: raw.draft && typeof raw.draft === "object" && !Array.isArray(raw.draft)
      ? structuredClone(raw.draft)
      : null,
    candidates: array(raw.candidates),
    liveTrades: array(raw.liveTrades),
    history: array(raw.history),
    view: text(raw.view) || "TRADE",
    notice: typeof raw.notice === "string" ? raw.notice : "",
    v24Installations: array(raw.v24Installations),
    v24Retirements: array(raw.v24Retirements),
    v24Lifecycles: array(raw.v24Lifecycles),
  };

  return immutable(normalized);
}

export function readExecutionBoardStore({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
} = {}) {
  const durable = requireStorage(storage);
  try {
    const raw = durable.getItem(storeKey);
    if (!raw) return normalizeExecutionBoardStore({});
    const parsed = JSON.parse(raw);
    return normalizeExecutionBoardStore(parsed);
  } catch (error) {
    if (error?.code === "LOCAL_EXECUTION_PERSISTENCE_FAILED") throw error;
    throw storeError(`local execution store could not be read: ${error.message}`);
  }
}

function listenersFor(storeKey) {
  const key = text(storeKey) || EXECUTION_BOARD_STORE_KEY;
  if (!listenersByKey.has(key)) listenersByKey.set(key, new Set());
  return listenersByKey.get(key);
}

function publish(storeKey, snapshot) {
  for (const listener of listenersFor(storeKey)) {
    try {
      listener(snapshot);
    } catch {
      // Projection listeners cannot invalidate an already durable commit.
    }
  }
}

export function subscribeExecutionBoardStore({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  listener,
  eventTarget = globalThis,
} = {}) {
  if (typeof listener !== "function") {
    throw storeError("Execution Board store subscriber must be a function", "INVALID_EXECUTION_BOARD_STORE_SUBSCRIBER");
  }

  const key = text(storeKey) || EXECUTION_BOARD_STORE_KEY;
  const listeners = listenersFor(key);
  listeners.add(listener);

  // Decision 22F: a storage event is notification only. Never trust or
  // project event.newValue as canonical execution state; reread durable
  // storage and publish that exact canonical snapshot instead.
  const onStorage = (event) => {
    if (event?.key !== key) return;
    if (event?.storageArea && storage && event.storageArea !== storage) return;

    try {
      const snapshot = readExecutionBoardStore({ storage, storeKey: key });
      publish(key, snapshot);
    } catch {
      // A cross-tab read failure cannot invent replacement execution state.
      // The next durable notification or ordinary application read may recover.
    }
  };

  const canObserveStorage = eventTarget && typeof eventTarget.addEventListener === "function";
  if (canObserveStorage) eventTarget.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    if (canObserveStorage && typeof eventTarget.removeEventListener === "function") {
      eventTarget.removeEventListener("storage", onStorage);
    }
  };
}

export function transactExecutionBoardStore({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  mutate,
} = {}) {
  if (typeof mutate !== "function") {
    throw storeError("Execution Board store transaction requires a mutate function", "INVALID_EXECUTION_BOARD_STORE_TRANSACTION");
  }

  const durable = requireStorage(storage);
  const priorRaw = durable.getItem(storeKey);
  const current = readExecutionBoardStore({ storage: durable, storeKey });
  const working = structuredClone(current);

  let proposed;
  try {
    proposed = mutate(working, current);
  } catch (error) {
    throw error;
  }

  const candidate = proposed === undefined ? working : proposed;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw storeError("Execution Board transaction result must be an object", "INVALID_EXECUTION_BOARD_STORE_TRANSACTION");
  }

  const normalized = normalizeExecutionBoardStore({
    ...structuredClone(candidate),
    storeRevision: current.storeRevision + 1,
  });
  const serialized = JSON.stringify(normalized);

  try {
    durable.setItem(storeKey, serialized);
    const exactReadBack = durable.getItem(storeKey);
    if (exactReadBack !== serialized) throw new Error("exact store readback mismatch");

    const committed = readExecutionBoardStore({ storage: durable, storeKey });
    if (committed.storeRevision !== current.storeRevision + 1) {
      throw new Error("storeRevision readback mismatch");
    }

    publish(storeKey, committed);
    return committed;
  } catch (error) {
    try {
      if (priorRaw === null) durable.removeItem?.(storeKey);
      else durable.setItem(storeKey, priorRaw);
    } catch {
      // Best-effort rollback only. Failure remains fail-closed.
    }
    if (error?.code === "LOCAL_EXECUTION_PERSISTENCE_FAILED") throw error;
    throw storeError(`local execution store could not be persisted exactly: ${error.message}`);
  }
}


function requireWriterLockManager(lockManager) {
  if (!lockManager || typeof lockManager.request !== "function") {
    throw storeError(
      "browser-wide Execution Board writer lock is unavailable",
      "EXECUTION_BOARD_STORE_WRITER_LOCK_UNAVAILABLE",
    );
  }
  return lockManager;
}

export async function withExecutionBoardStoreWriterLock({
  lockManager = globalThis?.navigator?.locks,
  operation,
} = {}) {
  if (typeof operation !== "function") {
    throw storeError(
      "Execution Board writer lock requires an operation",
      "INVALID_EXECUTION_BOARD_STORE_TRANSACTION",
    );
  }

  const manager = requireWriterLockManager(lockManager);
  return manager.request(
    EXECUTION_BOARD_STORE_WRITER_LOCK_NAME,
    { mode: "exclusive" },
    operation,
  );
}

export async function transactExecutionBoardStoreSerialized({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  mutate,
  lockManager = globalThis?.navigator?.locks,
} = {}) {
  if (typeof mutate !== "function") {
    throw storeError(
      "Execution Board store transaction requires a mutate function",
      "INVALID_EXECUTION_BOARD_STORE_TRANSACTION",
    );
  }

  // Decision 22F: the lock encloses only the canonical local read-modify-write
  // transaction. No broker or pretrade network operation belongs inside it.
  return withExecutionBoardStoreWriterLock({
    lockManager,
    operation: () => transactExecutionBoardStore({
      storage,
      storeKey,
      mutate,
    }),
  });
}

export function executionBoardStoreRevision({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
} = {}) {
  return readExecutionBoardStore({ storage, storeKey }).storeRevision;
}
