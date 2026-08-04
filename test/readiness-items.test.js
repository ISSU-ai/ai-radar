'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8');

const items = read('029_readiness_items.sql');
const bridge = read('030_readiness_fqa_bridge.sql');
const seed001 = read('001_enablement_hub.sql');

/** 029 의 insert 행을 파싱한다. code / area / seq / respondent 만 뽑으면 충분하다. */
const ITEMS = [...items.matchAll(
  /\('([SPDTBG]\d+)', '([SPDTBG])', (\d+), '(exec|it|staff|all)',/g
)].map(([, code, area, seq, respondent]) => ({ code, area, seq: Number(seq), respondent }));

/** 001 시드의 FQA 문항명 — 단일 출처. */
const FQA_ITEMS = new Set(
  [...seed001.matchAll(/\('([ABCD])', \d+, '([^']+)'/g)].map((m) => `${m[1]}|${m[2]}`)
);

// ── 029 ──────────────────────────────────────────────────────────
test('029 — 6축 × 7문항 = 42문항', () => {
  assert.equal(ITEMS.length, 42, `${ITEMS.length}문항이 적재됐다`);
  const byArea = ITEMS.reduce((acc, i) => ({ ...acc, [i.area]: (acc[i.area] || 0) + 1 }), {});
  assert.deepEqual(Object.keys(byArea).sort(), ['B', 'D', 'G', 'P', 'S', 'T']);
  for (const [area, count] of Object.entries(byArea)) {
    assert.equal(count, 7, `${area} 축이 ${count}문항이다`);
  }
  // code 와 area·seq 가 어긋나면 화면 정렬이 뒤섞인다
  for (const item of ITEMS) {
    assert.equal(item.code, `${item.area}${item.seq}`, `${item.code} 의 area/seq 가 코드와 다르다`);
  }
});

test('029 — 문항마다 5점 루브릭이 있다', () => {
  // "모르니까 3점" 을 줄이는 유일한 장치다. 비면 그 문항은 노이즈가 된다.
  const rubrics = [...items.matchAll(/'(\[[^']*\])'::jsonb\)/g)].map((m) => JSON.parse(m[1]));
  assert.equal(rubrics.length, 42, `루브릭이 ${rubrics.length}개뿐이다`);
  for (const rubric of rubrics) {
    assert.equal(rubric.length, 5, `루브릭이 ${rubric.length}단계다`);
    for (const level of rubric) {
      assert.ok(typeof level === 'string' && level.trim().length > 3, `빈 루브릭: ${level}`);
    }
  }
});

test('029 — 21문항 표와 섞지 않는다', () => {
  // 섞으면 21문항에 걸린 ISV 전제조건의 카테고리 평균 바구니가 바뀌어 판정이 흔들린다.
  assert.match(items, /create table if not exists readiness_items/);
  assert.ok(!/insert into fqa_items|alter table fqa_items/.test(items),
    '029 가 fqa_items 를 건드리면 안 된다');
  assert.match(items, /fqa_items.*와 (?:다른|섞지)/s, '왜 분리하는지가 적혀 있어야 한다');
});

test('029 — 응답자가 넷으로 나뉜다', () => {
  // 한 사람이 42문항을 다 답할 수 없다는 사실이 데이터에 남아 있어야, 나중에
  // 응답자별 수집으로 넓힐 때 근거가 된다.
  const byRespondent = ITEMS.reduce((acc, i) => ({ ...acc, [i.respondent]: (acc[i.respondent] || 0) + 1 }), {});
  assert.deepEqual(byRespondent, { exec: 15, it: 20, staff: 6, all: 1 });
  assert.match(items, /check \(respondent in \('exec','it','staff','all'\)\)/);
});

// ── 030 bridge ───────────────────────────────────────────────────
const BRIDGE = [...bridge.matchAll(
  /\('([SPDTBG]\d+)', '([ABCD])', '([^']+)',\s*'(exact|good)'/g
)].map(([, code, category, item, fidelity]) => ({ code, category, item, fidelity }));

