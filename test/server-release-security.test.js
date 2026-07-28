'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
const hubRoutes = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'hub.js'), 'utf8');
const offeringSource = fs.readFileSync(path.resolve(__dirname, '..', 'offering.js'), 'utf8');

test('server exposes an explicit frontend allowlist instead of the repository root', () => {
  assert.doesNotMatch(source, /express\.static\(path\.join\(__dirname\)/);
  assert.match(source, /const publicFrontendAssets = Object\.freeze\(\{[\s\S]*?'\/style\.css'[\s\S]*?'\/offering\.js'/);
  assert.match(source, /app\.use\(\(req, res\) => \{[\s\S]*?res\.status\(404\)/);
});

test('internal sales bundles are not served to anonymous visitors', () => {
  // app.js / hub.js 에는 내부 영업 로직(딜사이즈 산식, 벤더 추천 매핑, 내부 배너 문구)이
  // 들어 있다. 공개 자산 목록에 섞이면 비로그인에게 그대로 배포된다.
  const publicStart = source.indexOf('const publicFrontendAssets');
  const publicBlock = source.slice(publicStart, source.indexOf('});', publicStart));
  assert.doesNotMatch(publicBlock, /app\.js|hub\.js|hub\.css/);
  assert.match(source, /const authedFrontendAssets = Object\.freeze\(\{[\s\S]*?'\/app\.js'[\s\S]*?'\/hub\.js'/);
  assert.match(source, /requireAssetAuth\(asset\.canonicalPath\)/);
  // 자산은 로그인 리다이렉트가 아니라 401 로 끊는다(스크립트가 HTML 을 받으면 안 된다).
  assert.match(source, /const requireAssetAuth =[\s\S]*?res\.status\(401\)/);
});

test('crawlers are told to stay out of the internal surfaces', () => {
  assert.match(source, /app\.get\('\/robots\.txt'/);
  assert.match(source, /Disallow: \/hub/);
  assert.match(source, /Disallow: \/radar/);
  assert.match(source, /Disallow: \/admin/);
  assert.match(source, /Disallow: \/api\//);
  assert.match(source, /app\.get\('\/sitemap\.xml'/);
  // 사이트맵에는 대외 공개 페이지만 넣는다.
  const sitemapBlock = source.slice(source.indexOf("app.get('/sitemap.xml'"));
  assert.doesNotMatch(sitemapBlock.slice(0, 900), /'\/hub'|'\/radar'|'\/admin'/);
});

test('solution detail responses are column-allowlisted by role', () => {
  // SELECT * 는 opinion 만 지워도 sections·가격·tech_note·focal 이 그대로 나간다.
  assert.doesNotMatch(source, /SELECT \* FROM solutions WHERE slug/);
  assert.match(source, /const SOLUTION_COLUMNS_ADMIN_ONLY = Object\.freeze/);
  assert.match(source, /solutionColumnsFor\(req\.user\.role\)/);
  // 마이그레이션 적용 전이라도 내부 문단이 non-admin 에게 나가면 안 된다.
  assert.match(source, /stripInternalSections\(row\.sections\)/);
});

test('deal detail is limited to the owner, an admin, or an unclaimed deal', () => {
  assert.match(hubRoutes, /and \(\$2 = 'admin' or d\.owner_id is null or d\.owner_id = \$3\)/);
  assert.match(hubRoutes, /auditLog\(req\.user\.id, 'view', `deal:\$\{req\.params\.id\}`\)/);
  // 목록 응답에 고객 연락처·메모가 실리면 안 된다.
  assert.doesNotMatch(hubRoutes, /select d\.id, d\.customer, d\.customer_meta, d\.track/);
  assert.match(hubRoutes, /jsonb_build_object\([\s\S]*?'industry'[\s\S]*?'targetUsers'[\s\S]*?\) as customer_meta/);
});

test('reference-data lists package columns explicitly and flags unconfirmed prices', () => {
  assert.doesNotMatch(hubRoutes, /select p\.\*,/);
  assert.match(hubRoutes, /as price_is_placeholder/);
  assert.match(hubRoutes, /const hasPriceFlag =/);
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
  assert.match(source, /APP_SURFACE === 'admin'[\s\S]*?requirePageAuth\('\/admin', CATALOG_EDITOR_ROLES\)/);
  assert.match(source, /app\.get\(\['\/hub', '\/hub\.html'\], requirePageAuth\('\/hub'\)/);
  assert.match(source, /app\.get\(\['\/radar', '\/radar\/'\], requirePageAuth\('\/radar'\)/);
  // /admin 페이지는 curator 도 연다(카탈로그 편집). 회원 승인·가격·롤백은 라우트에서 adminOnly 로 막힌다.
  assert.match(source, /app\.get\(\['\/admin', '\/admin\.html'\], requirePageAuth\('\/admin', CATALOG_EDITOR_ROLES\)/);
  assert.match(source, /app\.get\(\['\/admin\/usage', '\/admin-usage\.html'\], requirePageAuth\('\/admin\/usage', 'admin'\)/);
});

test('public offering failures do not expose database internals', () => {
  const fqaEndpoint = hubRoutes.slice(
    hubRoutes.indexOf("router.get('/public/fqa-items'"),
    hubRoutes.indexOf("router.get('/public/tracks'")
  );
  assert.match(hubRoutes, /const sendPublicUnavailable =/);
  assert.match(hubRoutes, /Public FQA items failed:/);
  assert.match(hubRoutes, /준비도 진단 문항을 불러오지 못했습니다/);
  assert.doesNotMatch(fqaEndpoint, /sendError\(res, error, 500\)/);
  assert.match(offeringSource, /진단 문항을 불러오지 못했습니다/);
  assert.doesNotMatch(offeringSource, /questions'\)\.innerHTML = `<div class="loading">\$\{escapeHtml\(error\.message\)\}<\/div>`/);
});

test('server handles idle pool failures and drains resources on termination', () => {
  assert.match(source, /pool\.on\('error'/);
  assert.match(source, /const server = app\.listen/);
  assert.match(source, /server\.close\(async/);
  assert.match(source, /await pool\.end\(\)/);
  assert.match(source, /process\.on\('SIGTERM'/);
  assert.match(source, /process\.on\('SIGINT'/);
});
