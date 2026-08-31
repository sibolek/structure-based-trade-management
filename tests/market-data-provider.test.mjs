import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateMinuteBars,
  expectedClosedRthMinutes,
  freshness,
  isRegularTradingHours,
  minuteContinuity,
  normalizeBars,
  selectSessionBars,
  tradingDateKey,
} from "../schwab-bridge/market-data-provider.mjs";
import { SchwabMarketDataProvider, normalizeSchwabQuote } from "../schwab-bridge/schwab-market-data-provider.mjs";

function oneMinute(timestamp, { open, high, low, close, volume = 100 } = {}) {
  return {
    symbol: "NVDA",
    timeframe: "1m",
    source: "SCHWAB",
    timestamp,
    time: new Date(timestamp).toISOString(),
    open,
    high,
    low,
    close,
    volume,
  };
}

test("normalizes Schwab quote fields without leaking raw payload", () => {
  const payload = {
    NVDA: {
      assetMainType: "EQUITY",
      quote: {
        bidPrice: 180.1,
        askPrice: 180.14,
        lastPrice: 180.12,
        quoteTime: 1_800_000_000_000,
        tradeTime: 1_799_999_999_000,
      },
    },
  };

  const quote = normalizeSchwabQuote(payload, "nvda", { receivedAtMs: 1_800_000_000_500 });
  assert.equal(quote.symbol, "NVDA");
  assert.equal(quote.bid, 180.1);
  assert.equal(quote.ask, 180.14);
  assert.equal(quote.last, 180.12);
  assert.equal(quote.mark, 180.12);
  assert.equal(quote.assetMainType, "EQUITY");
  assert.equal(quote.asOf, new Date(1_800_000_000_000).toISOString());
  assert.equal("quote" in quote, false);
});

