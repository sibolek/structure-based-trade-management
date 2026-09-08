import { canonicalLifecycleState } from "./pretrade-state.mjs";
import { PRETRADE_ACTIVE_UNARMED_STATES, PRETRADE_TERMINAL_UNARMED_STATES } from "./pretrade-lifecycle-coordinator.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function serviceError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function key(value) {
  return `${text(value?.candidateId)}:v${Number(value?.contractVersion)}`;
}

function sameSymbolArmBlockingState(value) {
  const state = canonicalLifecycleState(value);
  return state === "ARMED" || PRETRADE_ACTIVE_UNARMED_STATES.has(state);
}

export class PreTradeOcoService {
  constructor({
    lifecycleCoordinator,
    ocoRepository,
    armLifecycleAuthority,
    deliveryRepository = null,
    executionOwnershipProvider = { async checkSymbol() { return { status: "UNKNOWN", reasonCode: "EXECUTION_OWNERSHIP_AUTHORITY_UNAVAILABLE" }; } },
  } = {}) {
    if (!lifecycleCoordinator || typeof lifecycleCoordinator.candidateSnapshot !== "function" || typeof lifecycleCoordinator.snapshot !== "function") throw new Error("OCO service requires lifecycleCoordinator");
    if (!ocoRepository || typeof ocoRepository.groupForCandidate !== "function") throw new Error("OCO service requires ocoRepository");
    if (!armLifecycleAuthority || typeof armLifecycleAuthority.cancelOcoSibling !== "function") throw new Error("OCO service requires ARM lifecycle authority");
    if (deliveryRepository && typeof deliveryRepository.getById !== "function") throw new Error("deliveryRepository.getById() is required when delivery reconciliation is configured");
    if (!executionOwnershipProvider || typeof executionOwnershipProvider.checkSymbol !== "function") throw new Error("executionOwnershipProvider.checkSymbol() is required");
    this.lifecycleCoordinator = lifecycleCoordinator;
    this.ocoRepository = ocoRepository;
    this.armLifecycleAuthority = armLifecycleAuthority;
    this.deliveryRepository = deliveryRepository;
    this.executionOwnershipProvider = executionOwnershipProvider;
  }

  createGroup({ operationId, groupId, accountId, members } = {}) {
    if (!Array.isArray(members) || members.length < 2) throw serviceError("OCO group requires at least two members", "INVALID_OCO_MEMBERSHIP");
    const candidates = members.map((member) => this.lifecycleCoordinator.candidateSnapshot(member.candidateId, member.contractVersion));
    const symbols = new Set(candidates.map((candidate) => text(candidate.symbol).toUpperCase()));
    if (symbols.size !== 1) throw serviceError("all OCO members must share one exact symbol", "OCO_SYMBOL_MISMATCH");
    for (const candidate of candidates) {
      const state = canonicalLifecycleState(candidate.lifecycleState);
      if (!PRETRADE_ACTIVE_UNARMED_STATES.has(state)) throw serviceError("OCO members must be active unarmed candidates", "OCO_MEMBER_NOT_ACTIVE", { candidateId: candidate.candidateId, state });
    }
    return this.ocoRepository.createGroup({
      operationId,
      groupId,
      accountId,
      symbol: [...symbols][0],
      members: candidates.map((candidate) => ({ candidateId: candidate.candidateId, contractVersion: candidate.contractVersion })),
    });
  }

  setAccount(command = {}) {
    const before = this.ocoRepository.getById(command.groupId);
    const updated = this.ocoRepository.setAccount(command);
    if (before.accountId === updated.accountId) return updated;
    for (const member of updated.members) {
      const candidate = this.lifecycleCoordinator.candidateSnapshot(member.candidateId, member.contractVersion);
      const state = canonicalLifecycleState(candidate.lifecycleState);
      if (!["READY", "CAUTION"].includes(state)) continue;
      this.lifecycleCoordinator.revalidatePermission({
        operationId: `OCO_ACCOUNT_REVALIDATE:${updated.groupId}:r${updated.accountRevision}:${key(member)}`,
        candidateId: member.candidateId,
        contractVersion: member.contractVersion,
        expectedState: state,
        expectedRevision: candidate.stateRevision,
        source: "OPERATOR",
        reason: "OCO_EXECUTION_ACCOUNT_CHANGED",
        provenance: {
          groupId: updated.groupId,
          accountId: updated.accountId,
          accountRevision: updated.accountRevision,
        },
      });
    }
    return updated;
  }

  dissolve(command = {}) {
    return this.ocoRepository.dissolve(command);
  }

