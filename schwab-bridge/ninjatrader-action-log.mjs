// Console presentation only. Broker observations and fill deduplication stay in
// NinjaTraderMonitor; in particular, fills use its callback rather than the
// bounded 100-row API history, so a large successful batch is not truncated.
const text = value => String(value ?? '—').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
const number = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
const orderKey = row => JSON.stringify([row.environment, row.accountId, row.orderId]);
const orderTerms = row => JSON.stringify([row.symbol, row.action, row.quantity, row.orderType, row.stopPrice, row.limitPrice, row.timeInForce]);
function clock(value, timeZone) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'time unavailable';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZoneName: 'short' }).format(new Date(value));
}
function prefix(row, time, timeZone) {
  return `${clock(time, timeZone)} | NINJATRADER ${text(row.environment).toUpperCase()} ${text(row.accountDisplay)}`;
}
export function formatNinjaTraderActionFill(fill, timeZone = 'America/Denver') {
  const time = fill.executionTime || fill.detectedAt;
  const label = fill.executionTime ? '' : ' (detected)';
  return `${prefix(fill, time, timeZone)}${label} | ${text(fill.action).toUpperCase()} ${number(fill.quantity)} ${text(fill.symbol)} @ ${number(fill.price)} | order ${text(fill.orderId)} | fill ${text(fill.fillId)}`;
}
function orderLine(order, action, timeZone) {
  const prices = [];
  if (order.stopPrice != null || ['Stop', 'StopLimit', 'TrailingStop', 'MIT'].includes(order.orderType)) prices.push(`stop ${number(order.stopPrice)}`);
  if (order.limitPrice != null || ['Limit', 'StopLimit'].includes(order.orderType)) prices.push(`limit ${number(order.limitPrice)}`);
  const terms = `${text(order.action)} ${number(order.quantity)} ${text(order.symbol)} ${text(order.orderType)}${prices.length ? ' · ' + prices.join(' · ') : ''}${order.timeInForce ? ' · ' + text(order.timeInForce) : ''}`;
  // Terminal prices describe the last observed working order, not a fill price.
  const prior = order.orderDetailsSource === 'LAST_OBSERVED_WORKING_ORDER' ? ' | last working terms' : '';
  return `${prefix(order, order.observedAt, timeZone)} | ORDER ${action} | ${terms} | order ${text(order.orderId)}${prior}`;
}
export function createNinjaTraderActionLogger(log, { timeZone = 'America/Denver' } = {}) {
  let initialized = false, previousOrders = new Map(), previousEvents = new Set(), previousCoverage = '';
  const filledThisPoll = new Set();
  const observe = state => {
    // A failed poll carries old observations. It cannot announce an action or
    // erase the comparison baseline; the runner reports failure/recovery once.
    if (state.stale || state.status !== 'OBSERVING') return;
    const orders = [...(state.workingOrders || []), ...(state.unconfirmedOrders || [])];
    const nextOrders = new Map();
    for (const order of orders) {
      const key = orderKey(order), prior = previousOrders.get(key);
      nextOrders.set(key, order.stale ? prior || order : order);
      if (!initialized || order.stale) continue;
      if (!prior && !filledThisPoll.has(key)) log(orderLine(order, 'WORKING', timeZone));
      else if (prior && orderTerms(prior) !== orderTerms(order)) log(orderLine(order, 'UPDATED', timeZone));
    }
    const nextEvents = new Set();
    for (const event of [...(state.orderEvents || [])].reverse()) {
      const key = JSON.stringify([orderKey(event), event.status]);
      nextEvents.add(key);
      // Filled is the order confirmation of an execution, not a second action.
      // Push snapshots may see it before the separately scheduled fill poll.
      if (!initialized || previousEvents.has(key) || event.status === 'Filled' || nextOrders.has(orderKey(event))) continue;
      log(orderLine(event, text(event.status).toUpperCase(), timeZone));
    }
    const unknownAccounts = (state.accounts || []).filter(account => account.workingOrdersStatus !== 'CURRENT').map(account => account.accountId).sort();
    const unknownOrders = orders.filter(order => order.stale).map(orderKey).sort();
    const coverage = JSON.stringify([unknownAccounts, unknownOrders]);
    const incomplete = unknownAccounts.length || unknownOrders.length;
    if (coverage !== previousCoverage && (incomplete || (initialized && previousCoverage !== '[[],[]]'))) {
      log(incomplete ? `NINJATRADER ORDER COVERAGE UNCONFIRMED | ${unknownAccounts.length} account(s), ${unknownOrders.length} order(s) | no cancellation inferred`
        : 'NINJATRADER ORDER COVERAGE RECOVERED');
    }
    previousOrders = nextOrders; previousEvents = nextEvents; previousCoverage = coverage; initialized = true;
    filledThisPoll.clear();
  };
  // The monitor calls this only for new fills after an entirely successful poll.
  observe.fill = fill => { log(formatNinjaTraderActionFill(fill, timeZone)); filledThisPoll.add(orderKey(fill)); };
  return observe;
}
