import BrokerStatusPanel from "./components/BrokerStatusPanel.jsx";
import useBrokerState from "./hooks/useBrokerState.js";
import ExecutionV23 from "./pages/ExecutionV23.jsx";

export default function App() {
  const broker = useBrokerState();

  return (
    <div className="min-h-screen bg-ink-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 pt-4 md:px-5">
        <BrokerStatusPanel broker={broker} />
      </div>
      <ExecutionV23 broker={broker} />
    </div>
  );
}
