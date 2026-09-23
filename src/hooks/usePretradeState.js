import { acceptPreviewAndObserve, mergePreviewObservation } from "../pretrade/pretrade-preview-client-state.js";
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
  const [previewState, setPreviewState] = useState(null);

  const refreshPreviews = useCallback(async (healthSnapshot) => {
    if (
      healthSnapshot?.pretradePreview?.enabled !== true
      && healthSnapshot?.pretradePreview?.outcomeLookupAvailable !== true
    ) {
      setPreviewState((prior) => prior?.outcomeUnknown || prior?.receipt ? prior : null);
      return null;
    }
    const result = await client.listPreviews();
    const previews = Array.isArray(result?.previews) ? result.previews : [];
    const latest = previews.at(-1) ?? null;
    setPreviewState((prior) => {
      const unresolvedOperationId = prior?.outcomeUnknown || prior?.receipt
        ? prior?.operation?.operationId || prior?.preview?.operationId || prior?.operationId
        : null;
      if (!unresolvedOperationId) return latest;
      const exact = previews.find((item) => (
        item?.operation?.operationId === unresolvedOperationId
        || item?.preview?.operationId === unresolvedOperationId
      ));
      if (!exact) return prior;
      return mergePreviewObservation(prior, exact);
    });
    return latest;
  }, [client]);

  const refreshNow = useCallback(async () => {
    const [snapshot, healthSnapshot] = await Promise.all([
      client.snapshot(),
      client.health(),
    ]);
    setState(snapshot);
    setHealth(healthSnapshot);
    await refreshPreviews(healthSnapshot);
    setConnected(true);
    setError("");
    return { state: snapshot, health: healthSnapshot };
  }, [client, refreshPreviews]);

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
        await refreshPreviews(healthSnapshot);
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
  }, [client, refreshPreviews]);

  const acceptPreview = useCallback((preview) => (
    acceptPreviewAndObserve(client, preview, setPreviewState)
  ), [client]);

  const discardPreview = useCallback(async (previewId, operationId) => {
    await client.discardPreview(previewId, operationId);
    const status = await client.previewStatus(previewId);
    setPreviewState(status);
    return status;
  }, [client]);

  const previewOutcome = useCallback(async (operationId) => {
    const status = await client.previewOutcome(operationId);
    setPreviewState((prior) => mergePreviewObservation(prior, status));
    return status;
  }, [client]);

  const refreshPreview = useCallback(async (previewId, operationId) => {
    const replacement = await client.refreshPreview(previewId, operationId);
    const status = await client.previewStatus(replacement.previewId);
    setPreviewState(status);
    return status;
  }, [client]);

  return {
    pretradeUrl,
    state,
    health,
    connected,
    error,
    client,
    refreshNow,
    previewState,
    acceptPreview,
    discardPreview,
    previewOutcome,
    refreshPreview,
  };
}
