import { useCallback, useEffect, useMemo, useState } from "react";
import { createPretradeApiClient } from "../pretrade/pretrade-api-client.js";

const DEFAULT_PRETRADE_URL = "http://127.0.0.1:8788";
const REFRESH_MS = 1000;

function errorText(error) {
  return error?.code || error?.message || String(error);
}

export default function usePretradeState() {
  const pretradeUrl = String(import.meta.env.VITE_EXECUTIONOS_PRETRADE_URL || DEFAULT_PRETRADE_URL).replace(/\/$/, "");
  const client = useMemo(() => createPretradeApiClient({ baseUrl: pretradeUrl }), [pretradeUrl]);
  const [state, setState] = useState(null);
  const [health, setHealth] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  const refreshNow = useCallback(async () => {
    const [snapshot, healthSnapshot] = await Promise.all([
      client.snapshot(),
      client.health(),
    ]);
    setState(snapshot);
    setHealth(healthSnapshot);
    setConnected(true);
    setError("");
    return { state: snapshot, health: healthSnapshot };
  }, [client]);

  useEffect(() => {
    let active = true;
    let timer;

    async function refresh() {
      try {
        const [snapshot, healthSnapshot] = await Promise.all([
          client.snapshot(),
          client.health(),
        ]);
        if (!active) return;
        setState(snapshot);
        setHealth(healthSnapshot);
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
    pretradeUrl,
    state,
    health,
    connected,
    error,
    client,
    refreshNow,
  };
}