test('030 — 대응이 실재하는 문항만 가리킨다', () => {
  assert.equal(BRIDGE.length, 13, `대응이 ${BRIDGE.length}건이다 (◎5 + ○8 = 13)`);
  const codes = new Set(ITEMS.map((i) => i.code));
  for (const link of BRIDGE) {
    assert.ok(codes.has(link.code), `029 에 없는 42문항: ${link.code}`);
    assert.ok(FQA_ITEMS.has(`${link.category}|${link.item}`),
      `001 에 없는 21문항: ${link.category} "${link.item}"`);
  }
  assert.equal(BRIDGE.filter((l) => l.fidelity === 'exact').length, 5);
  assert.equal(BRIDGE.filter((l) => l.fidelity === 'good').length, 8);
});

test('030 — 뜻이 어긋나는 대응은 넣지 않았다', () => {
  // 틀린 자동 채움은 빈칸보다 나쁘다. 빈칸은 영업이 보고 채우지만 틀린 값은 그냥 통과한다.
  const linked = new Set(BRIDGE.map((l) => `${l.category}|${l.item}`));
  for (const mustNotLink of [
    'A|접근권한과 계정 체계',      // 42 에 대응이 없다
    'A|데이터 보존·삭제 정책',
    'B|개발·테스트 환경',
    'D|예산·구매 준비도',          // 017 의 핵심 변경이 이 문항이다
    'A|데이터 분류와 민감도 기준', // D7 은 자동화 여부지 기준 정의가 아니다
    'A|감사 로그와 추적성',
    'B|모델·벤더 전환성',
    'D|현업 오너십'
  ]) {
    assert.ok(!linked.has(mustNotLink),
      `뜻이 어긋나는데 이어져 있다: ${mustNotLink}`);
  }
  // 8개가 남는 것이 정상이고, 그 사실이 파일에 적혀 있어야 다음 사람이 안 채운다
  assert.equal(21 - linked.size, 8, `자동 채움 안 되는 문항이 ${21 - linked.size}개다`);
  assert.match(bridge, /영업이 허브에서 채운다/);
  assert.match(bridge, /017 의 핵심 변경/, 'D-21 이 왜 중요한지 남겨야 한다');
});

test('030 — 대응마다 근거를 적었다', () => {
  // 근거 없는 매핑이 쌓이면 나중에 아무도 못 고친다.
  // note 는 줄바꿈으로 이어붙인 경우가 있어(SQL 문자열 연결) 행 단위로 잘라서 본다.
  const block = bridge.slice(bridge.indexOf('values'), bridge.indexOf('on conflict'));
  for (const link of BRIDGE) {
    const at = block.indexOf(`('${link.code}',`);
    assert.ok(at > 0, `${link.code} 행을 찾지 못했다`);
    const row = block.slice(at, block.indexOf('\n  (', at + 1) > 0
      ? block.indexOf('\n  (', at + 1) : block.length);
    const note = row.slice(row.indexOf(`'${link.fidelity}'`) + link.fidelity.length + 2);
    const text = [...note.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
    assert.ok(text.trim().length > 15, `${link.code} 근거가 너무 짧다: "${text}"`);
  }
});

test('030 — 지금은 전부 1:1 이다', () => {
  // 하나의 42문항이 여러 21문항을 채우기 시작하면 가중치를 나눠야 한다.
  // 지금 구조는 그걸 다루지 않으므로 1:1 을 유지한다.
  const byCode = BRIDGE.reduce((acc, l) => ({ ...acc, [l.code]: (acc[l.code] || 0) + 1 }), {});
  for (const [code, count] of Object.entries(byCode)) {
    assert.equal(count, 1, `${code} 가 ${count}개 문항을 채운다 — 가중치 분배가 필요해진다`);
  }
});

test('029·030 은 1회성 시드라 자동 실행 목록에 없다', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts', 'apply-migrations.js'), 'utf8');
  for (const file of ['029_readiness_items.sql', '030_readiness_fqa_bridge.sql']) {
    assert.ok(!runner.includes(file), `${file} 은 시드다`);
  }
});
