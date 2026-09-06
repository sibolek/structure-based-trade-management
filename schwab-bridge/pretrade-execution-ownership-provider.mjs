function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function ownershipError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function immutable(value) {
  return Object.freeze(structuredClone(value));
}

export class PreTradeExecutionOwnershipProvider {
  constructor({ resolver = null } = {}) {
    if (resolver !== null && typeof resolver !== "function") throw new Error("resolver must be a function when supplied");
    this.resolver = resolver;
  }

  async checkSymbol(symbol) {
    const normalizedSymbol = upper(symbol);
    if (!normalizedSymbol) throw ownershipError("symbol is required", "EXECUTION_OWNERSHIP_SYMBOL_REQUIRED");

    if (!this.resolver) {
      return immutable({
        status: "UNKNOWN",
        reasonCode: "EXECUTION_OWNERSHIP_AUTHORITY_UNAVAILABLE",
        symbol: normalizedSymbol,
        source: "PRETRADE_EXECUTION_OWNERSHIP_PROVIDER",
        authoritative: false,
      });
    }

    const result = await this.resolver(normalizedSymbol);
    const status = upper(result?.status);
    if (!["FREE", "OWNED", "UNKNOWN"].includes(status)) {
      throw ownershipError("execution ownership resolver returned invalid status", "EXECUTION_OWNERSHIP_RESULT_INVALID");
    }
    if (["FREE", "OWNED"].includes(status) && result?.authoritative !== true) {
      throw ownershipError("FREE/OWNED execution ownership requires authoritative provenance", "EXECUTION_OWNERSHIP_PROVENANCE_REQUIRED");
    }
    return immutable({
      ...structuredClone(result),
      status,
      symbol: normalizedSymbol,
      reasonCode: text(result?.reasonCode) || null,
      source: text(result?.source) || "EXECUTION_OWNERSHIP_RESOLVER",
      authoritative: result?.authoritative === true,
    });
  }
}