  reconcileBlockedHandoffRetirements({ symbol = null } = {}) {
    if (!this.deliveryRepository || typeof this.armLifecycleAuthority.retireBlockedHandoff !== "function") return [];
    const normalizedSymbol = text(symbol).toUpperCase();
    const results = [];
    const candidates = this.lifecycleCoordinator.snapshot().candidates || [];

    for (const candidate of candidates) {
      if (canonicalLifecycleState(candidate.lifecycleState) !== "ARMED") continue;
      if (normalizedSymbol && text(candidate.symbol).toUpperCase() !== normalizedSymbol) continue;
      const handoffId = text(candidate.arm?.handoffId);
      if (!handoffId) {
        results.push({ candidateId: candidate.candidateId, contractVersion: candidate.contractVersion, status: "ARMED_WITHOUT_HANDOFF_PROOF" });
        continue;
      }

      let delivery;
      try {
        delivery = this.deliveryRepository.getById(handoffId);
      } catch (error) {
        if (error?.code === "EXECUTION_BOARD_HANDOFF_DELIVERY_NOT_FOUND") {
          results.push({ candidateId: candidate.candidateId, contractVersion: candidate.contractVersion, handoffId, status: "DELIVERY_NOT_FOUND" });
          continue;
        }
        throw error;
      }
      if (text(delivery.status).toUpperCase() !== "BLOCKED") continue;

      try {
        const transition = this.armLifecycleAuthority.retireBlockedHandoff({
          operationId: `HANDOFF_BLOCK_RETIRE:${handoffId}`,
          candidateId: candidate.candidateId,
          contractVersion: candidate.contractVersion,
          expectedState: "ARMED",
          expectedRevision: candidate.stateRevision,
          delivery,
          reason: "EXECUTION_HANDOFF_BLOCKED_BEFORE_LISTENING",
          provenance: {
            authority: "EXECUTION_BOARD_HANDOFF_DELIVERY",
            handoffId,
            blockReason: delivery.blockReason,
            blockedAt: delivery.blockedAt,
          },
        });
        results.push({ candidateId: candidate.candidateId, contractVersion: candidate.contractVersion, handoffId, status: "RETIRED", transition });
      } catch (error) {
        results.push({
          candidateId: candidate.candidateId,
          contractVersion: candidate.contractVersion,
          handoffId,
          status: "RECONCILIATION_BLOCKED",
          code: error.code || "BLOCKED_HANDOFF_RETIREMENT_ERROR",
          message: error.message,
        });
      }
    }
    return results;
  }

  async armGate({ candidateId, contractVersion, review } = {}) {
    const candidate = this.lifecycleCoordinator.candidateSnapshot(candidateId, contractVersion);
    const state = canonicalLifecycleState(candidate.lifecycleState);
    if (!["READY", "CAUTION"].includes(state)) return { allowed: false, reasonCode: "ARM_NOT_REVIEWABLE", candidate, group: null, executionOwnership: null };
    const group = this.ocoRepository.groupForCandidate(candidateId, contractVersion);
    if (group && group.status !== "ACTIVE") return { allowed: false, reasonCode: "OCO_ARM_COMMIT_IN_PROGRESS", candidate, group, executionOwnership: null };
    if (group && text(review?.currentPackage?.material?.accountId) !== text(group.accountId)) {
      return { allowed: false, reasonCode: "OCO_ACCOUNT_CONTEXT_MISMATCH", candidate, group, executionOwnership: null };
    }

    // A terminal BLOCKED delivery proves Execution never established LISTENING
    // ownership. Retire only that exact frozen ARMED handoff before applying the
    // unchanged same-symbol exclusion gate. Pending/claimed/delivered handoffs
    // remain blockers and therefore continue to fail closed.
    this.reconcileBlockedHandoffRetirements({ symbol: candidate.symbol });

    const allCandidates = this.lifecycleCoordinator.snapshot().candidates || [];
    const conflicts = allCandidates.filter((other) => {
      if (key(other) === key(candidate)) return false;
      if (text(other.symbol).toUpperCase() !== text(candidate.symbol).toUpperCase()) return false;
      const otherState = canonicalLifecycleState(other.lifecycleState);
      if (!sameSymbolArmBlockingState(otherState)) return false;
      if (group && group.members.some((member) => key(member) === key(other))) return false;
      return true;
    }).map((other) => ({ candidateId: other.candidateId, contractVersion: other.contractVersion, lifecycleState: canonicalLifecycleState(other.lifecycleState) }));
    if (conflicts.length) return { allowed: false, reasonCode: "SAME_SYMBOL_PRETRADE_CONFLICT", candidate, group, conflicts, executionOwnership: null };

    const executionOwnership = await this.executionOwnershipProvider.checkSymbol(text(candidate.symbol).toUpperCase());
    const ownershipStatus = text(executionOwnership?.status).toUpperCase();
    if (ownershipStatus === "OWNED") return { allowed: false, reasonCode: "EXECUTION_SYMBOL_OWNED", candidate, group, conflicts: [], executionOwnership };
    if (ownershipStatus !== "FREE") return { allowed: false, reasonCode: text(executionOwnership?.reasonCode) || "EXECUTION_OWNERSHIP_UNKNOWN", candidate, group, conflicts: [], executionOwnership };

    return { allowed: true, reasonCode: null, candidate, group, conflicts: [], executionOwnership };
  }

