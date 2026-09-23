import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LivePreviewCard } from "/src/components/PreTradeWorkspace.jsx";
import { acceptPreviewAndObserve } from "/src/pretrade/pretrade-preview-client-state.js";
import "/src/styles.css";
import { OPERATOR_REVIEWED_IMPORT_SCOPE } from "/schwab-bridge/pretrade-preview-policy.mjs";

const preview = { previewId: "fixture-preview", operationId: "fixture-operation", state: "PREVIEW_READY", proposalHash: "fixture-hash", accountScope: "fixture-account", proposal: { symbol: "NVDA", direction: "LONG", setup: "Synthetic offline fixture", targets: [180], structuralInvalidation: { price: 176.5 } } };
preview.reviewScope = OPERATOR_REVIEWED_IMPORT_SCOPE;
const receipt = { operationId: preview.operationId, receiptId: "fixture-receipt", result: "ADMITTED", reviewScope: OPERATOR_REVIEWED_IMPORT_SCOPE };
function App() {
  const [observation, publish] = useState({ preview, operation: { operationId: preview.operationId, state: "UNSTARTED" } });
  const [busy, setBusy] = useState(null);
  const mode = new URLSearchParams(location.search).get("mode");
  const client = {
    async acceptPreview() {
      if (mode === "lost-post") throw new TypeError("simulated lost response");
      return receipt;
    },
    async previewStatus() { throw new TypeError("simulated status failure"); },
  };
  async function runFor(key, operation) {
    setBusy(key);
    try { await operation(); } catch { /* authoritative observation is preserved */ }
    finally { setBusy(null); }
  }
  const pretrade = {
    acceptPreview: value => acceptPreviewAndObserve(client, value, publish),
    previewOutcome: async operationId => {
      if (operationId !== preview.operationId) throw new Error("replacement operation forbidden");
      publish({ preview, receipt, operation: { operationId, state: "ADMITTED" }, lifecycle: { lifecycleState: "WAITING" } });
    },
    discardPreview: async () => publish({ preview: { ...preview, state: "DISCARDED" }, operation: { operationId: preview.operationId, state: "DISCARDED" } }),
    refreshPreview: async () => { throw new Error("not part of this response-recovery fixture"); },
  };
  return <LivePreviewCard previewState={observation} pretrade={pretrade} busyKey={busy} runFor={runFor} />;
}
createRoot(document.getElementById("root")).render(<App />);
