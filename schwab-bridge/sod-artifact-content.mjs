export const SOD_ARTIFACT_CONTENT_SCHEMA_VERSION = 1;

export const SOD_REPORT_SECTIONS = Object.freeze([
  Object.freeze({ id: "executive-summary", number: 1, title: "Executive Summary" }),
  Object.freeze({ id: "execution-discipline", number: 2, title: "Execution Discipline" }),
  Object.freeze({ id: "macro-overnight-context", number: 3, title: "Macro / Overnight Context" }),
  Object.freeze({ id: "scheduled-risk", number: 4, title: "Today’s Scheduled Risk" }),
  Object.freeze({ id: "rates-volatility-commodities", number: 5, title: "Rates, Volatility & Commodities" }),
  Object.freeze({ id: "mes", number: 6, title: "MES" }),
  Object.freeze({ id: "mnq", number: 7, title: "MNQ" }),
  Object.freeze({ id: "market-regime-breadth", number: 8, title: "Market Regime / Breadth" }),
  Object.freeze({ id: "semiconductors-primary-sector", number: 9, title: "Semiconductors / Primary Sector Focus" }),
  Object.freeze({ id: "mega-cap-tech", number: 10, title: "Mega-Cap Tech" }),
  Object.freeze({ id: "momentum-special-situations", number: 11, title: "Momentum / Special Situations" }),
  Object.freeze({ id: "crude-oil-mcl", number: 12, title: "Crude Oil / MCL" }),
  Object.freeze({ id: "key-levels", number: 13, title: "Key Levels" }),
  Object.freeze({ id: "validation-no-trade-zones", number: 14, title: "Validation Map / No-Trade Zones" }),
  Object.freeze({ id: "a-plus-trades", number: 15, title: "A+ Trades" }),
  Object.freeze({ id: "morning-priority", number: 16, title: "Morning Priority" }),
  Object.freeze({ id: "earnings-risk-events", number: 17, title: "Earnings / Risk Events" }),
  Object.freeze({ id: "risk-management", number: 18, title: "Risk Management" }),
  Object.freeze({ id: "opening-game-plan", number: 19, title: "Opening Game Plan / Process Goals" }),
]);

const TONES = new Set(["neutral", "green", "red", "amber", "blue"]);
const BLOCK_TYPES = new Set(["paragraph", "callout", "list", "table", "metrics"]);
const LIST_STYLES = new Set(["bullet", "numbered"]);

const EXECUTION_DISCIPLINE_BLOCKS = Object.freeze([
  Object.freeze({ type: "paragraph", text: "Capital preservation happens before entry." }),
  Object.freeze({ type: "paragraph", text: "Green is not an exit. Red is not invalidation. Structure is invalidation." }),
  Object.freeze({ type: "paragraph", text: "P/L-blind exit check: If I could not see my P/L, would I still exit this chart right now?" }),
  Object.freeze({ type: "callout", tone: "blue", text: "A red day is acceptable. Two consecutive red days are allowed. The daily objective is a green process day; do not lower the quality threshold after a loser." }),
]);

const RISK_MANAGEMENT_BLOCKS = Object.freeze([
  Object.freeze({ type: "paragraph", text: "Maximum planned loss per trade = 0.5% of current trading-account equity." }),
  Object.freeze({ type: "list", style: "bullet", items: Object.freeze([
    "Size from the structural/effective stop.",
    "Do not tighten a correct stop merely to fit the risk budget; reduce size or pass.",
    "Position sizing cannot exceed net liquidation.",
    "Maximum two instruments live at once unless explicitly changed.",
    "Treat correlated positions as one directional risk cluster rather than unrelated trades.",
    "If the minimum valid size cannot fit the 0.5% risk budget, PASS.",
  ]) }),
  Object.freeze({ type: "callout", tone: "blue", text: "Freeze the plan before entry. Do not change the plan mid-bar unless structural invalidation actually prints." }),
]);

