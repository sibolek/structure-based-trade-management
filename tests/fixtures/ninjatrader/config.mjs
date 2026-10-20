// Synthetic test contract, NOT an asserted NinjaTrader response schema.
export const config = {
  version: 1, environment: 'demo', bindingStatus: 'VERIFIED_FROM_AUTHENTICATED_DISCOVERY',
  instruments: { '/MESZ26': { contract: 'MESZ6', exchangeTimeZone: 'America/Chicago' } },
  bindings: {
    quote: { rows: '/quotes', symbol: '/contract', bid: '/bid', ask: '/ask', last: '/last',
      quoteTime: '/timestamp', timestampFormat: 'iso', realtime: '/realtime' },
    minute: { rows: '/bars', symbol: '/contract', timestamp: '/timestamp', timestampFormat: 'iso', timestampAnchor: 'end',
      open: '/o', high: '/h', low: '/l', close: '/c', volume: '/v', maxCount: 10000 },
    daily: { rows: '/bars', symbol: '/contract', timestamp: '/timestamp', timestampFormat: 'iso', timestampAnchor: 'start',
      open: '/o', high: '/h', low: '/l', close: '/c', volume: '/v', maxCount: 1000 },
  },
};
export const now = Date.parse('2026-10-19T14:32:00Z');
export const quotePayload = { quotes: [{ contract: 'MESZ6', bid: 6000, ask: 6000.25, last: 6000,
  timestamp: '2026-10-19T14:32:00Z', realtime: true }] };
export function candle(timestamp, extra = {}) { return { timestamp, o: 6000, h: 6001, l: 5999, c: 6000.5, v: 25, ...extra }; }
