'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');

test('server exposes an explicit frontend allowlist instead of the repository root', () => {
  assert.doesNotMatch(source, /express\.static\(path\.join\(__dirname\)/);
  assert.match(source, /const frontendAssets = Object\.freeze\(\{[\s\S]*?'\/style\.css'[\s\S]*?'\/offering\.js'/);
  assert.match(source, /app\.use\(\(req, res\) => \{[\s\S]*?res\.status\(404\)/);
});

test('document downloads are authenticated and restricted to an exact docx allowlist', () => {
  assert.match(source, /const downloadableDocs = new Set\(\[/);
  assert.match(source, /app\.get\('\/docs\/:filename', authenticateToken/);
  assert.match(source, /filename !== path\.basename\(filename\) \|\| !downloadableDocs\.has\(filename\)/);
  assert.doesNotMatch(source, /issu_ai_radar_schema\.sql[\s\S]*?downloadableDocs/);
});

test('server adds baseline browser security headers and database-backed readiness', () => {
  assert.match(source, /app\.disable\('x-powered-by'\)/);
  assert.match(source, /'Content-Security-Policy'/);
  assert.match(source, /'X-Content-Type-Options': 'nosniff'/);
  assert.match(source, /'X-Frame-Options': 'SAMEORIGIN'/);
  assert.match(source, /offering: req\.path === '\/healthz'/);
  assert.match(source, /app\.get\('\/healthz'[\s\S]*?select 1[\s\S]*?status\(503\)/);
});

test('server contains bounded login throttling and validates complete public diagnoses', () => {
  assert.match(source, /LOGIN_ATTEMPT_LIMIT = 10/);
  assert.match(source, /app\.post\('\/api\/auth\/login', checkLoginRateLimit/);
  assert.match(source, /status\(429\)/);
  assert.match(source, /const requireCompleteFqaScores/);
  assert.match(source, /hasMissingOrInvalidScore/);
  assert.match(source, /'\/api\/hub\/public\/diagnose'[\s\S]*?'\/api\/hub\/public\/leads'/);
});

test('authenticated requests re-check current approval and role from the database', () => {
  assert.match(source, /const readSessionUser = async/);
  assert.match(source, /const authenticateToken = async/);
  assert.match(source, /from profiles where id = \$1/);
  assert.match(source, /if \(!profile \|\| !profile\.approved\)/);
  assert.match(source, /role: profile\.role/);
});

test('public offering and internal sales surfaces have distinct entrypoints', () => {
  assert.match(source, /all: 'offering\.html'/);
  assert.match(source, /offering: 'offering\.html'/);
  assert.match(source, /hub: 'hub\.html'/);
  assert.match(source, /app\.get\('\/', requireSurfaceRootAuth/);
  assert.match(source, /APP_SURFACE === 'hub'[\s\S]*?requirePageAuth\('\/hub'\)/);
  assert.match(source, /APP_SURFACE === 'admin'[\s\S]*?requirePageAuth\('\/admin', 'admin'\)/);
  assert.match(source, /app\.get\(\['\/hub', '\/hub\.html'\], requirePageAuth\('\/hub'\)/);
  assert.match(source, /app\.get\(\['\/radar', '\/radar\/'\], requirePageAuth\('\/radar'\)/);
  assert.match(source, /app\.get\(\['\/admin', '\/admin\.html'\], requirePageAuth\('\/admin', 'admin'\)/);
});

test('server handles idle pool failures and drains resources on termination', () => {
  assert.match(source, /pool\.on\('error'/);
  assert.match(source, /const server = app\.listen/);
  assert.match(source, /server\.close\(async/);
  assert.match(source, /await pool\.end\(\)/);
  assert.match(source, /process\.on\('SIGTERM'/);
  assert.match(source, /process\.on\('SIGINT'/);
});
