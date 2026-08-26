import { useEffect, useState } from "react";

const DEFAULT_BROKER_URL = "http://127.0.0.1:8787";
const REFRESH_MS = 1000;

export default function useBrokerState() {
  const brokerUrl = String(import.meta.env.VITE_EXECUTIONOS_BROKER_URL || DEFAULT_BROKER_URL).replace(/\/$/, "");
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let timer;

    async function refresh() {
      try {
        const response = await fetch(`${brokerUrl}/api/state`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!active) return;
        setState(payload);
        setConnected(true);
        setError("");
      } catch (err) {
        if (!active) return;
        setConnected(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    refresh();
    timer = window.setInterval(refresh, REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [brokerUrl]);

  return { brokerUrl, state, connected, error };
}
