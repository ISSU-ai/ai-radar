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

test('갭을 평가영역과 42축 두 어휘로 넘긴다', () => {
  // 키가 겹치지 않아 솔루션은 평가영역으로, 패키지는 축으로 각자 맞물린다.
  assert.match(hubRoutes, /buildGapTotals\(deal\.assessment_totals, deal\.readiness_totals\)/);
  assert.match(hubRoutes, /categoryLabels: labels/, '이름표는 호출자가 넘긴다');
  // 후보 선정과 선행 판정은 다른 어휘다. 한 필드에 두면 점수가 이중 계산된다.
  assert.match(hubRoutes, /coverage: asCoverage\(row\.readiness_coverage, 'axis'\)/);
  assert.match(hubRoutes, /enablerCoverage: asCoverage\(row\.assessment_coverage, 'area'\)/);
  assert.match(hubRoutes, /coverage: asCoverage\(row\.assessment_coverage, 'area'\)/);
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

test('추천을 제안 3단 구조로 보여준다', () => {
  // 패키지와 ISV 를 한 줄로 세우지 않는다. 둘은 다른 질문에 답하고, 패키지에는
  // synergy·grade·bundle_potential 이 없어 점수 비교 자체가 성립하지 않는다.
  assert.match(hubClient, /const RECO_GROUPS = \[/);
  for (const title of ['① 준비', '② 도입', '③ 정착·운영', '선행 조건이 필요', '확인 필요']) {
    assert.match(hubClient, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  // 절대 점수 배지는 없앤다 — "10" 이 무엇 중 10 인지 영업이 알 수 없다.
  assert.doesNotMatch(hubClient, /class="reco-score"/);
  // 번들은 무엇을 선행해야 하는지 카드에 드러나야 한다.
  assert.match(hubClient, /item\.enabler \? ` <em>← \$\{escapeHtml\(item\.enabler\.name\)\} 선행/);
});

test('"판정 데이터 없음"과 "안 맞아서 제외"를 나눈다', () => {
  assert.match(hubClient, /const noData = excluded\.filter\(\(x\) => x\.excludedBy\?\.some\(\(r\) => \/판정 데이터\/\.test\(r\)\)\)/);
  assert.match(hubClient, /이 고객에게 맞지 않아 제외/);
  assert.match(hubClient, /판정 데이터가 없어 후보에서 빠짐/);
  assert.match(hubClient, /보강 우선순위로 삼으세요/);
  // 이 목록은 ISSU·관리자 전용이다. 영업에게는 미완성 솔루션을 보여주지 않는다.
  assert.match(hubClient, /noData\.length && isCatalogEditor\(\)/);
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

test('판정 데이터가 없는 솔루션은 영업에게 감춘다', () => {
  // 콘텐츠가 껍데기라 골라도 근거를 댈 수 없고, 추천에도 안 잡혀 혼란만 준다.
  assert.match(hubClient, /function hasJudgementData/);
  assert.match(hubClient, /isCatalogEditor\(\) \|\| selected\.has\(solution\.id\) \|\| hasJudgementData\(solution\)/);
  // 이미 고른 것은 남긴다 — 눈앞에서 사라지면 그게 더 혼란스럽다.
  assert.match(hubClient, /selected\.has\(solution\.id\)/);
  // 몇 건이 감춰졌는지는 알린다.
  assert.match(hubClient, /준비 중인 솔루션 \$\{hiddenCount\}건은 표시하지 않았습니다/);
});

test('reference-data 가 판정 데이터 보유 여부를 함께 준다', () => {
  assert.match(hubRoutes, /\$\{coverageColumn\} as assessment_coverage/);
  // 038 미적용 환경에서 카탈로그가 통째로 사라지면 안 된다.
  assert.match(hubRoutes, /hasCoverage \? 's\.assessment_coverage' : `'\[\{"legacy":true\}\]'::jsonb`/);
});
