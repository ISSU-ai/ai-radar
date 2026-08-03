'use strict';

/**
 * 017·018·019 — OpenAI 통합 오퍼링 기획안 v0.1 반영분의 정합성을 고정한다.
 *
 * 012 와 같은 이유로 필요하다. FQA 문항명이 한 글자만 달라도 런타임에는 에러가 아니라
 * "조용한 매칭 0건"이 되고, 그 패키지는 영원히 선행 후보로 안 뽑힌다. 사람이 눈으로
 * 잡을 수 있는 종류가 아니라서 전부 대조한다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8');

const base = read('001_enablement_hub.sql');
const slotMigration = read('011_slot_taxonomy_and_layer_fixes.sql');
const offering = read('017_offering_v01.sql');
const painMap = read('018_fqa_pain_map.sql');
const isvAlign = read('019_isv_offering_alignment.sql');

/** 001 의 fqa_items 시드가 문항명의 단일 출처다. */
function fqaItemsByCategory() {
  const block = base.slice(base.indexOf('insert into fqa_items'));
  const byCategory = new Map();
  for (const m of block.matchAll(/\('([A-D])',\s*(\d+),\s*'([^']+)'/g)) {
    if (!byCategory.has(m[1])) byCategory.set(m[1], new Set());
    byCategory.get(m[1]).add(m[3]);
  }
  return byCategory;
}

/** 011 의 슬롯 배정 + 019 가 새로 심는 슬러그. */
function knownSlugs() {
  const block = slotMigration.slice(
    slotMigration.indexOf('update solutions set slot = v.slot'),
    slotMigration.indexOf('as v(slug, slot)')
  );
  const slugs = new Set([...block.matchAll(/\('([a-z0-9-]+)',\s*'[a-z0-9-]+'\)/g)].map((m) => m[1]));
  const added = isvAlign.slice(
    isvAlign.indexOf('update solutions set slot = v.slot'),
    isvAlign.indexOf('as v(slug, slot)')
  );
  for (const m of added.matchAll(/\('([a-z0-9-]+)',\s*'[a-z0-9-]+'\)/g)) slugs.add(m[1]);
  return slugs;
}

