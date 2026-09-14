export function proposal(overrides = {}) {
  return {
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "VWAP_RECLAIM",
    setup: "PML sweep → VWAP reclaim → continuation",
    thesis: "Reclaim holds and buyers defend VWAP.",
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

export function normalizedRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceDate: "2026-09-10",
    generationMode: "INITIAL",
    charts: [
      {
        chartId: "nvda-5m",
        contentRef: "sod-chart:abc",
        symbol: "NVDA",
        timeframe: "5m",
        label: "NVDA 5m",
      },
    ],
    marketContext: null,
    priorSodRef: null,
    ...overrides,
  };
}

export function resolvedChart(overrides = {}) {
  return {
    chartId: "nvda-5m",
    contentRef: "sod-chart:abc",
    mediaType: "image/png",
    byteLength: 4,
    sha256: "abc",
    displayName: "nvda.png",
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    ...overrides,
  };
}

export function emptyBlock(type = "paragraph", blockText = "Context") {
  return {
    type,
    text: blockText,
    tone: type === "callout" ? "blue" : null,
    style: type === "list" ? "bullet" : null,
    listItems: type === "list" ? ["Item"] : [],
    columns: [],
    rows: [],
    metricItems: [],
  };
}

const SECTION_IDS = [
  "executive-summary",
  "execution-discipline",
  "macro-overnight-context",
  "scheduled-risk",
  "rates-volatility-commodities",
  "mes",
  "mnq",
  "market-regime-breadth",
  "semiconductors-primary-sector",
  "mega-cap-tech",
  "momentum-special-situations",
  "crude-oil-mcl",
  "key-levels",
  "validation-no-trade-zones",
  "a-plus-trades",
  "morning-priority",
  "earnings-risk-events",
  "risk-management",
  "opening-game-plan",
];

export function transportCandidate(overrides = {}) {
  return {
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "VWAP_RECLAIM",
    setup: "VWAP reclaim",
    decisionTimeframe: "5m",
    entryTimeframe: "2m",
    volatilityTimeframe: "2m",
    thesis: "Reclaim and hold with improving momentum.",
    plan: {
      bullCase: "Hold above VWAP.",
      bearCase: "Lose reclaim structure.",
      noTradeZone: "Mid-range chop.",
      bestLocation: "VWAP retest.",
    },
    trigger: {
      combination: "SINGLE",
      conditions: [{
        type: "QUOTE_COMPARISON",
        prompt: null,
        side: "LAST",
        operator: "GT",
        value: 180,
        timeframe: null,
        referenceLabel: "VWAP reclaim",
      }],
      persistence: { type: "CONDITION_HELD", timeframe: null },
    },
    structuralInvalidation: {
      price: 178.5,
      rule: "Break below reclaim low",
      referenceType: "SWING_LOW",
      reason: "Long thesis invalid",
      sourceTimeframe: "2m",
      referenceLabel: "reclaim low",
    },
    entryIntent: { mode: "BREAKOUT_PULLBACK" },
    plannedEntryReference: { label: "VWAP hold", price: 180 },
    entryConstraints: { summary: "Do not chase extension." },
    disqualifiers: ["Failed reclaim"],
    noTradeConditions: ["Mid-range chop"],
    targets: [
      { label: "T1", price: 181, reference: null },
      { label: "T2", price: 182, reference: null },
    ],
    managementContract: {
      mode: "SINGLE_ENTRY",
      allowReAdd: false,
      allowFlatReEntry: false,
    },
    bestLocation: "VWAP retest",
    context: "Bullish intraday structure",
    catalyst: "Relative strength",
    rating: "A+",
    morningPriority: 1,
    sourceProvenance: {
      chartIds: ["nvda-5m"],
      researchSourceUrls: ["https://example.com/vix"],
    },
    validity: {
      validFrom: "2026-09-10T13:30:00.000Z",
      validUntil: "2026-09-10T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

export function transportResult(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactContent: {
      hero: {
        kicker: "ExecutionOS • Start of Day",
        title: "Start of Day — 2026-09-10",
        snapshot: "Premarket snapshot",
        badges: [],
      },
      sections: SECTION_IDS.map((id) => ({
        id,
        title: id,
        blocks: [emptyBlock("paragraph", id === "rates-volatility-commodities" ? "VIX 18.2; volatility contained." : `${id} context`)],
      })),
      sources: [{ label: "VIX source", url: "https://example.com/vix", note: "Current-session context" }],
    },
    candidateProposals: [transportCandidate()],
    researchEvidence: [{
      category: "VIX",
      classification: "CURRENT_SESSION",
      label: "CBOE VIX",
      value: "18.2",
      asOf: "2026-09-10T13:15:00Z",
      sourceUrls: ["https://example.com/vix"],
    }],
    ...overrides,
  };
}

export function apiResponse(transport = transportResult(), overrides = {}) {
  return {
    id: "resp_test",
    status: "completed",
    model: "gpt-test",
    created_at: 1789045200,
    output: [
      {
        type: "web_search_call",
        action: { sources: [{ url: "https://example.com/vix" }] },
      },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(transport) }],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
    ...overrides,
  };
}
