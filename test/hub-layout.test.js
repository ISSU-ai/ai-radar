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

test('PoC readiness questions are grouped by A-D and use direct score buttons', () => {
  assert.match(js, /const fqaCategoryLabels = Object\.freeze\([\s\S]*?A:\s*'보안·데이터'[\s\S]*?D:\s*'업무·성과'/);
  assert.match(js, /class="fqa-group" data-category="\$\{category\}"/);
  assert.match(js, /type="radio"[^>]+data-fqa-no="\$\{item\.no\}"[^>]+data-fqa-category="\$\{category\}"/);
  assert.doesNotMatch(js, /<select data-fqa-no=/);
  assert.match(js, /\$\$\('input\[data-fqa-no\]'\)[\s\S]*?addEventListener\('change'/);
  assert.match(js, /data-fqa-clear="\$\{item\.no\}"/);
  assert.match(js, /delete scores\[button\.dataset\.fqaClear\]/);
  assert.match(css, /\.fqa-score-group\s*\{[^}]*grid-template-columns:\s*repeat\(5/);
  assert.match(css, /\.fqa-score-option input:checked \+ span/);
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
  assert.match(serverJs, /app\.get\(\['\/radar', '\/radar\/'\][\s\S]*?'index\.html'/);
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
  assert.match(js, /const refreshed = await api[\s\S]*?if \(state\.deal\?\.id !== change\.id \|\| stillHasLocalSave\) return/);
  assert.match(js, /if \(state\.mode === 'deals'\) renderWorkspace\(\)/);
});
