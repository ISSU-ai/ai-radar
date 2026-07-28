'use strict';

/**
 * 012 가 심는 추천 판정 데이터의 정합성을 고정한다.
 *
 * 이 값들은 sections 산문에서 뽑은 해석이라 오타가 나기 쉽고, 오타가 나도 런타임에는
 * 조용히 "매칭 0건"이 될 뿐 에러가 안 난다. FQA 항목명이 한 글자만 달라도 그 솔루션은
 * 영원히 추천되지 않는다. 그래서 문항명·슬러그·enum 을 전부 대조한다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const seed = fs.readFileSync(path.join(root, 'db', 'migrations', '012_seed_recommendation_rules.sql'), 'utf8');
const slotMigration = fs.readFileSync(
  path.join(root, 'db', 'migrations', '011_slot_taxonomy_and_layer_fixes.sql'),
  'utf8'
);
const baseMigration = fs.readFileSync(
  path.join(root, 'db', 'migrations', '001_enablement_hub.sql'),
  'utf8'
);

/** 001 의 fqa_items 시드에서 (category, name) 집합을 만든다 — 단일 출처. */
function loadFqaItems() {
  const block = baseMigration.slice(baseMigration.indexOf('insert into fqa_items'));
  const items = [];
  for (const m of block.matchAll(/\('([A-D])',\s*(\d+),\s*'([^']+)'/g)) {
    items.push({ category: m[1], no: Number(m[2]), name: m[3] });
  }
  return items;
}

/** 012 의 update 블록을 slug → {fqa_coverage, prerequisites, red_flags, bundle_potential} 로 파싱. */
function loadRules() {
  const rules = new Map();
  const blocks = seed.split(/^update solutions set$/m).slice(1);
  for (const block of blocks) {
    const slug = block.match(/where slug = '([a-z0-9-]+)'/);
    if (!slug) continue;
    const pick = (field) => {
      const m = block.match(new RegExp(`${field} = '([\\s\\S]*?)'::jsonb`));
      return m ? JSON.parse(m[1]) : null;
    };
    const bundle = block.match(/bundle_potential = (\d+)/);
    rules.set(slug[1], {
      fqa_coverage: pick('fqa_coverage'),
      prerequisites: pick('prerequisites'),
      red_flags: pick('red_flags'),
      bundle_potential: bundle ? Number(bundle[1]) : null
    });
  }
  return rules;
}

const knownSlugs = () => {
  const block = slotMigration.slice(
    slotMigration.indexOf('update solutions set slot = v.slot'),
    slotMigration.indexOf('as v(slug, slot)')
  );
  return new Set([...block.matchAll(/\('([a-z0-9-]+)',\s*'[a-z0-9-]+'\)/g)].map((m) => m[1]));
};

test('012 의 jsonb 리터럴이 전부 유효한 JSON 이다', () => {
  const rules = loadRules();
  assert.equal(rules.size, 9, '상세 작성된 9종만 대상이다');
  for (const [slug, rule] of rules) {
    assert.ok(Array.isArray(rule.fqa_coverage), `${slug}: fqa_coverage 누락`);
    assert.ok(Array.isArray(rule.prerequisites), `${slug}: prerequisites 누락`);
    assert.ok(Array.isArray(rule.red_flags), `${slug}: red_flags 누락`);
  }
});

test('대상 9종은 전부 카탈로그에 실재하는 슬러그다', () => {
  const slugs = knownSlugs();
  for (const slug of loadRules().keys()) {
    assert.ok(slugs.has(slug), `${slug} 이 011 의 슬롯 배정 목록에 없다`);
  }
});

test('fqa_coverage 의 카테고리·문항명이 001 시드와 일치한다', () => {
  const items = loadFqaItems();
  const byCategory = new Map();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, new Set());
    byCategory.get(item.category).add(item.name);
  }

  for (const [slug, rule] of loadRules()) {
    for (const entry of rule.fqa_coverage) {
      assert.ok(byCategory.has(entry.category), `${slug}: 알 수 없는 카테고리 ${entry.category}`);
      assert.ok(
        entry.strength >= 1 && entry.strength <= 3,
        `${slug}: strength 는 1~3 이어야 한다 (${entry.strength})`
      );
      for (const name of entry.items || []) {
        assert.ok(
          byCategory.get(entry.category).has(name),
          `${slug}: "${name}" 은 ${entry.category} 카테고리의 문항이 아니다`
        );
      }
    }
  }
});

test('prerequisites 의 kind 와 참조 문항이 유효하다', () => {
  const items = loadFqaItems();
  const byCategory = new Map();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, new Set());
    byCategory.get(item.category).add(item.name);
  }
  const numericFields = new Set(['seats', 'annual_budget_krw']);

  for (const [slug, rule] of loadRules()) {
    for (const prereq of rule.prerequisites) {
      assert.ok(
        ['fqa', 'numeric', 'manual'].includes(prereq.kind),
        `${slug}: 알 수 없는 prerequisite kind "${prereq.kind}"`
      );
      assert.equal(typeof prereq.blocking, 'boolean', `${slug}: blocking 이 boolean 이 아니다`);
      assert.ok(prereq.label, `${slug}: label 이 없다 — STEP03 에 표시할 문구가 필요하다`);

      if (prereq.kind === 'fqa') {
        assert.ok(byCategory.has(prereq.category), `${slug}: 알 수 없는 카테고리 ${prereq.category}`);
        assert.ok(
          byCategory.get(prereq.category).has(prereq.item),
          `${slug}: 전제 문항 "${prereq.item}" 이 ${prereq.category} 에 없다`
        );
        assert.ok(prereq.min >= 1 && prereq.min <= 5, `${slug}: min 은 1~5 이어야 한다`);
      }
      if (prereq.kind === 'numeric') {
        assert.ok(numericFields.has(prereq.field), `${slug}: 알 수 없는 numeric field "${prereq.field}"`);
        assert.ok(Number.isFinite(prereq.min) || Number.isFinite(prereq.max), `${slug}: min/max 가 없다`);
      }
    }
  }
});

test('red_flags 가 가리키는 slug 는 전부 카탈로그에 실재한다', () => {
  const slugs = knownSlugs();
  for (const [slug, rule] of loadRules()) {
    for (const flag of rule.red_flags) {
      assert.ok(flag.signal, `${slug}: red_flag 에 signal 이 없다`);
      assert.ok(Array.isArray(flag.alternatives) && flag.alternatives.length > 0,
        `${slug}: "${flag.signal}" 에 대안이 없다`);
      for (const alt of flag.alternatives) {
        assert.ok(alt.label, `${slug}: 대안에 label 이 없다`);
        if (alt.slug) {
          assert.ok(slugs.has(alt.slug), `${slug}: 대안 slug "${alt.slug}" 이 카탈로그에 없다`);
        }
      }
    }
  }
});

test('bundle_potential 은 1~3 이다', () => {
  for (const [slug, rule] of loadRules()) {
    assert.ok(
      rule.bundle_potential >= 1 && rule.bundle_potential <= 3,
      `${slug}: bundle_potential=${rule.bundle_potential}`
    );
  }
});

test('012 는 apply-migrations 자동 실행 대상이 아니다', () => {
  // ISSU 가 /admin 에서 수정한 값을 재실행으로 덮어쓰면 안 된다.
  const applyScript = fs.readFileSync(path.join(root, 'scripts', 'apply-migrations.js'), 'utf8');
  assert.doesNotMatch(applyScript, /012_seed_recommendation_rules/);
});
