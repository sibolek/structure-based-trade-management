export const PRETRADE_TRIGGER_SCHEMA_VERSION = 1;
export const PRETRADE_TRIGGER_EVALUATOR_VERSION = 1;

const LEAF_TYPES = new Set(["MANUAL_CONFIRMATION", "QUOTE_COMPARISON", "BAR_CLOSE_COMPARISON"]);
const COMPOUND_TYPES = new Set(["ALL_OF", "ANY_OF"]);
const COMPARISON_OPERATORS = new Set(["GT", "GTE", "LT", "LTE"]);
const QUOTE_SIDES = new Set(["BID", "ASK", "LAST"]);
const PERSISTENCE_TYPES = new Set(["ONE_SHOT", "CONDITION_HELD", "BAR_BOUND"]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function triggerError(message, code = "INVALID_TRIGGER_CONTRACT") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeNode(input, path, errors, { allowManual = true } = {}) {
  const node = input && typeof input === "object" ? input : {};
  const type = upper(node.type);
  const nodeId = text(node.nodeId) || path;

  if (!type) {
    errors.push(`${path}.type is required`);
    return { nodeId, type: null };
  }

  if (COMPOUND_TYPES.has(type)) {
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length < 2) errors.push(`${path}.children must contain at least two trigger nodes`);
    return {
      nodeId,
      type,
      observationType: "COMPOUND",
      children: children.map((child, index) => normalizeNode(child, `${path}.${index + 1}`, errors, { allowManual })),
    };
  }

  if (!LEAF_TYPES.has(type)) {
    errors.push(`${path}.type ${type} is not supported by trigger evaluator v${PRETRADE_TRIGGER_EVALUATOR_VERSION}`);
    return { nodeId, type };
  }

  if (type === "MANUAL_CONFIRMATION") {
    if (!allowManual) errors.push(`${path} may not use MANUAL_CONFIRMATION for automatic relevance`);
    return {
      nodeId,
      type,
      observationType: "MANUAL_EVENT",
      prompt: text(node.prompt) || null,
    };
  }

  const operator = upper(node.operator);
  const value = finiteNumber(node.value ?? node.level);
  if (!COMPARISON_OPERATORS.has(operator)) errors.push(`${path}.operator must be GT, GTE, LT, or LTE`);
  if (value === null) errors.push(`${path}.value must be numeric`);

  if (type === "QUOTE_COMPARISON") {
    const side = upper(node.side || "LAST");
    if (!QUOTE_SIDES.has(side)) errors.push(`${path}.side must be BID, ASK, or LAST`);
    return {
      nodeId,
      type,
      observationType: "QUOTE_EVENT",
      side,
      operator,
      value,
      reference: node.reference && typeof node.reference === "object" ? clone(node.reference) : null,
    };
  }

  const timeframe = text(node.timeframe);
  if (!timeframe) errors.push(`${path}.timeframe is required for BAR_CLOSE_COMPARISON`);
  return {
    nodeId,
    type,
    observationType: "BAR_CLOSE",
    timeframe,
    operator,
    value,
    reference: node.reference && typeof node.reference === "object" ? clone(node.reference) : null,
  };
}

function defaultPersistence(satisfaction) {
  if (satisfaction?.type === "QUOTE_COMPARISON") return { type: "CONDITION_HELD", timeframe: null };
  if (satisfaction?.type === "BAR_CLOSE_COMPARISON") return { type: "BAR_BOUND", timeframe: satisfaction.timeframe || null };
  return { type: "ONE_SHOT", timeframe: null };
}

function normalizePersistence(input, satisfaction, errors) {
  if (input === undefined || input === null) return defaultPersistence(satisfaction);
  const persistence = typeof input === "string" ? { type: input } : input;
  if (!persistence || typeof persistence !== "object") {
    errors.push("trigger.persistence must be a string or object");
    return defaultPersistence(satisfaction);
  }
  const type = upper(persistence.type);
  if (!PERSISTENCE_TYPES.has(type)) errors.push("trigger.persistence.type must be ONE_SHOT, CONDITION_HELD, or BAR_BOUND");
  const timeframe = text(persistence.timeframe) || null;
  if (type === "BAR_BOUND" && !timeframe && satisfaction?.type !== "BAR_CLOSE_COMPARISON") {
    errors.push("BAR_BOUND trigger persistence requires a timeframe");
  }
  return {
    type,
    timeframe: timeframe || (type === "BAR_BOUND" ? satisfaction?.timeframe || null : null),
  };
}

export function normalizeTriggerContract(input) {
  const trigger = input && typeof input === "object" ? input : {};
  const errors = [];
  const schemaVersion = Number(trigger.schemaVersion ?? PRETRADE_TRIGGER_SCHEMA_VERSION);
  const evaluatorVersion = Number(trigger.evaluatorVersion ?? PRETRADE_TRIGGER_EVALUATOR_VERSION);

  if (schemaVersion !== PRETRADE_TRIGGER_SCHEMA_VERSION) {
    errors.push(`trigger.schemaVersion must be ${PRETRADE_TRIGGER_SCHEMA_VERSION}`);
  }
  if (evaluatorVersion !== PRETRADE_TRIGGER_EVALUATOR_VERSION) {
    errors.push(`trigger.evaluatorVersion ${evaluatorVersion} is unsupported`);
  }

  const satisfactionInput = trigger.satisfaction && typeof trigger.satisfaction === "object"
    ? trigger.satisfaction
    : trigger;
  const relevanceInput = trigger.relevance && typeof trigger.relevance === "object"
    ? trigger.relevance
    : null;

  const satisfaction = normalizeNode(satisfactionInput, "satisfaction", errors, { allowManual: true });
  const relevance = relevanceInput
    ? normalizeNode(relevanceInput, "relevance", errors, { allowManual: false })
    : null;
  const persistence = normalizePersistence(trigger.persistence, satisfaction, errors);

  return {
    normalized: {
      schemaVersion: PRETRADE_TRIGGER_SCHEMA_VERSION,
      evaluatorVersion: PRETRADE_TRIGGER_EVALUATOR_VERSION,
      relevance,
      satisfaction,
      persistence,
    },
    errors: [...new Set(errors)],
  };
}

export function assertTriggerContract(contract) {
  const { normalized, errors } = normalizeTriggerContract(contract);
  if (errors.length) throw triggerError(errors.join("; "));
  return normalized;
}

export function triggerObservationTypes(node, target = new Set()) {
  if (!node || typeof node !== "object") return target;
  if (node.type === "ALL_OF" || node.type === "ANY_OF") {
    for (const child of node.children || []) triggerObservationTypes(child, target);
    return target;
  }
  if (node.observationType) target.add(node.observationType);
  return target;
}

export function triggerRequiresManualConfirmation(contract) {
  const visit = (node) => {
    if (!node || typeof node !== "object") return false;
    if (node.type === "MANUAL_CONFIRMATION") return true;
    return Array.isArray(node.children) && node.children.some(visit);
  };
  return visit(contract?.satisfaction);
}
