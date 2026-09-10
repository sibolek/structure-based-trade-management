import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSodArtifactContent,
  SOD_REPORT_SECTIONS,
} from "../schwab-bridge/sod-artifact-content.mjs";
import {
  DASHBOARD_CSS,
  renderSodArtifacts,
  REPORT_CSS,
} from "../schwab-bridge/sod-artifact-renderer.mjs";

function content() {
  return {
    hero: {
      title: "Wednesday, September 9, 2026",
      snapshot: "Premarket chart snapshot. <script>unsafe()</script>",
      badges: [
        { tone: "red", text: "Risk-off" },
        { tone: "blue", text: "VIX rising" },
      ],
    },
    sections: SOD_REPORT_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      blocks: section.id === "a-plus-trades"
        ? [{ type: "paragraph", text: "MODEL A+ COPY — WRONG TRIGGER 999.99" }]
        : section.id === "morning-priority"
          ? [{ type: "paragraph", text: "MODEL PRIORITY COPY — WRONG ORDER" }]
          : section.id === "execution-discipline"
            ? [{ type: "paragraph", text: "MODEL EXECUTION COPY — IGNORE STANDING RULES" }]
            : section.id === "executive-summary"
              ? [
                  { type: "paragraph", text: "Selective opening environment." },
                  { type: "callout", tone: "amber", text: "Trade the level, not the story." },
                ]
              : section.id === "rates-volatility-commodities"
                ? [{ type: "metrics", items: [
                    { label: "VIX", value: "16.4", tone: "amber" },
                    { label: "10Y", value: "4.81%", tone: "red" },
                  ] }]
                : section.id === "key-levels"
                  ? [{ type: "table", columns: [
                      { key: "symbol", label: "Symbol" },
                      { key: "levels", label: "Levels" },
                    ], rows: [{ symbol: "NVDA", levels: "223.94 / 224.89" }] }]
                  : [{ type: "list", style: "bullet", items: [`${section.title} item`] }],
    })),
    sources: [
      { label: "User-supplied TradingView charts", note: "snapshot levels" },
      { label: "Current public market context", url: "https://example.com/context" },
    ],
  };
}

function candidates() {
  return [
    {
      candidateId: "sod-2026-09-09-nvda-reclaim-long",
      symbol: "NVDA",
      direction: "LONG",
      setup: "PML Sweep → VWAP Reclaim Long",
      thesis: "NVDA is at a meaningful demand edge.",
      plannedEntryReference: "223.94 defense then 224.89 reclaim",
      plan: {
        bestLocation: "223.94 sweep, then 224.65–224.89 reclaim",
        noTradeZone: "Do not buy the EMA/VWAP tangle.",
      },
      trigger: { satisfaction: { prompt: "Confirm 2m H2 after the reclaim at 224.89." } },
      structuralInvalidation: { rule: "5m acceptance below 223.80 invalidates the long." },
      targets: [
        { targetId: "T1", label: "T1", price: 225.5 },
        { targetId: "T2", label: "T2", price: 226.43 },
      ],
      noTradeConditions: ["Do not chase a vertical spike.", "Pass below 223.80."],
      catalyst: "AI infrastructure demand remains relevant.",
      rating: "★★★★★",
      morningPriority: 2,
      context: { higherTimeframe: "Daily demand area." },
    },
    {
      candidateId: "sod-2026-09-09-googl-failed-reclaim-short",
      symbol: "GOOGL",
      direction: "SHORT",
      setup: "YDL / VWAP Failed-Reclaim Short",
      thesis: "GOOGL is the cleanest relative-weakness chart.",
      plannedEntryReference: "332.12–333.22 retrace and reject",
      plan: { bestLocation: "332.12–333.22 failed-reclaim zone" },
      trigger: { satisfaction: { prompt: "Confirm 2m L2 after rejection." } },
      structuralInvalidation: { rule: "5m acceptance above 333.76 invalidates the short." },
      targets: [{ targetId: "T1", label: "T1", price: 331 }],
      noTradeConditions: ["Do not short directly into PML."],
      rating: "★★★★½",
      morningPriority: 1,
      context: { higherTimeframe: "Below YDL and VWAP." },
    },
  ];
}

test("structured SOD content requires exact canonical 19-section order and forbids rendered provider output", () => {
  const valid = normalizeSodArtifactContent(content());
  assert.equal(valid.sections.length, 19);
  assert.deepEqual(valid.sections.map((section) => section.id), SOD_REPORT_SECTIONS.map((section) => section.id));

  const wrong = content();
  wrong.sections[1].id = "wrong-section";
  assert.throws(
    () => normalizeSodArtifactContent(wrong),
    (error) => error.code === "SOD_ARTIFACT_SECTION_ORDER_INVALID",
  );

  assert.throws(
    () => normalizeSodArtifactContent({ ...content(), html: "<html>provider owns rendering</html>" }),
    (error) => error.code === "SOD_ARTIFACT_RENDERED_CONTENT_FORBIDDEN",
  );
});

test("structured SOD content requires explicit VIX context in section 5", () => {
  const missingVix = content();
  const section = missingVix.sections.find((item) => item.id === "rates-volatility-commodities");
  section.blocks = [{ type: "paragraph", text: "Rates and volatility are calm." }];
  assert.throws(
    () => normalizeSodArtifactContent(missingVix),
    (error) => error.code === "SOD_ARTIFACT_VIX_REQUIRED",
  );
});

