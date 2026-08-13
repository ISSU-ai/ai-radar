'use strict';

/**
 * 레퍼런스·사례 (047).
 *
 * 두 가지만 잡으면 된다.
 *   ① **승인 없는 실명이 문서로 나가는 것** — 되돌릴 수 없는 사고다
 *   ② **안 맞는 사례가 붙는 것** — 고객이 "이게 우리랑 무슨 상관이죠" 라고 물으면
 *      그 뒤 문서 전체를 안 믿는다
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { scoreCaseStudy, pickCaseStudies, caseContext } = require('../lib/case-match');

const NAMED = {
  id: 'a', status: 'published', headline: '금융권 전사 도입', industry: 'Finance',
  isv_slugs: ['openai-enterprise'], package_ids: ['P02'],
  is_named: true, customer_name: '한빛금융', customer_label: '금융권 A사'
};
const ANON = { ...NAMED, id: 'b', is_named: false };

test('승인 없으면 실명이 응답에서 사라진다', () => {
  // 화면에서 숨기는 방식이면 언젠가 어느 화면이 실수한다. 여기서 잘라야 실수할 대상이 없다.
  const ctx = caseContext({ customer_meta: { industry: 'Finance' } }, ['openai-enterprise']);
  const [anon] = pickCaseStudies([ANON], ctx);
  assert.equal(anon.customer, '금융권 A사');
  assert.equal(JSON.stringify(anon).includes('한빛금융'), false, '실명이 응답에 남았다');
  // 승인된 것만 실명
  assert.equal(pickCaseStudies([NAMED], ctx)[0].customer, '한빛금융');
  // 익명 표기가 비어 있어도 실명으로 새면 안 된다
  const noLabel = { ...ANON, customer_label: '' };
  assert.equal(pickCaseStudies([noLabel], ctx)[0].customer, '고객사');
});

test('안 겹치면 아무것도 안 붙는다', () => {
  const other = caseContext({ customer_meta: { industry: 'Retail' } }, []);
  assert.deepEqual(pickCaseStudies([NAMED, ANON], other), [], '억지로 붙인 사례가 안 붙인 것보다 나쁘다');
  // 발행 안 된 것도 안 나간다
  assert.deepEqual(pickCaseStudies([{ ...NAMED, status: 'draft' }],
    caseContext({ customer_meta: { industry: 'Finance' } }, [])), []);
  // 둘까지만 — 셋을 넘기면 사례집이 되고 아무도 안 읽는다
  const many = [1, 2, 3, 4].map((n) => ({ ...NAMED, id: `c${n}` }));
  assert.equal(pickCaseStudies(many, caseContext({ customer_meta: { industry: 'Finance' } }, [])).length, 2);
});

test('겹치는 만큼 점수가 오른다', () => {
  const ctx = { industry: 'Finance', packages: ['P02'], slugs: ['openai-enterprise'] };
  assert.equal(scoreCaseStudy(NAMED, ctx), 7, '업종3 + ISV2 + 패키지2');
  assert.equal(scoreCaseStudy(NAMED, { industry: 'Finance' }), 3);
  assert.equal(scoreCaseStudy(NAMED, {}), 0);
  // 정렬이 흔들리지 않아야 한다 — 같은 점수면 id 순
  const rows = [{ ...NAMED, id: 'z' }, { ...NAMED, id: 'a' }];
  assert.deepEqual(pickCaseStudies(rows, ctx).map((x) => x.id), ['a', 'z']);
});

test('서버와 목업이 같은 규칙을 쓴다', () => {
  const routes = read('routes/hub.js');
  assert.match(routes, /require\('\.\.\/lib\/case-match'\)/);
  assert.match(routes, /return pickCaseStudies\(rows, caseContext\(deal, solutionSlugs\)\)/);
  // 라우트가 실명을 직접 다루면 안 된다 — 자르는 곳이 둘이 되면 하나가 어긋난다
  const block = routes.slice(routes.indexOf('const matchCaseStudies'), routes.indexOf('결과 링크. **인증 없이 열린다.**'));
  assert.ok(!/is_named \?/.test(block), '라우트가 실명을 직접 가른다');
  assert.match(block, /hasColumn\('case_studies', 'headline'\)/);
});

test('승인 없는 실명은 저장 단계에서 막는다', () => {
  // 저장돼 있으면 나중에 체크 한 번으로 실명이 문서에 나간다.
  const server = read('server.js');
  const block = server.slice(server.indexOf("app.post('/api/admin/case-studies'"),
    server.indexOf("app.get('/api/admin/recommendation-report'"));
  assert.match(block, /실명 공개 승인 없이 실명을 저장할 수 없습니다/);
  assert.match(block, /익명 표기는 항상 채웁니다/);
  assert.match(block, /catalogEditorOnly/);
  // DB 도 같은 것을 막는다 — 코드만 막으면 직접 INSERT 로 우회된다
  const sql = read('db/migrations/047_case_studies.sql');
  assert.match(sql, /case_studies_naming_check/);
  assert.match(sql, /not is_named or coalesce\(customer_name, ''\) <> ''/);
});

test('사례는 고객 문서와 피치에 같이 붙는다', () => {
  const hub = read('hub.js');
  // 고객용 키트 — 매칭 0건이면 절 자체가 안 나오고 번호가 밀린다
  const kit = hub.slice(hub.indexOf('function buildCustomerKit'), hub.indexOf('const STAGE_REPORT_TITLES'));
  assert.match(kit, /state\.reco\?\.caseStudies/);
  assert.match(kit, /caseStudies \? block\('5\. 비슷한 사례'/);
  assert.match(kit, /block\(caseStudies \? '6\. 예상 규모' : '5\. 예상 규모'/);
  // 화면은 customer 를 그대로 쓴다 — 실명 판정을 다시 하지 않는다
  assert.ok(!/is_named/.test(kit), '화면이 실명 판정을 또 한다');
  // 피치에도
  assert.match(hub, /5-1\. 비슷한 사례/);
});

test('047 은 예약어를 표 이름으로 쓰지 않는다', () => {
  const sql = read('db/migrations/047_case_studies.sql');
  assert.match(sql, /create table if not exists case_studies/);
  assert.ok(!/create table[^\n]*\breferences\b/i.test(sql), 'references 는 SQL 예약어다');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /is_catalog_editor\(\)/);
  assert.match(read('scripts/apply-migrations.js'), /'047_case_studies\.sql'/);
});
