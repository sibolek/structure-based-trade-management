import { SOD_REPORT_SECTIONS } from "./sod-artifact-content.mjs";

// Manual-package compatibility only. This may repair presentation/report-shape
// aliases, but it must never rewrite candidate proposals or confer trade authority.
const SECTION_ID_ALIASES = Object.freeze({
  "macro-context": "macro-overnight-context",
  "market-regime": "market-regime-breadth",
  semiconductors: "semiconductors-primary-sector",
  "software-ai": "mega-cap-tech",
  "momentum-special": "momentum-special-situations",
  "crude-oil": "crude-oil-mcl",
});

function text(value) {
  return String(value ?? "").trim();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalizeBlock(block) {
  if (!isObject(block)) return structuredClone(block);
  const result = structuredClone(block);
  const type = text(result.type).toLowerCase();

  if (type === "bullets") {
    result.type = "list";
    result.style = text(result.style).toLowerCase() || "bullet";
    if (!Array.isArray(result.items) && Array.isArray(result.listItems)) result.items = result.listItems;
  } else if (type === "list") {
    if (!Array.isArray(result.items) && Array.isArray(result.listItems)) result.items = result.listItems;
  } else if (type === "metrics") {
    if (!Array.isArray(result.items) && Array.isArray(result.metricItems)) result.items = result.metricItems;
  }

  return result;
}

export function canonicalizeManualSodArtifactContent(input) {
  if (!isObject(input)) return structuredClone(input);
  const content = structuredClone(input);
  if (!Array.isArray(content.sections)) return content;

  content.sections = content.sections.map((section, index) => {
    if (!isObject(section)) return section;
    const expected = SOD_REPORT_SECTIONS[index];
    const actualId = text(section.id);
    const aliasedId = SECTION_ID_ALIASES[actualId] ?? actualId;

    // Repair only a known alias when it resolves to the canonical section
    // expected at this exact position. Reordered/unknown sections remain invalid
    // and are rejected by the strict renderer contract.
    if (expected && aliasedId === expected.id) section.id = expected.id;
    if (Array.isArray(section.blocks)) section.blocks = section.blocks.map(canonicalizeBlock);
    return section;
  });

  return content;
}
