import { useState } from "react";
import BrokerStatusPanel from "./components/BrokerStatusPanel.jsx";
import PreTradeWaitingBoard from "./components/PreTradeWaitingBoard.jsx";
import WorkspaceNav from "./components/WorkspaceNav.jsx";
import useBrokerState from "./hooks/useBrokerState.js";
import usePretradeState from "./hooks/usePretradeState.js";
import useV24ExecutionRouter from "./hooks/useV24ExecutionRouter.js";
import ExecutionV23 from "./pages/ExecutionV23.jsx";

export default function App() {
  const broker = useBrokerState();
  const pretrade = usePretradeState();
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
          <PreTradeWaitingBoard pretrade={pretrade} />
        </div>
      </div>

      <div className={workspace === "EXECUTION" ? "block" : "hidden"}>
        <ExecutionV23 broker={broker} v24Router={v24Router} />
      </div>
    </div>
  );
}
