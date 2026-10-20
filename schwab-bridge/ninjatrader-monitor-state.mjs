import crypto from 'node:crypto';

const clone = value => structuredClone(value);
function fail(code) { throw new Error(code); }
function text(value) { return typeof value === 'string' && value.trim() && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null; }
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
function instant(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail('NINJATRADER_MONITOR_TIMESTAMP_INVALID');
  return new Date(value).toISOString();
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function monitorAccountId(name, environment) { return `nt:${environment}:${digest([environment, name])}`; }
export function monitorError(error) { return /^NINJATRADER_[A-Z0-9_]+$/.test(error?.message) ? error.message : 'NINJATRADER_MONITOR_READ_FAILED'; }
function symbol(value) { const result = text(value); if (!result || !/^[A-Za-z0-9./:_-]{1,64}$/.test(result)) fail('NINJATRADER_MONITOR_SYMBOL_INVALID'); return result; }
function opaqueAccount(name, environment) {
  return { accountId: monitorAccountId(name, environment), accountDisplay: `••••${name.slice(-4).replace(/[^A-Za-z0-9]/g, '•')}` };
}
export function normalizeMonitorAccountList(payload, environment) {
  const rows = Array.isArray(payload) ? payload : payload?.accounts;
  if (!Array.isArray(rows) || !['demo', 'live'].includes(environment)) fail('NINJATRADER_ACCOUNT_LIST_SCHEMA_MISMATCH');
  const names = new Set();
  return rows.filter(row => row?.active !== false && row?.isActive !== false).map(row => {
    const name = text(row?.name);
    if (!name || names.has(name)) fail('NINJATRADER_ACCOUNT_LIST_SCHEMA_MISMATCH');
    names.add(name); return { name, ...opaqueAccount(name, environment) };
  });
}
export function normalizeMonitorPortfolio(payload, account, environment, observedAt) {
  if (payload?.account?.name !== account.name || !Array.isArray(payload.positions)) fail('NINJATRADER_MONITOR_PORTFOLIO_SCHEMA_MISMATCH');
  const root = payload.account, identity = opaqueAccount(account.name, environment), seen = new Set();
  const positions = payload.positions.map(row => {
    const contract = symbol(row?.symbol), quantity = numeric(row.netPos), averagePrice = numeric(row.netPrice);
    if (!Number.isSafeInteger(quantity) || !quantity || averagePrice === null || seen.has(contract)) fail('NINJATRADER_MONITOR_POSITION_INVALID');
    seen.add(contract);
    return { ...identity, symbol: contract, quantity, side: quantity > 0 ? 'LONG' : 'SHORT', averagePrice,
      currentPrice: numeric(row.currentPrice), openPnl: numeric(row.openPnL),
      dataFeedMode: text(row.dataFeedMode), realtime: row.dataFeedMode === 'RealTime' ? true : row.dataFeedMode === 'Delayed' ? false : null,
      source: 'NINJATRADER', environment, observedAt };
  });
  return { account: { ...identity, currency: text(root.currency), netLiquidation: numeric(root.netLiq),
    cashBalance: numeric(root.cashBalance), openPnl: numeric(root.openPnL), realizedPnl: numeric(root.realizedPnL), dayPnl: numeric(root.dayPnL),
    source: 'NINJATRADER', environment, observedAt }, positions };
}
// An omitted beta projection is unknown, never proof of zero working orders.
export function normalizeMonitorWorkingOrders(payload, account, environment, observedAt) {
  if (!Object.hasOwn(payload, 'workingOrders')) return null;
  if (!Array.isArray(payload.workingOrders) || payload.workingOrders.length > 5000) fail('NINJATRADER_MONITOR_WORKING_ORDERS_INVALID');
  const seen = new Set();
  return payload.workingOrders.map(row => {
    const orderId = numeric(row?.id), quantity = numeric(row?.quantity), orderType = text(row?.orderType), status = text(row?.ordStatus);
    if (!Number.isSafeInteger(orderId) || orderId < 0 || seen.has(orderId) || !Number.isSafeInteger(quantity) || quantity <= 0
        || !['Buy', 'Sell'].includes(row?.action) || !orderType || !status) fail('NINJATRADER_MONITOR_WORKING_ORDERS_INVALID');
    for (const field of ['price', 'stopPrice']) if (row[field] != null && numeric(row[field]) === null) fail('NINJATRADER_MONITOR_WORKING_ORDERS_INVALID');
    seen.add(orderId);
    return { ...opaqueAccount(account.name, environment), orderId, symbol: symbol(row.symbol), action: row.action, orderType, quantity,
      status, limitPrice: numeric(row.price), stopPrice: numeric(row.stopPrice), timeInForce: text(row.timeInForce),
      parentOrderId: Number.isSafeInteger(row.bracket?.parentId) ? row.bracket.parentId : null,
      ocoOrderId: Number.isSafeInteger(row.bracket?.ocoId) ? row.bracket.ocoId : null,
      source: 'NINJATRADER', environment, observedAt, stale: false };
  });
}
export function normalizeMonitorFills(payload, account, environment) {
  if (!Array.isArray(payload?.items) || payload.items.length >= 5000) fail('NINJATRADER_MONITOR_FILL_HISTORY_UNVERIFIED');
  const ids = new Set();
  return payload.items.map(row => {
    const fillId = numeric(row.fillId), quantity = numeric(row.quantity), price = numeric(row.price);
    if (row.account !== account.name || !Number.isSafeInteger(fillId) || fillId < 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || price === null
        || !['Buy', 'Sell'].includes(row.action) || ids.has(fillId)) fail('NINJATRADER_MONITOR_FILL_INVALID');
    ids.add(fillId);
    return { ...opaqueAccount(account.name, environment), fillId, orderId: Number.isSafeInteger(row.orderId) ? row.orderId : null,
      symbol: symbol(row.symbol), action: row.action, quantity, price, executionTime: instant(row.timestamp),
      commission: numeric(row.commission), source: 'NINJATRADER', environment };
  });
}

const TERMINAL_ORDER_STATUS = Object.freeze({ Canceled: 'Cancelled', Cancelled: 'Cancelled', Filled: 'Filled', Rejected: 'Rejected', Expired: 'Expired', Completed: 'Completed' });
// Match structured current order records by exact account, stable ID, symbol
// and side. A cancel command, missing row or Completed status never means Canceled.
export function normalizeMonitorTerminalOrders(payload, account, environment, trackedOrders) {
  if (!Array.isArray(payload?.items) || payload.items.length >= 5000) fail('NINJATRADER_MONITOR_ORDER_HISTORY_UNVERIFIED');
  const tracked = new Map(trackedOrders.map(order => [order.orderId, order])), seen = new Set(), result = [];
  for (const row of payload.items) {
    const prior = tracked.get(row?.orderId); if (!prior) continue;
    if (seen.has(row.orderId) || row.account !== account.name || row.symbol !== prior.symbol || row.action !== prior.action) fail('NINJATRADER_MONITOR_ORDER_IDENTITY_MISMATCH');
    seen.add(row.orderId);
    const status = Object.hasOwn(TERMINAL_ORDER_STATUS, row.ordStatus) ? TERMINAL_ORDER_STATUS[row.ordStatus] : null; if (!status) continue;
    const quantity = numeric(row.quantity), filledQuantity = numeric(row.filledQty);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || (row.filledQty != null && (!Number.isSafeInteger(filledQuantity) || filledQuantity < 0 || filledQuantity > quantity))) fail('NINJATRADER_MONITOR_ORDER_HISTORY_UNVERIFIED');
    result.push({ ...opaqueAccount(account.name, environment), orderId: row.orderId, symbol: prior.symbol, action: row.action, quantity, filledQuantity,
      status, brokerStatus: row.ordStatus, brokerOrderTime: row.timestamp == null ? null : instant(row.timestamp), source: 'NINJATRADER', environment });
  }
  return result;
}

