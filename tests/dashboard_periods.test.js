const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboard = require('../dashboard_periods.js');

const TIME_ZONE = 'America/Los_Angeles';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test('counts a complaint submitted today and excludes yesterday from today', () => {
  const now = new Date('2026-06-17T19:00:00.000Z');
  const counts = dashboard.countRecordsByPeriod([
    { id: 1, created_at: '2026-06-17T08:00:00.000Z' },
    { id: 2, created_at: '2026-06-17T06:59:59.000Z' }
  ], now, TIME_ZONE);

  assert.deepEqual(counts, { today: 1, week: 2, month: 2, allTime: 2 });
});

test('uses Monday at local midnight as the weekly boundary', () => {
  const now = new Date('2026-07-15T19:00:00.000Z');
  const boundaries = dashboard.getPeriodBoundaries(now, TIME_ZONE);
  assert.equal(boundaries.weekStart.toISOString(), '2026-07-13T07:00:00.000Z');

  const counts = dashboard.countRecordsByPeriod([
    { id: 1, created_at: '2026-07-13T07:00:00.000Z' },
    { id: 2, created_at: '2026-07-13T06:59:59.000Z' }
  ], now, TIME_ZONE);
  assert.equal(counts.week, 1);
});

test('handles first-day and last-day month boundaries', () => {
  const now = new Date('2026-07-01T06:30:00.000Z');
  const counts = dashboard.countRecordsByPeriod([
    { id: 1, created_at: '2026-06-01T07:00:00.000Z' },
    { id: 2, created_at: '2026-06-01T06:59:59.000Z' },
    { id: 3, created_at: '2026-07-01T06:29:59.000Z' }
  ], now, TIME_ZONE);

  assert.equal(counts.month, 2);
  assert.equal(counts.allTime, 3);
});

test('handles December-to-January month ranges', () => {
  const january = dashboard.getMonthRange('2027-01', TIME_ZONE);
  assert.equal(january.start.toISOString(), '2027-01-01T08:00:00.000Z');
  assert.equal(january.end.toISOString(), '2027-02-01T08:00:00.000Z');
  assert.deepEqual(
    dashboard.listMonthKeys('2026-12-15T20:00:00.000Z', '2027-01-02T20:00:00.000Z', TIME_ZONE),
    ['2027-01', '2026-12']
  );
});

test('uses 23-hour and 25-hour local days across DST transitions', () => {
  const spring = dashboard.getPeriodBoundaries('2026-03-08T20:00:00.000Z', TIME_ZONE);
  assert.equal(spring.todayStart.toISOString(), '2026-03-08T08:00:00.000Z');
  assert.equal(spring.tomorrowStart.toISOString(), '2026-03-09T07:00:00.000Z');
  assert.equal(spring.tomorrowStart - spring.todayStart, 23 * 60 * 60 * 1000);

  const fall = dashboard.getPeriodBoundaries('2026-11-01T20:00:00.000Z', TIME_ZONE);
  assert.equal(fall.todayStart.toISOString(), '2026-11-01T07:00:00.000Z');
  assert.equal(fall.tomorrowStart.toISOString(), '2026-11-02T08:00:00.000Z');
  assert.equal(fall.tomorrowStart - fall.todayStart, 25 * 60 * 60 * 1000);
});

test('includes zero-complaint months between first record and current month', () => {
  assert.deepEqual(
    dashboard.listMonthKeys('2026-01-12T20:00:00.000Z', '2026-04-02T20:00:00.000Z', TIME_ZONE),
    ['2026-04', '2026-03', '2026-02', '2026-01']
  );
});

test('keeps an all-time cumulative count', () => {
  const counts = dashboard.countRecordsByPeriod([
    { id: 1, created_at: '2024-01-01T08:00:00.000Z' },
    { id: 2, created_at: '2025-01-01T08:00:00.000Z' },
    { id: 3, created_at: '2026-01-01T08:00:00.000Z' }
  ], '2026-07-15T19:00:00.000Z', TIME_ZONE);
  assert.equal(counts.allTime, 3);
});

test('retry reads and reuses the unresolved submission UUID', () => {
  const storage = memoryStorage();
  let calls = 0;
  const cryptoProvider = { randomUUID: () => `00000000-0000-4000-8000-${String(++calls).padStart(12, '0')}` };

  const first = dashboard.createPendingSubmission(
    storage,
    'Granada Hills North',
    1000,
    cryptoProvider,
    '12:00 PM'
  );
  const retry = dashboard.getPendingSubmission(storage);
  assert.equal(retry.id, first.id);
  assert.equal(calls, 1);
});

