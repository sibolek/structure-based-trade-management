import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSodOrchestrationApiClient,
  DEFAULT_SOD_ORCHESTRATION_URL,
} from "../sod/sod-orchestration-api-client.js";

const REFRESH_MS = 2000;
const PENDING_RUN_KEY = "executionos-sod-pending-run-v1";
function savedRun() {
  try { return JSON.parse(localStorage.getItem(PENDING_RUN_KEY) || "null"); } catch { return null; }
}

function errorText(error) {
  return error?.code || error?.message || String(error);
}

export default function useSodOrchestration() {
  const sodUrl = String(import.meta.env.VITE_EXECUTIONOS_SOD_URL || DEFAULT_SOD_ORCHESTRATION_URL).replace(/\/$/, "");
  const client = useMemo(() => createSodOrchestrationApiClient({ baseUrl: sodUrl }), [sodUrl]);
  const [health, setHealth] = useState(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [charts, setCharts] = useState([]);
  const [pendingRun, setPendingRun] = useState(savedRun);
  const restoredRun = useRef(pendingRun);
  const runOperation = useRef(0);

  const refreshNow = useCallback(async () => {
    const nextHealth = await client.health();
    setHealth(nextHealth);
    setConnected(true);
    setError("");
    return nextHealth;
  }, [client]);

  const uploadFiles = useCallback(async (files) => {
    const selected = Array.from(files || []);
    if (!selected.length) return [];
    setUploading(true);
    setError("");
    try {
      const uploaded = [];
      for (const file of selected) {
        uploaded.push(await client.uploadChart(file));
      }
      setCharts((current) => [...current, ...uploaded]);
      setConnected(true);
      return uploaded;
    } catch (err) {
      setError(errorText(err));
      throw err;
    } finally {
      setUploading(false);
    }
  }, [client]);

  const removeChart = useCallback((contentRef) => {
    setCharts((current) => current.filter((chart) => chart.contentRef !== contentRef));
  }, []);

  const executeRun = useCallback(async (request) => {
    const operation = ++runOperation.current;
    setBusy(true);
    setError("");
    try {
      const result = await client.generate(request);
      if (operation !== runOperation.current) return result;
      setLastResult(result);
      setConnected(true);
      return result;
    } catch (err) {
      if (operation !== runOperation.current) throw err;
      setError(errorText(err));
      if (err.details?.runId || err.details?.activeRun) setLastResult(err.details.activeRun || err.details);
      throw err;
    } finally {
      if (operation === runOperation.current) { ++runOperation.current; setBusy(false); }
    }
  }, [client]);

  const generate = useCallback(async (request) => {
    const pending = { ...request, runId: globalThis.crypto.randomUUID() };
    // Save operator intent before delivery. This is recovery convenience, never run authority.
    localStorage.setItem(PENDING_RUN_KEY, JSON.stringify(pending));
    setPendingRun(pending);
    return executeRun(pending);
  }, [executeRun]);
  const inspectRun = useCallback(async (runId = pendingRun?.runId) => {
    if (!runId) return;
    const operation = runOperation.current;
    try { const result = await client.status(runId); if (operation === runOperation.current) setLastResult(result); return result; }
    catch (err) { if (operation !== runOperation.current) return; if (err.details?.runId) setLastResult(err.details); setError(errorText(err)); }
  }, [client, pendingRun]);
  const resumeRun = useCallback(() => pendingRun && executeRun(pendingRun), [pendingRun, executeRun]);
  const abandonRun = useCallback(async () => {
    ++runOperation.current;
    try { const result = await client.abandon(lastResult?.runId); setLastResult(result); setError(""); }
    catch (err) { setError(errorText(err)); }
  }, [client, lastResult]);
  useEffect(() => {
    const runId = restoredRun.current?.runId;
    if (!runId) return;
    const operation = runOperation.current;
    let active = true;
    client.status(runId).then(result => {
      if (active && operation === runOperation.current) setLastResult(result);
    }).catch(err => {
      if (active && operation === runOperation.current) setError(errorText(err));
    });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    let active = true;
    let timer;

    async function refresh() {
      try {
        const nextHealth = await client.health();
        if (!active) return;
        setHealth(nextHealth);
        setConnected(true);
      } catch (err) {
        if (!active) return;
        setConnected(false);
        setError(errorText(err));
      }
    }

    refresh();
    timer = window.setInterval(refresh, REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client]);

  return {
    sodUrl,
    health,
    connected,
    busy,
    uploading,
    error,
    lastResult,
    charts,
    client,
    refreshNow,
    uploadFiles,
    removeChart,
    clearCharts: () => setCharts([]),
    generate,
    pendingRun, inspectRun, resumeRun, abandonRun,
    clearResult: () => setLastResult(null),
  };
}
