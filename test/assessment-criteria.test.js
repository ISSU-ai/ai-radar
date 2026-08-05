'use strict';

/**
 * 036~038 — 도입 판정 기준을 기획안 Appendix A 로.
 *
 * 시드가 문자열로 이어져 있다. 한 글자만 달라도 런타임 에러가 아니라 **조용한 매칭
 * 0건**이 되고, 그 평가영역은 영원히 안 채워진다. 030 에서 겪은 종류라 전부 대조한다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8');

const criteria = read('036_assessment_criteria.sql');
const bridge = read('037_readiness_assessment_bridge.sql');
const judgement = read('038_assessment_judgement.sql');

const areaIds = [...criteria.matchAll(/\('(A\d\d)', '(D\d)'/g)].map((m) => m[1]);
const readinessCodes = new Set([...read('029_readiness_items.sql')
  .matchAll(/\('([SPDTBG]\d+)', '[SPDTBG]'/g)].map((m) => m[1]));

// ── 036 ──────────────────────────────────────────────────────────
test('036 — 대분류 5 · 평가영역 10 이 기획안과 같다', () => {
  const domains = [...criteria.matchAll(/\('(D\d)', '([^']+)',\s*\d+\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(domains, [
    ['D1', '데이터·보안'], ['D2', '운영·통제'], ['D3', '신뢰·책임'],
    ['D4', '법률·규제'], ['D5', '비용·사업성']
  ]);
  assert.equal(areaIds.length, 10, `평가영역이 10개가 아니다: ${areaIds.length}`);
  assert.deepEqual([...new Set(areaIds)], areaIds, '중복된 영역 id 가 있다');
});

test('036 — 핵심 확인사항·주요 우려사항이 원문 그대로다', () => {
  // 영업이 고객 앞에서 읽는 문장이다. 요약하거나 다듬으면 근거가 흐려진다.
  for (const phrase of [
    '학습 사용 여부, 암호화, 고객사 간 분리',
    'SSO, MFA, SCIM, RBAC, 퇴사자 권한 회수',
    'Agent Tool Call, 파일·메일·외부전송 승인',
    '출처, 평가, 결과검증, Human-in-the-loop',
    '시트·Credit·API, 확장성과 종속성',
    '기밀정보·고객정보·소스코드 유출',
    '사고 원인·사용자 추적 불가',
    '비용 증가·ROI 부족·벤더 종속'
  ]) {
    assert.ok(criteria.includes(phrase), `Appendix A 원문이 없다: ${phrase}`);
  }
  assert.match(criteria, /ISO\/IEC 42001/, '분류 근거를 남겨야 한다');
});

test('036 — 되돌릴 수 없는 것에 높은 가중치를 준다', () => {
  const rows = [...criteria.matchAll(/\('(A\d\d)', 'D\d',[\s\S]*?(\d), (\d\.\d), \d+\)/g)]
    .map((m) => ({ id: m[1], weight: Number(m[2]), threshold: Number(m[3]) }));
  assert.equal(rows.length, 10);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  // 유출·계정 통제·데이터 권한·규제는 사고가 나면 되돌릴 수 없다
  for (const id of ['A01', 'A03', 'A04', 'A08']) {
    assert.equal(by[id].weight, 5, `${id} 의 가중치가 최고가 아니다`);
  }
  for (const r of rows) {
    assert.ok(r.weight >= 3 && r.weight <= 5, `${r.id} 가중치가 21문항 폭(3~5)을 벗어났다`);
    assert.ok(r.threshold >= 3.0 && r.threshold <= 3.5, `${r.id} 기준이 폭(3.0~3.5)을 벗어났다`);
  }
});

// ── 037 ──────────────────────────────────────────────────────────
test('037 — 42문항이 10영역 중 8개를 채운다', () => {
  const links = [...bridge.matchAll(/\('([SPDTBG]\d+)', '(A\d\d)', '(exact|good)'/g)]
    .map((m) => ({ code: m[1], area: m[2], fidelity: m[3] }));
  assert.ok(links.length >= 11, `대응이 너무 적다: ${links.length}`);

  const filled = new Set(links.map((l) => l.area));
  assert.equal(filled.size, 8, `채워지는 영역이 8개가 아니다: ${[...filled].sort()}`);
  // 못 채우는 둘은 순수 제품 통제 게이트다
  assert.ok(!filled.has('A02'), 'A02 저장·보존은 42문항이 묻지 않는다');
  assert.ok(!filled.has('A03'), 'A03 계정·접근통제는 42문항이 묻지 않는다');
});

test('037 — 실재하는 문항·영역만 가리킨다', () => {
  const links = [...bridge.matchAll(/\('([SPDTBG]\d+)', '(A\d\d)'/g)];
  assert.ok(links.length > 0);
  for (const [, code, area] of links) {
    assert.ok(readinessCodes.has(code), `029 에 없는 문항: ${code}`);
    assert.ok(areaIds.includes(area), `036 에 없는 영역: ${area}`);
  }
});

test('037 — 여러 문항이 한 영역을 채우면 평균을 쓴다', () => {
  // 최댓값이면 하나만 잘해도 통과하고, 최솟값이면 하나만 못해도 막힌다.
  assert.match(bridge, /평균을 쓴다/);
  const links = [...bridge.matchAll(/\('([SPDTBG]\d+)', '(A\d\d)'/g)].map((m) => m[2]);
  const multi = links.filter((a, i) => links.indexOf(a) !== i);
  assert.ok(multi.length >= 3, '여러 문항이 겹치는 영역이 있어야 평균 규칙이 의미가 있다');
});

// ── 038 ──────────────────────────────────────────────────────────
test('038 — 대응 없는 전제를 버리지 않고 영업 확인으로 돌린다', () => {
  // 그냥 지우면 막혔어야 할 후보가 조용히 통과한다. 낙관적으로 틀리는 쪽이다.
  assert.match(judgement, /'kind', 'manual'/);
  assert.match(judgement, /버리지 않고 영업 확인으로 돌린다/);
  // numeric·manual 전제는 손대지 않는다
  assert.match(judgement, /when p\.value ->> 'kind' <> 'fqa' then p\.value/);
});

test('038 — 패키지가 6축과 평가영역을 따로 갖는다', () => {
  // 하나로 합치면 "고객에게 필요한 것" 과 "제품 게이트를 푸는 것" 이 섞인다.
  assert.match(judgement, /readiness_coverage\s+jsonb/);
  assert.match(judgement, /assessment_lift\s+jsonb/);

  const axes = {};
  for (const m of judgement.matchAll(/readiness_coverage = '(\[[\s\S]*?\])'::jsonb\s*\n?\s*where id = '(\w+)'/g)) {
    axes[m[2]] = JSON.parse(m[1]).map((e) => e.axis);
  }
  // 01·04 가 사라지지 않는 것이 이 변경의 이유다
  assert.deepEqual(axes.P01, ['S', 'B'], '01 AI Consulting 이 전략·업무적용을 덮어야 한다');
  assert.deepEqual(axes.P04, ['P', 'B'], '04 Adoption & Change 가 인재·업무적용을 덮어야 한다');
  for (const [id, list] of Object.entries(axes)) {
    assert.ok(list.length > 0, `${id} 의 축 커버리지가 비었다 — 추천에서 사라진다`);
    for (const axis of list) {
      assert.ok('SPDTBG'.includes(axis), `${id} 가 없는 축을 가리킨다: ${axis}`);
    }
  }
});

test('038 — 전략·조직 과업은 제품 게이트를 풀지 않는다', () => {
  // "컨설팅을 하면 SSO 가 생긴다" 는 말이 되면 안 된다.
  assert.match(judgement, /assessment_coverage = '\[\]'::jsonb, assessment_lift = '\{\}'::jsonb\s*\n\s*where id in \('P01', 'P04'\)/);
});

test('038 — lift 가 실재하는 평가영역만 가리킨다', () => {
  const lifts = [...judgement.matchAll(/assessment_lift = '(\{[^}]*\})'::jsonb/g)]
    .flatMap((m) => Object.keys(JSON.parse(m[1])));
  assert.ok(lifts.length > 0);
  for (const area of lifts) {
    assert.ok(areaIds.includes(area), `036 에 없는 영역을 올린다: ${area}`);
  }
});

test('038 — 21문항 대응표가 실제 문항명과 붙는다', () => {
  // 문자열 조인이라 한 글자만 달라도 조용히 안 옮겨진다.
  const seedItems = new Set([...read('001_enablement_hub.sql')
    .matchAll(/\('([ABCD])',\s*\d+,\s*'([^']+)'/g)].map((m) => `${m[1]}|${m[2]}`));
  const mapped = [...judgement.matchAll(/\('([ABCD])', '([^']+)',\s*'(A\d\d)'\)/g)];
  assert.ok(mapped.length >= 14, `대응표가 너무 짧다: ${mapped.length}`);
  for (const [, category, item, area] of mapped) {
    assert.ok(seedItems.has(`${category}|${item}`), `001 에 없는 문항: ${category}|${item}`);
    assert.ok(areaIds.includes(area), `036 에 없는 영역: ${area}`);
  }
});

test('036~038 이 1회성 시드로 표시돼 있다', () => {
  // 자동 적용에 들어가면 어드민에서 고친 값을 덮어쓴다.
  for (const [name, sql] of [['036', criteria], ['037', bridge], ['038', judgement]]) {
    assert.match(sql, /apply-migrations\.js 에서 제외한다/, `${name} 에 표시가 없다`);
    assert.ok(!fs.readFileSync(path.join(root, 'scripts', 'apply-migrations.js'), 'utf8')
      .includes(`'${name}_`), `${name} 가 자동 적용 목록에 있다`);
  }
});

// ── SQL 함정 ─────────────────────────────────────────────────────
test('038 — 쓰는 컬럼을 전부 선언한다', () => {
  // packages.assessment_coverage 를 선언 없이 쓰다가 적용에서 터졌다.
  const added = new Set([...judgement.matchAll(/alter table (\w+)\s+add column if not exists (\w+)/g)]
    .map((m) => `${m[1]}.${m[2]}`));
  const written = new Set();
  for (const m of judgement.matchAll(/update (\w+)(?: \w+)? set([\s\S]*?)(?=\n\s*where |\n\s*from )/g)) {
    for (const c of m[2].matchAll(/(?:^|,)\s*(\w+) =/g)) written.add(`${m[1]}.${c[1]}`);
  }
  // 이전 마이그레이션에서 만든 것은 제외
  const preexisting = ['solutions.fqa_coverage', 'packages.fqa_coverage', 'packages.readiness_lift'];
  const missing = [...written].filter((w) => !added.has(w) && !preexisting.includes(w));
  assert.deepEqual(missing, [], `선언 없이 쓰는 컬럼: ${missing.join(', ')}`);
});

test('마이그레이션이 콤마 조인과 명시적 join 을 섞지 않는다', () => {
  // Postgres 는 join 을 **바로 앞 FROM 항목에만** 묶는다. `from a, b, c join d on b.x`
  // 는 b 를 못 봐서 42P01 로 터진다. 적용해 봐야 알 수 있는 종류라 여기서 막는다.
  const dir = path.join(root, 'db', 'migrations');
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.startsWith('_'))) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      .replace(/^\s*--.*$/gm, '')
      .replace(/\(values[\s\S]*?\)\s+as\s+\w+\([^)]*\)/gi, ' VALUES_LIST ');  // values 목록의 콤마는 제외
    for (const m of sql.matchAll(/\bfrom\s+[^;()]*?,[^;()]*?,[^;()]*?\n\s*(?:left\s+|inner\s+|right\s+)?join\s/gi)) {
      offenders.push(`${file}: ${m[0].replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});
