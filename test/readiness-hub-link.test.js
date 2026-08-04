'use strict';

/**
 * /readiness 42문항 → 딜 → /hub 연동.
 *
 * 이 경로가 끊기면 고객이 42문항을 다 답해도 영업은 빈 딜을 본다. 화면에서는
 * "접수 완료" 가 뜨기 때문에 아무도 모른 채로 지나간다. 그래서 배선 자체를 건다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateLead, normaliseDealPatch } = require('../lib/hub-domain');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const baseLead = {
  customer: '연동테스트', contact: 'a@b.co.kr', contact_name: '김테스트',
  contact_phone: '02-1111-2222', message: '연동 확인', consent: true
};

// ── 접수 ─────────────────────────────────────────────────────────
test('리드에 42문항 응답을 실어 보낼 수 있다', () => {
  const lead = validateLead({ ...baseLead, readiness_scores: { S1: 3, D4: 1 } });
  assert.deepEqual(lead.readiness_scores, { S1: 3, D4: 1 });
});

test('42문항이 없으면 빈 객체로 지나간다 — 기존 리드 경로가 깨지지 않는다', () => {
  assert.deepEqual(validateLead(baseLead).readiness_scores, {});
});

test('42문항으로 들어온 리드에는 21문항 전량을 요구하지 않는다', () => {
  // 고객은 21문항을 본 적이 없다. 요구하면 진단 결과가 통째로 버려진다.
  const server = read('server.js');
  const open = server.indexOf('const requireCompleteFqaScores');
  assert.ok(open > 0, 'requireCompleteFqaScores 가 있어야 한다');
  const body = server.slice(open, open + 1600);
  assert.match(body, /readiness_scores/);
  assert.match(body, /return next\(\)/);
});

// ── 채점과 bridge ────────────────────────────────────────────────
test('접수 때 채점하고 bridge 로 21문항을 채운다', () => {
  const routes = read('routes/hub.js');
  const open = routes.indexOf('const applyReadiness');
  assert.ok(open > 0, 'applyReadiness 가 있어야 한다');
  const body = routes.slice(open, routes.indexOf('router.get(', open));

  assert.match(body, /scoreReadiness\(/, '서버가 채점해야 한다');
  assert.match(body, /readiness_fqa_bridge/, '030 bridge 로 21문항을 채워야 한다');
  assert.match(body, /fqaFilled/, '어느 문항이 자동으로 찼는지 남겨야 한다');
  assert.match(body, /value >= 1 && value <= 5/, '범위 밖 값을 넣으면 안 된다');
  assert.match(body, /hasColumn\('readiness_fqa_bridge'/,
    '030 미적용 구간에도 접수는 성공해야 한다');
});

test('영업이 직접 답한 21문항이 자동 채움을 이긴다', () => {
  // 순서가 뒤집히면 영업이 확인해 고친 값을 고객 응답이 덮는다.
  const routes = read('routes/hub.js');
  assert.match(routes, /\{ \.\.\.readiness\.fqaScores, \.\.\.lead\.fqa_scores \}/);
});

test('031 미적용 구간에도 접수가 살아남는다', () => {
  const routes = read('routes/hub.js');
  assert.match(routes, /hasColumn\('deals', 'readiness_scores'\)/);
  assert.match(routes, /hasReadinessCols && readiness/,
    '컬럼이 없으면 준비도만 빼고 딜은 만들어야 한다');
});

// ── 영업은 고칠 수 없다 ──────────────────────────────────────────
test('영업이 딜에서 준비도 응답을 고칠 수 없다', () => {
  // 고객이 답한 값이다. 영업이 고치면 리포트와 딜의 숫자가 갈라진다.
  assert.throws(
    () => normaliseDealPatch({ readiness_scores: { S1: 5 }, readiness_totals: { average: 5 } }),
    /저장할 변경사항이 없습니다/
  );
});

// ── 허브 화면 ────────────────────────────────────────────────────
test('허브가 준비도 결과를 그대로 보여준다 — 다시 계산하지 않는다', () => {
  const hub = read('hub.js');
  assert.match(hub, /function renderReadinessPanel/);
  assert.match(hub, /state\.deal\.readiness_totals/);
  assert.match(hub, /renderReadinessPanel\(\)/, 'STEP02 에서 실제로 불러야 한다');
  assert.ok(!/scoreReadiness|areaScores|\/ 7\b/.test(hub),
    '허브가 42문항을 다시 채점하면 안 된다');
});

test('자동으로 채워진 21문항을 표시한다', () => {
  // 표시가 없으면 영업이 자기가 넣은 값인 줄 알고 근거 없이 신뢰한다.
  const hub = read('hub.js');
  assert.match(hub, /fqaFilled/);
  assert.match(hub, /fqa-auto/);
  assert.match(read('hub.css'), /\.fqa-auto/);
  assert.match(read('hub.css'), /\.readiness-panel/);
});

test('준비도가 없는 딜에서는 패널이 통째로 빠진다', () => {
  // 수동·시트로 만든 딜에 빈 카드가 뜨면 "왜 0점이지" 를 묻게 된다.
  const hub = read('hub.js');
  const open = hub.indexOf('function renderReadinessPanel');
  const body = hub.slice(open, hub.indexOf('function renderFqa', open));
  assert.match(body, /if \(!totals\.average \|\| !areas\.length\) return '';/);
});

// ── 진단 화면의 상담 폼 ──────────────────────────────────────────
test('진단 결과 화면에서 응답과 함께 상담을 요청한다', () => {
  const html = read('readiness.html');
  const js = read('readiness.js');

  assert.match(html, /id="lead-form"/);
  assert.match(js, /readiness_scores: state\.scores/,
    '42문항 응답이 리드에 실려야 한다 — 안 실으면 답한 게 버려진다');
  assert.match(js, /'\/api\/hub\/public\/leads'/);
  assert.ok(!/<a[^>]*href="\/#contact"[^>]*class="button primary"/.test(html),
    '랜딩으로 보내면 응답이 사라진다');

  // 결과를 본 뒤에만 연다
  assert.match(html, /id="contact" class="rd-contact section-wrap hidden"/);
  assert.match(js, /\$\('#contact'\)\.classList\.remove\('hidden'\)/);
});

test('상담 폼이 taxonomy 어휘를 쓴다', () => {
  // 여기서 직접 적으면 허브의 업종·규모 값과 갈라져 필터가 안 먹는다.
  const js = read('readiness.js');
  assert.match(js, /window\.IssuTaxonomy\.INDUSTRIES/);
  assert.match(js, /window\.IssuTaxonomy\.COMPANY_SIZES/);
  assert.match(read('readiness.html'), /src="\/taxonomy\.js"/);
});

test('수집 항목 고지에 준비도 응답이 들어 있다', () => {
  // 42문항 응답을 함께 보내면서 고지에 없으면 동의받은 범위를 넘는다.
  const html = read('readiness.html');
  const open = html.indexOf('rd-privacy-title');
  const body = html.slice(open, html.indexOf('</div>', open));
  for (const field of ['담당자 이름', '업무 이메일', '전화번호', '42문항']) {
    assert.ok(body.includes(field), `고지에 ${field} 이(가) 없다`);
  }
});

// ── 마이그레이션 ─────────────────────────────────────────────────
test('031 이 컬럼만 만들고 자동 적용에 들어간다', () => {
  const sql = read('db/migrations/031_deal_readiness.sql');
  assert.match(sql, /add column if not exists readiness_scores jsonb/);
  assert.match(sql, /add column if not exists readiness_totals jsonb/);
  assert.ok(!/insert into|update /.test(sql.split('-- 확인')[0]),
    '데이터를 건드리면 자동 적용에 넣을 수 없다');
  assert.match(read('scripts/apply-migrations.js'), /'031_deal_readiness\.sql'/);
});

test('목업이 030 bridge 를 직접 읽고 딜까지 만든다', () => {
  // 베껴 두면 실제와 어긋나고, 딜을 안 만들면 연동을 로컬에서 확인할 수 없다.
  const mock = read('scripts/mock-ui-server.js');
  assert.match(mock, /030_readiness_fqa_bridge\.sql/);
  assert.match(mock, /mockApplyReadiness/);
  assert.match(mock, /deals\.push\(/);
});

// ── 고객 진단은 한 곳뿐이다 ──────────────────────────────────────
test('랜딩이 21문항을 직접 받지 않는다', () => {
  // 21문항은 ISV 전제조건 판정용이라 영업이 답할 문항이다. 고객에게 물으면
  // "답할 수 없는 문항" 이 생기고, 그 응답으로 판정이 돌아간다.
  const html = read('offering.html');
  const js = read('offering.js');

  assert.ok(!/id="questions"|category-tab|calculate-result/.test(html),
    '랜딩에 21문항 진단 패널이 남아 있다');
  assert.ok(!/public\/fqa-items|public\/diagnose/.test(js),
    '랜딩이 아직 21문항 API 를 부른다');
  assert.ok(!/id="lead-form"/.test(html),
    '진단을 안 거친 상담 폼이 랜딩에 남아 있다 — 게이트가 400 으로 막는다');
});

test('랜딩의 진단 경로가 전부 /readiness 로 간다', () => {
  const html = read('offering.html');
  for (const [label, pattern] of [
    ['상단 CTA', /class="nav-cta" href="\/readiness"/],
    ['진단 시작 버튼', /id="start-assessment"[^>]*href="\/readiness"/],
    ['상담 안내', /class="contact-cta"[\s\S]*?href="\/readiness"/]
  ]) {
    assert.match(html, pattern, `${label} 가 /readiness 로 가지 않는다`);
  }
});

test('랜딩이 영역·문항 수를 API 에서 받는다', () => {
  // 베껴 두면 문항을 늘렸을 때 랜딩만 옛 숫자를 말한다. 고객이 "42문항" 을 보고
  // 들어갔는데 49문항이 나온다.
  const js = read('offering.js');
  assert.match(js, /public\/readiness-items/);
  assert.match(js, /#item-count/);
  assert.ok(!/'S'.*'P'.*'D'.*'T'/.test(js), '랜딩이 축 목록을 다시 적고 있다');
});

test('한쪽이 죽어도 나머지는 뜬다', () => {
  // 오퍼링 목록이 안 뜬다고 진단 입구까지 닫을 이유가 없다.
  const js = read('offering.js');
  assert.match(js, /Promise\.allSettled/);
});
