import assert from "node:assert/strict";
import test from "node:test";
import {
  ATR_RECONSTRUCTION_COMPLETED_RTH_SESSIONS,
  reconstructWilderAtr,
  trueRange,
  wilderAtrSeries,
} from "../schwab-bridge/wilder-atr.mjs";

function bar(timestamp, {
  open = 100,
  high = 101,
  low = 100,
  close = 100.5,
  complete = true,
} = {}) {
  return {
    timestamp: Date.parse(timestamp),
    open,
    high,
    low,
    close,
    complete,
  };
}

test("Phase 3 ATR reconstruction policy uses 20 completed RTH sessions", () => {
  assert.equal(ATR_RECONSTRUCTION_COMPLETED_RTH_SESSIONS, 20);
});

test("first RTH bar true range is high-low and excludes overnight gap", () => {
  const firstBar = bar("2026-08-31T09:30:00-04:00", {
    open: 110,
    high: 111,
    low: 109,
    close: 110.5,
  });

  assert.equal(trueRange(firstBar, {
    previousClose: 100,
    isSessionFirst: true,
  }), 2);
});

test("non-first RTH bar true range includes prior-close gap within the session", () => {
  const nextBar = bar("2026-08-31T09:32:00-04:00", {
    open: 104,
    high: 105,
    low: 103,
    close: 104,
  });

  assert.equal(trueRange(nextBar, {
    previousClose: 100,
    isSessionFirst: false,
  }), 5);
});

test("Wilder ATR seeds from the arithmetic mean of the first 14 true ranges", () => {
  const ranges = Array.from({ length: 14 }, (_, index) => index + 1);
  const result = wilderAtrSeries(ranges);

  assert.equal(result.seedAtr, 7.5);
  assert.equal(result.currentAtr, 7.5);
  assert.equal(result.atrSeries.length, 1);
});

test("Wilder ATR applies recursive RMA after the seed", () => {
  const ranges = [...Array.from({ length: 14 }, (_, index) => index + 1), 15];
  const result = wilderAtrSeries(ranges);
  const expected = ((7.5 * 13) + 15) / 14;

  assert.ok(Math.abs(result.currentAtr - expected) < 1e-12);
  assert.equal(result.atrSeries.length, 2);
});

test("Wilder state carries across RTH sessions while each new session first bar uses high-low", () => {
  const bars = [];
  for (let index = 0; index < 14; index += 1) {
    const minute = 30 + index * 2;
    const hour = 9 + Math.floor(minute / 60);
    const minuteWithinHour = minute % 60;
    bars.push(bar(`2026-08-28T${String(hour).padStart(2, "0")}:${String(minuteWithinHour).padStart(2, "0")}:00-04:00`, {
      open: 100,
      high: 101,
      low: 100,
      close: 100.5,
    }));
  }

  bars.push(bar("2026-08-31T09:30:00-04:00", {
    open: 110,
    high: 111,
    low: 110,
    close: 110.5,
  }));

  const result = reconstructWilderAtr(bars);

  assert.equal(result.trueRanges.length, 15);
  assert.equal(result.trueRanges[14], 1);
  assert.equal(result.seedAtr, 1);
  assert.equal(result.currentAtr, 1);
  assert.equal(result.latestTradingDate, "2026-08-31");
});

test("reconstruction fails closed when a forming bar is supplied", () => {
  assert.throws(
    () => reconstructWilderAtr([
      bar("2026-08-31T09:30:00-04:00", { complete: false }),
    ]),
    /forming\/incomplete bars cannot enter Wilder ATR/,
  );
});

test("reconstruction fails closed when an extended-hours bar is supplied", () => {
  assert.throws(
    () => reconstructWilderAtr([
      bar("2026-08-31T08:00:00-04:00"),
    ]),
    /non-RTH bars cannot enter V2.4 Wilder ATR reconstruction/,
  );
});

test("reconstruction fails closed on duplicate timestamps", () => {
  const duplicate = bar("2026-08-31T09:30:00-04:00");
  assert.throws(
    () => reconstructWilderAtr([duplicate, { ...duplicate }]),
    /duplicate bar timestamps/,
  );
});
