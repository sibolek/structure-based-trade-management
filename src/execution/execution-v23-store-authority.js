import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
  subscribeExecutionBoardStore,
  transactExecutionBoardStore,
} from "./execution-board-store-repository.js";

export const V23_EXECUTION_PROJECTION_FIELDS = Object.freeze([
  "draft",
  "candidates",
  "liveTrades",
  "history",
  "view",
  "notice",
]);

function authorityError(message, code = "INVALID_EXECUTION_BOARD_STORE_PROJECTION") {
  const error = new Error(message);
  error.code = code;
  return error;
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

export function readV23ExecutionProjection({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  project = defaultProject,
} = {}) {
  const projector = requireProject(project);
  return requireProjection(projector(readExecutionBoardStore({ storage, storeKey })));
}

export function transactV23ExecutionProjection({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  project = defaultProject,
  updater,
} = {}) {
  const projector = requireProject(project);
  if (typeof updater !== "function" && (!updater || typeof updater !== "object" || Array.isArray(updater))) {
    throw authorityError("V2.3 projection update requires an updater function or object");
  }

  const committed = transactExecutionBoardStore({
    storage,
    storeKey,
    mutate: (latest) => {
      const currentProjection = requireProjection(projector(latest));
      const proposed = typeof updater === "function" ? updater(currentProjection) : updater;
      const nextProjection = requireProjection(proposed);
      const next = { ...latest };
      for (const field of V23_EXECUTION_PROJECTION_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(nextProjection, field)) {
          next[field] = structuredClone(nextProjection[field]);
        }
      }
      return next;
    },
  });

  return requireProjection(projector(committed));
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
    listener: (snapshot) => listener(requireProjection(projector(snapshot))),
  });
}
