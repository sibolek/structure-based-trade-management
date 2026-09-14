// SOD-specific raw validation; manual-ingestion parser and its limits stay frozen.
export const SOD_PROVIDER_LIMITS = Object.freeze({
  maxCharts: 16, maxChartBytes: 32 * 1024 * 1024,
  maxRequestBytes: 48 * 1024 * 1024, maxResponseBytes: 4 * 1024 * 1024,
  maxSerializedBytes: 768 * 1024, maxDepth: 48, maxNodes: 25000,
  maxObjectKeys: 500, maxArrayLength: 5000, maxStringBytes: 64 * 1024,
});

export function sodError(code) {
  return Object.assign(new Error(code), { code });
}
function rawJsonError(_message, code = "SOD_OPENAI_RESPONSE_JSON_INVALID") { throw sodError(code); }

class RawJsonValidator {
  constructor(raw, limits) {
    this.raw = raw;
    this.limits = limits;
    this.i = 0;
    this.nodes = 0;
  }

  validate() {
    if (Buffer.byteLength(this.raw, "utf8") > this.limits.maxSerializedBytes) {
      rawJsonError(
        `manual envelope exceeds raw byte limit ${this.limits.maxSerializedBytes}`,
        "SOD_OPENAI_OUTPUT_TEXT_LIMIT",
      );
    }
    this.#skipWhitespace();
    this.#parseValue(0);
    this.#skipWhitespace();
    if (this.i !== this.raw.length) rawJsonError(`unexpected trailing JSON token at byte ${this.i}`);
    return { nodes: this.nodes };
  }

  #countNode(depth) {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      rawJsonError(
        `manual envelope exceeds structural node limit ${this.limits.maxNodes}`,
        "SOD_OPENAI_JSON_STRUCTURAL_LIMIT",
      );
    }
    if (depth > this.limits.maxDepth) {
      rawJsonError(
        `manual envelope exceeds nesting depth limit ${this.limits.maxDepth}`,
        "SOD_OPENAI_JSON_STRUCTURAL_LIMIT",
      );
    }
  }

  #skipWhitespace() {
    while (this.i < this.raw.length && /[\t\n\r ]/.test(this.raw[this.i])) this.i += 1;
  }

  #parseValue(depth) {
    this.#countNode(depth);
    const ch = this.raw[this.i];
    if (ch === "{") return this.#parseObject(depth);
    if (ch === "[") return this.#parseArray(depth);
    if (ch === "\"") return this.#parseString();
    if (ch === "t") return this.#consumeLiteral("true");
    if (ch === "f") return this.#consumeLiteral("false");
    if (ch === "n") return this.#consumeLiteral("null");
    if (ch === "-" || /[0-9]/.test(ch || "")) return this.#parseNumber();
    rawJsonError(`unexpected JSON token at byte ${this.i}`);
    return null;
  }

  #parseObject(depth) {
    this.i += 1;
    this.#skipWhitespace();
    const keys = new Set();
    let count = 0;
    if (this.raw[this.i] === "}") {
      this.i += 1;
      return;
    }
    while (this.i < this.raw.length) {
      if (this.raw[this.i] !== "\"") rawJsonError(`object key must be a JSON string at byte ${this.i}`);
      const key = this.#parseString();
      if (keys.has(key)) {
        rawJsonError(
          `duplicate JSON object key: ${key}`,
          "SOD_OPENAI_JSON_DUPLICATE_KEYS",
        );
      }
      keys.add(key);
      count += 1;
      if (count > this.limits.maxObjectKeys) {
        rawJsonError(
          `manual envelope object exceeds breadth limit ${this.limits.maxObjectKeys}`,
          "SOD_OPENAI_JSON_STRUCTURAL_LIMIT",
        );
      }
      this.#skipWhitespace();
      if (this.raw[this.i] !== ":") rawJsonError(`expected ':' after object key at byte ${this.i}`);
      this.i += 1;
      this.#skipWhitespace();
      this.#parseValue(depth + 1);
      this.#skipWhitespace();
      if (this.raw[this.i] === "}") {
        this.i += 1;
        return;
      }
      if (this.raw[this.i] !== ",") rawJsonError(`expected ',' or '}' at byte ${this.i}`);
      this.i += 1;
      this.#skipWhitespace();
    }
    rawJsonError("unterminated JSON object");
  }

  #parseArray(depth) {
    this.i += 1;
    this.#skipWhitespace();
    let count = 0;
    if (this.raw[this.i] === "]") {
      this.i += 1;
      return;
    }
    while (this.i < this.raw.length) {
      count += 1;
      if (count > this.limits.maxArrayLength) {
        rawJsonError(
          `manual envelope array exceeds length limit ${this.limits.maxArrayLength}`,
          "SOD_OPENAI_JSON_STRUCTURAL_LIMIT",
        );
      }
      this.#parseValue(depth + 1);
      this.#skipWhitespace();
      if (this.raw[this.i] === "]") {
        this.i += 1;
        return;
      }
      if (this.raw[this.i] !== ",") rawJsonError(`expected ',' or ']' at byte ${this.i}`);
      this.i += 1;
      this.#skipWhitespace();
    }
    rawJsonError("unterminated JSON array");
  }

  #parseString() {
    const start = this.i;
    this.i += 1;
    while (this.i < this.raw.length) {
      const ch = this.raw[this.i];
      if (ch === "\"") {
        this.i += 1;
        const encoded = this.raw.slice(start, this.i);
        let decoded;
        try {
          decoded = JSON.parse(encoded);
        } catch (error) {
          rawJsonError(`invalid JSON string escape at byte ${start}: ${error.message}`);
        }
        if (Buffer.byteLength(decoded, "utf8") > this.limits.maxStringBytes) {
          rawJsonError(
            `manual envelope string exceeds byte limit ${this.limits.maxStringBytes}`,
            "SOD_OPENAI_JSON_STRUCTURAL_LIMIT",
          );
        }
        return decoded;
      }
      if (ch === "\\") {
        const escaped = this.raw[this.i + 1];
        if (!escaped || !/["\\/bfnrtu]/.test(escaped)) {
          rawJsonError(`invalid JSON escape at byte ${this.i}`);
        }
        if (escaped === "u" && !/^[0-9a-fA-F]{4}$/.test(this.raw.slice(this.i + 2, this.i + 6))) {
          rawJsonError(`invalid JSON unicode escape at byte ${this.i}`);
        }
        this.i += escaped === "u" ? 6 : 2;
        continue;
      }
      if (ch < " ") rawJsonError(`unescaped control character in JSON string at byte ${this.i}`);
      this.i += 1;
    }
    rawJsonError("unterminated JSON string");
    return "";
  }

  #parseNumber() {
    const rest = this.raw.slice(this.i);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (!match) rawJsonError(`invalid JSON number at byte ${this.i}`);
    if (Buffer.byteLength(match[0], "utf8") > this.limits.maxStringBytes) {
      rawJsonError(
        `manual envelope numeric value exceeds byte limit ${this.limits.maxStringBytes}`,
        "SOD_OPENAI_JSON_STRUCTURAL_LIMIT",
      );
    }
    this.i += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) rawJsonError(`non-finite JSON number at byte ${this.i}`);
  }

  #consumeLiteral(literal) {
    if (this.raw.slice(this.i, this.i + literal.length) !== literal) {
      rawJsonError(`invalid JSON literal at byte ${this.i}`);
    }
    this.i += literal.length;
  }
}

