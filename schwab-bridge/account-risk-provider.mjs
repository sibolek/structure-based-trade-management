import crypto from "node:crypto";
import { RISK_SIZING_POLICY_VERSION, riskSizingPolicyForVersion } from "./risk-sizing-policy.mjs";

const DEFAULT_SCHWAB_TRADER_BASE_URL = "https://api.schwabapi.com/trader/v1";
const SCHWAB_ACCOUNT_CURRENCY = "USD";
const SCHWAB_EQUITY_FIELD = "currentBalances.liquidationValue";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finitePositive(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteTimestamp(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function blocked(reasonCode, partial = {}) {
  return immutable({
    ...partial,
    status: "BLOCKED",
    reasonCodes: [reasonCode],
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function snapshotId(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

function unwrapSecuritiesAccount(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.securitiesAccount && typeof payload.securitiesAccount === "object") {
    return payload.securitiesAccount;
  }
  return payload;
}

export function assessAccountRiskSnapshot(snapshot, {
  nowMs = Date.now(),
  policyVersion = RISK_SIZING_POLICY_VERSION,
} = {}) {
  const policy = riskSizingPolicyForVersion(policyVersion);
  const accountId = text(snapshot?.accountId);
  if (!accountId) return blocked("ACCOUNT_NOT_RESOLVED");

  const accountEquity = finitePositive(snapshot?.accountEquity);
  if (accountEquity === null) {
    return blocked("ACCOUNT_EQUITY_INVALID", { accountId });
  }

  const currency = upper(snapshot?.currency);
  if (currency !== SCHWAB_ACCOUNT_CURRENCY) {
    return blocked("ACCOUNT_CURRENCY_UNSUPPORTED", {
      accountId,
      accountEquity,
      currency: currency || null,
    });
  }

  const observedAtMs = finiteTimestamp(snapshot?.observedAt);
  const currentMs = finiteTimestamp(nowMs);
  if (observedAtMs === null || currentMs === null) {
    return blocked("ACCOUNT_SNAPSHOT_UNAVAILABLE", {
      accountId,
      accountEquity,
      currency,
    });
  }

  const ageMs = Math.max(0, currentMs - observedAtMs);
  const normalized = {
    accountId,
    accountEquity,
    currency,
    observedAt: new Date(observedAtMs).toISOString(),
    ageMs,
    source: upper(snapshot?.source) || "UNKNOWN",
    sourceSnapshotId: text(snapshot?.sourceSnapshotId) || null,
    equityField: text(snapshot?.equityField) || null,
  };

  if (ageMs > policy.accountSnapshotMaxAgeMs) {
    return blocked("ACCOUNT_SNAPSHOT_STALE", {
      snapshot: normalized,
      maxAgeMs: policy.accountSnapshotMaxAgeMs,
    });
  }

  return immutable({
    status: "VALID",
    reasonCodes: [],
    snapshot: normalized,
    maxAgeMs: policy.accountSnapshotMaxAgeMs,
  });
}

export function normalizeSchwabAccountRiskSnapshot(payload, {
  accountId,
  observedAt = Date.now(),
  currency = SCHWAB_ACCOUNT_CURRENCY,
  source = "SCHWAB",
  sourceSnapshotId = null,
} = {}) {
  const normalizedAccountId = text(accountId);
  if (!normalizedAccountId) return blocked("ACCOUNT_NOT_RESOLVED");

  const account = unwrapSecuritiesAccount(payload);
  if (!account) {
    return blocked("ACCOUNT_SNAPSHOT_UNAVAILABLE", { accountId: normalizedAccountId });
  }

  // Phase 4 net-liquidation semantics intentionally use only the current
  // liquidation value. Do not fall back to equity, initial balances, cash,
  // buying power, or any other account measure.
  const accountEquity = finitePositive(account?.currentBalances?.liquidationValue);
  if (accountEquity === null) {
    return blocked("ACCOUNT_EQUITY_INVALID", {
      accountId: normalizedAccountId,
      equityField: SCHWAB_EQUITY_FIELD,
    });
  }

  const observedAtMs = finiteTimestamp(observedAt);
  if (observedAtMs === null) {
    return blocked("ACCOUNT_SNAPSHOT_UNAVAILABLE", {
      accountId: normalizedAccountId,
      accountEquity,
      equityField: SCHWAB_EQUITY_FIELD,
    });
  }

  const normalizedCurrency = upper(currency);
  if (normalizedCurrency !== SCHWAB_ACCOUNT_CURRENCY) {
    return blocked("ACCOUNT_CURRENCY_UNSUPPORTED", {
      accountId: normalizedAccountId,
      accountEquity,
      currency: normalizedCurrency || null,
      equityField: SCHWAB_EQUITY_FIELD,
    });
  }

  return immutable({
    status: "VALID",
    reasonCodes: [],
    snapshot: {
      accountId: normalizedAccountId,
      accountEquity,
      currency: normalizedCurrency,
      observedAt: new Date(observedAtMs).toISOString(),
      ageMs: 0,
      source: upper(source) || "SCHWAB",
      sourceSnapshotId: text(sourceSnapshotId) || snapshotId(payload),
      equityField: SCHWAB_EQUITY_FIELD,
    },
  });
}

export class SchwabAccountRiskProvider {
  constructor({
    requestJson,
    now = () => Date.now(),
    baseUrl = DEFAULT_SCHWAB_TRADER_BASE_URL,
    currency = SCHWAB_ACCOUNT_CURRENCY,
    policyVersion = RISK_SIZING_POLICY_VERSION,
  } = {}) {
    if (typeof requestJson !== "function") {
      throw new Error("SchwabAccountRiskProvider requires requestJson(url)");
    }
    if (typeof now !== "function") throw new Error("now must be a function");

    this.requestJson = requestJson;
    this.now = now;
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.currency = upper(currency);
    this.policyVersion = policyVersion;
  }

  async getSnapshot(accountId) {
    const normalizedAccountId = text(accountId);
    if (!normalizedAccountId) return blocked("ACCOUNT_NOT_RESOLVED");
    if (this.currency !== SCHWAB_ACCOUNT_CURRENCY) {
      return blocked("ACCOUNT_CURRENCY_UNSUPPORTED", {
        accountId: normalizedAccountId,
        currency: this.currency || null,
      });
    }

    let payload;
    try {
      payload = await this.requestJson(`${this.baseUrl}/accounts/${encodeURIComponent(normalizedAccountId)}`);
    } catch {
      return blocked("ACCOUNT_SNAPSHOT_UNAVAILABLE", { accountId: normalizedAccountId });
    }

    const observedAtMs = finiteTimestamp(this.now());
    if (observedAtMs === null) {
      return blocked("ACCOUNT_SNAPSHOT_UNAVAILABLE", { accountId: normalizedAccountId });
    }

    const normalized = normalizeSchwabAccountRiskSnapshot(payload, {
      accountId: normalizedAccountId,
      observedAt: observedAtMs,
      currency: this.currency,
      source: "SCHWAB",
    });
    if (normalized.status !== "VALID") return normalized;

    return assessAccountRiskSnapshot(normalized.snapshot, {
      nowMs: observedAtMs,
      policyVersion: this.policyVersion,
    });
  }
}
