'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8');

const starter = read('024_starter_package.sql');
const triggers = read('025_isv_bundle_triggers.sql');
const products = read('026_bundle_products.sql');
const seed001 = read('001_enablement_hub.sql');

/** 001 시드의 FQA 문항명. 오타 하나가 판정 데이터를 통째로 무력화한다. */
const FQA_ITEMS = new Set(
  [...seed001.matchAll(/\('([ABCD])', \d+, '([^']+)'/g)].map((m) => `${m[1]}|${m[2]}`)
);

// ── 024 STARTER ──────────────────────────────────────────────────
test('024 — STARTER 가 진입 상품 자리에 들어간다', () => {
  assert.match(starter, /'STARTER', 'OpenAI Starter Package'/);
  assert.match(starter, /'entry'/, "role 은 entry — 진입 상품이다");
  // DISCOVERY 가 10 이므로 그보다 앞이어야 화면에서 먼저 보인다
  const order = /'active', (\d+),/.exec(starter);
  assert.ok(order && Number(order[1]) < 10, `sort_order 가 DISCOVERY(10) 보다 앞이어야 한다`);
  assert.match(starter, /offering_id[\s\S]{0,40}'02'|'02', 'entry'/, '02 OpenAI Ready 소속');
});

test('024 — 판정 데이터의 문항명이 001 시드와 일치한다', () => {
  const block = starter.slice(starter.indexOf("fqa_coverage = '["), starter.indexOf("readiness_lift"));
  const entries = [...block.matchAll(/"category":"([ABCD])","items":\[([^\]]+)\]/g)];
  assert.ok(entries.length >= 2, '커버리지가 비어 있다');
  for (const [, category, items] of entries) {
    for (const m of items.matchAll(/"([^"]+)"/g)) {
      assert.ok(FQA_ITEMS.has(`${category}|${m[1]}`),
        `001 에 없는 문항: ${category} "${m[1]}"`);
    }
  }
});

test('024 — 표준 범위라 SECURITY 보다 얕게 잡는다', () => {
  // 같은 A 문항을 둘 다 덮는다. 엔진(pickBest)은 strength 가 높은 쪽을 선행으로 고르므로
  // Starter 가 SECURITY 와 같거나 깊으면 유상 심화 패키지가 영영 안 붙는다.
  // `where id = 'X'` 는 파일에 여러 번 나온다(이름 갱신 / 판정 데이터). fqa_coverage 를
  // 담은 구문만 골라야 한다 — indexOf 로 첫 번째를 잡으면 엉뚱한 블록을 본다.
  const strengthIn = (sql, id) => {
    const block = sql.split('update packages set')
      .find((chunk) => chunk.includes('fqa_coverage') && chunk.includes(`where id = '${id}'`));
    if (!block) return null;
    const m = [...block.matchAll(/"category":"A"[^}]*"strength":(\d)/g)].pop();
    return m ? Number(m[1]) : null;
  };
  const offering = read('017_offering_v01.sql');
  assert.equal(strengthIn(starter, 'STARTER'), 2);
  assert.equal(strengthIn(offering, 'SECURITY'), 3);

  const lift = /readiness_lift = '(\{[^']+\})'/.exec(starter);
  assert.ok(lift, 'readiness_lift 가 있어야 한다');
  assert.ok(JSON.parse(lift[1]).A < 1.5, 'A 상승폭이 SECURITY(1.5) 보다 작아야 한다');
});

test('024 — 무상/유상 경계가 산출물 문구에 드러난다', () => {
  assert.match(starter, /OpenAI Ready · 무상/);
  assert.match(starter, /MS Light · 유상/);
  assert.match(starter, /기본 제공/);
});

// ── 025 번들 적용 기준 ───────────────────────────────────────────
test('025 — 번들 5종 전부 적용 기준이 붙는다', () => {
  const ids = ['AI_WORKSPACE', 'AI_DEVELOPER', 'AI_MONITORING', 'AI_TRUST', 'PRIVATE_AI'];
  for (const id of ids) {
    const at = triggers.indexOf(`where id = '${id}'`);
    assert.ok(at > 0, `${id} 갱신이 없다`);
    const block = triggers.slice(Math.max(0, at - 1200), at);
    assert.match(block, /applies_when = '[^']+'/, `${id} 에 적용 기준이 없다`);
    assert.match(block, /trigger_note = /, `${id} 에 근거 문항이 없다`);
  }
});

test('025 — fqa_signal 이 001 시드에 있는 문항만 가리킨다', () => {
  // 없는 문항을 가리키면 엔진이 조용히 아무것도 안 하거나 엉뚱한 고객에게 번들이 붙는다
  const signals = [...triggers.matchAll(/"category":"([ABCD])","item":"([^"]+)"/g)];
  assert.ok(signals.length >= 4, 'fqa_signal 이 너무 적다');
  for (const [, category, item] of signals) {
    assert.ok(FQA_ITEMS.has(`${category}|${item}`), `001 에 없는 문항: ${category} "${item}"`);
  }
});

