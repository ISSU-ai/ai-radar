'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'hub.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'hub.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'hub.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const radarHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const radarCss = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const radarJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('hub keeps rail, deal list, and workspace in one persistent shell', () => {
  const rail = html.indexOf('class="app-rail"');
  const list = html.indexOf('id="deal-sidebar"');
  const workspace = html.indexOf('class="app-main"');

  assert.ok(rail >= 0);
  assert.ok(list > rail);
  assert.ok(workspace > list);
  assert.match(css, /grid-template-columns:\s*var\(--rail-width\)\s+var\(--list-width\)\s+minmax\(0,\s*1fr\)/);
});

test('hub supports collapsed and mobile list-to-workspace layouts', () => {
  assert.match(css, /\.portal-app\.list-collapsed/);
  assert.match(css, /@media \(max-width:\s*900px\)/);
  assert.match(css, /\.portal-app\.mobile-workspace \.deal-sidebar/);
  assert.match(css, /\.portal-app\.mobile-workspace \.app-main/);
});

test('medium hub widths stack context cards instead of squeezing the deal form', () => {
  const mediumLayout = css.match(/@media \(max-width:\s*1200px\)[\s\S]*?(?=@media \(max-width:\s*900px\))/)?.[0] || '';
  assert.match(mediumLayout, /\.workspace-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(mediumLayout, /\.workspace-side\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(mediumLayout, /236px/);
});

test('hub interactions use delegated handlers and isolate pending saves by deal', () => {
  assert.doesNotMatch(html, /\sonclick=/i);
  assert.match(js, /#deal-list'\)\.addEventListener\('click'/);
  assert.match(js, /pendingDealId/);
  assert.match(js, /openSequence/);
  assert.match(js, /inFlightSaves/);
  assert.match(js, /eventUpdatedAt\s*<=\s*knownUpdatedAt/);
});

test('STEP02 는 42문항을 축별로 묶고 루브릭 문장을 고르게 한다', () => {
  // 숫자 라디오로 두면 "모르니까 3점" 이 늘고, 그 값이 그대로 추천의 근거가 된다.
  assert.match(js, /class="rd-group" data-area="\$\{escapeHtml\(area\.id\)\}"/);
  assert.match(js, /data-readiness-code="\$\{escapeHtml\(item\.code\)\}" data-readiness-score="\$\{score\}"/);
  assert.match(js, /asArray\(item\.rubric\)\.map/, '루브릭 문장이 선택지여야 한다');
  assert.doesNotMatch(js, /type="radio"[^>]+data-readiness-code/, '42문항이 라디오로 되돌아갔다');
  assert.match(js, /\$\$\('\[data-readiness-code\]'\)[\s\S]*?addEventListener\('click'/);
  assert.match(js, /delete scores\[button\.dataset\.readinessClear\]/);
  assert.match(css, /\.rd-picks\s*\{[^}]*grid-template-columns:\s*repeat\(5/);
  assert.match(css, /\.rd-pick\.picked/);
});

test('허브에서 21문항을 직접 받지 않는다', () => {
  // 42문항이 넘어오면 같은 것을 두 번 묻는 화면이다. 겹치는 13개는 030 bridge 가
  // 서버에서 채우고, 못 채우는 것은 STEP03 에서 후보별로 확인한다.
  assert.doesNotMatch(js, /data-fqa-no=/, '21문항 입력이 남아 있다');
  assert.doesNotMatch(js, /renderResidualFqa|fqaScoreLabels|hasFqaScore/);
  assert.doesNotMatch(css, /\.residual-fqa/);
});

test('42문항으로 판정 안 되는 전제는 후보 옆에서 확인한다', () => {
  // 모르는 것을 조용히 통과시키면 막혔어야 할 후보가 추천에 올라온다.
  // 낙관적으로 틀리는 쪽이라 화면에서는 티가 안 난다.
  const engine = fs.readFileSync(path.join(__dirname, '..', 'lib', 'recommendation-engine.js'), 'utf8');
  const open = engine.indexOf("if (prereq.kind === 'fqa')");
  const body = engine.slice(open, engine.indexOf("if (prereq.kind === 'numeric')", open));
  assert.match(body, /pendingManual\.push/, '모르면 확인 대상으로 올려야 한다');
  assert.doesNotMatch(body, /if \(!Number\.isFinite\(actual\)\) continue/,
    '모르는 전제를 조용히 통과시키면 안 된다');

  assert.match(js, /data-prereq-slug=/, '확인 체크박스가 있어야 한다');
  assert.match(js, /\$\$\('\[data-prereq-slug\]'\)[\s\S]{0,600}loadRecommendations\(\)/,
    '확인하면 바로 다시 계산해야 한다');
  assert.match(js, /prereq_confirmations/);
  assert.match(css, /\.prereq-check/);

  // 화면이 넘기는 키와 엔진이 읽는 키가 같아야 한다
  assert.match(engine, /prereq_confirmations\)\[candidate\.slug \|\| candidate\.id\]/);
  assert.match(js, /data-prereq-slug="\$\{escapeHtml\(item\.slug \|\| item\.id\)\}"/);
});

test('hub flushes edits safely and normalises mobile reference back navigation', () => {
  assert.match(js, /#logout-button'[\s\S]*?await flushSave\(\)/);
  assert.match(js, /\$\$\('\[data-meta-field\]'\)[\s\S]*?addEventListener\('input'/);
  assert.match(js, /state\.mode\s*!==\s*'deals'[\s\S]*?switchToDeals\(\)/);
  assert.match(js, /referenceToggle\.setAttribute\('aria-expanded'/);
});

test('hub preserves failed autosaves and warns before leaving with unsaved changes', () => {
  assert.match(js, /state\.pendingPatch = \{ \.\.\.patch, \.\.\.newerPatch \}/);
  assert.match(js, /catch \(error\) \{[\s\S]*?throw error;[\s\S]*?finally/);
  assert.match(js, /window\.addEventListener\('beforeunload', warnIfUnsaved\)/);
  assert.match(js, /window\.addEventListener\('pagehide', flushPendingOnPageHide\)/);
  assert.match(js, /keepalive: true/);
});

test('admin mode uses a full-width hub embed without nesting the legacy header', () => {
  assert.match(html, /data-src="\/admin\?embed=hub"/);
  assert.match(adminHtml, /body\.hub-embed \.app-header\s*\{\s*display:\s*none/);
  assert.match(adminHtml, /get\('embed'\)\s*===\s*'hub'/);
  assert.doesNotMatch(adminHtml, /\sonclick=/i);
  assert.match(adminHtml, /document\.addEventListener\('click',\s*handleAdminAction\)/);
});

test('AI Radar uses a dedicated embed route instead of recursively loading the hub root', () => {
  assert.match(html, /href="\/radar"\s+target="_blank"/);
  assert.match(html, /data-src="\/radar\?embed=hub"/);
  assert.doesNotMatch(html, /id="reference-frame"[^>]+data-src="\/"/);
  assert.match(serverJs, /const radarPath\s*=\s*req\.path === '\/radar'/);
  assert.match(serverJs, /app\.get\(\['\/radar', '\/radar\/'\], requirePageAuth\('\/radar'\), sendFrontendFile\('index\.html'\)\)/);
});

test('embedded AI Radar navigation always escapes or delegates to the parent hub', () => {
  assert.match(radarHtml, /__ISSU_HUB_EMBED__/);
  assert.match(radarHtml, /href="\/hub"\s+target="_top"/);
  assert.match(radarHtml, /href="\/admin"\s+target="_top"/);
  assert.match(radarCss, /html\.hub-embed \.app-header\s*\{\s*display:\s*none/);
  assert.match(radarJs, /window\.parent\.postMessage\(\{ type: 'issu-hub:navigate', route \}/);
  assert.match(js, /window\.addEventListener\('message', handleEmbeddedNavigation\)/);
  assert.match(js, /event\.source !== frame\.contentWindow/);
  assert.match(js, /current\.pathname === '\/hub'[\s\S]*?switchToDeals\(\)/);
});

test('embedded authentication redirects cannot strand login inside an iframe', () => {
  assert.match(radarHtml, /window\.__ISSU_RADAR_NAVIGATE__/);
  assert.match(radarHtml, /window\.top !== window \? window\.top : window/);
  assert.match(radarHtml, /window\.__ISSU_RADAR_LOGIN_PATH__\s*=\s*`\/login\.html\?next=\$\{encodeURIComponent\(radarReturnPath\)\}`/);
  assert.match(radarJs, /navigateRadar\(window\.__ISSU_RADAR_LOGIN_PATH__ \|\| '\/login\.html'\)/);
  assert.match(adminHtml, /function navigateAdmin\(path\)[\s\S]*?window\.top !== window \? window\.top : window/);
  assert.match(adminHtml, /isHubEmbed \? '\/login\.html\?next=\/hub\?mode=admin' : '\/login\.html\?next=\/admin'/);
});

test('stage rail navigation is view-only and does not mutate pipeline progress', () => {
  const selectStage = js.match(/function selectStage\(nextStage\)[\s\S]*?\n}\n\nfunction renderWorkspace/)?.[0] || '';
  assert.match(selectStage, /state\.activeStage = nextStage/);
  assert.match(selectStage, /renderStageRail\(\)/);
  assert.match(selectStage, /renderStage\(\)/);
  assert.doesNotMatch(selectStage, /savePatch|scheduleSave|stage:\s*nextStage/);
});

test('mode switches invalidate pending detail requests and preserve responsive workspace state', () => {
  const referenceMode = js.match(/function openReferenceMode\(\)[\s\S]*?\n}\n\nasync function openAdminMode/)?.[0] || '';
  const adminMode = js.match(/async function openAdminMode\(\)[\s\S]*?\n}\n\nfunction ensureReferenceFrame/)?.[0] || '';
  assert.match(referenceMode, /state\.openSequence \+= 1/);
  assert.match(adminMode, /state\.openSequence \+= 1/);
  assert.match(js, /if \(requestId !== state\.openSequence\) return/);
  assert.match(js, /const detailRoute = new URLSearchParams\(window\.location\.search\)\.has\('deal'\)/);
  assert.match(js, /const showMobileWorkspace = state\.mode !== 'deals'[\s\S]*?detailRoute[\s\S]*?app\.classList\.contains\('mobile-workspace'\)/);
  assert.match(js, /app\.classList\.toggle\('mobile-workspace', showMobileWorkspace\)/);
  assert.match(js, /selectedId && !mobile \? `\/hub\?deal=/);
});

test('asynchronous list, claim, and live-update responses cannot overwrite newer state', () => {
  assert.match(js, /const requestId = \+\+state\.dealListSequence/);
  assert.match(js, /if \(requestId !== state\.dealListSequence\) return/);
  assert.match(js, /const dealId = state\.deal\?\.id[\s\S]*?if \(state\.deal\?\.id === dealId\)/);
  assert.match(js, /refreshed = await api[\s\S]*?if \(state\.deal\?\.id !== change\.id \|\| stillHasLocalSave\) return/);
  // 열어둔 딜을 남이 claim 하면 상세가 404 로 닫힌다. 던지지 말고 워크스페이스를 비운다.
  assert.match(js, /refreshed = await api\(`\/api\/hub\/deals\/\$\{change\.id\}`\);\s*\} catch \(error\) \{[\s\S]*?state\.deal = null/);
  assert.match(js, /if \(state\.mode === 'deals'\) renderWorkspace\(\)/);
});
