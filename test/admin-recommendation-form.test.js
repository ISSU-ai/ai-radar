'use strict';

/**
 * 판정 데이터 입력 폼(2-2b). ISSU 가 slot·fqa_coverage·prerequisites·red_flags 를
 * 화면에서 넣을 수 있어야 등록이 성립한다. API 만 있으면 아무도 못 쓴다.
 *
 * 폼 필드와 저장 payload, 서버의 저장 경로가 서로 어긋나면 값이 조용히 사라진다 —
 * 그 연결을 양쪽에서 대조한다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('판정 데이터 입력 요소가 전부 있다', () => {
  for (const id of ['sol-slot', 'sol-bundle-potential', 'sol-prerequisites', 'sol-red-flags']) {
    assert.match(adminHtml, new RegExp(`id="${id}"`), `${id} 입력 요소가 없다`);
  }
  assert.match(adminHtml, /id="fqa-coverage-editor"/);
  assert.match(adminHtml, /id="completeness-panel"/);
  assert.match(adminHtml, /id="check-completeness-button"/);
});

test('폼이 슬롯 목록을 서버에서 받아 채운다', () => {
  assert.match(adminHtml, /fetch\('\/api\/admin\/slots'\)/);
  // 후보 수와 경쟁 여부를 같이 보여줘야 ISSU 가 빈 슬롯을 안다.
  assert.match(adminHtml, /후보 \$\{slot\.candidates\}종/);
  assert.match(serverSource, /app\.get\('\/api\/admin\/slots', authenticateToken, catalogEditorOnly/);
});

test('FQA 커버리지 편집기가 21문항을 공개 API 에서 가져온다', () => {
  // 문항 목록은 이미 공개 엔드포인트가 있으므로 새 API 를 만들지 않는다.
  assert.match(adminHtml, /fetch\('\/api\/hub\/public\/fqa-items'\)/);
  assert.match(adminHtml, /function renderFqaCoverageEditor/);
  assert.match(adminHtml, /function collectFqaCoverage/);
  // 강도 0 은 "해당 없음" 이라 수집에서 빠져야 한다.
  assert.match(adminHtml, /if \(!strength\) return null;/);
});

test('JSON 필드는 깨지면 저장을 막는다', () => {
  assert.match(adminHtml, /function parseJsonField/);
  assert.match(adminHtml, /throw new Error\(`\$\{label\} JSON 오류/);
  assert.match(adminHtml, /parseJsonField\('sol-prerequisites', '전제 조건'\)/);
  assert.match(adminHtml, /parseJsonField\('sol-red-flags', '부적합 신호'\)/);
});

test('저장 payload 와 서버 저장 필드가 일치한다', () => {
  const payloadBlock = adminHtml.slice(
    adminHtml.indexOf('sections_internal,\n        industries,'),
    adminHtml.indexOf("red_flags: parseJsonField('sol-red-flags'") + 200
  );
  for (const field of ['slot', 'bundle_potential', 'assessment_coverage', 'assessment_prerequisites', 'red_flags']) {
    assert.match(payloadBlock, new RegExp(`${field}:`), `payload 에 ${field} 가 없다`);
    assert.match(serverSource, new RegExp(`column: '${field}'`), `서버가 ${field} 를 저장하지 않는다`);
  }
});

test('서버가 생성·수정·발행 세 경로에서 판정 데이터를 저장한다', () => {
  const calls = serverSource.match(/await persistRecommendationFields\(/g) || [];
  assert.equal(calls.length, 3, 'POST·PUT·publish 세 곳에서 저장해야 한다');
  // undefined 면 건드리지 않아야 기존 값이 날아가지 않는다.
  assert.match(serverSource, /if \(value === undefined\) continue;/);
  // 010 미적용 환경에서도 부팅·저장이 깨지지 않아야 한다.
  assert.match(serverSource, /if \(!\(await hasColumn\('solutions', column\)\)\) continue;/);
});

test('완성도 패널이 차단·경고를 나눠 보여준다', () => {
  assert.match(adminHtml, /function runCompletenessCheck/);
  assert.match(adminHtml, /solutions\/\$\{loadedSolutionId\}\/completeness/);
  assert.match(adminHtml, /발행 차단 \$\{data\.blocking\.length\}건/);
  assert.match(adminHtml, /경고 \$\{data\.warnings\.length\}건/);
  assert.match(adminHtml, /✅ 발행 가능합니다/);
});

test('완성도 결과는 이스케이프해서 출력한다', () => {
  // 메시지에 솔루션 이름·본문 일부가 들어가므로 그대로 innerHTML 에 넣으면 안 된다.
  assert.match(adminHtml, /function escapeHtmlAdmin/);
  assert.match(adminHtml, /escapeHtmlAdmin\(item\.message\)/);
  assert.match(adminHtml, /escapeHtmlAdmin\(item\.detail\)/);
});

test('bundle_potential 은 1~3 만 저장된다', () => {
  assert.match(serverSource, /Number\.isFinite\(n\) && n >= 1 && n <= 3 \? Math\.round\(n\) : null/);
});