const PROCESS_GOAL_BLOCKS = Object.freeze([
  Object.freeze({ type: "paragraph", text: "Primary execution sequence: READ → PLAN → TRIGGER → RISK → HOLD → UPDATE → EXIT." }),
  Object.freeze({ type: "list", style: "numbered", items: Object.freeze([
    "One fully structurally managed trade.",
    "P/L-blind first 10 minutes.",
    "Reduce size—not the stop.",
    "Max 2 instruments live.",
    "No end-of-session make-it-green scalps.",
  ]) }),
  Object.freeze({ type: "callout", tone: "green", text: "Daily objective: a green process day. A correct read is not automatically a setup; a valid setup is not automatically a trade." }),
]);

function text(value) {
  return String(value ?? "").trim();
}

function artifactError(message, code = "SOD_ARTIFACT_CONTENT_INVALID", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeTone(value, fallback = "neutral") {
  const tone = text(value).toLowerCase() || fallback;
  if (!TONES.has(tone)) {
    throw artifactError(`Unsupported SOD artifact tone ${tone}`, "SOD_ARTIFACT_TONE_INVALID");
  }
  return tone;
}

function normalizeBadge(badge, index) {
  if (!badge || typeof badge !== "object" || Array.isArray(badge)) {
    throw artifactError(`SOD hero badge ${index} must be an object`);
  }
  const value = text(badge.text);
  if (!value) throw artifactError(`SOD hero badge ${index} requires text`);
  return { tone: normalizeTone(badge.tone), text: value };
}

function normalizeParagraph(block) {
  const value = text(block.text);
  if (!value) throw artifactError("SOD paragraph block requires text");
  return { type: "paragraph", text: value };
}

function normalizeCallout(block) {
  const value = text(block.text);
  if (!value) throw artifactError("SOD callout block requires text");
  return { type: "callout", tone: normalizeTone(block.tone, "blue"), text: value };
}

function normalizeList(block) {
  const style = text(block.style).toLowerCase() || "bullet";
  if (!LIST_STYLES.has(style)) throw artifactError(`Unsupported SOD list style ${style}`);
  if (!Array.isArray(block.items) || block.items.length === 0) {
    throw artifactError("SOD list block requires at least one item");
  }
  const items = block.items.map((item, index) => {
    const value = text(item);
    if (!value) throw artifactError(`SOD list item ${index} is empty`);
    return value;
  });
  return { type: "list", style, items };
}

function normalizeTable(block) {
  if (!Array.isArray(block.columns) || block.columns.length === 0) {
    throw artifactError("SOD table block requires columns");
  }
  const seen = new Set();
  const columns = block.columns.map((column, index) => {
    if (!column || typeof column !== "object" || Array.isArray(column)) {
      throw artifactError(`SOD table column ${index} must be an object`);
    }
    const key = text(column.key);
    const label = text(column.label);
    if (!key || !label || seen.has(key)) throw artifactError(`SOD table column ${index} is invalid`);
    seen.add(key);
    return { key, label };
  });
  if (!Array.isArray(block.rows)) throw artifactError("SOD table block requires rows array");
  const rows = block.rows.map((row, rowIndex) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw artifactError(`SOD table row ${rowIndex} must be an object`);
    }
    const normalized = {};
    for (const column of columns) normalized[column.key] = text(row[column.key]);
    return normalized;
  });
  return { type: "table", columns, rows };
}

function normalizeMetrics(block) {
  if (!Array.isArray(block.items) || block.items.length === 0) {
    throw artifactError("SOD metrics block requires items");
  }
  return {
    type: "metrics",
    items: block.items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw artifactError(`SOD metric ${index} must be an object`);
      }
      const label = text(item.label);
      const value = text(item.value);
      if (!label || !value) throw artifactError(`SOD metric ${index} requires label and value`);
      return { label, value, tone: normalizeTone(item.tone) };
    }),
  };
}

function normalizeBlock(block, index, sectionId) {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    throw artifactError(`SOD block ${index} in ${sectionId} must be an object`);
  }
  const type = text(block.type).toLowerCase();
  if (!BLOCK_TYPES.has(type)) throw artifactError(`Unsupported SOD block type ${type || "(empty)"}`);
  if (type === "paragraph") return normalizeParagraph(block);
  if (type === "callout") return normalizeCallout(block);
  if (type === "list") return normalizeList(block);
  if (type === "table") return normalizeTable(block);
  return normalizeMetrics(block);
}

function clonedCanonicalBlocks(blocks) {
  return blocks.map((block) => structuredClone(block));
}

