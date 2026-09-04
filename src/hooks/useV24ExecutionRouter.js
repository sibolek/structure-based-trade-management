import { useEffect, useRef, useState } from "react";
import { getOrCreateExecutionBoardReceiverId } from "../execution/execution-board-receiver.js";
import { createV24HandoffTransport } from "../execution/execution-v24-handoff-transport.js";
import { runV24ExecutionRouterCycle } from "../execution/execution-v24-runtime-router.js";
import {
  V24_ROUTER_LOOP_DELAY_MS,
  deriveV24RouterHealthStatus,
} from "../execution/execution-v24-router-health.js";
import {
  createV24RouterFailure,
  failuresFromV24RouterCycleResult,
} from "../execution/execution-v24-router-telemetry.js";
import {
  interpretV24RouterDisableConfig,
} from "../execution/execution-v24-router-config.js";

const ROUTER_LOCK_NAME = "executionos-v24-runtime-router";
const ROUTER_CONFIG = interpretV24RouterDisableConfig(
  import.meta.env.VITE_EXECUTIONOS_V24_ROUTER_DISABLED,
);

function delay(ms, signal = null) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    let settled = false;
    let timer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      signal?.removeEventListener?.("abort", finish);
      resolve();
    };

    timer = window.setTimeout(finish, ms);
    signal?.addEventListener?.("abort", finish, { once: true });
  });
}

function errorText(error) {
  return error?.code || error?.message || String(error);
}

export default function useV24ExecutionRouter({ broker, pretrade } = {}) {
  const latest = useRef({ broker, pretrade });
  const proposedBoundaries = useRef(new Map());
  const [state, setState] = useState(() => ({
    status: ROUTER_CONFIG.status,
    receiverId: null,
    leader: false,
    lastHeartbeatAt: null,
    lastSuccessfulCycleAt: null,
    lastFailedCycleAt: null,
    lastResult: null,
    activeError: null,
    lastFailure: null,
    error: ROUTER_CONFIG.error,
    brokerWriteAuthority: false,
    enabled: ROUTER_CONFIG.enabled,
  }));

  latest.current = { broker, pretrade };

  useEffect(() => {
    if (!ROUTER_CONFIG.enabled) return undefined;

    let cancelled = false;
    const epochAbort = new AbortController();
    const lockManager = globalThis?.navigator?.locks;
    if (!lockManager || typeof lockManager.request !== "function") {
      setState((current) => ({
        ...current,
        status: "BLOCKED",
        leader: false,
        error: "V24_RUNTIME_ROUTER_LOCK_UNAVAILABLE",
      }));
      return undefined;
    }

    let receiverId;
    try {
      receiverId = getOrCreateExecutionBoardReceiverId();
      setState((current) => ({ ...current, receiverId, status: "WAITING_FOR_ROUTER_LOCK" }));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "BLOCKED",
        error: errorText(error),
      }));
      return undefined;
    }

    const leaderPromise = lockManager.request(
      ROUTER_LOCK_NAME,
      { mode: "exclusive", signal: epochAbort.signal },
      async () => {
      if (cancelled) return;

      const leaderHeartbeatAt = new Date().toISOString();
      setState((current) => ({
        ...current,
        status: "RUNNING",
        leader: true,
        error: "",
        lastHeartbeatAt: leaderHeartbeatAt,
      }));

      const staleWatchdog = window.setInterval(() => {
        setState((current) => {
          const status = deriveV24RouterHealthStatus({
            leader: current.leader,
            status: current.status,
            lastHeartbeatAt: current.lastHeartbeatAt,
            now: Date.now(),
          });

          return status === current.status
            ? current
            : { ...current, status };
        });
      }, V24_ROUTER_LOOP_DELAY_MS);

      try {
      while (!cancelled) {
        const heartbeatAt = new Date().toISOString();
        setState((prior) => ({
          ...prior,
          leader: true,
          lastHeartbeatAt: heartbeatAt,
          status: prior.status === "STALE" ? "RUNNING" : prior.status,
        }));

        const current = latest.current;
        const brokerReady = Boolean(current?.broker?.connected && current?.broker?.state);
        const pretradeReady = Boolean(current?.pretrade?.connected && current?.pretrade?.pretradeUrl);

        // Decision 22C: Schwab evidence is required for broker-ownership
        // conclusions, but pretrade transport is not required once durable
        // ownership already exists.
        if (!brokerReady) {
          setState((prior) => ({
            ...prior,
            status: "WAITING_FOR_SCHWAB",
            leader: true,
            error: current?.broker?.error || "",
          }));
          await delay(V24_ROUTER_LOOP_DELAY_MS, epochAbort.signal);
          continue;
        }

        try {
          const transport = pretradeReady
            ? createV24HandoffTransport({ pretradeUrl: current.pretrade.pretradeUrl })
            : null;

          const result = await runV24ExecutionRouterCycle({
            transport,
            receiverId,
            brokerState: current.broker.state,
            proposedBoundaries: proposedBoundaries.current,
          });

          const failures = failuresFromV24RouterCycleResult(result);
          const activeError = failures[0] || null;
          const transportWaiting = result.results.find(
            (item) => item.stage === "TRANSPORT" && item.status === "WAITING_FOR_PRETRADE",
          );

          let status = "RUNNING";
          let stateError = "";

          if (activeError) {
            status = "ERROR";
            stateError = activeError.code || activeError.message;
          } else if (!pretradeReady || transportWaiting) {
            status = "WAITING_FOR_PRETRADE";
            stateError = current?.pretrade?.error || transportWaiting?.reason || "";
          }

          if (!cancelled) {
            const cycleAt = result.processedAt || new Date().toISOString();
            setState((prior) => ({
              ...prior,
              status,
              receiverId,
              leader: true,
              lastHeartbeatAt: cycleAt,
              lastSuccessfulCycleAt: activeError
                ? prior.lastSuccessfulCycleAt
                : cycleAt,
              lastFailedCycleAt: activeError
                ? cycleAt
                : prior.lastFailedCycleAt,
              lastResult: result,
              activeError,
              lastFailure: activeError || prior.lastFailure,
              error: stateError,
              brokerWriteAuthority: false,
              enabled: true,
            }));
          }
        } catch (error) {
          if (!cancelled) {
            const failedAt = new Date().toISOString();
            const failure = createV24RouterFailure({
              occurredAt: failedAt,
              stage: "ROUTER_SERVICE",
              error,
            });

            setState((prior) => ({
              ...prior,
              status: "ERROR",
              leader: true,
              activeError: failure,
              lastFailure: failure,
              error: failure.code || errorText(error),
              lastHeartbeatAt: failedAt,
              lastFailedCycleAt: failedAt,
            }));
          }
        }

        await delay(V24_ROUTER_LOOP_DELAY_MS, epochAbort.signal);
      }
      } finally {
        window.clearInterval(staleWatchdog);
      }
      },
    );

    leaderPromise.catch((error) => {
      if (cancelled) return;
      setState((current) => ({
        ...current,
        status: "BLOCKED",
        leader: false,
        error: errorText(error),
      }));
    });

    return () => {
      // Decision 22E: stop this epoch from beginning new work immediately.
      // If its router cycle is already in flight, that cycle remains inside
      // this lock callback until it settles; abort only releases pending
      // lock acquisition or interruptible loop delay.
      cancelled = true;
      epochAbort.abort();
    };
  }, []);

  return state;
}
