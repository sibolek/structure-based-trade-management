import http from "node:http";
import {
  createBrokerExecutionCoverage,
  validateBrokerExecutionCoverage,
} from "./broker-execution-provenance.mjs";
import {
  advanceBrokerExecutionActivity,
  createBrokerExecutionActivity,
  establishBrokerExecutionActivity,
  validateBrokerExecutionActivity,
} from "./broker-execution-activity.mjs";
import {
  advanceBrokerExecutionOwnershipJournal,
  appendBrokerExecutionOwnershipEvent,
  createBrokerExecutionOwnershipJournal,
  establishBrokerExecutionOwnershipJournal,
} from "./broker-execution-ownership-journal.mjs";

const DEFAULT_HOST = "127.0.0.1";
const MAX_EXECUTIONS = 25;

function nowIso() {
  return new Date().toISOString();
}

function accountKey(value) {
  return String(value?.accountId ?? value?.account ?? "").trim();
}

function positionKey(position) {
  return `${accountKey(position)}|${String(position?.symbol || "?").toUpperCase()}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function executionTimeRequired(execution) {
  const parsed = Date.parse(String(execution?.executionTime || ""));
  if (!Number.isFinite(parsed)) {
    const error = new Error("authoritative Schwab executionTime is required");
    error.code = "BROKER_EXECUTION_TIME_REQUIRED";
    throw error;
  }
}

export function createLiveStateApi({ port = 8787, host = DEFAULT_HOST } = {}) {
  let state = {
    version: 2,
    status: "BOOTING",
    readOnly: true,
    source: "SCHWAB",
    updatedAt: nowIso(),
    pollMs: null,
    accounts: [],
    positions: [],
    executions: [],
    executionCoverage: createBrokerExecutionCoverage(),
    executionActivity: createBrokerExecutionActivity(),
    executionOwnershipJournal: createBrokerExecutionOwnershipJournal(),
    lastError: null,
  };

  let server = null;
  let executionActivityFault = null;

  function touch() {
    state.updatedAt = nowIso();
  }

  function setStatus(status) {
    state.status = status;
    state.lastError = null;
    touch();
  }

  function setBootstrap({ pollMs = null, accounts = [], positions = [] } = {}) {
    state.pollMs = pollMs;
    state.accounts = clone(accounts);
    state.positions = clone(positions);
    state.lastError = null;
    touch();
  }

  function setExecutionCoverage(coverage) {
    const contract = validateBrokerExecutionCoverage(coverage);
    if (!contract.valid) {
      const error = new Error(`invalid broker execution coverage: ${contract.errors.join("; ")}`);
      error.code = "INVALID_BROKER_EXECUTION_COVERAGE";
      throw error;
    }

    if (coverage.status === "CONTIGUOUS" && executionActivityFault) {
      const error = new Error(
        `execution activity provenance is faulted: ${executionActivityFault.message}`,
      );
      error.code = "BROKER_EXECUTION_ACTIVITY_PROVENANCE_FAULT";
      throw error;
    }

    let nextActivity;
    let nextOwnershipJournal;
    if (coverage.status !== "CONTIGUOUS") {
      // Decisions 13 and 15: completeness and ownership evidence never survive a coverage gap.
      nextActivity = createBrokerExecutionActivity();
      nextOwnershipJournal = createBrokerExecutionOwnershipJournal();
    } else if (
      !state.executionActivity?.coverageStartedAt
      || state.executionActivity.coverageStartedAt !== coverage.coverageStartedAt
    ) {
      // Baseline establishment or successful recovery begins a new proof/evidence interval.
      nextActivity = establishBrokerExecutionActivity(createBrokerExecutionActivity(), {
        coverageStartedAt: coverage.coverageStartedAt,
        currentThrough: coverage.currentThrough,
      });
      nextOwnershipJournal = establishBrokerExecutionOwnershipJournal(
        createBrokerExecutionOwnershipJournal(),
        {
          coverageStartedAt: coverage.coverageStartedAt,
          currentThrough: coverage.currentThrough,
        },
      );
    } else {
      // A successful poll advances all broker-provenance views through the same observation point.
      nextActivity = advanceBrokerExecutionActivity(state.executionActivity, {
        observedThrough: coverage.currentThrough,
        executions: [],
      });
      nextOwnershipJournal = advanceBrokerExecutionOwnershipJournal(
        state.executionOwnershipJournal,
        { observedThrough: coverage.currentThrough },
      );
    }

    state.executionCoverage = clone(coverage);
    state.executionActivity = clone(nextActivity);
    state.executionOwnershipJournal = clone(nextOwnershipJournal);
    touch();
  }

  function setExecutionActivity(activity) {
    const contract = validateBrokerExecutionActivity(activity);
    if (!contract.valid) {
      const error = new Error(`invalid broker execution activity: ${contract.errors.join("; ")}`);
      error.code = "INVALID_BROKER_EXECUTION_ACTIVITY";
      throw error;
    }
    state.executionActivity = clone(activity);
    touch();
  }

  function updateAccount(account) {
    const key = accountKey(account);
    const index = state.accounts.findIndex((item) => accountKey(item) === key);
    if (index >= 0) state.accounts[index] = { ...state.accounts[index], ...clone(account) };
    else state.accounts.push(clone(account));
    touch();
  }

  function updatePosition(position) {
    const key = positionKey(position);
    const index = state.positions.findIndex((item) => positionKey(item) === key);

    if (!position.quantity) {
      if (index >= 0) state.positions.splice(index, 1);
    } else if (index >= 0) {
      state.positions[index] = { ...state.positions[index], ...clone(position) };
    } else {
      state.positions.push(clone(position));
    }
    touch();
  }

  function recordExecution(execution) {
    // Validate event-time authority before publishing the execution anywhere. The
    // monitor currently marks an unseen execution as seen before calling here, so a
    // malformed executionTime creates a sticky provenance fault for this process.
    // That prevents later polls from silently recovering after the bad event has
    // disappeared from the unseen path. A monitor restart establishes a new baseline.
    try {
      executionTimeRequired(execution);
    } catch (error) {
      executionActivityFault = {
        code: error.code || "BROKER_EXECUTION_TIME_REQUIRED",
        message: error.message,
        faultedAt: nowIso(),
      };
      throw error;
    }

    if (state.executionActivity?.coverageStartedAt && state.executionActivity?.currentThrough) {
      state.executionActivity = clone(advanceBrokerExecutionActivity(state.executionActivity, {
        // Keep the activity proof's interval endpoint aligned with executionCoverage.
        // The successful poll will advance both together after all fill processing.
        observedThrough: state.executionActivity.currentThrough,
        executions: [execution],
      }));
    }

    if (state.executionOwnershipJournal?.coverageStartedAt) {
      state.executionOwnershipJournal = clone(appendBrokerExecutionOwnershipEvent(
        state.executionOwnershipJournal,
        execution,
      ));
    }

    state.executions = [clone(execution), ...state.executions].slice(0, MAX_EXECUTIONS);
    state.lastError = null;
    touch();
  }

  function setError(message) {
    state.lastError = String(message || "Unknown monitor error");
    touch();
  }

  function snapshot() {
    return clone(state);
  }

  async function start() {
    if (server) return;

    server = http.createServer((request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "application/json; charset=utf-8");

      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method !== "GET") {
        response.statusCode = 405;
        response.end(JSON.stringify({ error: "read-only API" }));
        return;
      }

      if (request.url === "/health") {
        response.statusCode = 200;
        response.end(JSON.stringify({
          ok: true,
          status: state.status,
          updatedAt: state.updatedAt,
          executionCoverage: state.executionCoverage,
          executionActivity: state.executionActivity,
          executionOwnershipJournal: {
            schemaVersion: state.executionOwnershipJournal.schemaVersion,
            source: state.executionOwnershipJournal.source,
            coverageStartedAt: state.executionOwnershipJournal.coverageStartedAt,
            currentThrough: state.executionOwnershipJournal.currentThrough,
            entryCount: state.executionOwnershipJournal.entries.length,
          },
        }));
        return;
      }

      if (request.url === "/api/state") {
        response.statusCode = 200;
        response.end(JSON.stringify(snapshot()));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server?.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server?.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  }

  async function stop() {
    if (!server) return;
    const active = server;
    server = null;
    await new Promise((resolve) => active.close(() => resolve()));
  }

  return {
    host,
    port,
    start,
    stop,
    setStatus,
    setBootstrap,
    setExecutionCoverage,
    setExecutionActivity,
    updateAccount,
    updatePosition,
    recordExecution,
    setError,
    snapshot,
  };
}