function applyCanonicalSectionPolicy(sectionId, providerBlocks) {
  if (sectionId === "execution-discipline") return clonedCanonicalBlocks(EXECUTION_DISCIPLINE_BLOCKS);
  if (sectionId === "risk-management") {
    return [...clonedCanonicalBlocks(RISK_MANAGEMENT_BLOCKS), ...providerBlocks];
  }
  if (sectionId === "opening-game-plan") {
    return [...providerBlocks, ...clonedCanonicalBlocks(PROCESS_GOAL_BLOCKS)];
  }
  return providerBlocks;
}

function normalizeSection(section, expected, index) {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    throw artifactError(`SOD section ${index + 1} must be an object`);
  }
  if (text(section.id) !== expected.id) {
    throw artifactError(
      `SOD section ${index + 1} must be ${expected.id}`,
      "SOD_ARTIFACT_SECTION_ORDER_INVALID",
      { expected: expected.id, actual: text(section.id) || null },
    );
  }
  const title = text(section.title) || expected.title;
  const providerBlocks = Array.isArray(section.blocks)
    ? section.blocks.map((block, blockIndex) => normalizeBlock(block, blockIndex, expected.id))
    : [];
  const blocks = applyCanonicalSectionPolicy(expected.id, providerBlocks);
  return { id: expected.id, number: expected.number, title, blocks };
}

function normalizeSource(source, index) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw artifactError(`SOD source ${index} must be an object`);
  }
  const label = text(source.label);
  if (!label) throw artifactError(`SOD source ${index} requires label`);
  return {
    label,
    url: text(source.url) || null,
    note: text(source.note) || null,
  };
}

function searchableBlockText(block) {
  if (block.type === "paragraph" || block.type === "callout") return block.text;
  if (block.type === "list") return block.items.join(" ");
  if (block.type === "metrics") return block.items.map((item) => `${item.label} ${item.value}`).join(" ");
  if (block.type === "table") {
    return [
      ...block.columns.map((column) => column.label),
      ...block.rows.flatMap((row) => block.columns.map((column) => row[column.key])),
    ].join(" ");
  }
  return "";
}

function assertMandatoryVixContext(sections) {
  const section = sections.find((item) => item.id === "rates-volatility-commodities");
  const searchable = (section?.blocks || []).map(searchableBlockText).join(" ");
  if (!/\bVIX\b/i.test(searchable)) {
    throw artifactError(
      "SOD Rates, Volatility & Commodities section must include current VIX context",
      "SOD_ARTIFACT_VIX_REQUIRED",
    );
  }
}

export function normalizeSodArtifactContent(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw artifactError("SOD artifact content must be an object");
  }
  if (input.html !== undefined || input.markdown !== undefined || input.css !== undefined) {
    throw artifactError(
      "SOD provider content may not supply rendered HTML, Markdown, or CSS",
      "SOD_ARTIFACT_RENDERED_CONTENT_FORBIDDEN",
    );
  }

  const hero = input.hero && typeof input.hero === "object" && !Array.isArray(input.hero) ? input.hero : {};
  const title = text(hero.title);
  const snapshot = text(hero.snapshot);
  if (!title || !snapshot) throw artifactError("SOD artifact hero requires title and snapshot");

  if (!Array.isArray(input.sections) || input.sections.length !== SOD_REPORT_SECTIONS.length) {
    throw artifactError(
      `SOD artifact content requires exactly ${SOD_REPORT_SECTIONS.length} report sections`,
      "SOD_ARTIFACT_SECTION_COUNT_INVALID",
    );
  }

  const sections = input.sections.map((section, index) => normalizeSection(section, SOD_REPORT_SECTIONS[index], index));
  assertMandatoryVixContext(sections);

  return {
    schemaVersion: SOD_ARTIFACT_CONTENT_SCHEMA_VERSION,
    hero: {
      kicker: text(hero.kicker) || "ExecutionOS • Start of Day",
      title,
      snapshot,
      badges: Array.isArray(hero.badges) ? hero.badges.map(normalizeBadge) : [],
    },
    sections,
    sources: Array.isArray(input.sources) ? input.sources.map(normalizeSource) : [],
  };
}
