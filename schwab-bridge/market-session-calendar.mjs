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

// Published 2026 NYSE/Nasdaq core-market calendar. These dates are stable
// annual exchange closures/early closes rather than inferred from bar data.
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

// CME explicitly warns that holiday schedules are product-specific and are
// usually finalized only shortly before each holiday. Therefore an annual
// weekday assumption is not trusted on these dates. A CME holiday date must
// have an explicit verified product-family override below or it fails closed.
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

// V2.4 has directly verified the CME equity-index RTH boundary for Labor Day
// 2026 against the live Schwab /MESU26 stream: 210 one-minute bars from
// 09:30 through 12:59 ET, i.e. a 13:00 ET scheduled RTH close. MES/MNQ/ES/NQ
// share the same CME equity-index holiday family. Other CME holiday dates are
// deliberately not pre-authorized here; they remain UNVERIFIED until the
// final product schedule is checked.
const CME_EQUITY_INDEX_VERIFIED_2026 = Object.freeze({
  "2026-09-07": {
    status: MARKET_SESSION_STATUS.EARLY_CLOSE,
    openMinute: RTH_OPEN_MINUTE,
    closeMinute: 13 * 60,
    source: "CME_2026_LABOR_DAY_PLUS_LIVE_SCHWAB_MES_CONFIRMATION",
  },
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
      // Kept distinct so the blocker is diagnostic. V2.4 must not borrow
      // equity-index 09:30-16:00 RTH semantics for NYMEX energy products.
      return MARKET_SESSION_PROFILE.CME_ENERGY;
    }
    return MARKET_SESSION_PROFILE.UNSUPPORTED;
  }

  if (normalizedSymbol && !normalizedSymbol.startsWith("/") && !assetType) {
    return MARKET_SESSION_PROFILE.US_EQUITY;
  }

  return MARKET_SESSION_PROFILE.UNSUPPORTED;
}

function finalizedSchedule({
  date,
  profile,
  status,
  openMinute = null,
  closeMinute = null,
  source,
}) {
  const schedulable = ![
    MARKET_SESSION_STATUS.CLOSED,
    MARKET_SESSION_STATUS.UNVERIFIED,
  ].includes(status);
  const effectiveOpenMinute = schedulable
    ? (Number.isFinite(Number(openMinute)) ? Number(openMinute) : RTH_OPEN_MINUTE)
    : null;
  const effectiveCloseMinute = schedulable
    ? (Number.isFinite(Number(closeMinute)) ? Number(closeMinute) : NORMAL_RTH_CLOSE_MINUTE)
    : null;
  const minuteCount = effectiveOpenMinute === null || effectiveCloseMinute === null
    ? 0
    : Math.max(0, effectiveCloseMinute - effectiveOpenMinute);
  const completeTwoMinuteBars = Math.floor(minuteCount / 2);
  const lastCompleteTwoMinuteStartMinute = completeTwoMinuteBars > 0
    ? effectiveOpenMinute + (completeTwoMinuteBars - 1) * 2
    : null;

  return Object.freeze({
    schemaVersion: 1,
    calendarVersion: MARKET_SESSION_CALENDAR_VERSION,
    date,
    profile,
    status,
    openMinute: effectiveOpenMinute,
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
        openMinute: RTH_OPEN_MINUTE,
        closeMinute: earlyClose,
        source: "NYSE_NASDAQ_2026_EARLY_CLOSE_CALENDAR",
      });
    }
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile,
      status: MARKET_SESSION_STATUS.NORMAL,
      openMinute: RTH_OPEN_MINUTE,
      closeMinute: NORMAL_RTH_CLOSE_MINUTE,
      source: "NYSE_NASDAQ_2026_CORE_HOURS",
    });
  }

  if (normalizedProfile === MARKET_SESSION_PROFILE.CME_EQUITY_INDEX) {
    const verified = CME_EQUITY_INDEX_VERIFIED_2026[normalizedDate];
    if (verified) {
      return finalizedSchedule({
        date: normalizedDate,
        profile: normalizedProfile,
        ...verified,
      });
    }
    if (CME_HOLIDAY_DATES_2026.has(normalizedDate)) {
      return finalizedSchedule({
        date: normalizedDate,
        profile: normalizedProfile,
        status: MARKET_SESSION_STATUS.UNVERIFIED,
        source: "CME_PRODUCT_HOLIDAY_SCHEDULE_REQUIRES_VERIFICATION",
      });
    }
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile,
      status: MARKET_SESSION_STATUS.NORMAL,
      openMinute: RTH_OPEN_MINUTE,
      closeMinute: NORMAL_RTH_CLOSE_MINUTE,
      source: "CME_EQUITY_INDEX_NORMAL_RTH_PROFILE",
    });
  }

  if (normalizedProfile === MARKET_SESSION_PROFILE.CME_ENERGY) {
    // NYMEX energy RTH boundaries differ from the cash-equity/equity-index
    // profile and are not yet an accepted V2.4 authority. Fail closed on both
    // ordinary and holiday dates until that product-family schedule is added.
    return finalizedSchedule({
      date: normalizedDate,
      profile: normalizedProfile,
      status: MARKET_SESSION_STATUS.UNVERIFIED,
      source: "CME_ENERGY_RTH_PROFILE_NOT_YET_VERIFIED",
    });
  }

  return finalizedSchedule({
    date: normalizedDate,
    profile: normalizedProfile || MARKET_SESSION_PROFILE.UNSUPPORTED,
    status: MARKET_SESSION_STATUS.UNVERIFIED,
    source: "UNSUPPORTED_MARKET_SESSION_PROFILE",
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
