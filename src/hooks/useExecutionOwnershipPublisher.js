import { useEffect, useState } from "react";
import { getOrCreateExecutionBoardReceiverId } from "../execution/execution-board-receiver.js";
import {
  EXECUTION_BOARD_STORE_KEY,
  readExecutionBoardStore,
} from "../execution/execution-board-store-repository.js";

const PUBLISH_INTERVAL_MS = 1000;
const SOURCE = "EXECUTION_CANONICAL_STORE";
const AUTHORITY = "EXECUTION_BOARD_STORE";

function errorText(error) {
  return error?.code || error?.message || String(error);
}

function publicationEnvelope(publisherId) {
  return {
    source: SOURCE,
    authority: AUTHORITY,
    storeKey: EXECUTION_BOARD_STORE_KEY,
    publisherId,
    // Browser time is provenance only. PRETRADE owns freshness from server receive time.
    publishedAt: new Date().toISOString(),
  };
}

export default function useExecutionOwnershipPublisher({ pretrade } = {}) {
  const [state, setState] = useState({
    status: "WAITING_FOR_PRETRADE",
    storeRevision: null,
    lastPublishedAt: null,
    error: "",
  });

  const client = pretrade?.client;
  const connected = pretrade?.connected === true;
  const refreshNow = pretrade?.refreshNow;

  useEffect(() => {
    if (!client || !connected) {
      setState((current) => ({ ...current, status: "WAITING_FOR_PRETRADE" }));
      return undefined;
    }

    let active = true;
    let timer = null;
    let publishing = false;
    let acknowledged = null;
    let publisherId;

    try {
      publisherId = getOrCreateExecutionBoardReceiverId();
    } catch (error) {
      setState({ status: "BLOCKED", storeRevision: null, lastPublishedAt: null, error: errorText(error) });
      return undefined;
    }

    async function publishSnapshot(store) {
      const response = await client.publishExecutionOwnership({
        ...publicationEnvelope(publisherId),
        kind: "SNAPSHOT",
        store,
      });
      const result = response?.result || {};
      acknowledged = {
        storeRevision: Number(result.storeRevision),
        storeHash: String(result.storeHash || ""),
      };
      return result;
    }

    async function heartbeat() {
      const response = await client.publishExecutionOwnership({
        ...publicationEnvelope(publisherId),
        kind: "HEARTBEAT",
        storeRevision: acknowledged.storeRevision,
        storeHash: acknowledged.storeHash,
      });
      return response?.result || {};
    }

    async function tick({ forceSnapshot = false } = {}) {
      if (!active || publishing) return;
      publishing = true;
      let publishedFullSnapshot = false;
      try {
        const store = readExecutionBoardStore();
        let result;
        if (forceSnapshot || !acknowledged || acknowledged.storeRevision !== Number(store.storeRevision)) {
          result = await publishSnapshot(store);
          publishedFullSnapshot = true;
        } else {
          try {
            result = await heartbeat();
          } catch (error) {
            if ([
              "EXECUTION_OWNERSHIP_SNAPSHOT_REQUIRED",
              "EXECUTION_OWNERSHIP_HEARTBEAT_MISMATCH",
              "EXECUTION_OWNERSHIP_STALE_REVISION",
            ].includes(error?.code)) {
              acknowledged = null;
              result = await publishSnapshot(store);
              publishedFullSnapshot = true;
            } else {
              throw error;
            }
          }
        }

        if (!active) return;
        setState({
          status: "CONNECTED",
          storeRevision: Number(result.storeRevision),
          lastPublishedAt: result.receivedAt || null,
          error: "",
        });

        // A full snapshot can change PRETRADE's ownership-connected health immediately.
        // Heartbeats do not force duplicate candidate/health polling every second.
        if (publishedFullSnapshot && typeof refreshNow === "function") {
          refreshNow().catch(() => {});
        }
      } catch (error) {
        if (!active) return;
        setState((current) => ({
          ...current,
          status: "ERROR",
          error: errorText(error),
        }));
      } finally {
        publishing = false;
      }
    }

    const publishOnFocus = () => tick({ forceSnapshot: true });
    const publishOnVisibility = () => {
      if (document.visibilityState === "visible") tick({ forceSnapshot: true });
    };

    tick({ forceSnapshot: true });
    timer = window.setInterval(() => tick(), PUBLISH_INTERVAL_MS);
    window.addEventListener("focus", publishOnFocus);
    document.addEventListener("visibilitychange", publishOnVisibility);

    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("focus", publishOnFocus);
      document.removeEventListener("visibilitychange", publishOnVisibility);
    };
  }, [client, connected, refreshNow]);

  return state;
}