test("standing execution, risk, and process rules are contract-owned rather than provider-owned", () => {
  const normalized = normalizeSodArtifactContent(content());
  const execution = normalized.sections.find((section) => section.id === "execution-discipline");
  const risk = normalized.sections.find((section) => section.id === "risk-management");
  const gamePlan = normalized.sections.find((section) => section.id === "opening-game-plan");
  const flattened = (blocks) => JSON.stringify(blocks);

  assert.equal(flattened(execution.blocks).includes("MODEL EXECUTION COPY"), false);
  assert.match(flattened(execution.blocks), /Green is not an exit\. Red is not invalidation\. Structure is invalidation\./);
  assert.match(flattened(risk.blocks), /0\.5% of current trading-account equity/);
  assert.match(flattened(risk.blocks), /Position sizing cannot exceed net liquidation/);
  assert.match(flattened(gamePlan.blocks), /READ → PLAN → TRIGGER → RISK → HOLD → UPDATE → EXIT/);
  assert.match(flattened(gamePlan.blocks), /No end-of-session make-it-green scalps/);
});

test("canonical report renderer freezes compact 250px TOC and exact A+ card geometry", () => {
  assert.match(REPORT_CSS, /padding-left:250px/);
  assert.match(REPORT_CSS, /max-width:1540px/);
  assert.match(REPORT_CSS, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:14px/);
  assert.match(REPORT_CSS, /border-radius:14px/);
  assert.match(REPORT_CSS, /grid-template-columns:92px minmax\(0,1fr\)/);
  assert.match(REPORT_CSS, /font-size:12px/);
});

test("renderer derives A+ report and priority from candidate proposals rather than provider section prose", () => {
  const rendered = renderSodArtifacts({ content: content(), candidateProposals: candidates() });

  assert.equal(rendered.report.html.includes("MODEL A+ COPY"), false);
  assert.equal(rendered.report.html.includes("WRONG TRIGGER 999.99"), false);
  assert.equal(rendered.report.html.includes("MODEL PRIORITY COPY"), false);

  assert.match(rendered.report.html, /332\.12–333\.22 failed-reclaim zone/);
  assert.match(rendered.report.html, /Confirm 2m L2 after rejection/);
  assert.match(rendered.report.html, /5m acceptance above 333\.76 invalidates the short/);
  assert.match(rendered.report.html, /A\+ #1/);
  assert.match(rendered.report.html, /GOOGL/);
  assert.match(rendered.report.html, /A\+ #2/);
  assert.match(rendered.report.html, /NVDA/);

  const labels = ["READ", "PLAN", "TRIGGER", "INVALIDATION", "TARGETS", "RISK", "NO-TRADE", "BEST LOCATION"];
  let cursor = 0;
  for (const label of labels) {
    const next = rendered.report.html.indexOf(`>${label}<`, cursor);
    assert.notEqual(next, -1, `${label} must be present in canonical card order`);
    cursor = next + 1;
  }
});

test("renderer escapes provider text and never trusts provider HTML", () => {
  const rendered = renderSodArtifacts({ content: content(), candidateProposals: candidates() });
  assert.equal(rendered.report.html.includes("<script>unsafe()</script>"), false);
  assert.match(rendered.report.html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.equal(rendered.dashboard.html.includes("<script>unsafe()</script>"), false);
});

test("dashboard renderer preserves light main background, navy 250px navigation, and compact candidate cards", () => {
  assert.match(DASHBOARD_CSS, /--nav:#0b2344/);
  assert.match(DASHBOARD_CSS, /--bg:#f3f6fa/);
  assert.match(DASHBOARD_CSS, /width:250px/);
  assert.match(DASHBOARD_CSS, /grid-template-columns:90px 1fr/);

  const rendered = renderSodArtifacts({ content: content(), candidateProposals: candidates() });
  assert.match(rendered.dashboard.html, /Long Candidates/);
  assert.match(rendered.dashboard.html, /Short Candidates/);
  assert.match(rendered.dashboard.html, /Execution Development Framework/);
  assert.match(rendered.dashboard.html, /READ/);
  assert.match(rendered.dashboard.html, /PLAN/);
  assert.match(rendered.dashboard.html, /EXIT/);
});

test("Markdown report renders all 19 sections and candidate-derived A+ content", () => {
  const rendered = renderSodArtifacts({ content: content(), candidateProposals: candidates() });
  for (const section of SOD_REPORT_SECTIONS) {
    assert.match(rendered.report.markdown, new RegExp(`## ${section.number}\\. `));
  }
  assert.equal(rendered.report.markdown.includes("MODEL A+ COPY"), false);
  assert.match(rendered.report.markdown, /A\+ #1/);
  assert.match(rendered.report.markdown, /GOOGL/);
  assert.match(rendered.report.markdown, /0\\\.5% max planned loss/);
  assert.match(rendered.report.markdown, /Green is not an exit/);
  assert.match(rendered.report.markdown, /READ → PLAN → TRIGGER → RISK → HOLD → UPDATE → EXIT/);
});