test("normalizes and sorts candles", () => {
  const bars = normalizeBars([
    { datetime: 120_000, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
    { datetime: 60_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  ], { symbol: "NVDA", timeframe: "1m", source: "SCHWAB" });

  assert.deepEqual(bars.map((bar) => bar.timestamp), [60_000, 120_000]);
  assert.equal(bars[0].symbol, "NVDA");
  assert.equal(bars[0].timeframe, "1m");
});

test("RTH session selection uses America/New_York and honors DST", () => {
  const edt = [
    oneMinute(Date.parse("2026-08-28T13:29:00.000Z"), { open: 1, high: 1, low: 1, close: 1 }),
    oneMinute(Date.parse("2026-08-28T13:30:00.000Z"), { open: 2, high: 2, low: 2, close: 2 }),
    oneMinute(Date.parse("2026-08-28T19:59:00.000Z"), { open: 3, high: 3, low: 3, close: 3 }),
    oneMinute(Date.parse("2026-08-28T20:00:00.000Z"), { open: 4, high: 4, low: 4, close: 4 }),
  ];
  const rth = selectSessionBars(edt, { session: "RTH", tradingDate: "2026-08-28" });
  assert.deepEqual(rth.map((bar) => bar.timestamp), [Date.parse("2026-08-28T13:30:00.000Z"), Date.parse("2026-08-28T19:59:00.000Z")]);
  assert.equal(isRegularTradingHours(Date.parse("2026-08-28T13:30:00.000Z")), true);
  assert.equal(isRegularTradingHours(Date.parse("2026-08-28T20:00:00.000Z")), false);
  assert.equal(tradingDateKey(Date.parse("2026-08-28T03:59:00.000Z")), "2026-08-27");

  assert.equal(isRegularTradingHours(Date.parse("2026-01-05T14:30:00.000Z")), true); // 09:30 EST
  assert.equal(isRegularTradingHours(Date.parse("2026-01-05T21:00:00.000Z")), false); // 16:00 EST
});

test("expected closed RTH minute count follows the New York session clock", () => {
  assert.equal(expectedClosedRthMinutes(Date.parse("2026-08-31T13:29:59.000Z")), 0);
  assert.equal(expectedClosedRthMinutes(Date.parse("2026-08-31T13:30:59.000Z")), 0);
  assert.equal(expectedClosedRthMinutes(Date.parse("2026-08-31T13:31:00.000Z")), 1);
  assert.equal(expectedClosedRthMinutes(Date.parse("2026-08-31T13:45:37.000Z")), 15);
  assert.equal(expectedClosedRthMinutes(Date.parse("2026-08-31T13:52:02.000Z")), 22);
  assert.equal(expectedClosedRthMinutes(Date.parse("2026-08-31T20:00:00.000Z")), 390);
});

test("minute continuity detects missing and duplicate slots", () => {
  const base = Date.parse("2026-08-28T13:30:00.000Z");
  const bars = [
    oneMinute(base, { open: 1, high: 1, low: 1, close: 1 }),
    oneMinute(base + 60_000, { open: 1, high: 1, low: 1, close: 1 }),
    oneMinute(base + 60_000, { open: 1, high: 1, low: 1, close: 1 }),
    oneMinute(base + 180_000, { open: 1, high: 1, low: 1, close: 1 }),
  ];

  const report = minuteContinuity(bars);
  assert.equal(report.uniqueSlots, 3);
  assert.equal(report.duplicates, 1);
  assert.equal(report.missingSlots, 1);
  assert.equal(report.contiguous, false);
});

test("full 390-minute RTH session aggregates to 195 complete 2-minute bars", () => {
  const base = Date.parse("2026-08-28T13:30:00.000Z");
  const bars = Array.from({ length: 390 }, (_, index) => oneMinute(base + index * 60_000, {
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 100,
  }));
  const selected = selectSessionBars(bars, { session: "RTH", tradingDate: "2026-08-28" });
  const continuity = minuteContinuity(selected);
  const aggregated = aggregateMinuteBars(selected, { minutes: 2, nowMs: Date.parse("2026-08-28T20:00:01.000Z") });

  assert.equal(selected.length, 390);
  assert.equal(continuity.missingSlots, 0);
  assert.equal(continuity.duplicates, 0);
  assert.equal(aggregated.length, 195);
  assert.equal(aggregated.every((bar) => bar.sourceComplete), true);
  assert.equal(aggregated.every((bar) => bar.temporallyClosed), true);
  assert.equal(aggregated.every((bar) => bar.complete), true);
  assert.equal(aggregated[0].timestamp, base);
  assert.equal(aggregated.at(-1).timestamp, Date.parse("2026-08-28T19:58:00.000Z"));
});

test("aggregates aligned 1-minute candles into deterministic complete and incomplete 2-minute bars", () => {
  const base = Date.parse("2026-08-28T13:30:00.000Z"); // 09:30 ET during EDT
  const bars = [
    oneMinute(base, { open: 100, high: 101, low: 99.5, close: 100.5, volume: 100 }),
    oneMinute(base + 60_000, { open: 100.5, high: 102, low: 100.25, close: 101.75, volume: 150 }),
    oneMinute(base + 120_000, { open: 101.75, high: 102.25, low: 101.5, close: 102, volume: 90 }),
  ];

  const aggregated = aggregateMinuteBars(bars, { minutes: 2, nowMs: base + 4 * 60_000 });
  assert.equal(aggregated.length, 2);
  assert.deepEqual(aggregated[0], {
    symbol: "NVDA",
    timeframe: "2m",
    source: "SCHWAB",
    timestamp: base,
    time: new Date(base).toISOString(),
    open: 100,
    high: 102,
    low: 99.5,
    close: 101.75,
    volume: 250,
    sampleCount: 2,
    sourceComplete: true,
    temporallyClosed: true,
    complete: true,
    lastSourceTimestamp: base + 60_000,
  });
  assert.equal(aggregated[1].sampleCount, 1);
  assert.equal(aggregated[1].sourceComplete, false);
  assert.equal(aggregated[1].temporallyClosed, true);
  assert.equal(aggregated[1].complete, false);
});

test("forming 2-minute bar is source-complete but not temporally closed", () => {
  const base = Date.parse("2026-08-31T13:44:00.000Z");
  const bars = [
    oneMinute(base, { open: 218.06, high: 218.21, low: 217.8, close: 217.86, volume: 150_000 }),
    oneMinute(base + 60_000, { open: 217.86, high: 218.1, low: 217.78, close: 218.025, volume: 196_640 }),
  ];

  const forming = aggregateMinuteBars(bars, { minutes: 2, nowMs: Date.parse("2026-08-31T13:45:37.000Z") })[0];
  assert.equal(forming.sourceComplete, true);
  assert.equal(forming.temporallyClosed, false);
  assert.equal(forming.complete, false);

  const closed = aggregateMinuteBars(bars, { minutes: 2, nowMs: Date.parse("2026-08-31T13:46:02.000Z") })[0];
  assert.equal(closed.sourceComplete, true);
  assert.equal(closed.temporallyClosed, true);
  assert.equal(closed.complete, true);
});

test("closed 2-minute interval with a missing source minute remains incomplete", () => {
  const base = Date.parse("2026-08-31T13:44:00.000Z");
  const bars = [
    oneMinute(base, { open: 218.06, high: 218.21, low: 217.8, close: 217.86, volume: 150_000 }),
  ];

  const aggregated = aggregateMinuteBars(bars, { minutes: 2, nowMs: Date.parse("2026-08-31T13:46:10.000Z") })[0];
  assert.equal(aggregated.sourceComplete, false);
  assert.equal(aggregated.temporallyClosed, true);
  assert.equal(aggregated.complete, false);
});

test("freshness fails closed for invalid timestamps and marks old data stale", () => {
  assert.equal(freshness(null, { nowMs: 10_000, maxAgeMs: 1_000 }).isStale, true);
  assert.equal(freshness(9_500, { nowMs: 10_000, maxAgeMs: 1_000 }).isStale, false);
  assert.equal(freshness(8_000, { nowMs: 10_000, maxAgeMs: 1_000 }).isStale, true);
});

test("Schwab provider builds quote, minute, and daily read-only requests", async () => {
  const urls = [];
  const requestJson = async (url) => {
    urls.push(new URL(url));
    if (url.includes("/quotes")) {
      return { NVDA: { quote: { bidPrice: 100, askPrice: 100.1, lastPrice: 100.05, quoteTime: 1_800_000_000_000 } } };
    }
    return { candles: [{ datetime: 1_800_000_000_000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }] };
  };

  const provider = new SchwabMarketDataProvider({ requestJson, now: () => 1_800_000_001_000 });
  const quote = await provider.getQuote("nvda");
  const minute = await provider.getMinuteBars("NVDA", { startDate: 1_799_999_000_000, endDate: 1_800_001_000_000 });
  const daily = await provider.getDailyBars("NVDA");

  assert.equal(quote.symbol, "NVDA");
  assert.equal(minute[0].timeframe, "1m");
  assert.equal(daily[0].timeframe, "1d");

  assert.equal(urls[0].pathname, "/marketdata/v1/quotes");
  assert.equal(urls[0].searchParams.get("symbols"), "NVDA");
  assert.equal(urls[0].searchParams.get("fields"), "quote,reference");

  assert.equal(urls[1].pathname, "/marketdata/v1/pricehistory");
  assert.equal(urls[1].searchParams.get("frequencyType"), "minute");
  assert.equal(urls[1].searchParams.get("frequency"), "1");
  assert.equal(urls[1].searchParams.get("needExtendedHoursData"), "true");

  assert.equal(urls[2].pathname, "/marketdata/v1/pricehistory");
  assert.equal(urls[2].searchParams.get("frequencyType"), "daily");
  assert.equal(urls[2].searchParams.get("frequency"), "1");
});
