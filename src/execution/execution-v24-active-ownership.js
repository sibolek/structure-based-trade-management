function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function handoffIdForExecutionRecord(record) {
  return text(record?.v24?.handoffId);
}

function historyHandoffIds(store) {
  return new Set(
    (Array.isArray(store?.history) ? store.history : [])
      .map(handoffIdForExecutionRecord)
      .filter(Boolean),
  );
}

function lifecycleByHandoff(store) {
  return new Map(
    (Array.isArray(store?.v24Lifecycles) ? store.v24Lifecycles : [])
      .filter((item) => text(item?.handoffId))
      .map((item) => [text(item.handoffId), item]),
  );
}

function retirementByHandoff(store) {
  return new Map(
    (Array.isArray(store?.v24Retirements) ? store.v24Retirements : [])
      .filter((item) => text(item?.handoffId))
      .map((item) => [text(item.handoffId), item]),
  );
}

export function isV24InstallationReservationActive(store, installation) {
  const handoffId = text(installation?.handoffId);
  if (!handoffId || !["PREPARED", "LISTENING"].includes(upper(installation?.status))) return false;

  const retirement = retirementByHandoff(store).get(handoffId);
  if (upper(retirement?.status) === "RETIRED") return false;

  // Decision 20: once a durable lifecycle exists, the immutable installation
  // remains provenance only and can never continue reserving the symbol.
  if (lifecycleByHandoff(store).has(handoffId)) return false;

  return true;
}

export function isV24LifecycleReservationActive(store, lifecycle) {
  const handoffId = text(lifecycle?.handoffId);
  if (!handoffId) return false;
  const status = upper(lifecycle?.status);
  if (["LIVE", "LIVE_RECONCILIATION_REQUIRED"].includes(status)) return true;
  if (status !== "EXIT") return false;

  // EXIT remains owned until the corresponding completed record is durably in History.
  return !historyHandoffIds(store).has(handoffId);
}

export function executionOwnedSymbolsForHandoffAdmission(store, { excludeHandoffId = null } = {}) {
  const clean = store && typeof store === "object" ? store : {};
  const excluded = text(excludeHandoffId);
  const symbols = new Set();

  for (const candidate of Array.isArray(clean.candidates) ? clean.candidates : []) {
    if (excluded && handoffIdForExecutionRecord(candidate) === excluded) continue;
    const symbol = upper(candidate?.originalPlan?.symbol ?? candidate?.v24?.symbol);
    if (symbol) symbols.add(symbol);
  }

  for (const trade of Array.isArray(clean.liveTrades) ? clean.liveTrades : []) {
    if (excluded && handoffIdForExecutionRecord(trade) === excluded) continue;
    const symbol = upper(trade?.originalPlan?.symbol ?? trade?.v24?.symbol);
    if (symbol) symbols.add(symbol);
  }

  if (clean.draft?.mode === "EDIT") {
    const symbol = upper(clean.draft?.originalPlan?.symbol ?? clean.draft?.plan?.symbol);
    if (symbol) symbols.add(symbol);
  }

  for (const installation of Array.isArray(clean.v24Installations) ? clean.v24Installations : []) {
    if (excluded && text(installation?.handoffId) === excluded) continue;
    if (!isV24InstallationReservationActive(clean, installation)) continue;
    const symbol = upper(installation?.symbol ?? installation?.compatibility?.v24?.symbol);
    if (symbol) symbols.add(symbol);
  }

  for (const lifecycle of Array.isArray(clean.v24Lifecycles) ? clean.v24Lifecycles : []) {
    if (excluded && text(lifecycle?.handoffId) === excluded) continue;
    if (!isV24LifecycleReservationActive(clean, lifecycle)) continue;
    const symbol = upper(lifecycle?.symbol);
    if (symbol) symbols.add(symbol);
  }

  return Object.freeze([...symbols].sort());
}

export function v24OwnershipView(store, handoffId) {
  const id = text(handoffId);
  const installation = (Array.isArray(store?.v24Installations) ? store.v24Installations : [])
    .find((item) => text(item?.handoffId) === id) || null;
  const retirement = (Array.isArray(store?.v24Retirements) ? store.v24Retirements : [])
    .find((item) => text(item?.handoffId) === id) || null;
  const lifecycle = (Array.isArray(store?.v24Lifecycles) ? store.v24Lifecycles : [])
    .find((item) => text(item?.handoffId) === id) || null;
  const liveTrade = (Array.isArray(store?.liveTrades) ? store.liveTrades : [])
    .find((item) => handoffIdForExecutionRecord(item) === id) || null;
  const history = (Array.isArray(store?.history) ? store.history : [])
    .find((item) => handoffIdForExecutionRecord(item) === id) || null;

  return Object.freeze({
    handoffId: id,
    installation,
    retirement,
    lifecycle,
    liveTrade,
    history,
    installationReservesSymbol: isV24InstallationReservationActive(store, installation),
    lifecycleReservesSymbol: isV24LifecycleReservationActive(store, lifecycle),
  });
}
