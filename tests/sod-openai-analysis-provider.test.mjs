import assert from "node:assert/strict";
import test from "node:test";

import {
  assignDeterministicSodCandidateIds,
  buildDeterministicSodCandidateId,
} from "../schwab-bridge/sod-openai-analysis-provider.mjs";
import { normalizeSodAnalysisResult } from "../schwab-bridge/sod-analysis-provider.mjs";

function proposal(overrides = {}) {
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

test("deterministic candidate identity is stable across free-form setup wording changes", () => {
  const first = buildDeterministicSodCandidateId({
    sourceDate: "2026-09-10",
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "VWAP_RECLAIM",
  });
  const second = assignDeterministicSodCandidateIds({
    sourceDate: "2026-09-10",
    candidateProposals: [proposal({ setup: "VWAP reclaim and H2 continuation" })],
  })[0].candidateId;

  assert.equal(first, "sod-2026-09-10-nvda-vwap-reclaim-long");
  assert.equal(second, first);
});

test("different semantic setup keys create different candidate identities", () => {
  const vwap = buildDeterministicSodCandidateId({
    sourceDate: "2026-09-10",
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "VWAP_RECLAIM",
  });
  const breakout = buildDeterministicSodCandidateId({
    sourceDate: "2026-09-10",
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "BREAKOUT_PULLBACK",
  });

  assert.notEqual(vwap, breakout);
  assert.equal(breakout, "sod-2026-09-10-nvda-breakout-pullback-long");
});

test("model-authored candidate identity is forbidden", () => {
  for (const override of [
    { candidateId: "model-picked-id" },
    { candidateKey: "model-picked-key" },
  ]) {
    assert.throws(
      () => assignDeterministicSodCandidateIds({
        sourceDate: "2026-09-10",
        candidateProposals: [proposal(override)],
      }),
      (error) => error.code === "SOD_OPENAI_CANDIDATE_IDENTITY_AUTHORITY_FORBIDDEN",
    );
  }
});

test("unsupported setup keys fail closed rather than deriving identity from prose", () => {
  assert.throws(
    () => assignDeterministicSodCandidateIds({
      sourceDate: "2026-09-10",
      candidateProposals: [proposal({ setupKey: "VWAP_RECLAIM_H2_SPECIAL" })],
    }),
    (error) => error.code === "SOD_OPENAI_SETUP_KEY_UNSUPPORTED",
  );
});

test("duplicate semantic identities fail closed", () => {
  assert.throws(
    () => assignDeterministicSodCandidateIds({
      sourceDate: "2026-09-10",
      candidateProposals: [
        proposal({ setup: "VWAP reclaim" }),
        proposal({ setup: "VWAP reclaim with H2" }),
      ],
    }),
    (error) => error.code === "SOD_OPENAI_CANDIDATE_ID_COLLISION",
  );
});

test("private setupKey is stripped before the generic provider boundary", () => {
  const candidates = assignDeterministicSodCandidateIds({
    sourceDate: "2026-09-10",
    candidateProposals: [proposal()],
  });

  assert.equal(candidates[0].candidateId, "sod-2026-09-10-nvda-vwap-reclaim-long");
  assert.equal("setupKey" in candidates[0], false);
  assert.doesNotThrow(() => normalizeSodAnalysisResult({
    candidateProposals: candidates,
    artifactContent: null,
  }));
});
