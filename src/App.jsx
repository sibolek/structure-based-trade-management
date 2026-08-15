import ExecutionV2 from "./pages/ExecutionV2.jsx";

export default function App() {
  return (
    <>
      <div className="border-b border-amber-400/20 bg-amber-950/20 px-4 py-2 text-center text-xs font-semibold text-amber-100">
        Before any discretionary exit: Would I make this exact same exit if yesterday had been +$50 instead of -$50?
      </div>
      <ExecutionV2 />
    </>
  );
}
