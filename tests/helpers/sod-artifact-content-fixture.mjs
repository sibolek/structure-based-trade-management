import { SOD_REPORT_SECTIONS } from "../../schwab-bridge/sod-artifact-content.mjs";

export function sodArtifactContentFixture({
  title = "Wednesday, September 9, 2026",
  snapshot = "Test chart snapshot. Technical levels are snapshot references.",
  sectionText = "Test SOD content.",
} = {}) {
  return {
    hero: {
      kicker: "ExecutionOS • Start of Day",
      title,
      snapshot,
      badges: [{ tone: "blue", text: "TEST FIXTURE" }],
    },
    sections: SOD_REPORT_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      blocks: section.id === "rates-volatility-commodities"
        ? [
            { type: "paragraph", text: `${section.title}: ${sectionText}` },
            { type: "metrics", items: [{ label: "VIX", value: "16.4", tone: "amber" }] },
          ]
        : [{ type: "paragraph", text: `${section.title}: ${sectionText}` }],
    })),
    sources: [{ label: "Test source", note: "deterministic fixture" }],
  };
}
