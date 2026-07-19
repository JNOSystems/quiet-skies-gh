import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptDir, '..');
const TEST_TURNSTILE_SITE_KEYS = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF'
]);
const files = [
  { source: 'quiet_skies_granada_hills.html', output: 'index.html' },
  { source: 'dashboard_periods.js', output: 'dashboard_periods.js' },
  { source: 'secure_report_client.js', output: 'secure_report_client.js' },
  { source: 'sw.js', output: 'sw.js' },
  { source: 'manifest.json', output: 'manifest.json' },
  { source: 'icon.svg', output: 'icon.svg' }
];
const generatedOutputs = ['runtime-config.js'];
const expectedOutputs = [...files.map(({ output }) => output), ...generatedOutputs].sort();

function fail(message) {
  throw new Error(`[build] ${message}`);
}

function resolveOutputReference(reference) {
  const cleanReference = reference.split(/[?#]/, 1)[0];
  return cleanReference === '/' ? 'index.html' : cleanReference.replace(/^\.\//, '').replace(/^\//, '');
}

function getTurnstileSiteKey(env) {
  const siteKey = String(env.TURNSTILE_SITE_KEY || '').trim();
  if (TEST_TURNSTILE_SITE_KEYS.has(siteKey) && env.CONTEXT !== 'deploy-preview') {
    fail('Cloudflare test Turnstile site keys are allowed only in Deploy Preview builds');
  }
  if (env.CONTEXT === 'production') {
    if (!siteKey) fail('TURNSTILE_SITE_KEY is required for production builds');
  }
  return siteKey;
}

function verifyHtmlReferences(html) {
  const requiredReferences = new Map([
    ['runtime-config.js', /<script[^>]+src=["']runtime-config\.js["'][^>]*>/i],
    ['dashboard_periods.js', /<script[^>]+src=["']dashboard_periods\.js["'][^>]*>/i],
    ['secure_report_client.js', /<script[^>]+src=["']secure_report_client\.js["'][^>]*>/i],
    ['manifest.json', /<link[^>]+href=["']manifest\.json["'][^>]*>/i],
    ['icon.svg', /<link[^>]+href=["']icon\.svg["'][^>]*>/i],
    ['sw.js', /serviceWorker\.register\(\s*["']sw\.js["']\s*\)/],
    ['Turnstile', /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/i]
  ]);

  for (const [asset, pattern] of requiredReferences) {
    if (!pattern.test(html)) fail(`index.html does not reference required asset: ${asset}`);
  }

  const references = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/gi), (match) => match[1]);
  const registration = html.match(/serviceWorker\.register\(\s*["']([^"']+)["']\s*\)/);
  if (registration) references.push(registration[1]);

  for (const reference of references) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue;
    const output = resolveOutputReference(reference);
    if (!expectedOutputs.includes(output)) fail(`unexpected or missing local HTML asset: ${reference}`);
  }
}

function verifyManifest(distDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
  for (const icon of manifest.icons || []) {
    const output = resolveOutputReference(icon.src || '');
    if (!expectedOutputs.includes(output) || !fs.existsSync(path.join(distDir, output))) {
      fail(`manifest references missing local asset: ${icon.src || '(empty)'}`);
    }
  }
}

function verifyServiceWorker(distDir) {
  const source = fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8');
  for (const output of expectedOutputs) {
    if (output === 'index.html' || output === 'sw.js') continue;
    if (!source.includes(`/${output}`)) fail(`service worker app shell is missing /${output}`);
  }
  for (const bypass of ['/api/', '/.netlify/functions/', 'supabase.co']) {
    if (!source.includes(bypass)) fail(`service worker bypass is missing ${bypass}`);
  }
}

function verifyNoSecrets(distDir, env) {
  const secretNames = [
    'SUPABASE_SECRET_KEY',
    'TURNSTILE_SECRET_KEY',
    'RATE_LIMIT_HMAC_SECRET'
  ];
  const forbiddenValues = secretNames
    .map((name) => String(env[name] || ''))
    .filter((value) => value.length >= 8);

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isFile()) fail('dist must contain files only');
    const source = fs.readFileSync(path.join(distDir, entry.name), 'utf8');
    for (const name of secretNames) {
      if (source.includes(name)) fail(`${entry.name} contains a server-only environment variable name`);
    }
    for (const value of forbiddenValues) {
      if (source.includes(value)) fail(`${entry.name} contains a server secret value`);
    }
  }
}

export function build({
  projectRoot = defaultProjectRoot,
  distDir = path.join(projectRoot, 'dist'),
  env = process.env,
  log = console.log
} = {}) {
  const missingSources = files
    .map(({ source }) => source)
    .filter((source) => !fs.existsSync(path.join(projectRoot, source)));
  if (missingSources.length) fail(`missing required source file(s): ${missingSources.join(', ')}`);

  const turnstileSiteKey = getTurnstileSiteKey(env);
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  for (const { source, output } of files) {
    fs.copyFileSync(path.join(projectRoot, source), path.join(distDir, output));
  }
  fs.writeFileSync(
    path.join(distDir, 'runtime-config.js'),
    `window.QUIET_SKIES_CONFIG = Object.freeze(${JSON.stringify({
      turnstileSiteKey
    })});\n`,
    'utf8'
  );

  const entries = fs.readdirSync(distDir, { withFileTypes: true });
  const actualOutputs = entries.map((entry) => entry.name).sort();
  if (entries.some((entry) => !entry.isFile())) fail('dist must contain files only');
  if (JSON.stringify(actualOutputs) !== JSON.stringify(expectedOutputs)) {
    fail(`dist contents do not match the production allowlist: ${actualOutputs.join(', ')}`);
  }

  const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
  verifyHtmlReferences(html);
  verifyManifest(distDir);
  verifyServiceWorker(distDir);
  verifyNoSecrets(distDir, env);

  log(`[build] Built ${actualOutputs.length} files in dist:`);
  actualOutputs.forEach((output) => log(`- ${output}`));
  return actualOutputs;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    build();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
