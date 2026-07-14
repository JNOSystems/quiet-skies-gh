(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuietSkiesDashboard = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_TIME_ZONE = 'America/Los_Angeles';
  const PENDING_SUBMISSION_KEY = 'qsgh_pending_submission';
  const formatterCache = new Map();

  function getPartsFormatter(timeZone) {
    if (!formatterCache.has(timeZone)) {
      formatterCache.set(timeZone, new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      }));
    }
    return formatterCache.get(timeZone);
  }

  function getZonedParts(value, timeZone = DEFAULT_TIME_ZONE) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new TypeError('Invalid date value');

    const values = {};
    getPartsFormatter(timeZone).formatToParts(date).forEach((part) => {
      if (part.type !== 'literal') values[part.type] = Number(part.value);
    });

    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      second: values.second
    };
  }

  function calendarDate(year, month, day) {
    const normalized = new Date(Date.UTC(year, month - 1, day));
    return {
      year: normalized.getUTCFullYear(),
      month: normalized.getUTCMonth() + 1,
      day: normalized.getUTCDate()
    };
  }

  function addCalendarDays(parts, amount) {
    return calendarDate(parts.year, parts.month, parts.day + amount);
  }

  function zonedDateTimeToUtc(parts, timeZone = DEFAULT_TIME_ZONE) {
    const target = {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour || 0,
      minute: parts.minute || 0,
      second: parts.second || 0
    };
    const targetAsUtc = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
      target.second
    );
    let guess = targetAsUtc;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const actual = getZonedParts(new Date(guess), timeZone);
      const actualAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second
      );
      const adjustment = targetAsUtc - actualAsUtc;
      guess += adjustment;
      if (adjustment === 0) return new Date(guess);
    }

    throw new RangeError(`Could not resolve ${timeZone} calendar time`);
  }

  function getPeriodBoundaries(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(current.getTime())) throw new TypeError('Invalid current date');

    const local = getZonedParts(current, timeZone);
    const localDate = { year: local.year, month: local.month, day: local.day };
    const dayOfWeek = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const weekDate = addCalendarDays(localDate, -daysSinceMonday);
    const tomorrowDate = addCalendarDays(localDate, 1);

    return {
      now: current,
      todayStart: zonedDateTimeToUtc(localDate, timeZone),
      tomorrowStart: zonedDateTimeToUtc(tomorrowDate, timeZone),
      weekStart: zonedDateTimeToUtc(weekDate, timeZone),
      monthStart: zonedDateTimeToUtc({ year: local.year, month: local.month, day: 1 }, timeZone),
      nextMonthStart: zonedDateTimeToUtc(calendarDate(local.year, local.month + 1, 1), timeZone)
    };
  }

  function getMonthKey(value, timeZone = DEFAULT_TIME_ZONE) {
    const parts = getZonedParts(value, timeZone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
  }

  function parseMonthKey(monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey));
    if (!match) throw new TypeError('Month key must use YYYY-MM');
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) throw new RangeError('Month must be between 01 and 12');
    return { year, month };
  }

  function getMonthRange(monthKey, timeZone = DEFAULT_TIME_ZONE) {
    const { year, month } = parseMonthKey(monthKey);
    return {
      start: zonedDateTimeToUtc({ year, month, day: 1 }, timeZone),
      end: zonedDateTimeToUtc(calendarDate(year, month + 1, 1), timeZone)
    };
  }

  function listMonthKeys(firstRecordDate, currentDate = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const current = getZonedParts(currentDate, timeZone);
    const first = firstRecordDate ? getZonedParts(firstRecordDate, timeZone) : current;
    let cursor = first.year * 12 + first.month - 1;
    const last = current.year * 12 + current.month - 1;
    if (cursor > last) cursor = last;

    const keys = [];
    for (let value = cursor; value <= last; value += 1) {
      const year = Math.floor(value / 12);
      const month = (value % 12) + 1;
      keys.push(`${year}-${String(month).padStart(2, '0')}`);
    }
    return keys.reverse();
  }

  function formatMonthLabel(monthKey) {
    const { year, month } = parseMonthKey(monthKey);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric'
    }).format(new Date(Date.UTC(year, month - 1, 1)));
  }

  function countRecordsByPeriod(records, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
    const boundaries = getPeriodBoundaries(now, timeZone);
    const seen = new Set();
    const counts = { today: 0, week: 0, month: 0, allTime: 0 };

    (records || []).forEach((record) => {
      const timestamp = new Date(record && record.created_at);
      if (Number.isNaN(timestamp.getTime()) || timestamp > boundaries.now) return;

      const uniqueKey = record.submission_id || record.id;
      if (uniqueKey !== undefined && uniqueKey !== null) {
        const normalizedKey = String(uniqueKey);
        if (seen.has(normalizedKey)) return;
        seen.add(normalizedKey);
      }

      counts.allTime += 1;
      if (timestamp >= boundaries.monthStart) counts.month += 1;
      if (timestamp >= boundaries.weekStart) counts.week += 1;
      if (timestamp >= boundaries.todayStart) counts.today += 1;
    });

    return counts;
  }

  function createSubmissionId(cryptoProvider) {
    if (cryptoProvider && typeof cryptoProvider.randomUUID === 'function') {
      return cryptoProvider.randomUUID();
    }
    if (!cryptoProvider || typeof cryptoProvider.getRandomValues !== 'function') {
      throw new Error('Secure random UUID generation is unavailable');
    }

    const bytes = new Uint8Array(16);
    cryptoProvider.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function getPendingSubmission(storage) {
    try {
      const pending = JSON.parse(storage.getItem(PENDING_SUBMISSION_KEY) || 'null');
      if (
        pending &&
        typeof pending.id === 'string' &&
        typeof pending.zone === 'string' &&
        Number.isFinite(pending.createdAt)
      ) {
        return pending;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function createPendingSubmission(storage, zone, nowMs, cryptoProvider, reportedAt) {
    const created = {
      id: createSubmissionId(cryptoProvider),
      zone,
      createdAt: Number(nowMs),
      reportedAt: String(reportedAt || '')
    };
    storage.setItem(PENDING_SUBMISSION_KEY, JSON.stringify(created));
    return created;
  }

  function clearPendingSubmission(storage, submissionId) {
    try {
      const pending = JSON.parse(storage.getItem(PENDING_SUBMISSION_KEY) || 'null');
      if (pending && pending.id === submissionId) storage.removeItem(PENDING_SUBMISSION_KEY);
    } catch (error) {
      storage.removeItem(PENDING_SUBMISSION_KEY);
    }
  }

  function isDuplicateSubmissionError(error) {
    if (!error || String(error.code) !== '23505') return false;
    const context = [error.message, error.details, error.hint, error.constraint]
      .filter(Boolean)
      .join(' ');
    return /submission_id|reports_submission_id_unique/i.test(context);
  }

  function isAmbiguousNetworkError(error) {
    if (!error) return false;
    if (Number(error.status) === 0) return true;
    if (error.name === 'TypeError' || error.name === 'AbortError') return true;
    const code = String(error.code || '');
    if (/^(NETWORK_ERROR|FETCH_ERROR|ECONNRESET|ETIMEDOUT)$/i.test(code)) return true;
    const context = [error.message, error.details, error.hint]
      .filter(Boolean)
      .join(' ');
    return /failed to fetch|network(?: request)? failed|load failed|connection (?:lost|failed)|timed? out/i.test(context);
  }

  return {
    DEFAULT_TIME_ZONE,
    PENDING_SUBMISSION_KEY,
    addCalendarDays,
    clearPendingSubmission,
    countRecordsByPeriod,
    createPendingSubmission,
    createSubmissionId,
    formatMonthLabel,
    getMonthKey,
    getMonthRange,
    getPendingSubmission,
    getPeriodBoundaries,
    getZonedParts,
    isAmbiguousNetworkError,
    isDuplicateSubmissionError,
    listMonthKeys,
    parseMonthKey,
    zonedDateTimeToUtc
  };
}));