test('025 — 대응 문항이 없으면 억지로 걸지 않는다', () => {
  // AI Workspace 의 트리거(협업도구 일상 활용)는 우리 21문항에 없다.
  // 가장 가까운 B "업무 시스템 연동성" 은 뜻이 다르다(연동 가능성 vs 실제 사용).
  const at = triggers.indexOf("where id = 'AI_WORKSPACE'");
  const block = triggers.slice(Math.max(0, at - 1200), at);
  assert.match(block, /fqa_signal = '\[\]'::jsonb/,
    '대응 문항이 없으면 비워 둬야 한다 — 억지로 걸면 엉뚱한 고객에게 붙는다');
  assert.match(block, /억지로 걸지 않고/, '왜 비웠는지가 적혀 있어야 한다');
});

// ── 026 번들 구성 ────────────────────────────────────────────────
test('026 — 오퍼링 맵이 지목한 구성이 다 채워진다', () => {
  assert.match(products, /'databricks', 'Databricks'/);
  assert.match(products, /'trend-micro', 'Trend Micro'/);
  assert.match(products, /\('AI_MONITORING', 'databricks'/);
  assert.match(products, /\('AI_TRUST', {6}'trend-micro'/);
  // 슬롯과 번들은 다른 축이다 — Cohere 는 llm-platform 이지만 Private AI 묶음에 든다
  assert.match(products, /\('PRIVATE_AI', {4}'cohere'/);
});

test('026 — 신규 2종은 숨김 상태로 만든다', () => {
  // 021 을 다시 돌리면 어드민에서 손으로 켠 것까지 되돌아간다. 여기서 직접 세운다.
  assert.match(products, /set is_hidden = true where slug in \('databricks', 'trend-micro'\)/);
  const builder = fs.readFileSync(path.join(root, 'scripts', 'build-pending-sql.js'), 'utf8');
  const order = /const DEFAULT_ORDER = \[([^\]]+)\]/.exec(builder)[1];
  assert.ok(!order.includes("'021'"), '021 을 다시 돌리면 어드민 결정이 덮인다');
});

test('026 — 판정 데이터를 넣지 않아 영업 화면에 안 뜬다', () => {
  // f0fc05a 가 fqa_coverage 빈 솔루션을 viewer 에게 감춘다. 근거를 못 대는 제품을
  // 추천 후보로 올리지 않기 위한 장치이고 여기서도 맞다.
  assert.ok(!/where slug = 'databricks'[\s\S]{0,400}fqa_coverage/.test(products));
  assert.match(products, /판정 데이터는 넣지 않는다/);
});

test('026 — 본문이 미완성임을 본문 안에 적었다', () => {
  const overviews = [...products.matchAll(/'1', E'((?:[^'\\]|\\.|'')*)'/g)].map((m) => m[1]);
  assert.equal(overviews.length, 2, '개요 2건이 있어야 한다');
  for (const body of overviews) {
    assert.match(body, /본문 미완성/, '8탭이 안 찬 상태임을 읽는 사람이 알아야 한다');
  }
});

test('026 — 리전 조사 결과가 실제 문자열을 갈아낀다', () => {
  // replace 대상이 022·023 원본에 없으면 조용히 아무것도 안 바뀐다 — 가장 잡기 어려운 실패다.
  const sectionOf = (file, n) => {
    const m = new RegExp(`'${n}',\\s*E'((?:[^'\\\\]|\\\\.|'')*)'`).exec(read(file));
    return m ? m[1].replace(/\\n/g, '\n').replace(/''/g, "'") : '';
  };
  const targets = [
    ['023_cohere.sql', '7', '- [ ] **국내 리전 제공 여부** — 금융·공공에서 가장 먼저 막히는 항목'],
    ['022_portal26_content.sql', '7', '- [ ] 데이터 저장 위치와 국내 리전 제공 여부 — **금융·공공 딜에서 먼저 막히는 항목**']
  ];
  for (const [file, section, needle] of targets) {
    assert.ok(sectionOf(file, section).includes(needle),
      `${file} §${section} 에 replace 대상이 없다 — 026 이 조용히 무효가 된다`);
    assert.ok(products.includes(needle), `026 이 ${file} 의 대상 문자열을 정확히 써야 한다`);
  }
  // 조사 결과의 핵심 — 서울은 교차 리전 추론뿐이라 요청이 국외로 나간다
  assert.match(products, /교차 리전 추론|cross-region inference/);
  assert.match(products, /2026-08-03/, '조사 시점을 남겨야 한다');
});
