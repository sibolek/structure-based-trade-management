import { useEffect, useRef, useState } from "react";
import { getOrCreateExecutionBoardReceiverId } from "../execution/execution-board-receiver.js";
import { createV24HandoffTransport } from "../execution/execution-v24-handoff-transport.js";
import { runV24ExecutionRouterCycle } from "../execution/execution-v24-runtime-router.js";

const ROUTER_LOCK_NAME = "executionos-v24-runtime-router";
const LOOP_DELAY_MS = 500;
const ROUTER_ENABLED = String(import.meta.env.VITE_EXECUTIONOS_V24_ROUTER_ENABLED || "false").toLowerCase() === "true";

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
    status: ROUTER_ENABLED ? "STARTING" : "DISABLED_PENDING_ACCEPTANCE",
    receiverId: null,
    leader: false,
    lastCycleAt: null,
    lastResult: null,
    error: "",
    brokerWriteAuthority: false,
    enabled: ROUTER_ENABLED,
  }));

  latest.current = { broker, pretrade };

  useEffect(() => {
    if (!ROUTER_ENABLED) return undefined;

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
      setState((current) => ({ ...current, status: "RUNNING", leader: true, error: "" }));

      while (!cancelled) {
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
          await delay(LOOP_DELAY_MS, epochAbort.signal);
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

          const transportFailure = result.results.find(
            (item) => item.stage === "TRANSPORT" && item.status === "ERROR",
          );
          const transportWaiting = result.results.find(
            (item) => item.stage === "TRANSPORT" && item.status === "WAITING_FOR_PRETRADE",
          );

          let status = "RUNNING";
          let stateError = "";

          if (transportFailure) {
            status = "ERROR";
            stateError = transportFailure.reason || current?.pretrade?.error || "PRETRADE_TRANSPORT_ERROR";
          } else if (!pretradeReady || transportWaiting) {
            status = "WAITING_FOR_PRETRADE";
            stateError = current?.pretrade?.error || transportWaiting?.reason || "";
          }

          if (!cancelled) {
            setState({
              status,
              receiverId,
              leader: true,
              lastCycleAt: result.processedAt,
              lastResult: result,
              error: stateError,
              brokerWriteAuthority: false,
              enabled: true,
            });
          }
        } catch (error) {
          if (!cancelled) {
            setState((prior) => ({
              ...prior,
              status: "ERROR",
              leader: true,
              error: errorText(error),
              lastCycleAt: new Date().toISOString(),
            }));
          }
        }

        await delay(LOOP_DELAY_MS, epochAbort.signal);
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
