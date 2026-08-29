import { useEffect, useState } from "react";

const DEFAULT_PRETRADE_URL = "http://127.0.0.1:8788";
const REFRESH_MS = 1000;

export default function usePretradeState() {
  const pretradeUrl = String(import.meta.env.VITE_EXECUTIONOS_PRETRADE_URL || DEFAULT_PRETRADE_URL).replace(/\/$/, "");
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let timer;

    async function refresh() {
      try {
        const response = await fetch(`${pretradeUrl}/api/candidates`, { cache: "no-store" });
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
  }, [pretradeUrl]);

  return { pretradeUrl, state, connected, error };
}
