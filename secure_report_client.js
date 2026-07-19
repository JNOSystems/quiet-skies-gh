(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuietSkiesSecureReporting = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REPORT_ENDPOINT = '/api/report';
  const ZONE_LABELS = Object.freeze({
    'Granada Hills North': 'North',
    'Granada Hills Central': 'Central',
    'Granada Hills South': 'South'
  });
  const VALID_ZONES = Object.freeze(Object.keys(ZONE_LABELS));

  class ReportSubmissionError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'ReportSubmissionError';
      this.status = Number(options.status || 0);
      this.code = String(options.code || 'submission_failed');
      this.retryable = Boolean(options.retryable);
    }
  }

  function getPublicZoneLabel(zone) {
    return Object.prototype.hasOwnProperty.call(ZONE_LABELS, zone)
      ? ZONE_LABELS[zone]
      : null;
  }

  function sanitizeRecentReports(records) {
    return (Array.isArray(records) ? records : [])
      .filter((record) => record && getPublicZoneLabel(record.zone))
      .map((record) => ({
        id: record.id,
        created_at: record.created_at,
        zone: record.zone
      }));
  }

  function isAmbiguousSubmissionError(error) {
    if (!error) return false;
    if (error instanceof ReportSubmissionError) return false;
    if (Number(error.status) === 0) return true;
    if (error.name === 'TypeError' || error.name === 'AbortError') return true;
    return /failed to fetch|network(?: request)? failed|load failed|connection (?:lost|failed)|timed? out/i
      .test(String(error.message || ''));
  }

  async function parseJsonResponse(response) {
    try {
      return await response.json();
    } catch (error) {
      return {};
    }
  }

  async function submitReport({
    fetchImpl = fetch,
    zone,
    submissionId,
    turnstileToken
  }) {
    const response = await fetchImpl(REPORT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      cache: 'no-store',
      credentials: 'same-origin',
      body: JSON.stringify({
        zone,
        submissionId,
        turnstileToken
      })
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw new ReportSubmissionError(
        payload.message || 'The community report could not be accepted.',
        {
          status: response.status,
          code: payload.code,
          retryable: [409, 429, 503].includes(response.status)
        }
      );
    }

    if (!payload || payload.ok !== true) {
      throw new ReportSubmissionError('The report service returned an invalid response.', {
        status: response.status,
        code: 'invalid_response',
        retryable: true
      });
    }

    return {
      accepted: true,
      duplicate: payload.duplicate === true,
      requestId: typeof payload.requestId === 'string' ? payload.requestId : ''
    };
  }

  return {
    REPORT_ENDPOINT,
    ReportSubmissionError,
    VALID_ZONES,
    ZONE_LABELS,
    getPublicZoneLabel,
    isAmbiguousSubmissionError,
    sanitizeRecentReports,
    submitReport
  };
}));
