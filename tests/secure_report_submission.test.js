const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const secureClient = require('../secure_report_client.js');

const FUNCTION_PATH = path.join(
  __dirname,
  '..',
  'netlify',
  'functions',
  'submit-report.mjs'
);
const MIGRATION_PATH = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260719_secure_report_submission.sql'
);
const VALID_UUID = '8b90a282-53b4-477d-a73b-9e72b59f1d1c';
const CONTEXT_IP = '203.0.113.42';
const BASE_ENV = Object.freeze({
  CONTEXT: 'production',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test_only_never_publish',
  TURNSTILE_SECRET_KEY: 'turnstile_test_secret_for_unit_tests',
  RATE_LIMIT_HMAC_SECRET: 'unit-test-hmac-secret-with-at-least-32-characters',
  SUBMISSIONS_ENABLED: 'true'
});

let functionModule;
async function getFunctionModule() {
  if (!functionModule) functionModule = await import(pathToFileURL(FUNCTION_PATH).href);
  return functionModule;
}

function requestFor(body, options = {}) {
  const headers = new Headers(options.headers || {
    'Content-Type': 'application/json'
  });
  return new Request(options.url || 'https://www.quietskiesgh.org/api/report', {
    method: options.method || 'POST',
    headers,
    body: options.method === 'GET'
      ? undefined
      : (typeof body === 'string' ? body : JSON.stringify(body))
  });
}

function validBody(overrides = {}) {
  return {
    zone: 'Granada Hills North',
    submissionId: VALID_UUID,
    turnstileToken: 'turnstile-token',
    ...overrides
  };
}

function createLogger() {
  const entries = [];
  return {
    entries,
    info(message, details) { entries.push({ level: 'info', message, details }); },
    warn(message, details) { entries.push({ level: 'warn', message, details }); },
    error(message, details) { entries.push({ level: 'error', message, details }); }
  };
}

function createFetchMock(options = {}) {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    const target = String(url);
    calls.push({ target, init });
    if (target.includes('challenges.cloudflare.com')) {
      return Response.json(options.turnstileResult || {
        success: true,
        hostname: 'www.quietskiesgh.org',
        action: 'quiet-skies-report',
        'error-codes': []
      });
    }
    if (target.includes('/rest/v1/rpc/submit_community_report')) {
      return Response.json([{
        result: options.rpcResult || 'accepted',
        report_id: 1,
        accepted_at: '2026-07-19T12:00:00.000Z'
      }]);
    }
    throw new Error(`Unexpected fetch target: ${target}`);
  };
  fetchMock.calls = calls;
  return fetchMock;
}

async function invoke(body, options = {}) {
  const module = await getFunctionModule();
  const logger = options.logger || createLogger();
  const fetchImpl = options.fetchImpl || createFetchMock(options);
  const handler = module.createSubmitReportHandler({
    fetchImpl,
    env: { ...BASE_ENV, ...(options.env || {}) },
    logger
  });
  const request = body instanceof Request ? body : requestFor(body, options.requestOptions);
  const response = await handler(request, {
    ip: options.ip || CONTEXT_IP,
    requestId: options.requestId || '01K0A1B2C3D4E5F6G7H8J9K0MN'
  });
  return {
    response,
    payload: await response.json(),
    fetchImpl,
    logger
  };
}

test('accepts exactly the three approved Granada Hills zones', async () => {
  for (const zone of secureClient.VALID_ZONES) {
    const result = await invoke(validBody({ zone }));
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.ok, true);
  }

  const invalid = await invoke(validBody({ zone: 'North' }));
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.code, 'invalid_zone');
});

test('rejects unknown fields, missing fields, malformed JSON, oversized bodies, and invalid UUIDs', async () => {
  const unknown = await invoke({ ...validBody(), name: 'not-allowed' });
  assert.equal(unknown.response.status, 400);
  assert.equal(unknown.payload.code, 'invalid_fields');

  const missing = await invoke({
    zone: 'Granada Hills North',
    submissionId: VALID_UUID
  });
  assert.equal(missing.payload.code, 'invalid_fields');

  const malformed = await invoke(requestFor('{"zone":', {
    headers: { 'Content-Type': 'application/json' }
  }));
  assert.equal(malformed.payload.code, 'malformed_json');

  const oversizedRequest = requestFor('{}', {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': '4097'
    }
  });
  const oversized = await invoke(oversizedRequest);
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.payload.code, 'body_too_large');

  const invalidUuid = await invoke(validBody({ submissionId: 'not-a-uuid' }));
  assert.equal(invalidUuid.payload.code, 'invalid_submission_id');
});

