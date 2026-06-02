export const examples = [
  {
    title: "Underheld Winner",
    problem: "Exited on first pullback after entry moved green.",
    correction: "Hold until target, invalidation, or planned scale rule.",
  },
  {
    title: "Targetless Green Exit",
    problem: "Took profit because green felt fragile.",
    correction: "No trade without structural target. No exit without exit rule.",
  },
  {
    title: "Structural Stop Too Expensive",
    problem: "Entered with a fake tight stop because correct stop felt too large.",
    correction: "Reduce size or pass. Never solve risk by corrupting invalidation.",
  },
  {
    title: "Late Entry Scratch",
    problem: "Chased entry, then scratched because stop distance felt wrong.",
    correction: "Late entry changes permission. It does not change structure.",
  },
];
