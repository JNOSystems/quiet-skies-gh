import { createHmac, randomUUID } from 'node:crypto';

const MAX_BODY_BYTES = 4096;
const TURNSTILE_TIMEOUT_MS = 8000;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const PRODUCTION_HOSTNAME = 'www.quietskiesgh.org';
const PRODUCTION_ACTION = 'quiet-skies-report';
const DEPLOY_PREVIEW_HOSTNAME = 'localhost';
const DEPLOY_PREVIEW_ACTION = 'test';
const VALID_ZONES = new Set([
  'Granada Hills North',
  'Granada Hills Central',
  'Granada Hills South'
]);
const REQUIRED_FIELDS = ['submissionId', 'turnstileToken', 'zone'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PublicError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(status, payload, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function getContentLength(request) {
  const value = request.headers.get('content-length');
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readBodyWithLimit(request, maxBytes = MAX_BODY_BYTES) {
  const contentLength = getContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new PublicError(413, 'body_too_large', 'The request body is too large.');
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PublicError(413, 'body_too_large', 'The request body is too large.');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PublicError(400, 'invalid_body', 'The request body must be a JSON object.');
  }

  const fields = Object.keys(payload).sort();
  if (
    fields.length !== REQUIRED_FIELDS.length ||
    REQUIRED_FIELDS.some((field, index) => fields[index] !== field)
  ) {
    throw new PublicError(
      400,
      'invalid_fields',
      'The request contains missing or unsupported fields.'
    );
  }

  if (!VALID_ZONES.has(payload.zone)) {
    throw new PublicError(400, 'invalid_zone', 'Select a valid Granada Hills zone.');
  }
  if (typeof payload.submissionId !== 'string' || !UUID_PATTERN.test(payload.submissionId)) {
    throw new PublicError(400, 'invalid_submission_id', 'The submission identifier is invalid.');
  }
  if (
    typeof payload.turnstileToken !== 'string' ||
    payload.turnstileToken.length < 1 ||
    payload.turnstileToken.length > 2048
  ) {
    throw new PublicError(400, 'invalid_turnstile_token', 'Bot verification is required.');
  }

  return {
    zone: payload.zone,
    submissionId: payload.submissionId,
    turnstileToken: payload.turnstileToken
  };
}

function requireEnvironment(env) {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'TURNSTILE_SECRET_KEY',
    'RATE_LIMIT_HMAC_SECRET'
  ];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing required function configuration: ${missing.join(', ')}`);
  if (String(env.RATE_LIMIT_HMAC_SECRET).length < 32) {
    throw new Error('RATE_LIMIT_HMAC_SECRET must contain at least 32 characters.');
  }

  const supabaseUrl = new URL(env.SUPABASE_URL);
  if (supabaseUrl.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS.');
}

function deriveSourceHash(ip, secret) {
  return createHmac('sha256', secret).update(ip).digest('hex');
}

function getExpectedTurnstileFields(requestHostname) {
  if (/^deploy-preview-\d+--[a-z0-9-]+\.netlify\.app$/i.test(requestHostname)) {
    return {
      hostname: DEPLOY_PREVIEW_HOSTNAME,
      action: DEPLOY_PREVIEW_ACTION
    };
  }
  return {
    hostname: PRODUCTION_HOSTNAME,
    action: PRODUCTION_ACTION
  };
}

async function verifyTurnstile({
  fetchImpl,
  env,
  ip,
  requestId,
  requestHostname,
  token
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    remoteip: ip,
    idempotency_key: randomUUID()
  });

  let response;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: controller.signal
    });
  } catch (error) {
    throw new PublicError(503, 'verification_unavailable', 'Bot verification is temporarily unavailable.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new PublicError(503, 'verification_unavailable', 'Bot verification is temporarily unavailable.');
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new PublicError(503, 'verification_unavailable', 'Bot verification is temporarily unavailable.');
  }

  const errorCodes = Array.isArray(result['error-codes']) ? result['error-codes'] : [];
  if (!result.success) {
    if (errorCodes.includes('timeout-or-duplicate')) {
      throw new PublicError(409, 'verification_expired', 'Verification expired. Retry this report.');
    }
    throw new PublicError(400, 'verification_failed', 'Bot verification was not accepted.');
  }

  const expected = getExpectedTurnstileFields(requestHostname);
  if (result.hostname !== expected.hostname || result.action !== expected.action) {
    throw new PublicError(400, 'verification_mismatch', 'Bot verification was not accepted.');
  }
}

function mapRpcResult(result) {
  if (result === 'accepted') return { status: 200, duplicate: false };
  if (result === 'duplicate') return { status: 200, duplicate: true };
  if (result === 'disabled') {
    throw new PublicError(503, 'submissions_disabled', 'Community reporting is temporarily paused.');
  }
  if (result === 'cooldown') {
    throw new PublicError(429, 'cooldown', 'Please wait 30 seconds before submitting another report.');
  }
  if (result === 'source_10m_limit' || result === 'source_hour_limit') {
    throw new PublicError(429, 'rate_limited', 'Too many reports were submitted from this connection. Try again later.');
  }
  if (result === 'global_minute_limit') {
    throw new PublicError(429, 'system_busy', 'Community reporting is busy. Please retry shortly.');
  }
  throw new Error('The report RPC returned an unsupported result.');
}

async function callSubmitRpc({ fetchImpl, env, zone, submissionId, sourceHash }) {
  const endpoint = new URL('/rest/v1/rpc/submit_community_report', env.SUPABASE_URL);
  let response;

  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        apikey: env.SUPABASE_SECRET_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_zone: zone,
        p_submission_id: submissionId,
        p_source_hash: sourceHash
      })
    });
  } catch (error) {
    throw new PublicError(503, 'report_service_unavailable', 'Community reporting is temporarily unavailable.');
  }

  if (!response.ok) {
    throw new PublicError(503, 'report_service_unavailable', 'Community reporting is temporarily unavailable.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new PublicError(503, 'report_service_unavailable', 'Community reporting is temporarily unavailable.');
  }

  const row = Array.isArray(payload) ? payload[0] : payload;
  return mapRpcResult(row && row.result);
}

export function createSubmitReportHandler({
  fetchImpl = fetch,
  env = process.env,
  logger = console
} = {}) {
  return async (request, context = {}) => {
    const requestId = String(context.requestId || '');

    if (request.method !== 'POST') {
      return jsonResponse(405, {
        ok: false,
        code: 'method_not_allowed',
        message: 'Use POST to submit a community report.'
      }, { Allow: 'POST' });
    }

    if (env.SUBMISSIONS_ENABLED !== 'true') {
      return jsonResponse(503, {
        ok: false,
        code: 'submissions_disabled',
        message: 'Community reporting is temporarily paused.'
      });
    }

    try {
      requireEnvironment(env);
      const contentType = String(request.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== 'application/json') {
        throw new PublicError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
      }

      const rawBody = await readBodyWithLimit(request);
      let parsed;
      try {
        parsed = JSON.parse(rawBody);
      } catch (error) {
        throw new PublicError(400, 'malformed_json', 'The request body contains malformed JSON.');
      }
      const payload = validatePayload(parsed);

      const ip = typeof context.ip === 'string' ? context.ip : '';
      if (!ip || !requestId) throw new Error('Netlify request metadata is unavailable.');

      await verifyTurnstile({
        fetchImpl,
        env,
        ip,
        requestId,
        requestHostname: new URL(request.url).hostname,
        token: payload.turnstileToken
      });

      const sourceHash = deriveSourceHash(ip, env.RATE_LIMIT_HMAC_SECRET);
      const rpcResult = await callSubmitRpc({
        fetchImpl,
        env,
        zone: payload.zone,
        submissionId: payload.submissionId,
        sourceHash
      });

      logger.info('community_report_result', {
        requestId,
        result: rpcResult.duplicate ? 'duplicate' : 'accepted',
        sourcePrefix: sourceHash.slice(0, 12)
      });

      return jsonResponse(rpcResult.status, {
        ok: true,
        duplicate: rpcResult.duplicate,
        requestId
      });
    } catch (error) {
      if (error instanceof PublicError) {
        logger.warn('community_report_rejected', {
          requestId,
          code: error.code
        });
        return jsonResponse(error.status, {
          ok: false,
          code: error.code,
          message: error.message,
          requestId
        });
      }

      logger.error('community_report_error', {
        requestId,
        code: 'internal_error'
      });
      return jsonResponse(500, {
        ok: false,
        code: 'internal_error',
        message: 'Community reporting is temporarily unavailable.',
        requestId
      });
    }
  };
}

export const config = {
  path: '/api/report',
  method: 'POST',
  rateLimit: {
    windowLimit: 12,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};

export default createSubmitReportHandler();

export {
  MAX_BODY_BYTES,
  PRODUCTION_ACTION,
  PRODUCTION_HOSTNAME,
  TURNSTILE_VERIFY_URL,
  UUID_PATTERN,
  VALID_ZONES,
  deriveSourceHash,
  validatePayload
};
