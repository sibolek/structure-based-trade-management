import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
  subscribeExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "./execution-board-store-repository.js";

export const V23_EXECUTION_PROJECTION_FIELDS = Object.freeze([
  "draft",
  "candidates",
  "liveTrades",
  "history",
  "view",
  "notice",
]);

const EXECUTION_ARRAY_FIELDS = new Set(["candidates", "liveTrades", "history"]);

function authorityError(message, code = "INVALID_EXECUTION_BOARD_STORE_PROJECTION") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isV24Record(record) {
  return record?.origin === "V24_HANDOFF" && record?.v24;
}

function legacyProjectionSource(snapshot) {
  const clean = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    ...structuredClone(clean),
    candidates: (Array.isArray(clean.candidates) ? clean.candidates : []).filter((item) => !isV24Record(item)),
    liveTrades: (Array.isArray(clean.liveTrades) ? clean.liveTrades : []).filter((item) => !isV24Record(item)),
    history: (Array.isArray(clean.history) ? clean.history : []).filter((item) => !isV24Record(item)),
  };
}

function defaultProject(snapshot) {
  return {
    draft: snapshot?.draft ?? null,
    candidates: Array.isArray(snapshot?.candidates) ? structuredClone(snapshot.candidates) : [],
    liveTrades: Array.isArray(snapshot?.liveTrades) ? structuredClone(snapshot.liveTrades) : [],
    history: Array.isArray(snapshot?.history) ? structuredClone(snapshot.history) : [],
    view: snapshot?.view || "TRADE",
    notice: typeof snapshot?.notice === "string" ? snapshot.notice : "",
  };
}

function requireProject(project) {
  if (project == null) return defaultProject;
  if (typeof project !== "function") throw authorityError("projection must be a function");
  return project;
}

function requireProjection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw authorityError("projected Execution Board state must be an object");
  }
  return value;
}

function mergeLegacyArray(latest, proposed, field) {
  const durable = Array.isArray(latest?.[field]) ? latest[field] : [];
  const next = Array.isArray(proposed) ? proposed : [];
  if (next.some(isV24Record)) {
    throw authorityError(
      `legacy V2.3 projection may not create or mutate V2.4 ${field} records`,
      "V24_AUTHORIZATION_IMMUTABLE",
    );
  }
  const preservedV24 = durable.filter(isV24Record).map((item) => structuredClone(item));
  return [...preservedV24, ...structuredClone(next)];
}

export function readV23ExecutionProjection({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  project = defaultProject,
} = {}) {
  const projector = requireProject(project);
  const canonical = readExecutionBoardStore({ storage, storeKey });
  return requireProjection(projector(legacyProjectionSource(canonical)));
}

export async function transactV23ExecutionProjection({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  project = defaultProject,
  updater,
  lockManager = globalThis?.navigator?.locks,
} = {}) {
  const projector = requireProject(project);
  if (typeof updater !== "function" && (!updater || typeof updater !== "object" || Array.isArray(updater))) {
    throw authorityError("V2.3 projection update requires an updater function or object");
  }

  const committed = await transactExecutionBoardStoreSerialized({
    storage,
    storeKey,
    lockManager,
    mutate: (latest) => {
      const currentProjection = requireProjection(projector(legacyProjectionSource(latest)));
      const proposed = typeof updater === "function" ? updater(currentProjection) : updater;
      const nextProjection = requireProjection(proposed);
      const next = { ...latest };
      for (const field of V23_EXECUTION_PROJECTION_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(nextProjection, field)) continue;
        next[field] = EXECUTION_ARRAY_FIELDS.has(field)
          ? mergeLegacyArray(latest, nextProjection[field], field)
          : structuredClone(nextProjection[field]);
      }
      return next;
    },
  });

  return requireProjection(projector(legacyProjectionSource(committed)));
}

export function subscribeV23ExecutionProjection({
  storeKey = EXECUTION_BOARD_STORE_KEY,
  project = defaultProject,
  listener,
} = {}) {
  const projector = requireProject(project);
  if (typeof listener !== "function") {
    throw authorityError("V2.3 projection subscriber must be a function", "INVALID_EXECUTION_BOARD_STORE_SUBSCRIBER");
  }
  return subscribeExecutionBoardStore({
    storeKey,
    listener: (snapshot) => listener(requireProjection(projector(legacyProjectionSource(snapshot)))),
  });
}