/** 011 이 정의한 슬롯 id 집합. */
function knownSlots() {
  const block = slotMigration.slice(slotMigration.indexOf('insert into solution_slots'));
  return new Set([...block.matchAll(/\('([a-z0-9-]+)',\s+'[^']+',\s*'L\d'/g)].map((m) => m[1]));
}

function packagesIn017() {
  const out = new Map();
  const re = /update packages set\s*\n\s*fqa_coverage = '([\s\S]*?)'::jsonb,\s*\n\s*readiness_lift = '(\{[\s\S]*?\})'::jsonb\s*\n\s*where id = '(\w+)'/g;
  for (const m of offering.matchAll(re)) {
    out.set(m[3], { fqa_coverage: JSON.parse(m[1]), readiness_lift: JSON.parse(m[2]) });
  }
  return out;
}

function solutionsIn019() {
  const out = new Map();
  const re = /update solutions set\s*\n([\s\S]*?)where slug (?:=|in) \(?((?:'[a-z0-9-]+'(?:,\s*)?)+)\)?;/g;
  for (const m of isvAlign.matchAll(re)) {
    const pick = (field) => {
      const hit = m[1].match(new RegExp(`${field} = '([\\s\\S]*?)'::jsonb`));
      return hit ? JSON.parse(hit[1]) : null;
    };
    const data = {
      fqa_coverage: pick('fqa_coverage'),
      prerequisites: pick('prerequisites'),
      red_flags: pick('red_flags')
    };
    if (!data.fqa_coverage) continue;          // 슬롯 배정 전용 블록은 건너뛴다
    for (const s of m[2].matchAll(/'([a-z0-9-]+)'/g)) out.set(s[1], data);
  }
  return out;
}

// ── 017 ──────────────────────────────────────────────────────────

test('017 — 오퍼링 5종이 제출본(2026-08-02) 구성과 같다', () => {
  const rows = [...offering.matchAll(/^\s*\('(\d{2})', '([^']+)', '([^']*)',$/gm)]
    .map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(
    rows,
    [
      ['01', 'AI Consulting', 'PS'],
      ['02', 'OpenAI Ready', 'DS·PS'],
      ['03', 'AIR Service (AI-Ready)', 'PS'],
      ['04', 'AI Adoption & Change Management', 'PS'],
      ['05', 'Billing & Managed Service', 'MS']
    ],
    '제출본 기준. v0.1 의 "AI Consulting & PoC" / "AI Trust & Guardrails" 로 되돌아가면 안 된다'
  );
});

test('017 — 패키지 6종이 오퍼링에 배정된다 (PoC 는 03)', () => {
  const assigned = new Map();
  for (const m of offering.matchAll(/offering_id = '(\d{2})'[\s\S]{0,200}?where id (?:=|in) \(?((?:'\w+'(?:,\s*)?)+)\)?;/g)) {
    for (const p of m[2].matchAll(/'(\w+)'/g)) assigned.set(p[1], m[1]);
  }
  assert.deepEqual(
    [...assigned.entries()].sort(),
    [['ADOPTION', '04'], ['DISCOVERY', '01'], ['INTEGRATION', '03'],
      ['OPERATE', '05'], ['POC', '03'], ['SECURITY', '02']],
    // 제출본은 PoC 를 03 AIR Service 의 제공 범위에 넣었다("OpenAI API 기반 맞춤형
    // AI 애플리케이션 개발 및 PoC"). v0.1 의 01 이 아니다.
    'PoC 는 03 AIR Service 소속'
  );
  // 03 에 둘이 붙는다 = 오퍼링:패키지가 1:N 이다
  assert.equal([...assigned.values()].filter((v) => v === '03').length, 2);
});

test('017 — 패키지 이름을 001 시드 값으로 되돌린다', () => {
  // 03 아래 POC·INTEGRATION 둘이 붙으므로 이름을 오퍼링 이름으로 바꾸면 화면에
  // 같은 이름이 둘 나와 구분이 사라진다.
  //
  // rename 구문을 "지우는" 것으로는 부족하다. 이 파일의 v0.1 판이 이미 적용된 DB 가
  // 있고, 거기엔 오퍼링 이름으로 바뀐 패키지 이름이 남아 있다. 명시적으로 덮어써야
  // 몇 번을 돌려도 같은 상태가 된다.
  const seed = fs.readFileSync(path.join(root, 'db', 'migrations', '001_enablement_hub.sql'), 'utf8');
  const seedNames = new Map(
    [...seed.matchAll(/\('(DISCOVERY|POC|SECURITY|INTEGRATION|ADOPTION|OPERATE)', '([^']+)'/g)]
      .map((m) => [m[1], m[2]])
  );
  assert.equal(seedNames.size, 6, '001 에서 패키지 6종 이름을 읽어야 한다');

  for (const [id, name] of seedNames) {
    const re = new RegExp(`update packages set offering_id = '\\d{2}', name = '${name.replace(/[&]/g, '&')}'[\\s\\S]{0,120}?where id = '${id}'`);
    assert.match(offering, re, `${id} 이름이 001 값('${name}')으로 되돌아가야 한다`);
  }

  // v0.1 이 붙였던 오퍼링 이름이 패키지에 남으면 안 된다
  for (const dead of ['AI Trust & Guardrails', 'AI-Ready Service']) {
    assert.ok(!new RegExp(`update packages set[^;]*name = '${dead}'`).test(offering),
      `패키지 이름에 v0.1 오퍼링 이름 '${dead}' 가 남아 있다`);
  }
});

test('017 — 패키지 판정 데이터의 문항명이 001 시드와 일치한다', () => {
  const byCategory = fqaItemsByCategory();
  const packages = packagesIn017();
  assert.equal(packages.size, 6, '패키지 6종 전부 판정 데이터를 가진다');

  for (const [id, pkg] of packages) {
    for (const entry of pkg.fqa_coverage) {
      assert.ok(byCategory.has(entry.category), `${id}: 알 수 없는 카테고리 ${entry.category}`);
      assert.ok(entry.strength >= 1 && entry.strength <= 3,
        `${id}: strength 는 1~3 (${entry.strength})`);
      for (const name of entry.items || []) {
        assert.ok(byCategory.get(entry.category).has(name),
          `${id}: "${name}" 은 ${entry.category} 카테고리 문항이 아니다`);
      }
    }
    // lift 가 있는 카테고리는 커버리지에도 있어야 한다. 안 그러면 엔진이 무시한다.
    for (const category of Object.keys(pkg.readiness_lift)) {
      assert.ok(pkg.fqa_coverage.some((e) => e.category === category),
        `${id}: ${category} lift 가 있는데 커버리지에 ${category} 가 없다 — 엔진이 못 쓴다`);
    }
  }
});

test('017 — 21문항 중 아무도 못 덮는 문항이 없다', () => {
  const byCategory = fqaItemsByCategory();
  const packages = packagesIn017();
  const covered = new Set();
  for (const pkg of packages.values()) {
    for (const entry of pkg.fqa_coverage) {
      for (const name of entry.items || []) covered.add(`${entry.category}/${name}`);
    }
  }

  // 지금은 전제로 쓰이는 문항만 보장하면 된다. "예산·구매 준비도"가 016 까지
  // 비어 있어 그 문항에 막힌 ISV 가 전부 탈락했다 — 이게 이번 변경의 핵심이다.
  assert.ok(covered.has('D/예산·구매 준비도'),
    '017 의 핵심 변경이 사라졌다 — DISCOVERY 가 TCO 로 이 문항을 덮어야 한다');

  const uncovered = [];
  for (const [category, names] of byCategory) {
    for (const name of names) {
      if (!covered.has(`${category}/${name}`)) uncovered.push(`${category}/${name}`);
    }
  }
  // 못 덮는 문항이 남는 것 자체는 정상이다(패키지로 해결되지 않는 영역). 다만
  // 어떤 것이 남았는지는 눈에 보여야 하므로 목록을 고정해 둔다.
  assert.deepEqual(uncovered.sort(), ['B/모델·벤더 전환성'],
    `못 덮는 문항 목록이 바뀌었다: ${uncovered.join(', ')}`);
});

// ── 018 ──────────────────────────────────────────────────────────

test('018 — 5 대분류 / 10 평가영역이 전부 들어간다', () => {
  const categories = [...painMap.matchAll(/^\s*\('(G\d)', '.', '([^']+)',\s*\d+\)/gm)].map((m) => m[1]);
  assert.deepEqual(categories, ['G1', 'G2', 'G3', 'G4', 'G5']);

  const areas = [...painMap.matchAll(/^\s*\('([a-z-]+)',\s*'(G\d)', '([^']+)',$/gm)];
  assert.equal(areas.length, 10, 'Appendix G 는 10 평가영역이다');
  for (const [, , category] of areas) {
    assert.ok(categories.includes(category), `${category} 는 정의되지 않은 대분류다`);
  }
});

test('018 — 매핑이 참조하는 문항과 평가영역이 전부 실재한다', () => {
  const byCategory = fqaItemsByCategory();
  const areaIds = new Set([...painMap.matchAll(/^\s*\('([a-z-]+)',\s*'G\d', '[^']+',$/gm)].map((m) => m[1]));

  const block = painMap.slice(painMap.indexOf('insert into fqa_item_pain_map'));
  const rows = [...block.matchAll(/\('([A-D])',\s*'([^']+)',\s*'([a-z-]+)'\)/g)];
  assert.ok(rows.length >= 10, `매핑이 너무 적다: ${rows.length}`);

  for (const [, category, item, area] of rows) {
    assert.ok(byCategory.has(category), `알 수 없는 카테고리 ${category}`);
    assert.ok(byCategory.get(category).has(item),
      `"${item}" 은 ${category} 카테고리 문항이 아니다`);
    assert.ok(areaIds.has(area), `${area} 는 정의되지 않은 평가영역이다`);
  }

  // ⚠ 기획안 대비 진단 문항이 비어 있는 자리. 018 주석이 예고한 그대로여야 한다.
  const mapped = new Set(rows.map((r) => r[3]));
  const unmapped = [...areaIds].filter((a) => !mapped.has(a));
  assert.deepEqual(unmapped, ['ip-contract'],
    `대응 문항이 없는 평가영역 목록이 바뀌었다: ${unmapped.join(', ')}`);
});

// ── 019 ──────────────────────────────────────────────────────────

test('019 — 기획안이 지목한 ISV 9종이 전부 판정 데이터를 가진다', () => {
  const planned = ['slack', 'notion', 'github', 'gitlab', 'new-relic',
    'check-point', 'portal26', 'zscaler', 'articul8'];
  const seeded = solutionsIn019();
  const from012 = read('012_seed_recommendation_rules.sql');

  for (const slug of planned) {
    const has = seeded.has(slug) || from012.includes(`where slug = '${slug}'`);
    assert.ok(has, `${slug} 에 판정 데이터가 없다 — 영업 화면에서 숨겨진다`);
  }
});

test('019 — 새 판정 데이터의 문항명·슬러그가 유효하다', () => {
  const byCategory = fqaItemsByCategory();
  const slugs = knownSlugs();
  const seeded = solutionsIn019();
  assert.equal(seeded.size, 8, '미판정 4종 + 신규 4종');

  for (const [slug, rule] of seeded) {
    assert.ok(slugs.has(slug), `${slug} 이 슬롯 배정 목록에 없다`);
    assert.ok(Array.isArray(rule.prerequisites), `${slug}: prerequisites 누락`);
    assert.ok(Array.isArray(rule.red_flags), `${slug}: red_flags 누락`);

    for (const entry of rule.fqa_coverage) {
      assert.ok(byCategory.has(entry.category), `${slug}: 알 수 없는 카테고리 ${entry.category}`);
      for (const name of entry.items || []) {
        assert.ok(byCategory.get(entry.category).has(name),
          `${slug}: "${name}" 은 ${entry.category} 카테고리 문항이 아니다`);
      }
    }
    for (const prereq of rule.prerequisites) {
      assert.ok(['fqa', 'numeric', 'manual'].includes(prereq.kind),
        `${slug}: 알 수 없는 전제 kind ${prereq.kind}`);
      if (prereq.kind !== 'fqa') continue;
      assert.ok(byCategory.get(prereq.category)?.has(prereq.item),
        `${slug}: 전제가 없는 문항 "${prereq.item}" 을 가리킨다`);
    }
    // red_flags 의 대안 슬러그도 실재해야 한다. 깨진 링크는 화면에서 빈 칸이 된다.
    for (const flag of rule.red_flags) {
      for (const alt of flag.alternatives || []) {
        if (!alt.slug) continue;
        assert.ok(slugs.has(alt.slug), `${slug}: 대안 슬러그 ${alt.slug} 이 카탈로그에 없다`);
      }
    }
  }
});

test('019 — 신규 4종이 실재하는 슬롯에 배정된다', () => {
  const slots = knownSlots();
  const block = isvAlign.slice(
    isvAlign.indexOf('update solutions set slot = v.slot'),
    isvAlign.indexOf('as v(slug, slot)')
  );
  const rows = [...block.matchAll(/\('([a-z0-9-]+)',\s*'([a-z0-9-]+)'\)/g)];
  assert.equal(rows.length, 4, 'Slack·Notion·GitHub·GitLab');
  for (const [, slug, slot] of rows) {
    assert.ok(slots.has(slot), `${slug}: ${slot} 은 011 에 없는 슬롯이다`);
  }
});

test('019 — ISV 확장 패키지 5종의 구성원이 실재하는 솔루션이다', () => {
  const slugs = knownSlugs();
  const bundleIds = new Set(
    [...isvAlign.matchAll(/^\s*\('([A-Z_]+)', '[^']+',$/gm)].map((m) => m[1])
  );
  assert.deepEqual([...bundleIds].sort(),
    ['AI_DEVELOPER', 'AI_MONITORING', 'AI_TRUST', 'AI_WORKSPACE', 'PRIVATE_AI']);

  const block = isvAlign.slice(isvAlign.indexOf('insert into isv_bundle_members'));
  const members = [...block.matchAll(/\('([A-Z_]+)',\s*'([a-z0-9-]+)',\s*\d+\)/g)];
  assert.equal(members.length, 9, '기획안 ISV 9개 자리');

  for (const [, bundle, slug] of members) {
    assert.ok(bundleIds.has(bundle), `${bundle} 은 정의되지 않은 번들이다`);
    assert.ok(slugs.has(slug), `${bundle}: ${slug} 이 카탈로그에 없다`);
  }
  // 번들마다 최소 1개는 있어야 한다 — 빈 번들은 영업 화면에서 빈 카드가 된다.
  for (const id of bundleIds) {
    assert.ok(members.some((m) => m[1] === id), `${id} 에 구성원이 없다`);
  }
});