test('accepts POST application/json only', async () => {
  const getRequest = requestFor('', { method: 'GET' });
  const method = await invoke(getRequest);
  assert.equal(method.response.status, 405);
  assert.equal(method.response.headers.get('allow'), 'POST');

  const contentType = await invoke(requestFor(JSON.stringify(validBody()), {
    headers: { 'Content-Type': 'text/plain' }
  }));
  assert.equal(contentType.response.status, 415);
  assert.equal(contentType.payload.code, 'unsupported_media_type');
});

test('rejects missing, failed, mismatched, and reused Turnstile tokens', async () => {
  const missing = await invoke(validBody({ turnstileToken: '' }));
  assert.equal(missing.payload.code, 'invalid_turnstile_token');

  const failed = await invoke(validBody(), {
    turnstileResult: {
      success: false,
      'error-codes': ['invalid-input-response']
    }
  });
  assert.equal(failed.response.status, 400);
  assert.equal(failed.payload.code, 'verification_failed');

  const mismatch = await invoke(validBody(), {
    turnstileResult: {
      success: true,
      hostname: 'attacker.example',
      action: 'quiet-skies-report',
      'error-codes': []
    }
  });
  assert.equal(mismatch.payload.code, 'verification_mismatch');

  const reused = await invoke(validBody(), {
    turnstileResult: {
      success: false,
      'error-codes': ['timeout-or-duplicate']
    }
  });
  assert.equal(reused.response.status, 409);
  assert.equal(reused.payload.code, 'verification_expired');
});

test('verifies Turnstile with context.ip and ignores spoofed forwarding headers', async () => {
  const request = requestFor(validBody(), {
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.77',
      'CF-Connecting-IP': '198.51.100.88'
    }
  });
  const result = await invoke(request);
  assert.equal(result.response.status, 200);

  const turnstileCall = result.fetchImpl.calls.find((call) =>
    call.target.includes('challenges.cloudflare.com')
  );
  const verificationBody = new URLSearchParams(String(turnstileCall.init.body));
  assert.equal(verificationBody.get('remoteip'), CONTEXT_IP);
  assert.notEqual(verificationBody.get('remoteip'), '198.51.100.77');
  assert.match(
    verificationBody.get('idempotency_key'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test('accepts official Turnstile test responses only on Netlify Deploy Preview hosts', async () => {
  const previewRequest = requestFor(validBody(), {
    url: 'https://deploy-preview-42--quiet-skies-gh.netlify.app/api/report'
  });
  const preview = await invoke(previewRequest, {
    turnstileResult: {
      success: true,
      hostname: 'localhost',
      action: 'test',
      'error-codes': []
    }
  });
  assert.equal(preview.response.status, 200);

  const production = await invoke(validBody(), {
    turnstileResult: {
      success: true,
      hostname: 'localhost',
      action: 'test',
      'error-codes': []
    }
  });
  assert.equal(production.response.status, 400);
  assert.equal(production.payload.code, 'verification_mismatch');
});

test('never stores or logs the raw IP and sends only the HMAC hash to Supabase', async () => {
  const logger = createLogger();
  const result = await invoke(validBody(), { logger });
  const rpcCall = result.fetchImpl.calls.find((call) =>
    call.target.includes('submit_community_report')
  );
  const rpcBody = JSON.parse(rpcCall.init.body);

  assert.equal(rpcBody.p_zone, 'Granada Hills North');
  assert.equal(rpcBody.p_submission_id, VALID_UUID);
  assert.match(rpcBody.p_source_hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(rpcBody), new RegExp(CONTEXT_IP.replaceAll('.', '\\.')));
  assert.doesNotMatch(JSON.stringify(logger.entries), new RegExp(CONTEXT_IP.replaceAll('.', '\\.')));
  assert.equal(rpcCall.init.headers.Authorization, undefined);
  assert.equal(rpcCall.init.headers.apikey, BASE_ENV.SUPABASE_SECRET_KEY);
});

test('treats a duplicate UUID as accepted and maps every rate limit', async () => {
  const duplicate = await invoke(validBody(), { rpcResult: 'duplicate' });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);

  const cases = [
    ['cooldown', 'cooldown'],
    ['source_10m_limit', 'rate_limited'],
    ['source_hour_limit', 'rate_limited'],
    ['global_minute_limit', 'system_busy']
  ];
  for (const [rpcResult, code] of cases) {
    const limited = await invoke(validBody(), { rpcResult });
    assert.equal(limited.response.status, 429);
    assert.equal(limited.payload.code, code);
  }
});

test('fails closed when submissions are disabled', async () => {
  let fetched = false;
  const result = await invoke(validBody(), {
    env: { SUBMISSIONS_ENABLED: 'false' },
    fetchImpl: async () => {
      fetched = true;
      throw new Error('should not fetch');
    }
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.payload.code, 'submissions_disabled');
  assert.equal(fetched, false);
});

test('secure browser client sends only the exact API payload', async () => {
  let call;
  const result = await secureClient.submitReport({
    fetchImpl: async (url, init) => {
      call = { url, init };
      return Response.json({ ok: true, duplicate: false, requestId: 'request-id' });
    },
    zone: 'Granada Hills Central',
    submissionId: VALID_UUID,
    turnstileToken: 'fresh-token'
  });

  assert.equal(call.url, '/api/report');
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), {
    zone: 'Granada Hills Central',
    submissionId: VALID_UUID,
    turnstileToken: 'fresh-token'
  });
  assert.equal(result.accepted, true);
});

test('Recent Reports excludes unknown zone values', () => {
  const sanitized = secureClient.sanitizeRecentReports([
    { id: 1, created_at: '2026-07-19T12:00:00Z', zone: 'Granada Hills North' },
    { id: 2, created_at: '2026-07-19T12:01:00Z', zone: '<script>alert(1)</script>' },
    { id: 3, created_at: '2026-07-19T12:02:00Z', zone: 'Unknown' }
  ]);
  assert.deepEqual(sanitized, [
    { id: 1, created_at: '2026-07-19T12:00:00Z', zone: 'Granada Hills North' }
  ]);
  assert.equal(secureClient.getPublicZoneLabel('Granada Hills North'), 'North');
  assert.equal(secureClient.getPublicZoneLabel('Unknown'), null);
});

test('migration defines atomic private rate limits and preserves direct-insert revocation', () => {
  const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
  assert.match(sql, /create schema if not exists qsgh_private/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = pg_catalog/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /interval '30 seconds'/i);
  assert.match(sql, /interval '10 minutes'[\s\S]*\) >= 20/i);
  assert.match(sql, /interval '1 hour'[\s\S]*\) >= 60/i);
  assert.match(sql, /interval '1 minute'[\s\S]*\) >= 30/i);
  assert.match(sql, /submissions_enabled boolean not null default false/i);
  assert.match(sql, /grant execute[\s\S]*to service_role/i);
  assert.match(sql, /revoke execute[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(sql, /grant\s+insert/i);
  assert.doesNotMatch(sql, /raw_ip|ip_address/i);
  assert.doesNotMatch(sql, /reports_abuse_20260718/i);
  assert.ok(sql.indexOf("'duplicate'::text") < sql.indexOf("interval '30 seconds'"));
});

