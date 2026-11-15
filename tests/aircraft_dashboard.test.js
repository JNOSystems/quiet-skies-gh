const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const aircraft = require('../aircraft_dashboard.js');

function payload(overrides = {}) {
  return {
    source: 'FlyItalyADSB', asOf: '2026-11-15T21:00:00Z', timeZone: 'America/Los_Angeles',
    counts: { today: 20, allTime: 42 },
    coverage: { area: 'Granada Hills North', radiusNm: 1, maxEstimatedAglFt: 5000 },
    recent: [{ detectedAt: '2026-11-15T20:30:00Z', estimatedAglFt: 1270 }],
    ...overrides
  };
}

function harness(fetchImpl, now = () => Date.parse('2026-11-15T21:00:15Z')) {
  const elements = new Map();
  const listeners = new Map();
  function element() {
    return {
      textContent: '', children: [], attributes: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }
    };
  }
  const document = {
    hidden: false,
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element,
    addEventListener(event, listener) { listeners.set(event, listener); },
    removeEventListener(event) { listeners.delete(event); }
  };
  let tick, interval, cleared = false;
  const controller = aircraft.mount({ document, fetchImpl, now,
    setIntervalImpl(callback, ms) { tick = callback; interval = ms; return 1; },
    clearIntervalImpl() { cleared = true; }
  });
  return { document, controller, el: document.getElementById, listeners,
    tick: () => tick(), interval, isCleared: () => cleared };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const text = (el) => [el.textContent, ...el.children.map(text)].join(' ');

test('reads the existing public function without credentials or writes', async () => {
  let request;
  const result = await aircraft.fetchSummary({ fetchImpl: async (url, init) => {
    request = { url, init };
    return Response.json(payload());
  } });
  assert.equal(result.today, 20);
  assert.match(request.url, /\/functions\/v1\/quiet-skies-public-aircraft$/);
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.cache, 'no-store');
  assert.equal(request.init.body, undefined);
  assert.equal(request.init.headers, undefined);
});

test('rejects failed, invalid JSON, malformed counts and wrong timezone responses', async () => {
  for (const response of [new Response('', { status: 503 }), new Response('bad json'),
    Response.json(payload({ counts: { today: -1, allTime: 5 } })),
    Response.json(payload({ counts: { today: '0', allTime: 5 } })),
    Response.json(payload({ counts: { today: 10, allTime: 5 } })),
    Response.json(payload({ timeZone: 'UTC' })), Response.json(payload({ asOf: null }))]) {
    await assert.rejects(aircraft.fetchSummary({ fetchImpl: async () => response }));
  }
});

