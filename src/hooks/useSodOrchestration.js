import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSodOrchestrationApiClient,
  DEFAULT_SOD_ORCHESTRATION_URL,
} from "../sod/sod-orchestration-api-client.js";

const REFRESH_MS = 2000;

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

  const generate = useCallback(async (request) => {
    setBusy(true);
    setError("");
    try {
      const result = await client.generate(request);
      setLastResult(result);
      setConnected(true);
      return result;
    } catch (err) {
      setError(errorText(err));
      throw err;
    } finally {
      setBusy(false);
    }
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
        setError("");
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
    clearResult: () => setLastResult(null),
  };
}
