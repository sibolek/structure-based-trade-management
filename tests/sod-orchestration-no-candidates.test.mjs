import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareSodOrchestration,
  publishPreparedSodOrchestration,
  SOD_ORCHESTRATION_NO_CANDIDATES,
} from "../schwab-bridge/sod-orchestration-core.mjs";
import { sodArtifactContentFixture } from "./helpers/sod-artifact-content-fixture.mjs";

const request = {
  sourceDate: "2026-09-09",
  generationMode: "INITIAL",
  charts: [{
    chartId: "market-5m",
    contentRef: "chart-upload:market-5m",
    symbol: "SPY",
    timeframe: "5m",
  }],
};

const provider = {
  async generate() {
    return {
      candidateProposals: [],
      artifactContent: sodArtifactContentFixture({ sectionText: "No A+ candidates." }),
      generationMetadata: { provider: "test-double" },
    };
  },
};

test("valid SOD with zero A+ candidates renders report and performs no candidate publication", async () => {
  const prepared = await prepareSodOrchestration({
    provider,
    request,
    pretradeSnapshot: { candidates: [] },
    clock: () => "2026-09-09T15:00:00.000Z",
  });

  assert.equal(prepared.status, SOD_ORCHESTRATION_NO_CANDIDATES);
  assert.equal(prepared.bundle, null);
  assert.deepEqual(prepared.lineage, []);
  assert.deepEqual(prepared.publicationIntents, []);
  assert.equal(prepared.requiresPretradePreflight, false);
  assert.equal(prepared.analysis.rendererVersion, 1);
  assert.equal(prepared.analysis.report.markdown.includes("No A+ candidates"), true);
  assert.equal(prepared.analysis.dashboard.html.includes("No A+ long candidates"), true);

  await assert.rejects(
    publishPreparedSodOrchestration({ prepared, inboxPath: "/must/not/be/read" }),
    (error) => error.code === "SOD_ORCHESTRATION_NO_CANDIDATES",
  );
});
