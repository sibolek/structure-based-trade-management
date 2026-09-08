import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluatePretradeQuantitySafety,
} from "../schwab-bridge/pretrade-quantity-safety.mjs";

function mes() {
  return {
    riskEvaluation: {
      status: "VALID",
      dss: {
        dssEvaluationId: "dss-1",
      },
      account: {
        maxDollarRisk: 67.5,
      },
      instrument: {
        assetType: "FUTURE",
        minimumQuantity: 1,
        quantityIncrement: 1,
        tickSize: 0.25,
        tickValue: 1.25,
      },
      calculation: {
        finalQuantity: 3,
      },
    },
    dssEvaluation: {
      status: "VALID",
      dssEvaluationId: "dss-1",
      atrValue: 1,
    },
  };
}

test("normal stop sizing remains binding when Phase 4 is more conservative", () => {
  const result = evaluatePretradeQuantitySafety(mes());

  assert.equal(result.status, "VALID");
  assert.equal(result.stressAtrMultiple, 2);
  assert.equal(result.stressDistance, 2);
  assert.equal(result.stressTicks, 8);
  assert.equal(result.stressRiskPerUnit, 10);
  assert.equal(result.volatilityMaxQuantity, 6);
  assert.equal(result.phase4MaxQuantity, 3);
  assert.equal(result.policyMaxQuantity, 3);
  assert.equal(result.bindingConstraint, "PHASE4_STOP_RISK");
});

test("2-ATR volatility ceiling prevents near-stop quantity explosion", () => {
  const input = mes();
  input.riskEvaluation.account.maxDollarRisk = 70.06;
  input.riskEvaluation.calculation.finalQuantity = 11;
  input.dssEvaluation.atrValue = 1.75;

  const result = evaluatePretradeQuantitySafety(input);

  assert.equal(result.status, "VALID");
  assert.equal(result.stressDistance, 3.5);
  assert.equal(result.stressTicks, 14);
  assert.equal(result.stressRiskPerUnit, 17.5);
  assert.equal(result.phase4MaxQuantity, 11);
  assert.equal(result.volatilityMaxQuantity, 4);
  assert.equal(result.policyMaxQuantity, 4);
  assert.equal(result.bindingConstraint, "VOLATILITY_STRESS");
});

test("futures quantity safety floors to the valid quantity increment", () => {
  const input = mes();
  input.riskEvaluation.account.maxDollarRisk = 100;
  input.riskEvaluation.calculation.finalQuantity = 10;
  input.riskEvaluation.instrument.quantityIncrement = 2;
  input.riskEvaluation.instrument.minimumQuantity = 2;
  input.dssEvaluation.atrValue = 1.25;

  const result = evaluatePretradeQuantitySafety(input);

  assert.equal(result.status, "VALID");
  assert.equal(result.stressDistance, 2.5);
  assert.equal(result.stressRiskPerUnit, 12.5);
  assert.equal(result.rawVolatilityQuantity, 8);
  assert.equal(result.volatilityMaxQuantity, 8);
  assert.equal(result.policyMaxQuantity, 8);
  assert.equal(result.bindingConstraint, "VOLATILITY_STRESS");
});

test("volatility safety can reduce safe quantity to zero without changing the stop", () => {
  const input = mes();
  input.riskEvaluation.account.maxDollarRisk = 70;
  input.riskEvaluation.calculation.finalQuantity = 1;
  input.dssEvaluation.atrValue = 10;

  const result = evaluatePretradeQuantitySafety(input);

  assert.equal(result.status, "NO_AFFORDABLE_SIZE");
  assert.deepEqual(
    result.reasonCodes,
    ["MINIMUM_QUANTITY_EXCEEDS_VOLATILITY_SAFETY_BUDGET"],
  );
  assert.equal(result.phase4MaxQuantity, 1);
  assert.equal(result.volatilityMaxQuantity, 0);
  assert.equal(result.policyMaxQuantity, 0);
});

test("equities use the same 2-ATR stress policy without futures tick conversion", () => {
  const result = evaluatePretradeQuantitySafety({
    riskEvaluation: {
      status: "VALID",
      dss: {
        dssEvaluationId: "dss-equity-1",
      },
      account: { maxDollarRisk: 50 },
      instrument: {
        assetType: "EQUITY",
        minimumQuantity: 1,
        quantityIncrement: 1,
      },
      calculation: {
        finalQuantity: 100,
      },
    },
    dssEvaluation: {
      status: "VALID",
      dssEvaluationId: "dss-equity-1",
      atrValue: 0.5,
    },
  });

  assert.equal(result.status, "VALID");
  assert.equal(result.stressDistance, 1);
  assert.equal(result.stressRiskPerUnit, 1);
  assert.equal(result.volatilityMaxQuantity, 50);
  assert.equal(result.policyMaxQuantity, 50);
  assert.equal(result.bindingConstraint, "VOLATILITY_STRESS");
});

test("quantity safety fails closed when Phase 4 and DSS evidence identities differ", () => {
  const input = mes();
  input.dssEvaluation.dssEvaluationId = "different-dss";

  const result = evaluatePretradeQuantitySafety(input);

  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["QUANTITY_SAFETY_DSS_IDENTITY_MISMATCH"]);
});
