'use strict';

/**
 * 완성도 게이트. 오늘 실제로 프로덕션에 들어가 있던 결함을 잡는지로 검증한다.
 *   · 7종에 `{name}` 플레이스홀더가 치환되지 않은 채 남아 있었다
 *   · 9종이 §3.2 페르소나 문장을 글자 하나 다르지 않게 공유했다
 * 반대로 잘 쓰인 9종은 통과해야 한다 — 게이트가 전부를 막으면 아무도 안 쓴다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { evaluateCompleteness, findSharedLines, isStructuralLine } =
  require('../lib/solution-completeness');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const DETAILED = new Set([
  'OpenAI Enterprise', 'Articul8', 'Anthropic Claude', 'Twelve Labs', 'Eleven Labs',
  'Replit', 'Dataiku', 'LiteLLM', 'Anaconda'
]);

const toSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function loadCatalog() {
  const source = fs.readFileSync(path.join(root, 'isv_data.js'), 'utf8');
  // eslint-disable-next-line no-eval
  return eval(`${source}; isvData`).map((s) => ({ ...s, slug: toSlug(s.name) }));
}

/** 슬롯·커버리지는 채워진 것으로 두고 콘텐츠 결함만 본다. */
function contentOnly(solution, catalog) {
  return evaluateCompleteness(
    { ...solution, slot: 'x', layer: 'L1', fqa_coverage: [{ category: 'A', strength: 3 }] },
    {
      slots: new Map([['x', { layer: 'L1' }]]),
      knownSlugs: new Set(catalog.map((s) => s.slug)),
      otherSolutions: catalog
    }
  );
}

test('상세 작성 9종은 콘텐츠 결함으로 막히지 않는다', () => {
  const catalog = loadCatalog();
  for (const solution of catalog.filter((s) => DETAILED.has(s.name))) {
    const verdict = contentOnly(solution, catalog);
    assert.deepEqual(
      verdict.blocking.map((b) => b.code), [],
      `${solution.name} 이 막혔다: ${JSON.stringify(verdict.blocking)}`
    );
  }
});

test('{name} 플레이스홀더가 남은 7종을 잡는다', () => {
  const catalog = loadCatalog();
  const caught = catalog
    .filter((s) => contentOnly(s, catalog).blocking.some((b) => b.code === 'placeholder'))
    .map((s) => s.name)
    .sort();
  assert.deepEqual(caught,
    ['CNVRG', 'DataRobot', 'H2O', 'IBM', 'MeshyAI', 'Tigergraph', 'Unique'].sort());
});

test('템플릿을 복사한 9종을 잡는다', () => {
  const catalog = loadCatalog();
  const caught = catalog
    .filter((s) => contentOnly(s, catalog).blocking.some((b) => b.code === 'duplicated_copy'))
    .map((s) => s.name);
  assert.equal(caught.length, 9, `복붙으로 잡힌 솔루션: ${caught.join(', ')}`);
  for (const name of caught) {
    assert.ok(!DETAILED.has(name), `${name} 은 상세 작성본인데 복붙으로 잡혔다`);
  }
});

test('공통 서식 헤딩은 복붙으로 세지 않는다', () => {
  // `### 7.3 부적합 신호: Red Flag (5가지)` 는 11종이 공유한다. 헤딩까지 세면
  // 잘 쓴 문서도 전부 막힌다.
  assert.ok(isStructuralLine('### 7.3 부적합 신호: Red Flag (5가지)'));
  assert.ok(isStructuralLine('#### 3.1 산업 적합도'));
  assert.ok(!isStructuralLine('- **플랫폼 엔지니어 / IT 운영 리더**: 인프라 복잡성 완화가 관심사'));

  const a = { slug: 'a', name: 'A', sections: { 7: '### 7.3 부적합 신호: Red Flag (5가지)\n고유한 본문 문장입니다 여기는 다릅니다.' } };
  const b = { slug: 'b', name: 'B', sections: { 7: '### 7.3 부적합 신호: Red Flag (5가지)\n전혀 다른 본문 문장이 여기 들어갑니다.' } };
  assert.deepEqual(findSharedLines(a, [b]), []);
});

