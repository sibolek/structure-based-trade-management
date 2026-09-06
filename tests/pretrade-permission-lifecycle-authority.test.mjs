import assert from "node:assert/strict";
import test from "node:test";

import { PreTradeLifecycleApiService } from "../schwab-bridge/pretrade-lifecycle-api.mjs";

function coordinator() {
  const calls = [];
  return {
    calls,
    candidateSnapshot(candidateId, contractVersion) {
      return {
        candidateId,
        contractVersion,
        lifecycleState: "PERMISSION_EVALUATING",
        stateRevision: 2,
        contractAuthority: { authority: "CANONICAL_CANDIDATE_INGRESS" },
      };
    },
    publishPermissionOutcome(command) { calls.push(["publish", command]); },
    setPermissionBlocker(command) { calls.push(["block", command]); },
    clearPermissionBlocker(command) { calls.push(["clear", command]); },
    revalidatePermission(command) { calls.push(["revalidate", command]); return command; },
  };
}

const identity = { candidateId: "candidate-1", contractVersion: 1 };

test("canonical browser command cannot publish READY CAUTION or PASS directly", () => {
  const c = coordinator();
  const service = new PreTradeLifecycleApiService({ coordinator: c });
  assert.throws(
    () => service.execute("publish-permission", identity, {
      operationId: "forged-ready",
      expectedState: "PERMISSION_EVALUATING",
      expectedRevision: 2,
      outcome: "READY",
      permissionEvaluationId: "forged",
    }),
    (error) => error.code === "PERMISSION_PIPELINE_AUTHORITY_REQUIRED",
  );
  assert.deepEqual(c.calls, []);
});

test("canonical browser command cannot establish or clear permission blockers directly", () => {
  const c = coordinator();
  const service = new PreTradeLifecycleApiService({ coordinator: c });
  for (const commandName of ["set-permission-blocker", "clear-permission-blocker"]) {
    assert.throws(
      () => service.execute(commandName, identity, {
        operationId: `forged-${commandName}`,
        expectedState: "PERMISSION_EVALUATING",
        expectedRevision: 2,
        blockerStatus: "BLOCKED_RETRYABLE",
        reasonCode: "FORGED",
      }),
      (error) => error.code === "PERMISSION_PIPELINE_AUTHORITY_REQUIRED",
    );
  }
  assert.deepEqual(c.calls, []);
});

test("operator revalidation remains an allowed intent-specific lifecycle command", () => {
  const c = coordinator();
  const service = new PreTradeLifecycleApiService({ coordinator: c });
  service.execute("revalidate-permission", identity, {
    operationId: "operator-revalidate",
    expectedState: "READY",
    expectedRevision: 3,
    reason: "ACCOUNT_CHANGED",
  });
  assert.equal(c.calls[0][0], "revalidate");
});
