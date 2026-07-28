'use strict';

/**
 * 슬롯 분류표(011)와 카탈로그(isv_data.js)의 정합성을 고정한다.
 *
 * 슬롯은 "같은 자리를 놓고 경쟁하는가"를 표현하는 축이라, 솔루션의 layer 와 슬롯의
 * layer 가 어긋나면 추천 결과가 조용히 틀어진다(트랙 적합도 계산에 layer 를 쓴다).
 * 007 이 Zscaler/Check Point 를 L1 로 넣어둔 것이 정확히 그 사고였다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'db', 'migrations', '011_slot_taxonomy_and_layer_fixes.sql'),
  'utf8'
);

// 앱이 name 에서 slug 를 만드는 규칙과 동일해야 한다 (server.js 의 생성식).
const toSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function loadCatalog() {
  const source = fs.readFileSync(path.join(root, 'isv_data.js'), 'utf8');
  // eslint-disable-next-line no-eval
  return eval(`${source}; isvData`);
}

/** solution_slots insert 에서 (id → {layer, competitive}) 를 뽑는다. */
function parseSlots() {
  const block = migration.slice(
    migration.indexOf('insert into solution_slots'),
    migration.indexOf('on conflict (id) do update')
  );
  const slots = new Map();
  for (const m of block.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*'(L[0-4])',\s*(true|false)/g)) {
    slots.set(m[1], { name: m[2], layer: m[3], competitive: m[4] === 'true' });
  }
  return slots;
}

/** solutions 슬롯 배정 values 에서 (slug → slot) 을 뽑는다. */
function parseAssignments() {
  const block = migration.slice(
    migration.indexOf('update solutions set slot = v.slot'),
    migration.indexOf('as v(slug, slot)')
  );
  const rows = new Map();
  for (const m of block.matchAll(/\('([a-z0-9-]+)',\s*'([a-z0-9-]+)'\)/g)) {
    rows.set(m[1], m[2]);
  }
  return rows;
}

test('슬롯 분류표가 파싱되고 23개 슬롯을 모두 담는다', () => {
  const slots = parseSlots();
  assert.equal(slots.size, 23, '슬롯 개수가 바뀌면 이 테스트를 갱신할 것');
  for (const [id, slot] of slots) {
    assert.match(id, /^[a-z0-9-]+$/, `슬롯 id 는 kebab-case 여야 한다: ${id}`);
    assert.match(slot.layer, /^L[0-4]$/);
  }
});

test('배정된 슬롯은 전부 분류표에 존재한다', () => {
  const slots = parseSlots();
  for (const [slug, slot] of parseAssignments()) {
    assert.ok(slots.has(slot), `${slug} 에 배정된 슬롯 '${slot}' 이 분류표에 없다`);
  }
});

test('카탈로그 18종이 빠짐없이 슬롯을 배정받았다', () => {
  const assignments = parseAssignments();
  for (const solution of loadCatalog()) {
    const slug = toSlug(solution.name);
    assert.ok(assignments.has(slug), `${solution.name} (${slug}) 에 슬롯 배정이 없다`);
  }
});

test('007 이 넣은 Trust Layer 4종도 슬롯을 배정받았다', () => {
  const assignments = parseAssignments();
  for (const slug of ['portal26', 'check-point', 'new-relic', 'zscaler']) {
    assert.ok(assignments.has(slug), `${slug} 에 슬롯 배정이 없다`);
  }
});

test('솔루션 layer 와 슬롯 layer 가 일치한다', () => {
  const slots = parseSlots();
  const assignments = parseAssignments();
  for (const solution of loadCatalog()) {
    const slug = toSlug(solution.name);
    const slot = slots.get(assignments.get(slug));
    assert.equal(
      solution.layer,
      slot.layer,
      `${solution.name}: 솔루션 layer=${solution.layer} 인데 슬롯 '${assignments.get(slug)}' 은 ${slot.layer} 이다`
    );
  }
});

test('레이어 정정 4건이 마이그레이션과 시드에 모두 반영됐다', () => {
  const expected = {
    zscaler: 'L4',
    'check-point': 'L4',
    followerrabbit: 'L4',
    tigergraph: 'L0'
  };
  for (const [slug, layer] of Object.entries(expected)) {
    assert.match(
      migration,
      new RegExp(`update solutions set layer = '${layer}' where slug = '${slug}'`),
      `${slug} 레이어 정정 구문이 없다`
    );
  }

  // 시드에 있는 두 건은 파일도 함께 고쳐져 있어야 한다(새 환경이 틀린 값으로 시드되지 않도록).
  const catalog = loadCatalog();
  assert.equal(catalog.find((s) => s.name === 'Tigergraph').layer, 'L0');
  assert.equal(catalog.find((s) => s.name === 'FollowerRabbit').layer, 'L4');
});

test('is_competitive 는 실제 후보 수와 모순되지 않는다', () => {
  const slots = parseSlots();
  const counts = new Map();
  for (const slot of parseAssignments().values()) {
    counts.set(slot, (counts.get(slot) || 0) + 1);
  }
  for (const [id, slot] of slots) {
    const n = counts.get(id) || 0;
    if (n >= 2) {
      assert.ok(slot.competitive, `'${id}' 은 후보가 ${n}종인데 is_competitive=false 다`);
    }
    // 역방향은 검사하지 않는다: 미등록 22종(Databricks 등)을 기다리는 빈 경쟁 슬롯이 정상이다.
  }
});

test('통합 적용 스크립트가 원본 마이그레이션과 동기화돼 있다', () => {
  // _combined_apply.sql 은 생성물이다. 원본을 고치고 재생성을 잊으면 SQL Editor 에
  // 낡은 스크립트를 붙여넣게 된다.
  const combined = fs.readFileSync(path.join(root, 'db', 'migrations', '_combined_apply.sql'), 'utf8');
  for (const file of [
    '010_recommendation_engine.sql',
    '011_slot_taxonomy_and_layer_fixes.sql',
    '012_seed_recommendation_rules.sql',
    '013_curator_role.sql'
  ]) {
    const source = fs.readFileSync(path.join(root, 'db', 'migrations', file), 'utf8').trimEnd();
    assert.ok(combined.includes(source),
      `${file} 이 _combined_apply.sql 과 다르다 — node scripts/build-pending-sql.js 재실행 필요`);
  }

  // enum 추가는 어떤 트랜잭션에도 들어가면 안 된다.
  const alterIndex = combined.indexOf('alter type app_role add value');
  const before = combined.slice(0, alterIndex);
  const opens = (before.match(/^begin;/gm) || []).length;
  const closes = (before.match(/^commit;/gm) || []).length;
  assert.equal(opens, closes, 'alter type 이 열린 트랜잭션 안에 있다');
});
