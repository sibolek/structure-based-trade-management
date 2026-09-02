import { useEffect, useRef, useState } from "react";
import { getOrCreateExecutionBoardReceiverId } from "../execution/execution-board-receiver.js";
import { createV24HandoffTransport } from "../execution/execution-v24-handoff-transport.js";
import { runV24ExecutionRouterCycle } from "../execution/execution-v24-runtime-router.js";

const ROUTER_LOCK_NAME = "executionos-v24-runtime-router";
const LOOP_DELAY_MS = 500;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function errorText(error) {
  return error?.code || error?.message || String(error);
}

export default function useV24ExecutionRouter({ broker, pretrade } = {}) {
  const latest = useRef({ broker, pretrade });
  const proposedBoundaries = useRef(new Map());
  const [state, setState] = useState(() => ({
    status: "STARTING",
    receiverId: null,
    leader: false,
    lastCycleAt: null,
    lastResult: null,
    error: "",
    brokerWriteAuthority: false,
  }));

  latest.current = { broker, pretrade };

  useEffect(() => {
    let cancelled = false;
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

    const leaderPromise = lockManager.request(ROUTER_LOCK_NAME, { mode: "exclusive" }, async () => {
      if (cancelled) return;
      setState((current) => ({ ...current, status: "RUNNING", leader: true, error: "" }));

      while (!cancelled) {
        const current = latest.current;
        const brokerReady = Boolean(current?.broker?.connected && current?.broker?.state);
        const pretradeReady = Boolean(current?.pretrade?.connected && current?.pretrade?.pretradeUrl);

        if (!brokerReady || !pretradeReady) {
          setState((prior) => ({
            ...prior,
            status: "WAITING_FOR_SERVICES",
            leader: true,
            error: current?.broker?.error || current?.pretrade?.error || "",
          }));
          await delay(LOOP_DELAY_MS);
          continue;
        }

        try {
          const transport = createV24HandoffTransport({ pretradeUrl: current.pretrade.pretradeUrl });
          const result = await runV24ExecutionRouterCycle({
            transport,
            receiverId,
            brokerState: current.broker.state,
            proposedBoundaries: proposedBoundaries.current,
          });
          if (!cancelled) {
            setState({
              status: "RUNNING",
              receiverId,
              leader: true,
              lastCycleAt: result.processedAt,
              lastResult: result,
              error: "",
              brokerWriteAuthority: false,
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

        await delay(LOOP_DELAY_MS);
      }
    });

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
      cancelled = true;
      setState((current) => ({ ...current, leader: false }));
    };
  }, []);

  return state;
}
