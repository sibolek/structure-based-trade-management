import React, { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";

import useV24ExecutionRouter from "../../src/hooks/useV24ExecutionRouter.js";

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
