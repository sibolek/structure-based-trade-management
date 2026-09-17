function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function latestTerminalEvent(candidate) {
  const events = Array.isArray(candidate?.lifecycleJournal?.events)
    ? candidate.lifecycleJournal.events
    : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if ([
      "CANDIDATE_INVALIDATED",
      "CANDIDATE_DECLINED",
      "CANDIDATE_EXPIRED",
      "CANDIDATE_SUPERSEDED",
      "CANDIDATE_OCO_CANCELLED",
    ].includes(upper(event?.eventType))) return event;
  }
  return null;
}

export function projectTerminalHistoryAudit(candidate) {
  const outcome = candidate?.terminalOutcome && typeof candidate.terminalOutcome === "object"
    ? candidate.terminalOutcome
    : null;
  const event = latestTerminalEvent(candidate);

  const reasonCode = text(outcome?.reasonCode || event?.metadata?.reasonCode || event?.reason) || null;
  const reasonText = text(outcome?.note || event?.metadata?.note) || null;
  const source = upper(outcome?.source || event?.source) || null;
  const occurredAt = text(outcome?.occurredAt || event?.occurredAt) || null;

  return {
    occurredAt,
    source,
    reasonCode,
    reasonText,
    displayReason: reasonText || reasonCode || null,
  };
}
