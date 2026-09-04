import React, { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";

import useV24ExecutionRouter from "../../src/hooks/useV24ExecutionRouter.js";
import {
  EXECUTION_BOARD_STORE_KEY,
  EXECUTION_BOARD_STORE_WRITER_LOCK_NAME,
  readExecutionBoardStore,
  subscribeExecutionBoardStore,
  transactExecutionBoardStoreSerialized,
} from "../../src/execution/execution-board-store-repository.js";

function RouterHarness() {
  const broker = useMemo(() => ({
    connected: true,
    error: "",
    state: {
      status: "ARMED",
      source: "PLAYWRIGHT_READ_ONLY_SYNTHETIC",
      readOnly: true,
      brokerWriteAuthority: false,
      accounts: [],
      positions: [],
      executionCoverage: {
        schemaVersion: 1,
        status: "CONTIGUOUS",
        source: "PLAYWRIGHT_READ_ONLY_SYNTHETIC",
        coverageStartedAt: "2026-09-03T00:00:00.000Z",
        baselineCompletedAt: "2026-09-03T00:00:00.000Z",
        currentThrough: "2026-09-03T23:59:59.999Z",
        lastGapAt: null,
        lastGapReason: null,
      },
      executionOwnershipJournal: {
        schemaVersion: 1,
        source: "PLAYWRIGHT_READ_ONLY_SYNTHETIC",
        coverageStartedAt: "2026-09-03T00:00:00.000Z",
        currentThrough: "2026-09-03T23:59:59.999Z",
        entries: [],
      },
    },
  }), []);

  const pretrade = useMemo(() => ({
    connected: false,
    error: "",
    pretradeUrl: null,
  }), []);

  const router = useV24ExecutionRouter({ broker, pretrade });

  useEffect(() => {
    window.__V24_ROUTER_STATE__ = router;
  }, [router]);

  useEffect(() => {
    let projection = readExecutionBoardStore();

    const unsubscribe = subscribeExecutionBoardStore({
      listener: (snapshot) => {
        projection = snapshot;
        window.__V24_STORE_PROJECTION__ = snapshot;
      },
    });

    window.__V24_STORE_PROJECTION__ = projection;

    window.__V24_STORE_TEST__ = {
      storeKey: EXECUTION_BOARD_STORE_KEY,
      writerLockName: EXECUTION_BOARD_STORE_WRITER_LOCK_NAME,

      read() {
        return readExecutionBoardStore();
      },

      projection() {
        return window.__V24_STORE_PROJECTION__;
      },

      async appendCandidate(candidateId) {
        return transactExecutionBoardStoreSerialized({
          mutate: (store) => ({
            ...store,
            candidates: [
              ...(Array.isArray(store.candidates) ? store.candidates : []),
              {
                id: String(candidateId),
                origin: "PLAYWRIGHT_CROSS_TAB",
              },
            ],
          }),
        });
      },

      dispatchUntrustedStorageNotification(fakeNewValue) {
        window.dispatchEvent(new StorageEvent("storage", {
          key: EXECUTION_BOARD_STORE_KEY,
          newValue: fakeNewValue,
          storageArea: localStorage,
          url: window.location.href,
        }));
      },
    };

    return () => {
      unsubscribe();
      delete window.__V24_STORE_TEST__;
    };
  }, []);

  return (
    <main>
      <div data-testid="status">{router.status}</div>
      <div data-testid="leader">{String(Boolean(router.leader))}</div>
      <div data-testid="receiver">{router.receiverId || ""}</div>
      <div data-testid="heartbeat">{router.lastHeartbeatAt || ""}</div>
      <div data-testid="broker-write-authority">
        {String(Boolean(router.brokerWriteAuthority))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<RouterHarness />);
