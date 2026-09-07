import { EASTERN_TIME_ZONE, tradingDateKey } from "./market-data-provider.mjs";

export const MARKET_SESSION_CALENDAR_VERSION = 1;
export const MARKET_SESSION_TRUSTED_THROUGH = "2026-12-31";

export const MARKET_SESSION_PROFILE = Object.freeze({
  US_EQUITY: "US_EQUITY",
  CME_EQUITY_INDEX: "CME_EQUITY_INDEX",
  CME_ENERGY: "CME_ENERGY",
  UNSUPPORTED: "UNSUPPORTED",
});

export const MARKET_SESSION_STATUS = Object.freeze({
  NORMAL: "NORMAL",
  EARLY_CLOSE: "EARLY_CLOSE",
  CLOSED: "CLOSED",
  UNVERIFIED: "UNVERIFIED",
});

const RTH_OPEN_MINUTE = 9 * 60 + 30;
const NORMAL_RTH_CLOSE_MINUTE = 16 * 60;

const US_EQUITY_CLOSED_2026 = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

const US_EQUITY_EARLY_CLOSE_2026 = Object.freeze({
  "2026-11-27": 13 * 60,
  "2026-12-24": 13 * 60,
});

// CME dates that require an exchange-specific holiday schedule rather than a
// normal weekday assumption. Dates not explicitly verified for a supported
// product profile fail closed as UNVERIFIED.
const CME_HOLIDAY_DATES_2026 = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-11-27",
  "2026-12-24",
  "2026-12-25",
  "2026-12-31",
]);

// Verified/operational schedules for the futures families supported by V2.4.
// Labor Day 2026 is additionally corroborated by the live Schwab bar stream:
// CME equity-index RTH produced 210 one-minute bars from 09:30-12:59 ET.
const CME_EQUITY_INDEX_2026 = Object.freeze({
  "2026-01-01": { status: MARKET_SESSION_STATUS.CLOSED, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-01-19": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 13 * 60, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-02-16": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 13 * 60, source: "CME_2026_HOLIDAY_SCHEDULE" },
  // Good Friday has a special abbreviated schedule. Keep it fail-closed until
  // the exact product-family RTH boundary is registered rather than guessing.
  "2026-04-03": { status: MARKET_SESSION_STATUS.UNVERIFIED, source: "CME_2026_GOOD_FRIDAY_SPECIAL" },
  "2026-05-25": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 13 * 60, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-06-19": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 13 * 60, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-07-03": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 13 * 60, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-09-07": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 13 * 60, source: "CME_2026_LABOR_DAY_CONFIRMED" },
  "2026-11-26": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 13 * 60, source: "CME_2026_HOLIDAY_SCHEDULE" },
  // The day after Thanksgiving and Christmas Eve use product-specific closes.
  // Do not infer them from NYSE hours.
  "2026-11-27": { status: MARKET_SESSION_STATUS.UNVERIFIED, source: "CME_2026_PRODUCT_SPECIFIC_CLOSE_REQUIRED" },
  "2026-12-24": { status: MARKET_SESSION_STATUS.UNVERIFIED, source: "CME_2026_PRODUCT_SPECIFIC_CLOSE_REQUIRED" },
  "2026-12-25": { status: MARKET_SESSION_STATUS.CLOSED, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-12-31": { status: MARKET_SESSION_STATUS.NORMAL, source: "CME_2026_HOLIDAY_SCHEDULE" },
});

const CME_ENERGY_2026 = Object.freeze({
  "2026-01-01": { status: MARKET_SESSION_STATUS.CLOSED, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-01-19": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 14 * 60 + 30, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-02-16": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 14 * 60 + 30, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-04-03": { status: MARKET_SESSION_STATUS.UNVERIFIED, source: "CME_2026_GOOD_FRIDAY_SPECIAL" },
  "2026-05-25": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 14 * 60 + 30, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-06-19": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 14 * 60 + 30, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-07-03": { status: MARKET_SESSION_STATUS.UNVERIFIED, source: "CME_2026_PRODUCT_SPECIFIC_CLOSE_REQUIRED" },
  "2026-09-07": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 14 * 60 + 30, source: "CME_2026_LABOR_DAY_CONFIRMED" },
  "2026-11-26": { status: MARKET_SESSION_STATUS.EARLY_CLOSE, closeMinute: 14 * 60 + 30, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-11-27": { status: MARKET_SESSION_STATUS.UNVERIFIED, source: "CME_2026_PRODUCT_SPECIFIC_CLOSE_REQUIRED" },
  "2026-12-24": { status: MARKET_SESSION_STATUS.UNVERIFIED, source: "CME_2026_PRODUCT_SPECIFIC_CLOSE_REQUIRED" },
  "2026-12-25": { status: MARKET_SESSION_STATUS.CLOSED, source: "CME_2026_HOLIDAY_SCHEDULE" },
  "2026-12-31": { status: MARKET_SESSION_STATUS.NORMAL, source: "CME_2026_HOLIDAY_SCHEDULE" },
});

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function weekdayForDate(date) {
  const parsed = Date.parse(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "short",
  }).format(new Date(parsed));
}

