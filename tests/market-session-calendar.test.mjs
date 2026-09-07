import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKET_SESSION_PROFILE,
  MARKET_SESSION_STATUS,
  expectedClosedSessionMinutes,
  resolveMarketSessionProfile,
  sessionScheduleForDate,
  sessionStateAt,
} from "../schwab-bridge/market-session-calendar.mjs";

test("US equities are fully closed on Labor Day 2026", () => {
  const profile = resolveMarketSessionProfile({ symbol: "NVDA", assetMainType: "EQUITY" });
  assert.equal(profile, MARKET_SESSION_PROFILE.US_EQUITY);

  const schedule = sessionScheduleForDate("2026-09-07", { profile });
  assert.equal(schedule.status, MARKET_SESSION_STATUS.CLOSED);
  assert.equal(schedule.minuteCount, 0);
  assert.equal(schedule.completeTwoMinuteBars, 0);
  assert.equal(sessionStateAt(Date.parse("2026-09-07T15:00:00.000Z"), { profile }).state, "CLOSED");
  assert.equal(expectedClosedSessionMinutes(Date.parse("2026-09-07T17:45:00.000Z"), { profile }), 0);
});

test("US equity early closes use the published 13:00 ET core-session boundary", () => {
  const profile = MARKET_SESSION_PROFILE.US_EQUITY;
  for (const date of ["2026-11-27", "2026-12-24"]) {
    const schedule = sessionScheduleForDate(date, { profile });
    assert.equal(schedule.status, MARKET_SESSION_STATUS.EARLY_CLOSE);
    assert.equal(schedule.openMinute, 9 * 60 + 30);
    assert.equal(schedule.closeMinute, 13 * 60);
    assert.equal(schedule.minuteCount, 210);
    assert.equal(schedule.completeTwoMinuteBars, 105);
  }
});

test("CME equity-index futures use the verified Labor Day 13:00 ET RTH close", () => {
  for (const symbol of ["/MESU26", "/MNQU26", "/ESU26", "/NQU26"]) {
    const profile = resolveMarketSessionProfile({ symbol, assetMainType: "FUTURE" });
    assert.equal(profile, MARKET_SESSION_PROFILE.CME_EQUITY_INDEX);
    const schedule = sessionScheduleForDate("2026-09-07", { profile });
    assert.equal(schedule.status, MARKET_SESSION_STATUS.EARLY_CLOSE);
    assert.equal(schedule.openMinute, 9 * 60 + 30);
    assert.equal(schedule.closeMinute, 13 * 60);
    assert.equal(schedule.minuteCount, 210);
    assert.equal(schedule.completeTwoMinuteBars, 105);
    assert.equal(schedule.lastCompleteTwoMinuteStartMinute, 12 * 60 + 58);
  }

  const profile = MARKET_SESSION_PROFILE.CME_EQUITY_INDEX;
  assert.equal(sessionStateAt(Date.parse("2026-09-07T16:59:00.000Z"), { profile }).state, "RTH");
  assert.equal(sessionStateAt(Date.parse("2026-09-07T17:01:00.000Z"), { profile }).state, "AFTER_HOURS");
  assert.equal(expectedClosedSessionMinutes(Date.parse("2026-09-07T17:45:00.000Z"), { profile }), 210);
});

test("CME holiday dates without a finalized verified product-family override fail closed", () => {
  const profile = MARKET_SESSION_PROFILE.CME_EQUITY_INDEX;
  for (const date of ["2026-04-03", "2026-11-26", "2026-11-27", "2026-12-24"]) {
    const schedule = sessionScheduleForDate(date, { profile });
    assert.equal(schedule.status, MARKET_SESSION_STATUS.UNVERIFIED);
    assert.equal(sessionStateAt(Date.parse(`${date}T17:00:00.000Z`), { profile }).state, "UNVERIFIED");
  }
});

test("CME energy is a distinct unverified RTH profile rather than inheriting equity-index hours", () => {
  for (const symbol of ["/MCLU26", "/CLU26", "/NGV26"]) {
    const profile = resolveMarketSessionProfile({ symbol, assetMainType: "FUTURE" });
    assert.equal(profile, MARKET_SESSION_PROFILE.CME_ENERGY);
    const normalDay = sessionScheduleForDate("2026-09-08", { profile });
    const laborDay = sessionScheduleForDate("2026-09-07", { profile });
    assert.equal(normalDay.status, MARKET_SESSION_STATUS.UNVERIFIED);
    assert.equal(laborDay.status, MARKET_SESSION_STATUS.UNVERIFIED);
    assert.equal(sessionStateAt(Date.parse("2026-09-08T15:00:00.000Z"), { profile }).state, "UNVERIFIED");
  }
});

test("unknown futures and dates outside the trusted calendar fail closed", () => {
  const unsupported = resolveMarketSessionProfile({ symbol: "/GCU26", assetMainType: "FUTURE" });
  assert.equal(unsupported, MARKET_SESSION_PROFILE.UNSUPPORTED);
  assert.equal(
    sessionScheduleForDate("2026-09-08", { profile: unsupported }).status,
    MARKET_SESSION_STATUS.UNVERIFIED,
  );

  const outsideTrustedYear = sessionScheduleForDate("2027-01-04", {
    profile: MARKET_SESSION_PROFILE.US_EQUITY,
  });
  assert.equal(outsideTrustedYear.status, MARKET_SESSION_STATUS.UNVERIFIED);
});
