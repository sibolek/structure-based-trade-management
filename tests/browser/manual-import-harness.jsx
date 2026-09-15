import React from "react";
import { createRoot } from "react-dom/client";
import SodWorkspace from "../../src/components/SodWorkspace.jsx";
import { createPretradeApiClient } from "../../src/pretrade/pretrade-api-client.js";
import "../../src/styles.css";
const client = createPretradeApiClient({ baseUrl: window.location.origin });
const pretrade = { connected: true, client, refreshNow: async () => ({}) };
const sod = { connected: !new URLSearchParams(window.location.search).has("sodOffline"), health: { providerConfigured: true, chartIngestion: "IMMUTABLE_OPAQUE_REF", brokerWriteAuthority: false }, charts: [{ chartId: "chart", contentRef: "chart-upload:fixture", displayName: "Fixture chart" }], generate: async () => { window.sodGenerated = true; } };
createRoot(document.getElementById("root")).render(<main className="mx-auto max-w-5xl p-5"><SodWorkspace sod={sod} pretrade={pretrade} onOpenPretrade={() => { window.openedPretrade = true; }} /></main>);