  beginArmCommit({ group, operationId, winner } = {}) {
    if (!group) return null;
    return this.ocoRepository.beginArmCommit({ groupId: group.groupId, operationId, winner });
  }

  releaseArmCommit({ group, operationId } = {}) {
    if (!group) return null;
    return this.ocoRepository.releaseArmCommit({ groupId: group.groupId, operationId });
  }

  completeWinner({ groupId, operationId, winner } = {}) {
    if (!groupId) return null;
    const group = this.ocoRepository.getById(groupId);
    if (group.status === "RESOLVED") {
      if (key(group.winner) !== key(winner) || group.armOperationId !== text(operationId)) throw serviceError("resolved OCO winner conflicts with ARM operation", "OCO_ARM_CONFLICT");
      return group;
    }
    if (group.status !== "COMMITTING" || group.armOperationId !== text(operationId) || key(group.pendingWinner) !== key(winner)) throw serviceError("OCO commit reservation conflicts with ARM operation", "OCO_ARM_CONFLICT");

    for (const member of group.members) {
      if (key(member) === key(winner)) continue;
      const sibling = this.lifecycleCoordinator.candidateSnapshot(member.candidateId, member.contractVersion);
      const state = canonicalLifecycleState(sibling.lifecycleState);
      if (PRETRADE_TERMINAL_UNARMED_STATES.has(state)) continue;
      if (state === "ARMED") throw serviceError("an OCO sibling is already ARMED", "OCO_MULTIPLE_WINNER_CONFLICT", { sibling: member });
      if (!PRETRADE_ACTIVE_UNARMED_STATES.has(state)) throw serviceError("OCO sibling is in unsupported state", "OCO_SIBLING_STATE_CONFLICT", { sibling: member, state });
      this.armLifecycleAuthority.cancelOcoSibling({
        operationId: `OCO_CANCEL:${groupId}:${operationId}:${key(member)}`,
        candidateId: member.candidateId,
        contractVersion: member.contractVersion,
        expectedState: state,
        expectedRevision: sibling.stateRevision,
        groupId,
        winner,
        reason: "OCO_WINNER_ARMED",
        provenance: { groupId, winner, armOperationId: operationId },
      });
    }
    return this.ocoRepository.resolveArmCommit({ groupId, operationId, winner });
  }

  recoverCommitting(armOperationRepository) {
    const results = [];
    for (const group of this.ocoRepository.list().filter((item) => item.status === "COMMITTING")) {
      const operation = armOperationRepository.getByOperationId(group.armOperationId);
      if (operation && ["AUTHORIZED", "COMPLETED"].includes(operation.status)) {
        results.push({ groupId: group.groupId, status: "AUTHORIZED_ARM_PENDING_COMPLETION", armOperationId: group.armOperationId });
      } else {
        const released = this.ocoRepository.releaseArmCommit({ groupId: group.groupId, operationId: group.armOperationId });
        results.push({ groupId: group.groupId, status: "RELEASED_UNPROVEN_ARM", armOperationId: group.armOperationId, group: released });
      }
    }
    return results;
  }

  reconcileClosedNoArm() {
    const results = [];
    for (const group of this.ocoRepository.list().filter((item) => item.status === "ACTIVE")) {
      const states = group.members.map((member) => canonicalLifecycleState(this.lifecycleCoordinator.candidateSnapshot(member.candidateId, member.contractVersion).lifecycleState));
      if (states.every((state) => PRETRADE_TERMINAL_UNARMED_STATES.has(state))) {
        const closed = this.ocoRepository.closeNoArm({ operationId: `OCO_CLOSE_NO_ARM:${group.groupId}`, groupId: group.groupId });
        results.push(closed);
      }
    }
    return results;
  }
}
