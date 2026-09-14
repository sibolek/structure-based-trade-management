import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import SodWorkspace from "../../src/components/SodWorkspace.jsx";
import useSodOrchestration from "../../src/hooks/useSodOrchestration.js";
import "../../src/styles.css";

function Harness() {
  const sod = useSodOrchestration();
  const [visible, setVisible] = useState(true);
  return <main><button onClick={() => setVisible(!visible)}>Toggle workspace</button>
    <div className={visible ? "block" : "hidden"}>
      <SodWorkspace sod={sod} pretrade={{ connected: false }} onOpenPretrade={() => {}} />
    </div>
  </main>;
}
createRoot(document.getElementById("root")).render(<Harness />);
