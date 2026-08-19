'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const I = require('../lib/catalog-import');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

/** 지금 카탈로그에서 표기가 갈리는 것들. 실제 slug 다. */
const EXISTING = [
  { slug: 'anthropic-claude', name: 'Anthropic Claude' },
  { slug: 'openai-enterprise', name: 'OpenAI Enterprise' },
  { slug: 'check-point', name: 'Check Point' },
  { slug: 'trend-micro', name: 'Trend Micro' },
  { slug: 'eleven-labs', name: 'ElevenLabs' },
  { slug: 'palo-alto', name: 'Palo Alto Networks' },
  { slug: 'slack', name: 'Slack' },
  { slug: 'followerrabbit', name: 'FollowerRabbit' },
  { slug: 'zscaler', name: 'Zscaler' }
];
const plan = (headers, rows, mapping, decisions) =>
  I.buildPlan({ headers, rows, mapping, existing: EXISTING, decisions });

test('엑셀 탭과 CSV 쉼표를 스스로 가른다', () => {
  // 「구분자가 무엇입니까」를 사람에게 묻지 않는다 — 우리가 셀 수 있다.
  assert.equal(I.parseDelimited('a\tb\n1\t2').delimiter, '\t');
  assert.equal(I.parseDelimited('a,b\n1,2').delimiter, ',');
  // 따옴표 안의 쉼표는 값이다. 회사명에 흔하다.
  const { rows } = I.parseDelimited('name,note\n"Flex, Inc.",제조');
  assert.deepEqual(rows[0], ['Flex, Inc.', '제조']);
  // 빈 줄은 버린다 — 엑셀에서 복사하면 꼬리에 붙는다.
  assert.equal(I.parseDelimited('a\tb\n1\t2\n\n\n').rows.length, 1);
});

test('컬럼 이름이 코드에 박혀 있지 않다', () => {
  // 8/28 에 어떤 서식이 올지 모른다. 매핑만 다시 고르면 되어야 한다.
  const guess = I.suggestMapping(['Company Name (EN)', '회사명 (KR)', 'Website']);
  assert.deepEqual(guess, ['name', 'name_kr', 'website']);
  // 이름이 달라도 사람이 고르면 그대로 쓴다 — 자동 추정에 의존하지 않는다.
  const out = plan(['제품', '주소'], [['Wiz', 'https://wiz.io']], ['name', 'website']);
  assert.equal(out.create[0].values.name, 'Wiz');
  assert.equal(out.create[0].values.website, 'https://wiz.io');
});

test('연결 안 된 컬럼을 조용히 버리지 않는다', () => {
  // 뭘 잃었는지 모르는 게 잃는 것보다 나쁘다.
  const out = plan(['name', '담당자', '비밀메모'], [['Wiz', '김OO', 'x']], ['name', null, null]);
  assert.deepEqual(out.unmapped, ['담당자', '비밀메모']);
});

test('slug 는 괄호 안을 버린다 — 그건 이름이 아니라 관계 정보다', () => {
  assert.equal(I.slugify('AppDynamics (Cisco)'), 'appdynamics');
  assert.equal(I.slugify('Tenable(구 .Ermetic)'), 'tenable');
  assert.equal(I.slugify('Salesforce - Slack'), 'salesforce-slack');
  // 한글만 남으면 만들 수 없다. 사람이 지정한다(kccinfo · ksinfo).
  assert.equal(I.slugify('KCC정보통신'), '');  // 한글이 더 많으면 조각을 남기지 않는다
});

test('한글 사명은 막고 사람에게 넘긴다', () => {
  const out = plan(['name'], [['KCC정보통신'], ['KS고용정보']], ['name']);
  assert.equal(out.create.length, 0);
  assert.equal(out.blocked.length, 2);
  assert.match(out.blocked[0].reason, /직접 지정/);
  // slug 를 같이 주면 통과한다.
  const fixed = plan(['name', 'slug'], [['KCC정보통신', 'kccinfo']], ['name', 'slug']);
  assert.equal(fixed.create[0].slug, 'kccinfo');
});

test('표기만 다른 것은 자동으로 기존과 짝짓는다', () => {
  // 실제 마스터에서 확인된 표기 흔들림이다.
  for (const [name, slug] of [['Checkpoint', 'check-point'], ['TrendMicro', 'trend-micro'],
    ['Elevenlabs', 'eleven-labs'], ['Palo Alto Networks', 'palo-alto']]) {
    const hit = I.matchExisting(name, '', EXISTING);
    assert.ok(hit, `${name} 을 못 찾았다`);
    assert.equal(hit.slug, slug);
    assert.ok(hit.confidence !== 'partial', `${name} 은 자동으로 맞아야 한다`);
  }
});

test('⚠ 포함 관계는 자동으로 묶지 않는다 — 다른 회사일 수 있다', () => {
  // Rabbit 과 FollowerRabbit 은 다른 회사다. 자동으로 묶으면 남의 카탈로그를 덮어쓴다.
  const hit = I.matchExisting('Rabbit', '', EXISTING);
  assert.equal(hit.slug, 'followerrabbit');
  assert.equal(hit.confidence, 'partial', 'partial 이 아니면 자동 병합된다');

  const out = plan(['name'], [['Rabbit']], ['name']);
  assert.equal(out.create.length, 1, '새로 만들어야 한다');
  assert.equal(out.create[0].slug, 'rabbit');
  assert.equal(out.update.length, 0, '자동으로 갱신하면 안 된다');
  assert.ok(out.create[0].suggestion, '사람에게 보여줄 제안은 남긴다');
});

