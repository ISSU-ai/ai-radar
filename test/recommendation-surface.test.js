'use strict';

/**
 * 추천 API 와 STEP 03 UI 배선.
 *
 * 추천은 딜 데이터(FQA·업종·예산)를 입력으로 쓰므로 딜 상세와 같은 수준으로
 * 보호돼야 한다. 그리고 판정 데이터가 없어 빠진 후보는 "안 맞아서 제외"와
 * 구분돼 보여야 한다 — 영업에게는 다른 뜻이고, ISSU 에게는 보강 신호다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const hubRoutes = fs.readFileSync(path.join(root, 'routes', 'hub.js'), 'utf8');
const hubClient = fs.readFileSync(path.join(root, 'hub.js'), 'utf8');
const hubStyles = fs.readFileSync(path.join(root, 'hub.css'), 'utf8');

test('추천 API 가 딜 상세와 같은 owner 게이트를 쓴다', () => {
  const block = hubRoutes.slice(
    hubRoutes.indexOf("router.get('/deals/:id/recommendations'"),
    hubRoutes.indexOf("router.post('/deals/:id/recommendations/snapshot'")
  );
  assert.match(block, /\$2 = 'admin' or d\.owner_id is null or d\.owner_id = \$3/);
  assert.match(block, /status\(404\)/, '남의 딜은 존재를 숨겨 404 로 답해야 한다');
});

test('스키마 미적용 환경에서는 503 으로 원인을 알린다', () => {
  // 010~011 이 없으면 slot·fqa_coverage 가 없어 조회 자체가 깨진다.
  assert.match(hubRoutes, /추천 엔진 스키마가 아직 적용되지 않았습니다/);
  assert.match(hubRoutes, /await hasColumn\('solutions', 'slot'\)/);
});

test('문항 단위 전제를 실제 문항 점수로 판정한다', () => {
  // 카테고리 평균으로만 보면 A[보안 게이트웨이] 같은 개별 전제가 뭉개진다.
  assert.match(hubRoutes, /itemScores\[item\.name\] = score/);
  assert.match(hubRoutes, /itemScores,/);
});

test('필터·가중치를 recommendation_config 에서 읽는다', () => {
  assert.match(hubRoutes, /select key, kind, weight, enabled from recommendation_config/);
  assert.match(hubRoutes, /if \(row\.kind === 'rank'\) weights\[row\.key\]/);
  assert.match(hubRoutes, /if \(row\.kind === 'filter'\) filters\[row\.key\]/);
  // 설정 테이블이 없어도 기본값으로 동작해야 한다.
  assert.match(hubRoutes, /\.catch\(\(\) => \[\]\)/);
});

test('스냅샷 저장도 owner 로 제한된다', () => {
  const block = hubRoutes.slice(hubRoutes.indexOf("router.post('/deals/:id/recommendations/snapshot'"));
  assert.match(block, /\$3 = 'admin' or owner_id = \$4/);
});

test('STEP 03 이 추천을 한 번만 계산하고 재렌더는 캐시를 쓴다', () => {
  // 렌더 안에서 부르면 재귀가 된다. 렌더가 끝난 뒤, 결과가 없을 때만 시작한다.
  assert.match(hubClient, /if \(stage === 2 && !state\.reco\) loadRecommendations\(\);/);
  assert.match(hubClient, /else if \(stage === 2\) renderRecommendationPanel\(\);/);
  // 딜을 새로 열면 이전 딜의 추천이 남으면 안 된다.
  assert.match(hubClient, /state\.deal = deal;\s*\n\s*state\.reco = null;/);
});

test('추천 그룹을 나눠 보여준다', () => {
  assert.match(hubClient, /const RECO_GROUPS = \[/);
  for (const title of ['바로 도입 가능', '선행 조건이 필요', '확인 필요']) {
    assert.match(hubClient, new RegExp(title));
  }
  // 번들은 무엇을 선행해야 하는지 카드에 드러나야 한다.
  assert.match(hubClient, /item\.enabler \? ` <em>← \$\{escapeHtml\(item\.enabler\.name\)\} 선행/);
});

test('"판정 데이터 없음"과 "안 맞아서 제외"를 나눈다', () => {
  assert.match(hubClient, /const noData = excluded\.filter\(\(x\) => x\.excludedBy\?\.some\(\(r\) => \/판정 데이터\/\.test\(r\)\)\)/);
  assert.match(hubClient, /이 고객에게 맞지 않아 제외/);
  assert.match(hubClient, /판정 데이터가 없어 후보에서 빠짐/);
  assert.match(hubClient, /ISSU 에 보강을 요청하세요/);
});

test('추천 카드의 사용자 데이터는 이스케이프한다', () => {
  // 솔루션 이름·근거 문장·부적합 신호가 전부 DB 에서 온다.
  assert.match(hubClient, /escapeHtml\(item\.name\)/);
  assert.match(hubClient, /\.map\(\(r\) => `<li>\$\{escapeHtml\(r\)\}<\/li>`\)/);
  assert.match(hubClient, /escapeHtml\(f\.signal\)/);
});

test('추천은 제안이지 강제가 아니다 — 수동 선택이 남아 있다', () => {
  // 기존 카탈로그 그리드와 검색이 그대로 있어야 한다.
  assert.match(hubClient, /data-solution-id="\$\{solution\.id\}"/);
  assert.match(hubClient, /id="catalog-search"/);
  // 추천 카드의 "조합에 추가" 는 같은 isv_combo 를 건드린다.
  assert.match(hubClient, /data-reco-add/);
  assert.match(hubClient, /scheduleSave\(\{ isv_combo: state\.deal\.isv_combo \}, true\)/);
  // 담당자가 아니면 추가 버튼이 비활성이어야 한다.
  assert.match(hubClient, /\$\{isOwner\(\) \? '' : 'disabled'\}/);
});

test('추천 패널 스타일이 그룹별로 구분된다', () => {
  for (const cls of ['.reco-panel', '.reco-ok', '.reco-bundle', '.reco-warn', '.reco-nodata']) {
    assert.ok(hubStyles.includes(cls), `${cls} 스타일이 없다`);
  }
  assert.match(hubStyles, /\.reco-panel:empty \{ display: none/);
});