test('a deliberate new same-zone complaint always receives a new UUID', () => {
  const storage = memoryStorage();
  let calls = 0;
  const cryptoProvider = { randomUUID: () => `00000000-0000-4000-8000-${String(++calls).padStart(12, '0')}` };

  const first = dashboard.createPendingSubmission(
    storage,
    'Granada Hills North',
    1000,
    cryptoProvider,
    '12:00 PM'
  );
  const next = dashboard.createPendingSubmission(
    storage,
    'Granada Hills North',
    2000,
    cryptoProvider,
    '12:00 PM'
  );
  assert.notEqual(next.id, first.id);
  assert.equal(calls, 2);
});

test('a successful request clears its pending state', () => {
  const storage = memoryStorage();
  const cryptoProvider = { randomUUID: () => '00000000-0000-4000-8000-000000000001' };
  const pending = dashboard.createPendingSubmission(
    storage,
    'Granada Hills Central',
    1000,
    cryptoProvider,
    '12:00 PM'
  );

  dashboard.clearPendingSubmission(storage, pending.id);
  assert.equal(dashboard.getPendingSubmission(storage), null);
});

test('deduplicates records carrying the same submission UUID', () => {
  const records = [
    { id: 1, submission_id: 'same-request', created_at: '2026-06-17T08:00:00.000Z' },
    { id: 2, submission_id: 'same-request', created_at: '2026-06-17T08:00:01.000Z' }
  ];
  const counts = dashboard.countRecordsByPeriod(records, '2026-06-17T19:00:00.000Z', TIME_ZONE);
  assert.equal(counts.allTime, 1);
  assert.equal(counts.today, 1);
});

test('accepts only submission-id uniqueness errors as successful retries', () => {
  assert.equal(dashboard.isDuplicateSubmissionError({
    code: '23505',
    details: 'Key (submission_id)=(example) already exists.'
  }), true);
  assert.equal(dashboard.isDuplicateSubmissionError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "reports_pkey"'
  }), false);
  assert.equal(dashboard.isDuplicateSubmissionError({ code: '42501' }), false);
});

test('distinguishes ambiguous network failures from confirmed database errors', () => {
  assert.equal(dashboard.isAmbiguousNetworkError(new TypeError('Failed to fetch')), true);
  assert.equal(dashboard.isAmbiguousNetworkError({ status: 0, message: 'Network failed' }), true);
  assert.equal(dashboard.isAmbiguousNetworkError({ code: '42501', message: 'RLS rejected insert' }), false);
});

test('two valid same-zone complaints within five minutes both count', () => {
  const records = [
    { id: 1, submission_id: 'request-one', zone: 'Granada Hills South', created_at: '2026-07-13T19:00:00.000Z' },
    { id: 2, submission_id: 'request-two', zone: 'Granada Hills South', created_at: '2026-07-13T19:04:00.000Z' }
  ];
  const counts = dashboard.countRecordsByPeriod(records, '2026-07-13T19:05:00.000Z', TIME_ZONE);
  assert.deepEqual(counts, { today: 2, week: 2, month: 2, allTime: 2 });
});

test('a disposable retry changes every applicable total only once and cleans up', () => {
  const records = [];
  const submissionId = '00000000-0000-4000-8000-000000000001';
  const createdAt = '2026-07-13T19:00:00.000Z';
  const now = '2026-07-13T20:00:00.000Z';

  function insert(payload) {
    if (records.some((record) => record.submission_id === payload.submission_id)) {
      return {
        error: {
          code: '23505',
          details: `Key (submission_id)=(${payload.submission_id}) already exists.`
        }
      };
    }
    records.push({ id: 1, created_at: createdAt, ...payload });
    return { error: null };
  }

  assert.equal(insert({ zone: 'Granada Hills North', submission_id: submissionId }).error, null);
  const retry = insert({ zone: 'Granada Hills North', submission_id: submissionId });
  assert.equal(dashboard.isDuplicateSubmissionError(retry.error), true);
  assert.equal(records.length, 1);

  const counts = dashboard.countRecordsByPeriod(records, now, TIME_ZONE);
  assert.deepEqual(counts, { today: 1, week: 1, month: 1, allTime: 1 });
  const selectedRange = dashboard.getMonthRange('2026-07', TIME_ZONE);
  const selectedMonthTotal = records.filter((record) => {
    const timestamp = new Date(record.created_at);
    return timestamp >= selectedRange.start && timestamp < selectedRange.end;
  }).length;
  assert.equal(selectedMonthTotal, 1);

  records.splice(0, records.length);
  assert.equal(records.length, 0);
});