test('사람이 고른 짝이 자동 추정을 이긴다', () => {
  const out = plan(['name'], [['OpenAI']], ['name'], { 0: 'openai-enterprise' });
  assert.equal(out.update.length, 1);
  assert.equal(out.update[0].slug, 'openai-enterprise');
  assert.equal(out.create.length, 0);
});

test('같은 붙여넣기 안의 중복을 막는다', () => {
  // 마스터에 Avepoint·Netskope·Splunk·Vanta·MegazoneCloud 가 두 번씩 있었다.
  const out = plan(['name'], [['Avepoint'], ['Avepoint']], ['name']);
  assert.equal(out.create.length, 1);
  assert.equal(out.blocked.length, 1);
  assert.match(out.blocked[0].reason, /중복/);
});

test('바뀌는 값이 없으면 갱신하지 않는다', () => {
  // 의미 없는 UPDATE 는 updated_at 만 흔든다.
  const out = plan(['name', 'slug'], [['Zscaler', 'zscaler']], ['name', 'slug']);
  assert.equal(out.update.length, 0);
  assert.match(out.blocked[0].reason, /바뀌는 값이 없/);
});

test('판정 데이터·가격·내부 본문은 임포트 대상이 아니다', () => {
  // 엑셀에서 들어오면 ISV BU 검토를 건너뛴다.
  for (const forbidden of ['assessment_coverage', 'prerequisites', 'red_flags',
    'unit_price', 'list_price', 'opinion', 'sections_internal', 'status']) {
    assert.ok(!I.FIELD_KEYS.includes(forbidden), `${forbidden} 이 임포트 가능 필드에 있다`);
  }
  // 그런 컬럼을 매핑으로 넣으려 해도 값이 안 실린다.
  const out = plan(['name', 'x'], [['Wiz', '3']], ['name', 'unit_price']);
  assert.deepEqual(Object.keys(out.create[0].values).sort(), ['name', 'slug']);
});

test('들어온 것은 전부 draft 다', () => {
  const server = read('server.js');
  const route = server.slice(server.indexOf("'/api/admin/solutions/import'"));
  const block = route.slice(0, route.indexOf('\napp.'));
  assert.match(block, /'draft'/, '초안으로 안 넣는다');
  assert.ok(!/'published'/.test(block), '임포트가 발행까지 한다');
  // 한 트랜잭션 — 절반만 들어간 카탈로그가 최악이다.
  assert.match(block, /begin'\)/);
  assert.match(block, /rollback'\)/);
  // 052 미적용 구간에 통째로 실패하지 않는다.
  assert.match(block, /hasColumn\('solutions', 'website'\)/);
});

test('미리보기와 실행이 같은 계획을 쓴다', () => {
  // 두 경로가 다른 규칙을 쓰면 미리보기가 거짓말을 한다.
  const server = read('server.js');
  const route = server.slice(server.indexOf("'/api/admin/solutions/import'"));
  const block = route.slice(0, route.indexOf('\napp.'));
  assert.equal((block.match(/buildImportPlan\(/g) || []).length, 1, '계획을 두 번 세운다');
  assert.match(block, /dryRun !== false/);
  // 목업도 같은 lib 을 쓴다.
  assert.match(read('scripts/mock-ui-server.js'), /require\('\.\.\/lib\/catalog-import'\)/);
});

test('화면이 규칙을 따로 짜지 않는다', () => {
  const html = read('admin.html');
  assert.match(html, /window\.IssuCatalogImport/);
  for (const fn of ['parseDelimited', 'suggestMapping']) {
    assert.match(html, new RegExp(`lib\\.${fn}\\(`), `화면이 ${fn} 을 안 쓴다`);
    assert.ok(!html.includes(`function ${fn}(`), `화면이 ${fn} 을 다시 만들었다`);
  }
  // /admin 에서 스크립트가 열려야 한다 — 빠뜨리면 프로덕션에서만 404 다.
  const server = read('server.js');
  assert.match(server, /'\/lib\/catalog-import\.js': \{ file: 'lib\/catalog-import\.js', canonicalPath: '\/admin' \}/);
  const surface = server.slice(server.indexOf('const allowed = {'), server.indexOf('if (!allowed)'));
  assert.match(surface, /admin: [^\n]*startsWith\('\/lib\/'\)/, 'admin 분기에 /lib/ 이 없다');
});

test('브라우저에서 <script> 로 불러도 죽지 않는다', () => {
  // node require 검사는 통과하고 브라우저에서만 터지는 종류다. 두 번 데였다.
  const context = { console };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('lib/catalog-import.js'), context, { filename: 'catalog-import.js' });
  assert.ok(context.IssuCatalogImport, 'window.IssuCatalogImport 가 안 생겼다');
  assert.equal(context.IssuCatalogImport.IMPORT_FIELDS.length, I.IMPORT_FIELDS.length);
});

test('052 는 컬럼 둘만 만들고 관계 정보를 안 만든다', () => {
  const sql = read('db/migrations/052_solution_identity.sql');
  assert.match(sql, /add column if not exists name_kr/);
  assert.match(sql, /add column if not exists website/);
  // 「행의 단위」가 8/28 에 정해진다. 그 전에 만들면 두 번 만든다.
  for (const early of ['parent_vendor', 'former_name', 'offering_type', 'delivery_unit']) {
    assert.ok(!sql.includes(early), `${early} 를 미리 만들었다`);
  }
  assert.ok(!/^\s*update\s+solutions\s+set\s+(name_kr|website)/im.test(sql), '소급 백필이 있다');
});
