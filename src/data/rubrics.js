export const riskTiers = [
  {
    tier: "R0",
    label: "No Trade",
    tone: "red",
    criteria: "Stop is unknown, unaffordable, or based on pain tolerance.",
    action: "Pass. Reclassify only if structure changes.",
  },
  {
    tier: "R1",
    label: "Tactical",
    tone: "blue",
    criteria: "Tight stop, fast target, low tolerance for hesitation.",
    action: "Use scalp rules. No swing behavior.",
  },
  {
    tier: "R2",
    label: "Standard",
    tone: "green",
    criteria: "Structural stop fits normal risk and target is sufficient.",
    action: "Trade normal size by plan.",
  },
  {
    tier: "R3",
    label: "Reduced",
    tone: "amber",
    criteria: "Correct stop is wider but thesis quality remains high.",
    action: "Reduce size. Hold by structure.",
  },
];

export const stopRules = {
  long: [
    "Stop belongs below the structure that must hold.",
    "A red print above invalidation is not failure.",
    "If entry is late, do not move stop closer to hide lateness.",
    "If the stop is too wide, reduce size or pass.",
  ],
  short: [
    "Stop belongs above the structure that must reject.",
    "A green print below invalidation is not failure.",
    "Do not exit because short profit pulls back unless structure flips.",
    "If the stop is too wide, reduce size or pass.",
  ],
};

export const exitRubric = [
  { state: "Target hit", allowed: "Yes", rule: "Take planned exit or execute planned runner logic." },
  { state: "Structure broken", allowed: "Yes", rule: "Exit. Thesis is invalidated." },
  { state: "Momentum slows", allowed: "Conditional", rule: "Exit only if scalp plan defined speed as required." },
  { state: "Open profit pulls back", allowed: "No", rule: "Check structure. Green giveback is not invalidation." },
  { state: "Position turns red", allowed: "No", rule: "Red is not invalidation. Stop structure decides." },
];
