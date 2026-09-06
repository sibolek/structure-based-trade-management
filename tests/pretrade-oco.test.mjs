import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeOcoRepository } from "../schwab-bridge/pretrade-oco-repository.mjs";
import { PreTradeOcoService } from "../schwab-bridge/pretrade-oco-service.mjs";

const NOW = "2026-09-06T13:00:00.000Z";

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-oco-")), "oco.json");
}

function candidates() {
  return [
    { candidateId: "nvda-long", contractVersion: 1, symbol: "NVDA", lifecycleState: "READY", stateRevision: 3 },
    { candidateId: "nvda-short", contractVersion: 1, symbol: "NVDA", lifecycleState: "CAUTION", stateRevision: 4 },
    { candidateId: "nvda-third", contractVersion: 1, symbol: "NVDA", lifecycleState: "WAITING", stateRevision: 0 },
  ];
}

function coordinator(values = candidates()) {
  const revalidations = [];
  return {
    candidateSnapshot(candidateId, contractVersion) {
      const found = values.find((item) => item.candidateId === candidateId && item.contractVersion === Number(contractVersion));
      if (!found) { const error = new Error("not found"); error.code = "CANDIDATE_NOT_FOUND"; throw error; }
      return structuredClone(found);
    },
    snapshot() { return { candidates: structuredClone(values) }; },
    revalidatePermission(command) {
      const found = values.find((item) => item.candidateId === command.candidateId && item.contractVersion === Number(command.contractVersion));
      if (!found) { const error = new Error("not found"); error.code = "CANDIDATE_NOT_FOUND"; throw error; }
      assert.equal(found.lifecycleState, command.expectedState);
      assert.equal(found.stateRevision, command.expectedRevision);
      found.lifecycleState = "PERMISSION_EVALUATING";
      found.stateRevision += 1;
      revalidations.push(structuredClone(command));
      return { candidateId: found.candidateId, contractVersion: found.contractVersion, lifecycleState: found.lifecycleState, stateRevision: found.stateRevision };
    },
    revalidations,
  };
}

const noopArmLifecycle = { cancelOcoSibling() { throw new Error("not expected"); } };

test("OCO group binds exact candidate versions, symbol, and common account", () => {
  const repo = new PreTradeOcoRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const service = new PreTradeOcoService({
    lifecycleCoordinator: coordinator(),
    ocoRepository: repo,
    armLifecycleAuthority: noopArmLifecycle,
    executionOwnershipProvider: { async checkSymbol() { return { status: "FREE", revision: 1 }; } },
  });
  const group = service.createGroup({
    operationId: "create-1",
    groupId: "oco-nvda",
    accountId: "acct-1",
    members: [
      { candidateId: "nvda-long", contractVersion: 1 },
      { candidateId: "nvda-short", contractVersion: 1 },
    ],
  });
  assert.equal(group.status, "ACTIVE");
  assert.equal(group.symbol, "NVDA");
  assert.equal(group.accountId, "acct-1");
  assert.deepEqual(repo.groupForCandidate("nvda-long", 1).members, group.members);
});