export function parseStrictSodJson(raw) {
  if (typeof raw !== "string") throw sodError("SOD_OPENAI_RESPONSE_JSON_INVALID");
  new RawJsonValidator(raw, SOD_PROVIDER_LIMITS).validate();
  return JSON.parse(raw);
}

// Complete validator for the keywords used by the closed transport schema.
// Unknown schema keywords are a programming error, never silently ignored.
export function validateSodTransport(value, schema) {
  const supported = new Set(["type", "enum", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minimum"]);
  function check(v, s) {
    if (Object.keys(s).some(k => !supported.has(k))) throw sodError("SOD_OPENAI_SCHEMA_DEFINITION_INVALID");
    const invalid = () => { throw sodError("SOD_OPENAI_RESPONSE_SCHEMA_INVALID"); };
    if (s.enum && !s.enum.some(x => Object.is(x, v))) invalid();
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some(t => t === "null" ? v === null : t === "array" ? Array.isArray(v)
        : t === "object" ? v !== null && typeof v === "object" && !Array.isArray(v)
        : t === "integer" ? Number.isSafeInteger(v)
        : t === "number" ? typeof v === "number" && Number.isFinite(v) : typeof v === t)) invalid();
    }
    if (s.minimum !== undefined && v < s.minimum) invalid();
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) invalid();
      if (s.maxItems !== undefined && v.length > s.maxItems) invalid();
      if (s.items) v.forEach(x => check(x, s.items));
    } else if (v !== null && typeof v === "object") {
      for (const key of s.required || []) if (!Object.hasOwn(v, key)) invalid();
      for (const key of Object.keys(v)) {
        if (!Object.hasOwn(s.properties || {}, key)) { if (s.additionalProperties === false) invalid(); }
        else check(v[key], s.properties[key]);
      }
    }
  }
  check(value, schema);
  return value;
}

export function serializeSodProviderRequest(payload) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > SOD_PROVIDER_LIMITS.maxRequestBytes) throw sodError("SOD_OPENAI_REQUEST_BYTES_LIMIT");
  return body;
}