test('migration enforces uniqueness for non-null submission UUIDs', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260713_add_report_submission_id.sql'),
    'utf8'
  );
  assert.match(migration, /submission_id uuid/i);
  assert.match(migration, /create unique index/i);
  assert.match(migration, /where submission_id is not null/i);
  assert.match(migration, /grant insert \(submission_id\)/i);
  assert.doesNotMatch(migration, /grant\s+insert\s+on\s+table/i);
  assert.doesNotMatch(migration, /grant\s+select/i);
  assert.match(migration, /anon_can_insert_submission_id/i);
  assert.match(migration, /anon_can_select_submission_id/i);
  assert.match(migration, /role_table_grants/i);
  assert.doesNotMatch(migration, /(?:create|alter|drop)\s+policy/i);
  assert.doesNotMatch(migration, /(?:enable|disable|force|no force)\s+row level security/i);
  assert.doesNotMatch(migration, /(?:update|delete from)\s+public\.reports/i);
  assert.match(migration, /rollback/i);
  assert.match(migration, /revoke insert \(submission_id\)/i);
  assert.match(migration, /drop column if exists submission_id/i);
});

test('dashboard markup exposes four periods and an accessible month selector', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'quiet_skies_granada_hills.html'), 'utf8');
  assert.match(html, /TODAY&(?:rsquo|#8217);S COMPLAINTS/i);
  assert.match(html, /<div class="stat-desc">Today<\/div>/);
  assert.match(html, /<div class="stat-desc">This Week<\/div>/);
  assert.match(html, /<div class="stat-desc">This Month<\/div>/);
  assert.match(html, /<div class="stat-desc">All Time<\/div>/);
  assert.match(html, /<label class="month-label" for="month-select">Month and year<\/label>/);
  assert.match(html, /<select class="month-select" id="month-select"/);
  assert.match(html, />Retry this report<\/button>/);
  assert.match(html, />Log a new complaint<\/button>/);
});

test('refresh recovery displays unresolved choices without submitting automatically', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'quiet_skies_granada_hills.html'), 'utf8');
  const restoreFunction = html.match(/function restorePendingSubmission\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(restoreFunction);
  assert.match(restoreFunction[1], /getPendingSubmission/);
  assert.match(restoreFunction[1], /showSubmissionRecovery/);
  assert.doesNotMatch(restoreFunction[1], /submitPendingReport|\.insert\(/);
});

test('inline application script parses and service worker caches its local dependency', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'quiet_skies_granada_hills.html'), 'utf8');
  const inlineScripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))
    .map((match) => match[1])
    .filter((script) => script.trim());
  assert.doesNotThrow(() => new Function(inlineScripts.at(-1)));

  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(serviceWorker, /quiet-skies-gh-v4-idempotency/);
  assert.match(serviceWorker, /\/dashboard_periods\.js/);
});

test('service worker deletes obsolete caches and bypasses cross-origin Supabase requests', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const listeners = {};
  const deleted = [];
  const cacheName = 'quiet-skies-gh-v4-idempotency';
  const context = {
    URL,
    fetch: async () => ({ clone: () => ({}) }),
    caches: {
      keys: async () => ['quiet-skies-gh-v2-webtrak', cacheName],
      delete: async (key) => { deleted.push(key); return true; },
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      match: async () => null
    },
    self: {
      location: { origin: 'https://www.quietskiesgh.org' },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (type, handler) => { listeners[type] = handler; }
    }
  };
  vm.runInNewContext(source, context);

  let activation;
  listeners.activate({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ['quiet-skies-gh-v2-webtrak']);

  let responded = false;
  listeners.fetch({
    request: { method: 'GET', url: 'https://whqevjejldbxgtlyagpw.supabase.co/rest/v1/reports' },
    respondWith: () => { responded = true; }
  });
  assert.equal(responded, false);
});
