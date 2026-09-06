import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
} from "./execution-board-store-repository.js";
import {
  findV24RetiredAuthorizationExceptions,
  recordV24RetiredAuthorizationExceptionsSerialized,
} from "./execution-v24-retired-authorization-exceptions.js";
import { runV24ExecutionRouterCycle } from "./execution-v24-runtime-router.js";

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function immutable(value) { return Object.freeze(structuredClone(value)); }
function array(value) { return Array.isArray(value) ? value : []; }

function retirementFor(store, handoffId) {
  return array(store?.v24Retirements).find((item) => text(item?.handoffId) === text(handoffId)) || null;
}

function isGlobalStoreFailure(error) {
  return [
    "LOCAL_EXECUTION_PERSISTENCE_FAILED",
    "EXECUTION_BOARD_STORE_WRITER_LOCK_UNAVAILABLE",
  ].includes(upper(error?.code));
}

export async function reconcileV24RetiredAuthorizationExceptionsCycle({
  brokerState,
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_BOARD_STORE_KEY,
  lockManager = globalThis?.navigator?.locks,
  dependencies = {},
} = {}) {
  const readStore = dependencies.readStore || readExecutionBoardStore;
  const recordExceptions = dependencies.recordExceptions || recordV24RetiredAuthorizationExceptionsSerialized;
  let store = readStore({ storage, storeKey });
  const results = [];

  const installations = [...array(store?.v24Installations)]
    .filter((item) => upper(item?.status) === "LISTENING")
    .sort((left, right) => text(left?.handoffId).localeCompare(text(right?.handoffId)));

  for (const installation of installations) {
    const handoffId = text(installation?.handoffId ?? installation?.compatibility?.v24?.handoffId);
    if (!handoffId) continue;
    const retirement = retirementFor(store, handoffId);
    if (upper(retirement?.status) !== "RETIRED" || upper(retirement?.reason) !== "ENTRY_AUTHORIZATION_EXPIRED") continue;

    let exceptions;
    try {
      exceptions = findV24RetiredAuthorizationExceptions({
        store,
        installation,
        retirement,
        brokerState,
      });
    } catch (error) {
      results.push({
        stage: "AUTHORIZATION_EXCEPTION",
        handoffId,
        status: "ERROR",
        reason: error?.code || error?.message || String(error),
      });
      continue;
    }

    if (!exceptions.length) continue;

    try {
      const recorded = await recordExceptions({
        storage,
        storeKey,
        handoffId,
        exceptions,
        lockManager,
      });
      results.push({
        stage: "AUTHORIZATION_EXCEPTION",
        handoffId,
        status: "RECORDED",
        recordedCount: Array.isArray(recorded?.recorded) ? recorded.recorded.length : exceptions.length,
        codes: [...new Set(exceptions.map((item) => item.code))],
      });
      store = readStore({ storage, storeKey });
    } catch (error) {
      if (isGlobalStoreFailure(error)) throw error;
      results.push({
        stage: "AUTHORIZATION_EXCEPTION",
        handoffId,
        status: "ERROR",
        reason: error?.code || error?.message || String(error),
      });
    }
  }

  return immutable({ results, storeRevision: Number(store?.storeRevision || 0) });
}

export async function runV24ManagedExecutionRouterCycle(options = {}) {
  const base = await runV24ExecutionRouterCycle(options);
  const exceptionRecovery = await reconcileV24RetiredAuthorizationExceptionsCycle({
    brokerState: options.brokerState,
    storage: options.storage,
    storeKey: options.storeKey,
    lockManager: options.lockManager,
    dependencies: options.retiredExceptionDependencies || {},
  });

  return immutable({
    ...structuredClone(base),
    results: [
      ...array(base?.results).map((item) => structuredClone(item)),
      ...exceptionRecovery.results.map((item) => structuredClone(item)),
    ],
    storeRevision: exceptionRecovery.storeRevision,
  });
}