test('aborts a hung request and allows callers to recover', async () => {
  await assert.rejects(aircraft.fetchSummary({ timeoutMs: 10, fetchImpl: (_, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  }), /aborted/);
});

test('normalizes only public fields, orders recent flights, limits eight and preserves unknown altitude', () => {
  const result = aircraft.parseSummary(payload({
    recent: [null, { detectedAt: 'bad' }, { detectedAt: '2027-01-01T00:00:00Z' },
      ...Array.from({ length: 10 }, (_, i) => ({
        detectedAt: `2026-11-15T20:${String(i).padStart(2, '0')}:00Z`,
        estimatedAglFt: i === 9 ? null : 1000.7, hex: 'private', latitude: 1
      }))], secret: 'private'
  }));
  assert.equal(result.recent.length, 8);
  assert.equal(result.recent[0].detectedAt, '2026-11-15T20:09:00Z');
  assert.equal(result.recent[0].agl, null);
  assert.equal(result.recent[1].agl, 1001);
  assert.doesNotMatch(JSON.stringify(result), /private|latitude|hex/);
});

test('renders Pacific dates, counts and altitude independently of complaint elements', async () => {
  const h = harness(async () => Response.json(payload()));
  h.el('counter').textContent = '7';
  h.el('logList').textContent = 'Community complaint';
  await settle();
  assert.equal(h.el('aircraft-today').textContent, '20');
  assert.equal(h.el('aircraft-all-time').textContent, '42');
  assert.match(text(h.el('aircraft-recent')), /Nov 15, 2026.*12:30:00 PM PST.*1,270 ft above ground/);
  assert.equal(h.el('counter').textContent, '7');
  assert.equal(h.el('logList').textContent, 'Community complaint');
  assert.equal(h.el('aircraft-section').attributes['aria-busy'], 'false');
  assert.equal(h.interval, 30000);
  h.controller.stop();
  assert.equal(h.isCleared(), true);
  assert.equal(h.listeners.size, 0);
});

test('formats summer and winter detections in Los Angeles time regardless of browser timezone', async () => {
  const h = harness(async () => Response.json(payload({ recent: [
    { detectedAt: '2026-11-01T09:30:00Z', estimatedAglFt: 0 },
    { detectedAt: '2026-11-01T08:30:00Z', estimatedAglFt: null }
  ] })));
  await settle();
  const output = text(h.el('aircraft-recent'));
  assert.match(output, /1:30:00 AM PST/);
  assert.match(output, /1:30:00 AM PDT/);
  assert.match(output, /~0 ft above ground/);
  assert.match(output, /Altitude unavailable/);
  h.controller.stop();
});

test('zero counts display only after a successful response, with a distinct empty history', async () => {
  const h = harness(async () => Response.json(payload({ counts: { today: 0, allTime: 0 }, recent: [] })));
  await settle();
  assert.equal(h.el('aircraft-today').textContent, '0');
  assert.match(text(h.el('aircraft-recent')), /No recent flights detected/);
  h.controller.stop();
});

test('initial failure is unavailable, retains last good data after failure and recovers', async () => {
  let fail = true;
  const h = harness(async () => { if (fail) throw new Error('offline'); return Response.json(payload()); });
  await settle();
  assert.equal(h.el('aircraft-today').textContent, '—');
  assert.match(text(h.el('aircraft-recent')), /unavailable/);
  fail = false;
  await h.controller.refresh();
  assert.equal(h.el('aircraft-today').textContent, '20');
  fail = true;
  await h.controller.refresh();
  assert.equal(h.el('aircraft-today').textContent, '20');
  assert.match(h.el('aircraft-status').textContent, /Updates delayed.*last available data/);
  fail = false;
  await h.controller.refresh();
  assert.equal(h.el('aircraft-badge').textContent, 'Updated');
  h.controller.stop();
});

test('old successful summaries are labelled delayed', async () => {
  const h = harness(async () => Response.json(payload()), () => Date.parse('2026-11-16T00:00:00Z'));
  await settle();
  assert.equal(h.el('aircraft-badge').textContent, 'Delayed');
  h.controller.stop();
});

test('avoids overlapping requests, pauses hidden tabs and refreshes when visible', async () => {
  let calls = 0, release;
  const h = harness(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  await h.tick();
  assert.equal(calls, 1);
  release(Response.json(payload()));
  await settle();
  h.document.hidden = true;
  await h.tick();
  assert.equal(calls, 1);
  h.document.hidden = false;
  h.listeners.get('visibilitychange')();
  assert.equal(calls, 2);
  release(Response.json(payload()));
  await settle();
  h.controller.stop();
  await h.tick();
  assert.equal(calls, 2);
});

test('service worker installs new shell, expires old cache, serves repeat/offline loads and bypasses APIs', async () => {
  const events = {}, entries = new Map(), deleted = [];
  let networkFails = false, claimed = false, skipped = false;
  const cache = {
    async addAll(urls) { urls.forEach(url => entries.set(url, `cached:${url}`)); },
    async put(request, value) { entries.set(request.url, value); }
  };
  const context = {
    URL, self: { location: { origin: 'https://quiet-skies-gh.netlify.app' },
      addEventListener: (name, handler) => { events[name] = handler; },
      skipWaiting: async () => { skipped = true; }, clients: { claim: async () => { claimed = true; } } },
    caches: { open: async () => cache, keys: async () => ['quiet-skies-gh-v5-secure-reporting', 'quiet-skies-gh-v6-automatic-flights'],
      delete: async key => { deleted.push(key); }, match: async request => entries.get(request.url || request) },
    fetch: async () => { if (networkFails) throw new Error('offline'); return { ok: true, clone: () => 'fresh asset' }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
  let pending;
  events.install({ waitUntil: p => { pending = p; } }); await pending;
  assert.equal(skipped, true);
  assert.equal(entries.has('/aircraft_dashboard.js'), true);
  events.activate({ waitUntil: p => { pending = p; } }); await pending;
  assert.deepEqual(deleted, ['quiet-skies-gh-v5-secure-reporting']);
  assert.equal(claimed, true);
  for (const url of ['https://whqevjejldbxgtlyagpw.supabase.co/functions/v1/quiet-skies-public-aircraft',
    'https://quiet-skies-gh.netlify.app/api/report', 'https://quiet-skies-gh.netlify.app/.netlify/functions/submit-report']) {
    events.fetch({ request: { url, method: 'GET' }, respondWith() { assert.fail('API must bypass cache'); } });
  }
  const request = { method: 'GET', url: 'https://quiet-skies-gh.netlify.app/aircraft_dashboard.js' };
  events.fetch({ request, respondWith: p => { pending = p; } }); await pending;
  await settle();
  networkFails = true;
  events.fetch({ request, respondWith: p => { pending = p; } });
  assert.equal(await pending, 'fresh asset');
});
