import BrokerStatusPanel from "./components/BrokerStatusPanel.jsx";
import ExecutionV21 from "./pages/ExecutionV21.jsx";

export default function App() {
  return (
    <div className="min-h-screen bg-ink-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-3 pt-4 md:px-5">
        <BrokerStatusPanel />
      </div>
      <ExecutionV21 />
    </div>
  );
}
