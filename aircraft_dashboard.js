(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuietSkiesAircraft = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ENDPOINT = 'https://whqevjejldbxgtlyagpw.supabase.co/functions/v1/quiet-skies-public-aircraft';
  const REFRESH_MS = 30000;
  const STALE_MS = 2 * 60 * 1000;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
  });
  const number = new Intl.NumberFormat('en-US');
  const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const validCount = (value) => Number.isSafeInteger(value) && value >= 0;

  function parseSummary(data) {
    if (!data || !validDate(data.asOf) || data.timeZone !== 'America/Los_Angeles' ||
        !validCount(data.counts?.today) || !validCount(data.counts?.allTime) ||
        data.counts.today > data.counts.allTime || !Array.isArray(data.recent) ||
        typeof data.coverage?.area !== 'string' || !data.coverage.area.trim() ||
        !Number.isFinite(data.coverage.radiusNm) || data.coverage.radiusNm <= 0 ||
        !Number.isFinite(data.coverage.maxEstimatedAglFt) || data.coverage.maxEstimatedAglFt < 0 ||
        data.source !== 'FlyItalyADSB') {
      throw new Error('Invalid aircraft summary');
    }
    // Only the public summary fields enter UI state. Never render raw response HTML.
    return {
      asOf: data.asOf,
      today: data.counts.today,
      allTime: data.counts.allTime,
      area: data.coverage.area.trim(),
      radiusNm: data.coverage.radiusNm,
      maxAgl: data.coverage.maxEstimatedAglFt,
      recent: data.recent.filter((flight) => flight && validDate(flight.detectedAt) &&
        Date.parse(flight.detectedAt) <= Date.parse(data.asOf))
        .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
        .slice(0, 8).map((flight) => ({
          detectedAt: flight.detectedAt,
          agl: Number.isFinite(flight.estimatedAglFt) ? Math.round(flight.estimatedAglFt) : null
        }))
    };
  }

  async function fetchSummary({ fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) throw new Error('Aircraft summary unavailable');
      return parseSummary(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  function mount({ document, fetchImpl = globalThis.fetch, now = Date.now,
    setIntervalImpl = globalThis.setInterval, clearIntervalImpl = globalThis.clearInterval } = {}) {
    const el = (id) => document.getElementById(id);
    const section = el('aircraft-section');
    let lastSummary = null;
    let inFlight = false;
    let stopped = false;

    function render(summary) {
      el('aircraft-today').textContent = number.format(summary.today);
      el('aircraft-all-time').textContent = number.format(summary.allTime);
      el('aircraft-coverage').textContent = `${summary.area} · ${number.format(summary.radiusNm)} nautical mile radius · up to ${number.format(summary.maxAgl)} ft estimated above ground`;
      const rows = summary.recent.map((flight) => {
        const row = document.createElement('li');
        row.className = 'aircraft-row';
        const time = document.createElement('time');
        time.dateTime = flight.detectedAt;
        time.textContent = formatter.format(new Date(flight.detectedAt));
        const altitude = document.createElement('span');
        altitude.textContent = flight.agl === null ? 'Altitude unavailable' : `~${number.format(flight.agl)} ft above ground`;
        row.append(time, altitude);
        return row;
      });
      if (!rows.length) {
        const empty = document.createElement('li');
        empty.className = 'aircraft-empty';
        empty.textContent = 'No recent flights detected.';
        rows.push(empty);
      }
      el('aircraft-recent').replaceChildren(...rows);
    }

    function status(failed = false) {
      const stale = lastSummary && now() - Date.parse(lastSummary.asOf) > STALE_MS;
      el('aircraft-badge').textContent = failed ? 'Unavailable' : stale ? 'Delayed' : 'Updated';
      el('aircraft-status').textContent = lastSummary
        ? `${failed || stale ? 'Updates delayed. Showing last available data. ' : ''}Summary updated ${formatter.format(new Date(lastSummary.asOf))}.`
        : 'Flight data is temporarily unavailable. Retrying automatically.';
    }

    async function refresh() {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      section.setAttribute('aria-busy', 'true');
      try {
        const summary = await fetchSummary({ fetchImpl });
        if (stopped) return;
        lastSummary = summary;
        render(summary);
        status();
      } catch (_) {
        if (stopped) return;
        if (!lastSummary) {
          el('aircraft-coverage').textContent = 'Monitoring coverage is temporarily unavailable.';
          el('aircraft-today').textContent = '—';
          el('aircraft-all-time').textContent = '—';
          const message = document.createElement('li');
          message.className = 'aircraft-empty';
          message.textContent = 'Recent-flight history is temporarily unavailable.';
          el('aircraft-recent').replaceChildren(message);
        }
        status(true);
      } finally {
        inFlight = false;
        section.setAttribute('aria-busy', 'false');
      }
    }
    const onVisibility = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setIntervalImpl(refresh, REFRESH_MS);
    refresh();
    return {
      refresh,
      stop() {
        stopped = true;
        clearIntervalImpl(timer);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }

  return { parseSummary, fetchSummary, mount };
});