test("changing common OCO account invalidates READY/CAUTION permission for every active member", () => {
  const values = candidates().slice(0, 2);
  const lifecycle = coordinator(values);
  const repo = new PreTradeOcoRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const service = new PreTradeOcoService({
    lifecycleCoordinator: lifecycle,
    ocoRepository: repo,
    armLifecycleAuthority: noopArmLifecycle,
    executionOwnershipProvider: { async checkSymbol() { return { status: "FREE" }; } },
  });
  service.createGroup({
    operationId: "create-account",
    groupId: "oco-account",
    accountId: "acct-1",
    members: [
      { candidateId: "nvda-long", contractVersion: 1 },
      { candidateId: "nvda-short", contractVersion: 1 },
    ],
  });
  const updated = service.setAccount({ operationId: "account-change", groupId: "oco-account", accountId: "acct-2" });
  assert.equal(updated.accountId, "acct-2");
  assert.equal(updated.accountRevision, 1);
  assert.equal(lifecycle.candidateSnapshot("nvda-long", 1).lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(lifecycle.candidateSnapshot("nvda-short", 1).lifecycleState, "PERMISSION_EVALUATING");
  assert.equal(lifecycle.revalidations.length, 2);
  assert.equal(lifecycle.revalidations[0].provenance.accountId, "acct-2");
});

test("same-symbol active candidate outside OCO group blocks ARM", async () => {
  const repo = new PreTradeOcoRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const service = new PreTradeOcoService({
    lifecycleCoordinator: coordinator(),
    ocoRepository: repo,
    armLifecycleAuthority: noopArmLifecycle,
    executionOwnershipProvider: { async checkSymbol() { return { status: "FREE" }; } },
  });
  service.createGroup({
    operationId: "create-1",
    groupId: "oco-nvda",
    accountId: "acct-1",
    members: [
      { candidateId: "nvda-long", contractVersion: 1 },
      { candidateId: "nvda-short", contractVersion: 1 },
    ],
  });
  const gate = await service.armGate({
    candidateId: "nvda-long",
    contractVersion: 1,
    review: { currentPackage: { material: { accountId: "acct-1" } } },
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reasonCode, "SAME_SYMBOL_PRETRADE_CONFLICT");
  assert.equal(gate.conflicts[0].candidateId, "nvda-third");
});

test("same-symbol ARMED candidate outside OCO group blocks a second ARM before Execution projection catches up", async () => {
  const values = [
    { candidateId: "nvda-new", contractVersion: 1, symbol: "NVDA", lifecycleState: "READY", stateRevision: 3 },
    { candidateId: "nvda-armed", contractVersion: 1, symbol: "NVDA", lifecycleState: "ARMED", stateRevision: 8 },
  ];
  const repo = new PreTradeOcoRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const service = new PreTradeOcoService({
    lifecycleCoordinator: coordinator(values),
    ocoRepository: repo,
    armLifecycleAuthority: noopArmLifecycle,
    executionOwnershipProvider: { async checkSymbol() { return { status: "FREE" }; } },
  });
  const gate = await service.armGate({ candidateId: "nvda-new", contractVersion: 1, review: null });
  assert.equal(gate.allowed, false);
  assert.equal(gate.reasonCode, "SAME_SYMBOL_PRETRADE_CONFLICT");
  assert.equal(gate.conflicts[0].candidateId, "nvda-armed");
  assert.equal(gate.conflicts[0].lifecycleState, "ARMED");
});

test("Execution ownership UNKNOWN or OWNED blocks ARM; exact FREE permits it", async () => {
  const values = candidates().slice(0, 2);
  const repo = new PreTradeOcoRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  let status = "UNKNOWN";
  const service = new PreTradeOcoService({
    lifecycleCoordinator: coordinator(values),
    ocoRepository: repo,
    armLifecycleAuthority: noopArmLifecycle,
    executionOwnershipProvider: { async checkSymbol() { return { status, source: "TEST" }; } },
  });
  service.createGroup({
    operationId: "create-1",
    groupId: "oco-nvda",
    accountId: "acct-1",
    members: [
      { candidateId: "nvda-long", contractVersion: 1 },
      { candidateId: "nvda-short", contractVersion: 1 },
    ],
  });
  const args = { candidateId: "nvda-long", contractVersion: 1, review: { currentPackage: { material: { accountId: "acct-1" } } } };
  assert.equal((await service.armGate(args)).allowed, false);
  status = "OWNED";
  assert.equal((await service.armGate(args)).reasonCode, "EXECUTION_SYMBOL_OWNED");
  status = "FREE";
  assert.equal((await service.armGate(args)).allowed, true);
});

test("failed ARM may release COMMITTING reservation while proven ARM resolves exact winner", () => {
  const repo = new PreTradeOcoRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  repo.createGroup({
    operationId: "create-1",
    groupId: "oco-nvda",
    symbol: "NVDA",
    accountId: "acct-1",
    members: [
      { candidateId: "nvda-long", contractVersion: 1 },
      { candidateId: "nvda-short", contractVersion: 1 },
    ],
  });
  const committing = repo.beginArmCommit({ groupId: "oco-nvda", operationId: "arm-1", winner: { candidateId: "nvda-long", contractVersion: 1 } });
  assert.equal(committing.status, "COMMITTING");
  assert.equal(repo.releaseArmCommit({ groupId: "oco-nvda", operationId: "arm-1" }).status, "ACTIVE");

  repo.beginArmCommit({ groupId: "oco-nvda", operationId: "arm-2", winner: { candidateId: "nvda-short", contractVersion: 1 } });
  const resolved = repo.resolveArmCommit({ groupId: "oco-nvda", operationId: "arm-2", winner: { candidateId: "nvda-short", contractVersion: 1 } });
  assert.equal(resolved.status, "RESOLVED");
  assert.equal(resolved.winner.candidateId, "nvda-short");
  assert.throws(() => repo.dissolve({ operationId: "dissolve-late", groupId: "oco-nvda" }), (error) => error.code === "OCO_DISSOLUTION_NOT_ALLOWED");
});
