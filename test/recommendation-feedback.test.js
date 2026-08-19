'use strict';

/**
 * 피드백 루프. 측정 없이 최적화는 감으로 만지는 것이다.
 *
 * 세 신호를 뽑는 것이 목적이다.
 *   miss   추천했는데 안 고름     → 판정 데이터가 현실과 어긋남
 *   manual 추천에 없었는데 고름    → 엔진이 놓친 것. 가장 값지다
 *   nodata 판정 데이터 없어 빠짐   → 보강 우선순위
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const hubRoutes = read('routes', 'hub.js');
const hubClient = read('hub.js');
const serverSource = read('server.js');
const adminHtml = read('admin.html');

test('스냅샷은 덮어쓰지 않고 병합한다', () => {
  // 추천 기록과 채택 기록이 다른 시점에 들어온다. 덮어쓰면 한쪽이 사라진다.
  assert.match(hubRoutes,
    /recommendation_snapshot = coalesce\(recommendation_snapshot, '\{\}'::jsonb\) \|\| \$1::jsonb/);
});

test('스냅샷 쓰기는 담당자·admin 만 가능하다', () => {
  const block = hubRoutes.slice(hubRoutes.indexOf("router.post('/deals/:id/recommendations/snapshot'"));
  assert.match(block, /\$3 = 'admin' or owner_id = \$4/);
  assert.doesNotMatch(block.slice(0, 900), /owner_id is null/,
    '읽기와 달리 쓰기는 미배정 딜을 허용하지 않는다');
});

test('추천 직후 무엇을 추천했는지 기록한다', () => {
  assert.match(hubClient, /state\.reco = await api\([\s\S]{0,80}saveRecommendationSnapshot\(\)/);
  assert.match(hubClient, /function saveRecommendationSnapshot/);
  // 기준선에는 세 그룹과 "판정 데이터 없어 빠진 것"이 함께 들어가야 한다.
  for (const field of ['eligible', 'bundles', 'needsConfirmation', 'excludedNoData']) {
    assert.match(hubClient, new RegExp(`${field}:`), `스냅샷에 ${field} 가 없다`);
  }
});

test('조합이 바뀔 때마다 채택을 기록한다', () => {
  assert.match(hubClient, /function saveAdoptionSnapshot/);
  // 카탈로그 체크박스와 추천 카드 버튼 양쪽에서 불려야 한다.
  const calls = hubClient.match(/saveAdoptionSnapshot\(\);/g) || [];
  assert.ok(calls.length >= 2, `채택 기록 호출이 ${calls.length}곳뿐이다`);
  // slug 를 남겨야 리포트에서 솔루션을 식별할 수 있다.
  assert.match(hubClient, /slug: solution\?\.slug \|\| null/);
});

test('기록 실패가 영업 작업을 막지 않는다', () => {
  assert.match(hubClient, /function postSnapshot[\s\S]*?\.catch\(\(\) => \{\}\)/);
});

test('리포트가 세 신호를 분리해서 낸다', () => {
  assert.match(serverSource, /app\.get\('\/api\/admin\/recommendation-report', authenticateToken, catalogEditorOnly/);
  for (const key of ['misses', 'manualPicks', 'needsData']) {
    assert.match(serverSource, new RegExp(`${key}:`), `리포트에 ${key} 가 없다`);
  }
  // manual = 추천 목록에 없었는데 고른 것
  assert.match(serverSource, /bump\(slug, meta\?\.name, 'manual'\)/);
  // miss = 2회 이상 추천됐는데 채택률 30% 미만
  assert.match(serverSource, /s\.recommended >= 2 && \(s\.adoptionRate \?\? 1\) < 0\.3/);
});

test('리포트는 스냅샷이 있는 딜만 훑고 상한을 둔다', () => {
  assert.match(serverSource, /recommendation_snapshot <> '\{\}'::jsonb/);
  assert.match(serverSource, /limit 500/);
});

test('admin 에 리포트 탭이 있고 curator 도 본다', () => {
  assert.match(adminHtml, /data-tab="reco-report"/);
  assert.match(adminHtml, /id="tab-admin-reco-report"/);
  assert.match(adminHtml, /function loadRecoReport/);
  // 콘텐츠 보강 우선순위라 ISV BU(curator)가 봐야 한다 — data-role-admin 이 없어야 한다.
  // 해당 <button> 요소만 잘라낸다(앞 버튼까지 걸치면 오탐이 난다).
  const marker = adminHtml.indexOf('data-tab="reco-report"');
  const tabButton = adminHtml.slice(adminHtml.lastIndexOf('<button', marker),
    adminHtml.indexOf('>', marker) + 1);
  assert.match(tabButton, /data-tab="reco-report"/);
  assert.doesNotMatch(tabButton, /data-role-admin/);
});

test('리포트 출력도 이스케이프한다', () => {
  assert.match(adminHtml, /escapeHtmlAdmin\(c\.get\(r\)\)/);
});
