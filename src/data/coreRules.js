export const coreRules = [
  "Structure decides. P&L emotion does not.",
  "Green is not an exit.",
  "Red is not invalidation.",
  "Structure is invalidation.",
  "A correct read is not automatically a setup.",
  "A valid setup is not automatically a trade.",
  "If I cannot tolerate the correct structural stop, I reduce size or pass.",
  "Do not enter as a swing and exit as a fear scalp.",
  "When fear rises, check structure before touching the exit.",
  "The setup earns attention. Stop, target, and plan decide permission.",
];

export const operatingModel = [
  {
    title: "Setup Is Not Permission",
    badge: "CORE",
    tone: "blue",
    body: "A setup is not a trade until it passes permission.",
  },
  {
    title: "Execution Chain",
    badge: "CORE",
    tone: "green",
    body: "The setup earns attention. The stop grants permission. The target justifies risk. The plan controls holding.",
  },
  {
    title: "Structure Is Invalidation",
    badge: "STOP",
    tone: "amber",
    body: "Green is not an exit. Red is not invalidation. Structure is invalidation.",
  },
  {
    title: "Fear Is A Pause Signal",
    badge: "FEAR",
    tone: "red",
    body: "When fear rises, do not exit first. Check structure first.",
  },
];

export const permissionGates = [
  {
    title: "Identity Gate",
    badge: "CLASSIFY",
    tone: "blue",
    question: "What is this trade?",
    check: "Scalp, structure trade, swing, or A+ exception is named before entry.",
  },
  {
    title: "Structure Gate",
    badge: "STOP",
    tone: "amber",
    question: "Where is invalidation?",
    check: "The price area that proves the thesis wrong is visible and accepted.",
  },
  {
    title: "Risk Gate",
    badge: "RISK",
    tone: "red",
    question: "Can I afford the correct structural stop?",
    check: "Size fits the stop. If not, reduce size or pass.",
  },
  {
    title: "Management Gate",
    badge: "EXIT",
    tone: "green",
    question: "How will I exit?",
    check: "Target, invalidation, and early-exit rules are written before entry.",
  },
];

export const noTradeUnless = [
  "Trade type is named before entry.",
  "Invalidation is visible and accepted.",
  "Target offers enough room for the stop.",
  "Management rules are known before entry.",
  "Size fits the structural stop.",
];

export const riskPermissionSummary = [
  { label: "Setup", value: "Earns attention", tone: "blue" },
  { label: "Stop", value: "Grants permission", tone: "amber" },
  { label: "Target", value: "Justifies risk", tone: "green" },
  { label: "Plan", value: "Controls holding", tone: "blue" },
];

export const supportRubrics = [
  { label: "Primary Operating Model", badge: "CORE", tone: "blue", value: "Structure governs action." },
  { label: "Four-Gate Trade Permission Model", badge: "RISK", tone: "amber", value: "Identity, structure, risk, and management must pass." },
  { label: "Management Contract", badge: "EXIT", tone: "green", value: "Hold and exit only by plan." },
  { label: "Fear-of-Exit Protocol", badge: "FEAR", tone: "red", value: "Pause, name fear, check invalidation." },
  { label: "Supporting Rubrics", badge: "REVIEW", tone: "neutral", value: "Risk tiers, exit permission, and review prompts." },
];
