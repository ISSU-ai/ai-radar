'use strict';

/**
 * 대분류(domain). 슬롯의 부모이자 3단 계층의 맨 위.
 *
 * 솔루션에는 아무것도 붙지 않는다 — 슬롯이 정해지면 대분류가 따라온다. 그래서
 * 검사할 것은 "23개 슬롯이 빠짐없이 대분류를 갖는가"와 "layer 와 다른 축인가"다.
 * 하나라도 비면 그 슬롯의 솔루션이 그룹핑에서 사라진다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const slotSql = read('db', 'migrations', '011_slot_taxonomy_and_layer_fixes.sql');
const domainSql = read('db', 'migrations', '015_slot_domains.sql');
const serverSource = read('server.js');
const adminHtml = read('admin.html');
const hubClient = read('hub.js');
const engine = read('lib', 'recommendation-engine.js');

const parseDomains = () => {
  const block = domainSql.slice(
    domainSql.indexOf('insert into solution_domains'),
    domainSql.indexOf('on conflict (id) do update')
  );
  return new Map([...block.matchAll(/\('([a-z-]+)',\s*'([^']+)',\s*(\d+)/g)]
    .map((m) => [m[1], { name: m[2], order: Number(m[3]) }]));
};

const parseAssignments = () => {
  const block = domainSql.slice(
    domainSql.indexOf('update solution_slots set domain = v.domain'),
    domainSql.indexOf('as v(slot, domain)')
  );
  return new Map([...block.matchAll(/\('([a-z0-9-]+)',\s*'([a-z-]+)'\)/g)].map((m) => [m[1], m[2]]));
};

const parseSlots = () => {
  const block = slotSql.slice(
    slotSql.indexOf('insert into solution_slots'),
    slotSql.indexOf('on conflict (id) do update')
  );
  return new Map([...block.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*'(L[0-4])'/g)]
    .map((m) => [m[1], { name: m[2], layer: m[3] }]));
};

test('대분류 6개가 정의된다', () => {
  const domains = parseDomains();
  assert.deepEqual([...domains.keys()].sort(),
    ['ai-app', 'ai-dev', 'ai-infra', 'data', 'ops', 'security'].sort());
});

test('23개 슬롯이 빠짐없이 대분류를 갖는다', () => {
  const slots = parseSlots();
  const assignments = parseAssignments();
  assert.equal(slots.size, 23);
  for (const id of slots.keys()) {
    assert.ok(assignments.has(id), `슬롯 '${id}' 에 대분류가 없다 — 그룹핑에서 사라진다`);
  }
});

test('배정된 대분류는 전부 정의표에 있다', () => {
  const domains = parseDomains();
  for (const [slot, domain] of parseAssignments()) {
    assert.ok(domains.has(domain), `슬롯 '${slot}' 의 대분류 '${domain}' 이 정의되지 않았다`);
  }
});

test('layer 와 다른 축이다 — L4 가 셋으로 갈린다', () => {
  const slots = parseSlots();
  const assignments = parseAssignments();
  const l4Domains = new Set(
    [...slots.entries()].filter(([, s]) => s.layer === 'L4').map(([id]) => assignments.get(id))
  );
  assert.deepEqual([...l4Domains].sort(), ['ai-infra', 'ops', 'security']);

  // 반대로 한 대분류가 여러 레이어에 걸치기도 한다(ai-app 은 L1·L2).
  const aiAppLayers = new Set(
    [...assignments.entries()].filter(([, d]) => d === 'ai-app').map(([id]) => slots.get(id).layer)
  );
  assert.ok(aiAppLayers.size > 1, 'domain 이 layer 의 별칭이면 축을 늘릴 이유가 없다');
});

test('주요 솔루션의 대분류가 상식과 맞는다', () => {
  const slotOfSolution = (() => {
    const block = slotSql.slice(
      slotSql.indexOf('update solutions set slot = v.slot'),
      slotSql.indexOf('as v(slug, slot)')
    );
    return new Map([...block.matchAll(/\('([a-z0-9-]+)',\s*'([a-z0-9-]+)'\)/g)].map((m) => [m[1], m[2]]));
  })();
  const assignments = parseAssignments();
  const domainOf = (slug) => assignments.get(slotOfSolution.get(slug));

  assert.equal(domainOf('openai-enterprise'), 'ai-app');
  assert.equal(domainOf('articul8'), 'ai-app');
  assert.equal(domainOf('portal26'), 'security');
  assert.equal(domainOf('check-point'), 'security');
  assert.equal(domainOf('zscaler'), 'security');
  assert.equal(domainOf('new-relic'), 'ops');
  assert.equal(domainOf('litellm'), 'ai-infra');
  assert.equal(domainOf('tigergraph'), 'data');
});

test('슬롯 API 가 대분류를 함께 준다', () => {
  assert.match(serverSource, /left join solution_domains d on d\.id = s\.domain/);
  assert.match(serverSource, /d\.name as domain_name/);
  assert.match(serverSource, /order by d\.sort_order nulls last, s\.sort_order/);
});

test('admin 드롭다운이 대분류로 묶인다', () => {
  assert.match(adminHtml, /<optgroup label="\$\{domain\}">/);
  assert.match(adminHtml, /slot\.domain_name \|\| '미분류'/);
});

test('추천 결과와 UI 가 대분류를 실어 나른다', () => {
  assert.match(engine, /domain: slot\?\.domain \|\| null/);
  assert.match(engine, /domainName: slot\?\.domain_name \|\| null/);
  assert.match(hubClient, /item\.domainName \? `<b>\$\{escapeHtml\(item\.domainName\)\}<\/b>/);
  // 그룹 헤더에 대분류 분포 요약
  assert.match(hubClient, /const byDomain = items\.reduce/);
});

test('category 는 분류가 아니라 설명임을 스키마에 남긴다', () => {
  assert.match(domainSql, /comment on column solutions\.category is '제품 한 줄 설명\(자유서술\)/);
});