test('build output contains only allowed browser files and no server secrets', async () => {
  const { build } = await import(
    pathToFileURL(path.join(__dirname, '..', 'scripts', 'build.mjs')).href
  );
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsgh-build-'));
  try {
    const outputs = build({
      projectRoot: path.join(__dirname, '..'),
      distDir,
      env: {
        CONTEXT: 'deploy-preview',
        TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
        SUPABASE_SECRET_KEY: 'server-secret-sentinel',
        TURNSTILE_SECRET_KEY: 'turnstile-secret-sentinel',
        RATE_LIMIT_HMAC_SECRET: 'hmac-secret-sentinel'
      },
      log: () => {}
    });
    assert.deepEqual(outputs, [
      'dashboard_periods.js',
      'icon.svg',
      'index.html',
      'manifest.json',
      'runtime-config.js',
      'secure_report_client.js',
      'sw.js'
    ]);

    const outputText = outputs
      .map((file) => fs.readFileSync(path.join(distDir, file), 'utf8'))
      .join('\n');
    assert.doesNotMatch(outputText, /server-secret-sentinel|turnstile-secret-sentinel|hmac-secret-sentinel/);
    assert.equal(fs.existsSync(path.join(distDir, 'tests')), false);
    assert.equal(fs.existsSync(path.join(distDir, 'supabase')), false);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

test('Cloudflare test site keys are limited to Deploy Preview builds', async () => {
  const { build } = await import(
    pathToFileURL(path.join(__dirname, '..', 'scripts', 'build.mjs')).href
  );
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qsgh-production-build-'));
  try {
    assert.throws(() => build({
      projectRoot: path.join(__dirname, '..'),
      distDir,
      env: {
        CONTEXT: 'production',
        TURNSTILE_SITE_KEY: '1x00000000000000000000AA'
      },
      log: () => {}
    }), /allowed only in Deploy Preview/i);

    assert.throws(() => build({
      projectRoot: path.join(__dirname, '..'),
      distDir,
      env: {
        CONTEXT: 'branch-deploy',
        TURNSTILE_SITE_KEY: '1x00000000000000000000AA'
      },
      log: () => {}
    }), /allowed only in Deploy Preview/i);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});