function minuteOfDay(timestamp) {
  const number = Number(timestamp);
  if (!Number.isFinite(number)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(number));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function futuresRoot(symbol) {
  const normalized = upper(symbol).replace(/^\//, "");
  const roots = ["MES", "MNQ", "M2K", "MYM", "ES", "NQ", "RTY", "YM", "MCL", "CL", "NG", "RB", "HO", "BZ"];
  return roots.find((root) => normalized.startsWith(root)) || null;
}

export function resolveMarketSessionProfile({ symbol, assetMainType = null } = {}) {
  const assetType = upper(assetMainType);
  const normalizedSymbol = upper(symbol);

  if (["EQUITY", "ETF"].includes(assetType)) return MARKET_SESSION_PROFILE.US_EQUITY;

  if (assetType === "FUTURE" || normalizedSymbol.startsWith("/")) {
    const root = futuresRoot(normalizedSymbol);
    if (["MES", "MNQ", "M2K", "MYM", "ES", "NQ", "RTY", "YM"].includes(root)) {
      return MARKET_SESSION_PROFILE.CME_EQUITY_INDEX;
    }
    if (["MCL", "CL", "NG", "RB", "HO", "BZ"].includes(root)) {
      return MARKET_SESSION_PROFILE.CME_ENERGY;
    }
    return MARKET_SESSION_PROFILE.UNSUPPORTED;
  }

  if (normalizedSymbol && !normalizedSymbol.startsWith("/") && !assetType) {
    return MARKET_SESSION_PROFILE.US_EQUITY;
  }

  return MARKET_SESSION_PROFILE.UNSUPPORTED;
}

function finalizedSchedule({ date, profile, status, closeMinute = null, source }) {
  const effectiveCloseMinute = status === MARKET_SESSION_STATUS.CLOSED || status === MARKET_SESSION_STATUS.UNVERIFIED
    ? null
    : (Number.isFinite(Number(closeMinute)) ? Number(closeMinute) : NORMAL_RTH_CLOSE_MINUTE);
  const openMinute = status === MARKET_SESSION_STATUS.CLOSED || status === MARKET_SESSION_STATUS.UNVERIFIED
    ? null
    : RTH_OPEN_MINUTE;
  const minuteCount = openMinute === null || effectiveCloseMinute === null
    ? 0
    : Math.max(0, effectiveCloseMinute - openMinute);
  const completeTwoMinuteBars = Math.floor(minuteCount / 2);
  const lastCompleteTwoMinuteStartMinute = completeTwoMinuteBars > 0
    ? openMinute + (completeTwoMinuteBars - 1) * 2
    : null;

  return Object.freeze({
    schemaVersion: 1,
    calendarVersion: MARKET_SESSION_CALENDAR_VERSION,
    date,
    profile,
    status,
    openMinute,
    closeMinute: effectiveCloseMinute,
    minuteCount,
    completeTwoMinuteBars,
    lastCompleteTwoMinuteStartMinute,
    source,
    timezone: EASTERN_TIME_ZONE,
  });
}

export function sessionScheduleForDate(date, { profile } = {}) {
  const normalizedDate = text(date);
  const normalizedProfile = upper(profile);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    return finalizedSchedule({
      date: normalizedDate || null,
      profile: normalizedProfile || MARKET_SESSION_PROFILE.UNSUPPORTED,
      status: MARKET_SESSION_STATUS.UNVERIFIED,
      source: "INVALID_SESSION_DATE",
    });
  }

  const year = Number(normalizedDate.slice(0, 4));
  if (year !== 2026) {
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile || MARKET_SESSION_PROFILE.UNSUPPORTED,
      status: MARKET_SESSION_STATUS.UNVERIFIED,
      source: "MARKET_SESSION_CALENDAR_OUTSIDE_TRUSTED_YEAR",
    });
  }

  const weekday = weekdayForDate(normalizedDate);
  if (["Sat", "Sun"].includes(weekday)) {
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile,
      status: MARKET_SESSION_STATUS.CLOSED,
      source: "WEEKEND",
    });
  }

  if (normalizedProfile === MARKET_SESSION_PROFILE.US_EQUITY) {
    if (US_EQUITY_CLOSED_2026.has(normalizedDate)) {
      return finalizedSchedule({
        date: normalizedDate,
        profile: normalizedProfile,
        status: MARKET_SESSION_STATUS.CLOSED,
        source: "NYSE_NASDAQ_2026_HOLIDAY_CALENDAR",
      });
    }
    const earlyClose = US_EQUITY_EARLY_CLOSE_2026[normalizedDate];
    if (Number.isFinite(earlyClose)) {
      return finalizedSchedule({
        date: normalizedDate,
        profile: normalizedProfile,
        status: MARKET_SESSION_STATUS.EARLY_CLOSE,
        closeMinute: earlyClose,
        source: "NYSE_NASDAQ_2026_EARLY_CLOSE_CALENDAR",
      });
    }
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile,
      status: MARKET_SESSION_STATUS.NORMAL,
      source: "NYSE_NASDAQ_2026_CORE_HOURS",
    });
  }

  const cmeMap = normalizedProfile === MARKET_SESSION_PROFILE.CME_EQUITY_INDEX
    ? CME_EQUITY_INDEX_2026
    : normalizedProfile === MARKET_SESSION_PROFILE.CME_ENERGY
      ? CME_ENERGY_2026
      : null;

  if (!cmeMap) {
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile || MARKET_SESSION_PROFILE.UNSUPPORTED,
      status: MARKET_SESSION_STATUS.UNVERIFIED,
      source: "UNSUPPORTED_MARKET_SESSION_PROFILE",
    });
  }

  const override = cmeMap[normalizedDate];
  if (override) {
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile,
      ...override,
    });
  }

  if (CME_HOLIDAY_DATES_2026.has(normalizedDate)) {
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile,
      status: MARKET_SESSION_STATUS.UNVERIFIED,
      source: "CME_HOLIDAY_SCHEDULE_NOT_REGISTERED_FOR_PROFILE",
    });
  }

  return finalizedSchedule({
    date: normalizedDate,
    profile: normalizedProfile,
    status: MARKET_SESSION_STATUS.NORMAL,
    source: "CME_2026_NORMAL_RTH_PROFILE",
  });
}

