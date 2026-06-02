import { useMemo, useState } from "react";
import Shell from "./components/Shell.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import FrontPageRules from "./pages/FrontPageRules.jsx";
import TradeClassification from "./pages/TradeClassification.jsx";
import StructuralStops from "./pages/StructuralStops.jsx";
import RiskPermission from "./pages/RiskPermission.jsx";
import WinnerManagement from "./pages/WinnerManagement.jsx";
import FearOfExit from "./pages/FearOfExit.jsx";
import PracticeDrills from "./pages/PracticeDrills.jsx";
import ReferencePage from "./pages/ReferencePage.jsx";
import TradeReview from "./pages/TradeReview.jsx";

function TradeZellaNote() {
  return <ReferencePage type="tradezella" />;
}

function RubricsPage() {
  return <ReferencePage type="rubrics" />;
}

function CaseStudiesPage() {
  return <ReferencePage type="cases" />;
}

const pageGroups = [
  {
    section: "Command",
    items: [{ id: "dashboard", label: "Command Center", component: Dashboard }],
  },
  {
    section: "Before Entry",
    items: [
      { id: "classification", label: "Trade Identity", component: TradeClassification },
      { id: "rules", label: "Permission Gate", component: FrontPageRules },
      { id: "risk", label: "Risk Permission", component: RiskPermission },
    ],
  },
  {
    section: "During Trade",
    items: [
      { id: "winners", label: "Winner Management", component: WinnerManagement },
      { id: "fear", label: "Exit Protocol", component: FearOfExit },
      { id: "stops", label: "Stop Movement", component: StructuralStops },
    ],
  },
  {
    section: "After Trade",
    items: [
      { id: "review", label: "Execution Review", component: TradeReview },
      { id: "tradezella", label: "TradeZella Note", component: TradeZellaNote },
    ],
  },
  {
    section: "Reference",
    items: [
      { id: "rubrics", label: "Rubrics", component: RubricsPage },
      { id: "cases", label: "Case Studies", component: CaseStudiesPage },
      { id: "drills", label: "Practice Drills", component: PracticeDrills },
    ],
  },
];

export default function App() {
  const [activeId, setActiveId] = useState("dashboard");
  const flatPages = useMemo(() => pageGroups.flatMap((group) => group.items), []);
  const activePage = useMemo(
    () => flatPages.find((page) => page.id === activeId) ?? flatPages[0],
    [activeId, flatPages],
  );
  const ActiveComponent = activePage.component;

  return (
    <Shell pages={pageGroups} activeId={activeId} onSelect={setActiveId}>
      <ActiveComponent />
    </Shell>
  );
}
