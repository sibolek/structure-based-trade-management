import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRETRADE_OCO_REPOSITORY_SCHEMA_VERSION = 1;
export const PRETRADE_OCO_GROUP_SCHEMA_VERSION = 1;
export const DEFAULT_PRETRADE_OCO_FILE = ".executionos-v24-oco-groups.json";

const STATUSES = new Set(["ACTIVE", "COMMITTING", "RESOLVED", "DISSOLVED", "CLOSED_NO_ARM"]);

function text(value) {
  return String(value ?? "").trim();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function ocoError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function identity(value) {
  const candidateId = text(value?.candidateId);
  const contractVersion = Number(value?.contractVersion);
  if (!candidateId || !Number.isInteger(contractVersion) || contractVersion < 1) return null;
  return { candidateId, contractVersion };
}

function identityKey(value) {
  const id = identity(value);
  return id ? `${id.candidateId}:v${id.contractVersion}` : null;
}

function sameIdentity(left, right) {
  return identityKey(left) === identityKey(right);
}

function normalizeMembers(members) {
  const values = Array.isArray(members) ? members.map(identity).filter(Boolean) : [];
  const seen = new Set();
  const normalized = [];
  for (const member of values) {
    const key = identityKey(member);
    if (seen.has(key)) throw ocoError("OCO membership contains duplicate candidate identity", "INVALID_OCO_MEMBERSHIP");
    seen.add(key);
    normalized.push(member);
  }
  if (normalized.length < 2) throw ocoError("OCO group requires at least two exact candidate versions", "INVALID_OCO_MEMBERSHIP");
  return normalized;
}

function validateGroup(group) {
  const errors = [];
  if (Number(group?.schemaVersion) !== PRETRADE_OCO_GROUP_SCHEMA_VERSION) errors.push("unsupported group schemaVersion");
  if (!text(group?.groupId)) errors.push("groupId is required");
  if (!STATUSES.has(text(group?.status).toUpperCase())) errors.push("invalid group status");
  if (!text(group?.symbol)) errors.push("symbol is required");
  if (!text(group?.accountId)) errors.push("accountId is required");
  const members = Array.isArray(group?.members) ? group.members : [];
  if (members.length < 2 || members.some((member) => !identity(member))) errors.push("members are invalid");
  if (new Set(members.map(identityKey)).size !== members.length) errors.push("members are duplicated");
  if (group?.status === "COMMITTING") {
    if (!text(group.armOperationId) || !identity(group.pendingWinner)) errors.push("COMMITTING requires arm operation and pending winner");
  }
  if (group?.status === "RESOLVED") {
    if (!identity(group.winner) || !text(group.armOperationId)) errors.push("RESOLVED requires winner and arm operation");
  }
  return { valid: errors.length === 0, errors };
}

function emptyState() {
  return {
    schemaVersion: PRETRADE_OCO_REPOSITORY_SCHEMA_VERSION,
    updatedAt: null,
    groups: [],
    operations: [],
  };
}

export class PreTradeOcoRepository {
  constructor({ filePath = DEFAULT_PRETRADE_OCO_FILE, clock = () => new Date().toISOString() } = {}) {
    if (typeof clock !== "function") throw new Error("clock must be a function");
    this.filePath = path.resolve(filePath);
    this.clock = clock;
    this.state = emptyState();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      this.state = {
        schemaVersion: PRETRADE_OCO_REPOSITORY_SCHEMA_VERSION,
        updatedAt: text(parsed?.updatedAt) || null,
        groups: Array.isArray(parsed?.groups) ? parsed.groups.filter(Boolean).map(immutable) : [],
        operations: Array.isArray(parsed?.operations) ? parsed.operations.filter(Boolean).map(immutable) : [],
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.state = emptyState();
    }
    this.#assertState();
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  save() {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  getById(groupId) {
    const group = this.state.groups.find((item) => item.groupId === text(groupId));
    if (!group) throw ocoError(`OCO group ${text(groupId)} was not found`, "OCO_GROUP_NOT_FOUND");
    return immutable(group);
  }

  groupForCandidate(candidateId, contractVersion) {
    const key = identityKey({ candidateId, contractVersion });
    const matches = this.state.groups.filter((group) => ["ACTIVE", "COMMITTING"].includes(group.status) && group.members.some((member) => identityKey(member) === key));
    if (matches.length > 1) throw ocoError("candidate belongs to more than one active OCO group", "CORRUPT_OCO_REPOSITORY");
    return matches[0] ? immutable(matches[0]) : null;
  }

  createGroup({ operationId, groupId, symbol, accountId, members } = {}) {
    const normalized = {
      groupId: text(groupId),
      symbol: text(symbol).toUpperCase(),
      accountId: text(accountId),
      members: normalizeMembers(members),
    };
    if (!normalized.groupId || !normalized.symbol || !normalized.accountId) throw ocoError("groupId, symbol, and accountId are required", "INVALID_OCO_GROUP");
    return this.#run(operationId, "CREATE_OCO_GROUP", normalized, () => {
      if (this.state.groups.some((group) => group.groupId === normalized.groupId)) throw ocoError("groupId already exists", "OCO_GROUP_ID_CONFLICT");
      for (const member of normalized.members) {
        if (this.groupForCandidate(member.candidateId, member.contractVersion)) throw ocoError("candidate already belongs to an active OCO group", "OCO_MEMBERSHIP_CONFLICT");
      }
      const at = this.#now();
      const group = immutable({
        schemaVersion: PRETRADE_OCO_GROUP_SCHEMA_VERSION,
        groupId: normalized.groupId,
        status: "ACTIVE",
        symbol: normalized.symbol,
        accountId: normalized.accountId,
        accountRevision: 0,
        members: normalized.members,
        createdAt: at,
        updatedAt: at,
        armOperationId: null,
        pendingWinner: null,
        winner: null,
        resolvedAt: null,
        dissolvedAt: null,
        closedAt: null,
      });
      this.state.groups.push(group);
      return group;
    });
  }

  setAccount({ operationId, groupId, accountId } = {}) {
    const normalizedAccountId = text(accountId);
    if (!normalizedAccountId) throw ocoError("accountId is required", "OCO_ACCOUNT_REQUIRED");
    return this.#run(operationId, "SET_OCO_ACCOUNT", { groupId: text(groupId), accountId: normalizedAccountId }, () => {
      return this.#replace(groupId, (group) => {
        if (group.status !== "ACTIVE") throw ocoError("OCO account can change only while group is ACTIVE", "OCO_GROUP_NOT_MUTABLE");
        if (group.accountId === normalizedAccountId) return group;
        return immutable({ ...group, accountId: normalizedAccountId, accountRevision: Number(group.accountRevision || 0) + 1, updatedAt: this.#now() });
      });
    });
  }

  dissolve({ operationId, groupId } = {}) {
    return this.#run(operationId, "DISSOLVE_OCO_GROUP", { groupId: text(groupId) }, () => this.#replace(groupId, (group) => {
      if (group.status !== "ACTIVE") throw ocoError("only an unresolved ACTIVE OCO group may be dissolved", "OCO_DISSOLUTION_NOT_ALLOWED");
      const at = this.#now();
      return immutable({ ...group, status: "DISSOLVED", dissolvedAt: at, updatedAt: at });
    }));
  }

  beginArmCommit({ operationId, groupId, winner } = {}) {
    const winnerIdentity = identity(winner);
    if (!winnerIdentity) throw ocoError("winner identity is invalid", "INVALID_OCO_WINNER");
    const armOperationId = text(operationId);
    if (!armOperationId) throw ocoError("ARM operationId is required", "OCO_ARM_OPERATION_REQUIRED");
    const group = this.#mutable(groupId);
    if (group.status === "COMMITTING" && group.armOperationId === armOperationId && sameIdentity(group.pendingWinner, winnerIdentity)) return immutable(group);
    if (group.status !== "ACTIVE") throw ocoError("OCO group is not available for ARM", "OCO_ARM_CONFLICT");
    if (!group.members.some((member) => sameIdentity(member, winnerIdentity))) throw ocoError("winner is not an OCO member", "INVALID_OCO_WINNER");
    const previous = structuredClone(this.state);
    try {
      const at = this.#now();
      Object.assign(group, { status: "COMMITTING", armOperationId, pendingWinner: winnerIdentity, updatedAt: at });
      this.state.updatedAt = at;
      this.save();
      return immutable(group);
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  releaseArmCommit({ groupId, operationId } = {}) {
    const group = this.#mutable(groupId);
    if (group.status === "ACTIVE") return immutable(group);
    if (group.status !== "COMMITTING" || group.armOperationId !== text(operationId)) throw ocoError("OCO commit reservation does not match ARM operation", "OCO_ARM_CONFLICT");
    const previous = structuredClone(this.state);
    try {
      const at = this.#now();
      Object.assign(group, { status: "ACTIVE", armOperationId: null, pendingWinner: null, updatedAt: at });
      this.state.updatedAt = at;
      this.save();
      return immutable(group);
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  resolveArmCommit({ groupId, operationId, winner } = {}) {
    const group = this.#mutable(groupId);
    const winnerIdentity = identity(winner);
    if (group.status === "RESOLVED" && group.armOperationId === text(operationId) && sameIdentity(group.winner, winnerIdentity)) return immutable(group);
    if (group.status !== "COMMITTING" || group.armOperationId !== text(operationId) || !sameIdentity(group.pendingWinner, winnerIdentity)) {
      throw ocoError("OCO group is not committed to this ARM winner", "OCO_ARM_CONFLICT");
    }
    const previous = structuredClone(this.state);
    try {
      const at = this.#now();
      Object.assign(group, { status: "RESOLVED", winner: winnerIdentity, pendingWinner: null, resolvedAt: at, updatedAt: at });
      this.state.updatedAt = at;
      this.save();
      return immutable(group);
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  closeNoArm({ operationId, groupId } = {}) {
    return this.#run(operationId, "CLOSE_OCO_NO_ARM", { groupId: text(groupId) }, () => this.#replace(groupId, (group) => {
      if (group.status !== "ACTIVE") throw ocoError("only ACTIVE group may close without ARM", "OCO_CLOSE_NOT_ALLOWED");
      const at = this.#now();
      return immutable({ ...group, status: "CLOSED_NO_ARM", closedAt: at, updatedAt: at });
    }));
  }

  list() {
    return this.state.groups.map(immutable);
  }

  #run(operationId, action, payload, mutation) {
    const id = text(operationId);
    if (!id) throw ocoError("operationId is required", "OCO_OPERATION_ID_REQUIRED");
    const operationHash = digest({ action, payload });
    const prior = this.state.operations.find((item) => item.operationId === id);
    if (prior) {
      if (prior.operationHash !== operationHash) throw ocoError("operationId conflicts with prior OCO mutation", "OCO_OPERATION_ID_CONFLICT");
      return immutable(prior.result);
    }
    const previous = structuredClone(this.state);
    try {
      const result = mutation();
      this.state.operations.push(immutable({ operationId: id, operationHash, action, result }));
      this.state.updatedAt = this.#now();
      this.save();
      return immutable(result);
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }

  #replace(groupId, transition) {
    const index = this.state.groups.findIndex((group) => group.groupId === text(groupId));
    if (index < 0) throw ocoError("OCO group was not found", "OCO_GROUP_NOT_FOUND");
    const next = transition(structuredClone(this.state.groups[index]));
    this.state.groups[index] = immutable(next);
    return immutable(next);
  }

  #mutable(groupId) {
    const index = this.state.groups.findIndex((group) => group.groupId === text(groupId));
    if (index < 0) throw ocoError("OCO group was not found", "OCO_GROUP_NOT_FOUND");
    this.state.groups[index] = structuredClone(this.state.groups[index]);
    return this.state.groups[index];
  }

  #now() {
    const parsed = Date.parse(String(this.clock() ?? ""));
    if (!Number.isFinite(parsed)) throw ocoError("OCO repository clock returned invalid timestamp", "OCO_CLOCK_INVALID");
    return new Date(parsed).toISOString();
  }

  #assertState() {
    const groupIds = new Set();
    const activeMembership = new Set();
    for (const group of this.state.groups) {
      const validation = validateGroup(group);
      if (!validation.valid || groupIds.has(group.groupId)) throw ocoError(`persisted OCO group is invalid: ${validation.errors.join("; ")}`, "CORRUPT_OCO_REPOSITORY");
      groupIds.add(group.groupId);
      if (["ACTIVE", "COMMITTING"].includes(group.status)) {
        for (const member of group.members) {
          const key = identityKey(member);
          if (activeMembership.has(key)) throw ocoError("candidate belongs to multiple active OCO groups", "CORRUPT_OCO_REPOSITORY");
          activeMembership.add(key);
        }
      }
    }
  }
}