export function sessionStateAt(timestamp, { profile } = {}) {
  const date = tradingDateKey(timestamp);
  const schedule = sessionScheduleForDate(date, { profile });
  if (schedule.status === MARKET_SESSION_STATUS.UNVERIFIED) {
    return Object.freeze({ state: "UNVERIFIED", date, schedule });
  }
  if (schedule.status === MARKET_SESSION_STATUS.CLOSED) {
    return Object.freeze({ state: "CLOSED", date, schedule });
  }

  const minute = minuteOfDay(timestamp);
  if (!Number.isFinite(minute)) return Object.freeze({ state: "UNVERIFIED", date, schedule });
  if (minute < schedule.openMinute) return Object.freeze({ state: "PREMARKET", date, schedule });
  if (minute < schedule.closeMinute) return Object.freeze({ state: "RTH", date, schedule });
  return Object.freeze({ state: "AFTER_HOURS", date, schedule });
}

export function expectedClosedSessionMinutes(timestamp, { profile } = {}) {
  const resolved = sessionStateAt(timestamp, { profile });
  const { schedule } = resolved;
  if (schedule.status === MARKET_SESSION_STATUS.UNVERIFIED) return null;
  if (schedule.status === MARKET_SESSION_STATUS.CLOSED) return 0;

  const minute = minuteOfDay(timestamp);
  if (!Number.isFinite(minute)) return null;
  if (minute <= schedule.openMinute) return 0;
  if (minute >= schedule.closeMinute) return schedule.minuteCount;
  return Math.max(0, minute - schedule.openMinute);
}

export function isTimestampWithinScheduledRth(timestamp, { profile } = {}) {
  return sessionStateAt(timestamp, { profile }).state === "RTH";
}

export function marketMinuteOfDay(timestamp) {
  return minuteOfDay(timestamp);
}