test('한두 줄 우연한 일치는 경고로만 남는다', () => {
  const line = '이 문장은 서른 자를 훌쩍 넘기는 충분히 긴 공통 문장입니다.';
  const a = { slug: 'a', name: 'A', sections: { 1: `${line}\n고유 문장 A 입니다.` } };
  const b = { slug: 'b', name: 'B', sections: { 1: `${line}\n고유 문장 B 입니다.` } };
  const verdict = evaluateCompleteness(
    { ...a, slot: 'x', layer: 'L1', fqa_coverage: [{ category: 'A' }] },
    { slots: new Map([['x', { layer: 'L1' }]]), knownSlugs: new Set(['a', 'b']), otherSolutions: [b] }
  );
  assert.ok(!verdict.blocking.some((x) => x.code === 'duplicated_copy'));
  assert.ok(verdict.warnings.some((x) => x.code === 'duplicated_copy_minor'));
});

test('추천 후보 최소 조건을 막는다 — 슬롯·커버리지·레이어', () => {
  const base = { slug: 'x', name: 'X', layer: 'L1', sections: {} };
  const slots = new Map([['s', { layer: 'L4' }]]);

  const noSlot = evaluateCompleteness(base, { slots });
  assert.ok(noSlot.blocking.some((b) => b.code === 'slot_missing'));
  assert.ok(noSlot.blocking.some((b) => b.code === 'coverage_missing'));

  const badLayer = evaluateCompleteness(
    { ...base, slot: 's', fqa_coverage: [{ category: 'A' }] }, { slots });
  assert.ok(badLayer.blocking.some((b) => b.code === 'layer_mismatch'));

  const unknownSlot = evaluateCompleteness(
    { ...base, slot: 'nope', fqa_coverage: [{ category: 'A' }] }, { slots });
  assert.ok(unknownSlot.blocking.some((b) => b.code === 'slot_unknown'));
});

test('red_flags 무결성을 막는다 — 대안 없음·깨진 슬러그', () => {
  const base = {
    slug: 'x', name: 'X', layer: 'L1', slot: 's', sections: {},
    fqa_coverage: [{ category: 'A' }]
  };
  const ctx = { slots: new Map([['s', { layer: 'L1' }]]), knownSlugs: new Set(['x', 'real']) };

  const noAlt = evaluateCompleteness({ ...base, red_flags: [{ signal: '조건', alternatives: [] }] }, ctx);
  assert.ok(noAlt.blocking.some((b) => b.code === 'red_flag_no_alternative'));

  const dead = evaluateCompleteness(
    { ...base, red_flags: [{ signal: '조건', alternatives: [{ slug: 'ghost', label: 'G' }] }] }, ctx);
  assert.ok(dead.blocking.some((b) => b.code === 'red_flag_dead_link'));

  const good = evaluateCompleteness(
    { ...base, red_flags: [{ signal: '조건', alternatives: [{ slug: 'real', label: 'R' }] }] }, ctx);
  assert.ok(!good.blocking.some((b) => b.code.startsWith('red_flag')));
});

test('발행 라우트가 게이트를 통과해야만 진행한다', () => {
  assert.match(serverSource, /const verdict = evaluateCompleteness\(candidate, context\)/);
  assert.match(serverSource, /if \(!verdict\.ok\) \{[\s\S]*?rollback[\s\S]*?status\(422\)/);
  // 게이트 판정이 UPDATE 보다 먼저 있어야 한다.
  const gateIndex = serverSource.indexOf('const verdict = evaluateCompleteness');
  const updateIndex = serverSource.indexOf("UPDATE solutions\n      SET slug = $1, name = $2, delivery = $3, layer = $4, synergy = $5, category = $6,\n          jtbd = $7, value_chain = $8, sections = $9, opinion = $10, status = 'published'");
  assert.ok(gateIndex > 0 && updateIndex > gateIndex, '게이트가 발행 UPDATE 뒤에 있다');
});

test('게이트 우회는 admin 만 가능하고 감사로그를 남긴다', () => {
  assert.match(serverSource, /const bypassGate = payload\.skip_completeness_check === true && isAdminUser\(req\.user\)/);
  assert.match(serverSource, /완성도 검사 우회는 관리자만 가능합니다/);
  assert.match(serverSource, /auditLog\(req\.user\.id, 'publish', slug, 'completeness gate bypassed'\)/);
});

test('완성도 미리보기 엔드포인트가 curator 에게 열려 있다', () => {
  assert.match(serverSource,
    /app\.get\('\/api\/admin\/solutions\/:id\/completeness', authenticateToken, catalogEditorOnly/);
});
