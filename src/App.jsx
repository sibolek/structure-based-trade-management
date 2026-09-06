import { useState } from "react";
import BrokerStatusPanel from "./components/BrokerStatusPanel.jsx";
import PreTradeWorkspace from "./components/PreTradeWorkspace.jsx";
import V24AuthorizedTradesBoard from "./components/V24AuthorizedTradesBoard.jsx";
import V24LiveExecutionBoard from "./components/V24LiveExecutionBoard.jsx";
import V24RouterHealthPanel from "./components/V24RouterHealthPanel.jsx";
import WorkspaceNav from "./components/WorkspaceNav.jsx";
import useBrokerState from "./hooks/useBrokerState.js";
import useExecutionOwnershipPublisher from "./hooks/useExecutionOwnershipPublisher.js";
import usePretradeState from "./hooks/usePretradeState.js";
import useV24ExecutionRouter from "./hooks/useV24ExecutionRouter.js";
import ExecutionV23 from "./pages/ExecutionV23.jsx";

export default function App() {
  const broker = useBrokerState();
  const pretrade = usePretradeState();
  useExecutionOwnershipPublisher({ pretrade });
  const v24Router = useV24ExecutionRouter({ broker, pretrade });
  const [workspace, setWorkspace] = useState("PRETRADE");

  return (
    <div className="min-h-screen bg-ink-950 text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-3 px-3 pt-4 md:px-5">
        <WorkspaceNav workspace={workspace} onChange={setWorkspace} broker={broker} pretrade={pretrade} />
        <BrokerStatusPanel broker={broker} />
      </div>

      <div className={workspace === "PRETRADE" ? "block" : "hidden"}>
        <div className="mx-auto max-w-7xl px-3 py-4 md:px-5">
          <PreTradeWorkspace pretrade={pretrade} broker={broker} />
        </div>
      </div>

      <div className={workspace === "EXECUTION" ? "block" : "hidden"}>
        <div className="mx-auto max-w-7xl space-y-3 px-3 pt-4 md:px-5">
          <V24RouterHealthPanel router={v24Router} />
          <V24AuthorizedTradesBoard broker={broker} v24Router={v24Router} />
          <V24LiveExecutionBoard />
        </div>
        <ExecutionV23 broker={broker} v24Router={v24Router} />
      </div>
    </div>
  );
}