export class NinjaTraderMonitor {
  #client; #accounts = null; #seen = new Map(); #busy = false; #pendingOrders = new Map(); #orderHistoryNextRead = new Map(); #hasOrderHistory = false;
  constructor({ client, environment = 'demo', pollMs = 5000, accountSelectors = [], now = Date.now, onFill = () => {} } = {}) {
    if (!client || typeof client.readAccountList !== 'function' || typeof client.callTool !== 'function') fail('NINJATRADER_MONITOR_CLIENT_REQUIRED');
    if (!['live', 'demo'].includes(environment) || !Number.isFinite(pollMs) || pollMs < 2000 || pollMs > 60000) fail('NINJATRADER_MONITOR_CONFIG_INVALID');
    if (!Array.isArray(accountSelectors) || accountSelectors.some(value => !text(value))) fail('NINJATRADER_MONITOR_ACCOUNT_SELECTION_INVALID');
    this.#client = client; this.environment = environment; this.pollMs = pollMs; this.accountSelectors = [...accountSelectors]; this.now = now; this.onFill = onFill;
    this.state = { schema: 'executionos.ninjatrader.monitor.v1', version: 1, source: 'NINJATRADER', environment,
      readOnly: true, executionEnabled: false, executionOwnershipVerified: false, continuousFillCoverageVerified: false,
      status: 'BOOTING', pollMs, accounts: [], positions: [], workingOrders: [], unconfirmedOrders: [], orderEvents: [], executions: [], baselineCompletedAt: null,
      baselineFillCount: 0, lastFillSuccessfulAt: null, lastSuccessfulAt: null, lastError: null, updatedAt: new Date(now()).toISOString() };
  }
  async initialize() {
    const tools = await this.#client.toolCatalog();
    if (!['my_portfolio', 'fill_history'].every(name => tools.some(tool => tool.name === name))) fail('NINJATRADER_MONITOR_READ_PERMISSIONS_REQUIRED');
    this.#hasOrderHistory = tools.some(tool => tool.name === 'order_history');
    const available = normalizeMonitorAccountList(await this.#client.readAccountList(), this.environment);
    this.#accounts = this.accountSelectors.length ? available.filter(account => this.accountSelectors.includes(account.name) || this.accountSelectors.includes(account.accountId)) : available;
    if (this.accountSelectors.some(selector => !this.#accounts.some(account => [account.name, account.accountId].includes(selector)))) fail('NINJATRADER_MONITOR_ACCOUNT_SELECTION_INVALID');
    if (!this.#accounts.length || this.#accounts.length > 10) fail('NINJATRADER_MONITOR_SELECT_ONE_TO_TEN_ACCOUNTS');
    this.state.status = 'BASELINING';
    return this.poll();
  }
  async poll({ readFills = true } = {}) {
    if (!this.#accounts) fail('NINJATRADER_MONITOR_NOT_INITIALIZED');
    if (this.#busy) fail('NINJATRADER_MONITOR_POLL_IN_PROGRESS');
    if (typeof readFills !== 'boolean' || (!readFills && !this.state.baselineCompletedAt)) fail('NINJATRADER_MONITOR_FILL_BASELINE_REQUIRED');
    this.#busy = true;
    try {
      const started = this.now(), accounts = [], positions = [], workingOrders = [], fills = [], orderEvents = [], unconfirmedOrders = [];
      const pendingOrders = new Map(this.#pendingOrders);
      let positionResource = null, orderResource, orderResourceRead = false;
      const startDate = new Date(started - 86400000).toISOString().slice(0, 10);
      const endDate = new Date(started + 86400000).toISOString().slice(0, 10);
      for (const account of this.#accounts) {
        const raw = await this.#client.callTool('my_portfolio', { account: account.name,
          fields: ['account.name', 'account.currency', 'account.netLiq', 'account.cashBalance', 'account.openPnL', 'account.realizedPnL', 'account.dayPnL', 'positions[]', 'workingOrders[]'] });
        // The beta may omit an empty projected positions branch. Confirm
        // absence using its independent read-only positions resource rather
        // than interpreting an absent array as a flat account.
        if (!Object.hasOwn(raw, 'positions')) {
          if (!positionResource) {
            if (typeof this.#client.readPositionList !== 'function') fail('NINJATRADER_MONITOR_POSITION_SNAPSHOT_INCOMPLETE');
            const result = await this.#client.readPositionList();
            positionResource = Array.isArray(result) ? result : result?.positions;
            if (!Array.isArray(positionResource)) fail('NINJATRADER_MONITOR_POSITION_SNAPSHOT_INCOMPLETE');
          }
          if (positionResource.length && (positionResource.some(row => !text(row?.account)) || positionResource.some(row => row.account === account.name))) fail('NINJATRADER_MONITOR_POSITION_SNAPSHOT_INCOMPLETE');
          raw.positions = [];
        }
        const observedAt = new Date(this.now()).toISOString();
        const normalized = normalizeMonitorPortfolio(raw, account, this.environment, observedAt);
        let orders = normalizeMonitorWorkingOrders(raw, account, this.environment, observedAt);
        // Empty projected branches are omitted by this beta. A successful
        // independent empty orders resource proves zero working orders.
        if (orders === null && typeof this.#client.readOrderList === 'function') {
          if (!orderResourceRead) { orderResource = await this.#client.readOrderList(); orderResourceRead = true; }
          const resourceRows = Array.isArray(orderResource) ? orderResource : orderResource?.orders;
          if (Array.isArray(resourceRows) && resourceRows.length === 0) orders = [];
        }
        const priorOrders = this.state.workingOrders.filter(row => row.accountId === account.accountId);
        const currentIds = orders === null ? new Set() : new Set(orders.map(order => order.orderId));
        for (const order of priorOrders) if (!currentIds.has(order.orderId)) pendingOrders.set(`${account.accountId}:${order.orderId}`, order);
        for (const order of orders || []) pendingOrders.delete(`${account.accountId}:${order.orderId}`);
        const missing = [...pendingOrders.values()].filter(order => order.accountId === account.accountId);
        const terminalIds = new Set();
        if (missing.length && this.#hasOrderHistory && started >= (this.#orderHistoryNextRead.get(account.accountId) || 0)) {
          // One query per affected account, at most once per 15 seconds, only
          // while known orders have disappeared. No extra steady-state history poll.
          this.#orderHistoryNextRead.set(account.accountId, this.now() + 15000);
          const history = await this.#client.callTool('order_history', { account: account.name, startDate, endDate, format: 'objects' });
          for (const order of normalizeMonitorTerminalOrders(history, account, this.environment, missing)) {
            terminalIds.add(order.orderId); pendingOrders.delete(`${account.accountId}:${order.orderId}`);
            orderEvents.push({ ...order, observedAt: new Date(this.now()).toISOString(),
              positionQuantity: normalized.positions.find(position => position.symbol === order.symbol)?.quantity ?? 0 });
          }
        }
        const priorAccount = this.state.accounts.find(row => row.accountId === account.accountId);
        normalized.account.workingOrdersStatus = orders === null ? 'UNAVAILABLE' : 'CURRENT';
        normalized.account.workingOrdersObservedAt = orders === null ? priorAccount?.workingOrdersObservedAt ?? null : observedAt;
        workingOrders.push(...(orders ?? priorOrders.filter(order => !terminalIds.has(order.orderId)).map(row => ({ ...row, stale: true }))));
        const displayedIds = new Set((orders ?? priorOrders.filter(order => !terminalIds.has(order.orderId))).map(order => order.orderId));
        unconfirmedOrders.push(...[...pendingOrders.values()].filter(order => order.accountId === account.accountId && !displayedIds.has(order.orderId)).map(order => ({ ...order, stale: true })));
        accounts.push(normalized.account); positions.push(...normalized.positions);
        if (readFills) fills.push(...normalizeMonitorFills(await this.#client.callTool('fill_history', { account: account.name, startDate, endDate, format: 'objects' }), account, this.environment));
      }
      const detectedAt = new Date(this.now()).toISOString(), baseline = !this.state.baselineCompletedAt;
      const nextSeen = new Map(this.#seen), fresh = [];
      for (const fill of fills.sort((a, b) => Date.parse(a.executionTime) - Date.parse(b.executionTime) || a.fillId - b.fillId)) {
        const { commission, ...execution } = fill;
        const key = `${fill.accountId}:${fill.fillId}`, fingerprint = digest(execution), prior = nextSeen.get(key);
        if (prior && prior.fingerprint !== fingerprint) fail('NINJATRADER_MONITOR_FILL_CORRECTION_REQUIRES_REBASELINE');
        if (!prior && !baseline) fresh.push({ ...fill, detectedAt });
        nextSeen.set(key, { fingerprint, executionTime: fill.executionTime });
      }
      for (const [key, row] of nextSeen) if (readFills && Date.parse(row.executionTime) < Date.parse(`${startDate}T00:00:00Z`)) nextSeen.delete(key);
      if (nextSeen.size > 50000) fail('NINJATRADER_MONITOR_FILL_MEMORY_LIMIT');
      if (pendingOrders.size > 1000) fail('NINJATRADER_MONITOR_ORDER_RECONCILIATION_LIMIT');
      this.#pendingOrders = pendingOrders;
      this.#seen = nextSeen;
      this.state = { ...this.state, status: 'OBSERVING', accounts, positions, workingOrders, unconfirmedOrders,
        orderEvents: [...orderEvents.reverse(), ...this.state.orderEvents].slice(0, 100),
        executions: [...fresh.slice().reverse(), ...this.state.executions].slice(0, 100),
        baselineCompletedAt: this.state.baselineCompletedAt || detectedAt,
        baselineFillCount: baseline ? fills.length : this.state.baselineFillCount,
        lastFillSuccessfulAt: readFills ? detectedAt : this.state.lastFillSuccessfulAt,
        lastSuccessfulAt: detectedAt, updatedAt: detectedAt, lastError: null };
      for (const fill of fresh) { try { this.onFill(clone(fill)); } catch { /* Presentation cannot change observation state. */ } }
      return this.snapshot();
    } catch (error) {
      this.markError(error); throw error;
    } finally { this.#busy = false; }
  }
  markError(error) { this.state = { ...this.state, status: 'DEGRADED', lastError: monitorError(error), updatedAt: new Date(this.now()).toISOString() }; }
  stop() { this.state = { ...this.state, status: 'STOPPED', updatedAt: new Date(this.now()).toISOString() }; }
  snapshot() {
    const result = clone(this.state);
    result.stale = result.status !== 'OBSERVING' || !result.lastSuccessfulAt || this.now() - Date.parse(result.lastSuccessfulAt) > Math.max(15000, this.pollMs * 3);
    return result;
  }
}
