'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateLead, cleanPhone } = require('../lib/hub-domain');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const BASE = Object.freeze({
  consent: true,
  customer: '한빛금융',
  contact: 'kim@hanbit.co.kr',
  contact_name: '김담당',
  contact_phone: '02-1234-5678'
});

// ── 검증 ─────────────────────────────────────────────────────────
test('담당자 이름·전화번호가 필수다', () => {
  for (const field of ['contact_name', 'contact_phone']) {
    assert.throws(() => validateLead({ ...BASE, [field]: '' }), /입력해주세요/,
      `${field} 없이 통과하면 영업이 연락할 방법이 없다`);
  }
});

test('전화번호는 모양을 강제하지 않고 자릿수로만 본다', () => {
  // 형식을 잡으면 정상인데 모양이 다른 번호를 거절해 리드를 통째로 잃는다
  for (const ok of [
    '02-1234-5678 (내선 301)',
    '+82 10 1234 5678',
    '010.1234.5678',
    '1588-1234'
  ]) {
    assert.equal(cleanPhone(ok, '전화번호'), ok.trim().replace(/\s+/g, ' '),
      `정상 번호를 원형 그대로 둬야 한다: ${ok}`);
  }
  // "내선" 같은 글자를 지우면 "( 301)" 이 남는다. 지우지 않는 편이 낫다.
  assert.match(cleanPhone('02-1234-5678 (내선 301)', 'x'), /내선/);

  for (const bad of ['010', '전화주세요', '1234567', '1'.repeat(20)]) {
    assert.throws(() => cleanPhone(bad, '전화번호'), /형식을 확인|입력해주세요/,
      `걸러야 한다: ${bad}`);
  }
});

test('개인정보는 customer_meta 로 새지 않는다', () => {
  // customer_meta 는 deals 로 흘러가 영업이 자유롭게 고치는 자유형 필드다.
  // 개인정보를 거기 두면 어디까지 퍼졌는지 추적할 수 없다.
  const lead = validateLead({
    ...BASE,
    customer_meta: { industry: 'Finance', companySize: '1,000명 초과' }
  });
  assert.equal(lead.contact_name, '김담당');
  assert.equal(lead.contact_phone, '02-1234-5678');
  const metaText = JSON.stringify(lead.customer_meta);
  assert.ok(!metaText.includes('김담당'), '이름이 customer_meta 에 들어갔다');
  assert.ok(!metaText.includes('1234-5678'), '전화번호가 customer_meta 에 들어갔다');
  // 업종·규모는 개인정보가 아니므로 meta 로 간다
  assert.equal(lead.customer_meta.industry, 'Finance');
  assert.equal(lead.customer_meta.companySize, '1,000명 초과');
});

// ── 폼 ───────────────────────────────────────────────────────────
// 상담 폼은 랜딩이 아니라 진단 결과 화면에 있다. 진단 없이 리드만 들어오면
// 영업이 맥락 없이 만나고, 딜에 고객 상태가 비어 추천도 돌지 않는다.
test('상담 폼이 네 항목을 받는다', () => {
  const html = read('readiness.html');
  for (const [name, label] of [
    ['industry', '업종'], ['companySize', '고객사 규모'],
    ['contactName', '담당자 이름'], ['contactPhone', '전화번호']
  ]) {
    assert.match(html, new RegExp(`name="${name}"`), `${label} 입력칸이 없다`);
    assert.match(html, new RegExp(`${label}`), `${label} 라벨이 없다`);
  }
  // 넷 다 필수여야 영업이 받아 보고 다시 묻지 않는다
  for (const name of ['industry', 'companySize', 'contactName', 'contactPhone']) {
    const field = new RegExp(`name="${name}"[^>]*required|required[^>]*name="${name}"`);
    assert.match(html, field, `${name} 이 required 가 아니다`);
  }
});

test('개인정보 고지가 늘어난 항목을 담는다', () => {
  // 항목만 늘리고 고지를 안 고치면 동의 범위를 벗어난다. 법적 문제이지 UI 문제가 아니다.
  const html = read('readiness.html');
  const notice = html.slice(html.indexOf('privacy-notice'), html.indexOf('class="consent"'));
  for (const item of ['업종', '고객사 규모', '담당자 이름', '전화번호']) {
    assert.ok(notice.includes(item), `고지에 "${item}" 이 없다`);
  }
  assert.match(notice, /보유 기간/);
});

test('업종은 SFDC 분류 셀렉트다 — 자유입력이 아니다', () => {
  // 자유입력이면 "금융"·"금융업"·"은행" 이 다 다른 값이 되어 업종 벤치마크 비교를 못 한다.
  const html = read('readiness.html');
  assert.match(html, /<select name="industry"/, '업종이 select 여야 한다');

  const js = read('taxonomy.js');
  const block = js.slice(js.indexOf('const INDUSTRIES'), js.indexOf(']);', js.indexOf('const INDUSTRIES')));
  const codes = [...block.matchAll(/\['([^']+)', '/g)].map((m) => m[1]);
  assert.ok(codes.length >= 30, `SFDC 분류가 ${codes.length}종뿐이다`);
  for (const must of ['Finance', 'Manufacturing', 'Government', 'Technology', 'Other']) {
    assert.ok(codes.includes(must), `${must} 가 없다`);
  }
  assert.equal(new Set(codes).size, codes.length, '중복 코드가 있다');
});

// ── 저장 경로 ────────────────────────────────────────────────────
test('027 미적용 구간에도 리드 접수가 깨지지 않는다', () => {
  // 스키마는 수동 적용이라 코드가 먼저 배포되는 구간이 있다. 거기서 insert 가 실패하면
  // 리드를 통째로 잃는다 — 되돌릴 수 없는 손실이다.
  const routes = read('routes/hub.js');
  // 접수(POST /public/leads)와 상세 조회(GET /deals/:id) 두 곳이 이 컬럼을 만진다.
  // 한 곳만 검사하면 다른 곳이 뚫려도 통과한다 — 실제로 그렇게 새는 걸 확인했다.
  const declarations = [...routes.matchAll(/const hasContactCols\s*=\s*([^;]+);/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim());
  assert.equal(declarations.length, 2, `가드 선언이 ${declarations.length}곳이다 (접수·상세 2곳이어야 한다)`);
  for (const decl of declarations) {
    assert.match(decl, /hasColumn\('leads', 'contact_name'\)/,
      `가드 없이 컬럼을 쓰면 027 적용 전에 500 이 난다: ${decl}`);
  }

  assert.match(routes, /if \(hasContactCols\) \{[\s\S]{0,200}contact_name', 'contact_phone'/,
    '접수는 컬럼이 있을 때만 붙여야 한다');
  assert.match(routes, /null::text as contact_name/,
    '상세는 컬럼이 없으면 null 로 내려 화면이 그려져야 한다');
});

test('전화번호를 Slack 으로 흘리지 않는다', () => {
  // Slack 채널은 보존기간 관리 밖이다. 개인정보를 남길 자리가 아니다.
  const routes = read('routes/hub.js');
  const at = routes.indexOf('slackNotify(`🔵 신규 딜');
  assert.ok(at > 0, '알림 문구를 찾지 못했다');
  const block = routes.slice(at, at + 400);
  assert.ok(!block.includes('contact_phone'), '전화번호가 Slack 문구에 들어갔다');
  assert.match(block, /contact_name/, '담당자 이름은 있어야 첫 연락이 자연스럽다');
});

test('허브는 포탈 담당자 정보를 읽기 전용으로 보여준다', () => {
  // leads 에만 있는 값이라 딜로 복사하지 않는다. 영업이 고칠 값이 아니라 고객이 남긴 값이다.
  const hub = read('hub.js');
  assert.match(hub, /function portalContactMarkup/);
  assert.match(hub, /lead_contact_name/);
  assert.match(hub, /lead_contact_phone/);
  assert.match(hub, /readonly-value/);
  assert.ok(!/data-meta-field="contactPhone"/.test(hub),
    '포탈 전화번호를 customer_meta 로 다시 쓰면 안 된다');
  assert.match(read('hub.css'), /\.readonly-value/, '스타일이 없으면 그냥 텍스트로 뜬다');
});

test('027 은 스키마만 바꾼다', () => {
  const sql = read('db/migrations/027_lead_contact_fields.sql');
  assert.match(sql, /alter table leads add column if not exists contact_name/);
  assert.match(sql, /alter table leads add column if not exists contact_phone/);
  assert.ok(!/insert into|update .* set/i.test(sql.replace(/^--.*$/gm, '')),
    '시드가 섞이면 재실행이 위험해진다');
});

// ── 분류 어휘 (028) ──────────────────────────────────────────────
test('규모·업종 목록이 taxonomy.js 한 곳에만 있다', () => {
  // 화면마다 적으면 같은 필드에 다른 어휘가 섞인다. 실제로 "100~499명"(허브) 과
  // "200~500명"(상담 폼) 이 공존했고, 그러면 규모로 묶어 보는 일이 전부 어긋난다.
  const taxonomy = read('taxonomy.js');
  assert.match(taxonomy, /COMPANY_SIZES = Object\.freeze/);
  assert.match(taxonomy, /INDUSTRIES = Object\.freeze/);

  // 주석은 뺀다. "왜 이렇게 됐는지" 를 설명하는 글에 옛 값이 나오는 건 정상이고,
  // 오히려 그 이력을 지우면 다음 사람이 같은 실수를 반복한다.
  const stripComments = (body) => body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  for (const file of ['offering.js', 'hub.js', 'readiness.js',
    'offering.html', 'hub.html', 'readiness.html']) {
    const body = stripComments(read(file));
    for (const dead of ['1~99명', '100~499명', '500~1,999명', '2,000명 이상']) {
      assert.ok(!body.includes(dead), `${file} 코드에 옛 규모 어휘 "${dead}" 가 남아 있다`);
    }
    // 새 값도 화면 파일에 직접 박으면 안 된다 — taxonomy.js 에서 와야 한다
    if (file.endsWith('.js')) {
      assert.ok(!/\['200명 미만'|"200명 미만"|>200명 미만</.test(body),
        `${file} 이 규모 목록을 다시 적고 있다`);
    }
  }
});

test('폼이 있는 페이지가 taxonomy.js 를 소비자보다 먼저 로드한다', () => {
  // 랜딩(offering.html)에는 폼이 없어 빠졌다. 폼이 다시 생기면 여기 추가해야 한다.
  for (const [page, consumer] of [['readiness.html', '/readiness.js'], ['hub.html', '/hub.js']]) {
    const html = read(page);
    const at = html.indexOf('/taxonomy.js');
    assert.ok(at > 0, `${page} 에 taxonomy.js 로드가 없다`);
    assert.ok(at < html.indexOf(consumer), `${page}: taxonomy.js 가 먼저여야 한다`);
  }
  const server = read('server.js');
  const open = server.indexOf('const publicFrontendAssets');
  assert.match(server.slice(open, server.indexOf('});', open)), /'\/taxonomy\.js'/,
    '공개 자산이 아니면 비로그인 상담 폼에서 목록이 안 채워진다');
});

test('업종은 허브 새 딜에서도 셀렉트다', () => {
  // 상담 폼만 고치면 영업이 직접 만든 딜에서 자유입력이 다시 들어온다
  const html = read('hub.html');
  assert.match(html, /<select id="new-industry"/);
  assert.ok(!/<input name="industry"/.test(html), '자유입력이 남아 있다');
  assert.match(read('hub.js'), /fillNewDealTaxonomy/);
});

test('028 이전 값을 화면이 만나도 선택 상태를 잃지 않는다', () => {
  // DB 는 028 이 한 번에 바꾸지만 그 전에 저장된 값을 셀렉트가 만나면 아무것도
  // 선택되지 않은 것처럼 보이고, 그대로 저장하면 값이 날아간다.
  const { IssuTaxonomy } = require('../taxonomy.js') || {};
  const t = globalThis.IssuTaxonomy;
  assert.equal(t.normaliseCompanySize('100~499명'), '200~500명');
  assert.equal(t.normaliseCompanySize('1~99명'), '200명 미만');
  assert.equal(t.normaliseCompanySize('2,000명 이상'), '1,000명 초과');
  assert.equal(t.normaliseCompanySize('200~500명'), '200~500명', '새 값은 그대로');
  assert.equal(t.normaliseCompanySize(''), '');
  assert.match(read('hub.js'), /normaliseCompanySize/, '허브가 정규화를 거쳐야 한다');
});

test('028 이 옛 어휘 네 가지를 모두 옮긴다', () => {
  const sql = read('db/migrations/028_company_size_vocabulary.sql');
  for (const old of ['1~99명', '100~499명', '500~1,999명', '2,000명 이상']) {
    assert.ok(sql.includes(`'${old}'`), `028 에 ${old} 매핑이 없다`);
  }
  // 경계를 걸치는 구간은 옮긴 뒤 확인이 필요하다 — 쿼리로 뽑아 줘야 한다
  assert.match(sql, /1,000 을 걸친다|영업 확인이 필요/);
  assert.match(sql, /where d\.customer_meta ->> 'companySize' = m\.old_value/);
});

// ── 045 직함·도입 시기 ──────────────────────────────────────────
test('직함은 개인정보라 leads 로, 도입 시기는 customer_meta 로 간다', () => {
  const domain = read('lib/hub-domain.js');
  const routes = read('routes/hub.js');
  const html = read('readiness.html');
  const js = read('readiness.js');

  // 직함 — 027 규약대로 동의 이력과 같은 표
  assert.match(domain, /contact_title: optionalText\(body\.contact_title, 60\)/);
  assert.match(routes, /leadColumns\.push\('contact_title'\)/);
  assert.match(routes, /hasColumn\('leads', 'contact_title'\)/);
  assert.match(js, /contact_title: form\.get\('contactTitle'\)/);
  // customer_meta 로 새면 딜로 흘러가 어디까지 퍼졌는지 추적할 수 없다
  const submit = js.slice(js.indexOf('customer_meta: {'), js.indexOf('customer_meta: {') + 500);
  assert.ok(!/contactTitle|contact_title/.test(submit), '직함이 customer_meta 로 갔다');

  // 도입 시기 — 개인정보가 아니라 컬럼을 만들지 않는다
  assert.match(js, /timeline: form\.get\('timeline'\)/);
  assert.ok(!/leads.*contact_timeline|add column.*timeline/i.test(routes));
  const sql = read('db/migrations/045_lead_authority_timeline.sql');
  assert.match(sql, /add column if not exists contact_title text/);
  assert.ok(!/add column[^\n]*timeline/i.test(sql), '도입 시기는 컬럼이 아니다');

  // 폼에 둘 다 있다
  assert.match(html, /name="contactTitle"/);
  assert.match(html, /name="timeline"/);
});

test('항목을 늘렸으면 고지와 동의 버전도 같이 올린다', () => {
  // 027 이 같은 실수를 한 번 지적해 뒀다 — 항목만 늘리고 고지를 안 고치면
  // 동의 범위를 벗어난다.
  const html = read('readiness.html');
  const routes = read('routes/hub.js');
  const notice = html.slice(html.indexOf('<b>수집 항목</b>'), html.indexOf('<b>이용 목적</b>'));
  assert.match(notice, /직함/, '고지에 직함이 없다');
  assert.match(notice, /도입 희망 시기/, '고지에 도입 시기가 없다');
  assert.match(notice, /열람 기록/, '고지에 결과 링크 열람 기록이 없다');   // 048
  // 옛 버전 그대로면 무엇에 동의했는지 되찾을 수 없다. **이 줄은 수집 항목을 고칠
  // 때마다 같이 올라간다** — 그게 이 검사의 목적이다. 지난 버전은 되돌아올 수 없다.
  assert.match(routes, /version: '2026-08-13-v3'/);
  for (const retired of ["'2026-07-22-v1'", "'2026-08-13-v2'"]) {
    assert.ok(!routes.includes(`version: ${retired}`), `동의 버전이 ${retired} 로 되돌아갔다`);
  }
});

test('직함은 포탈 원본과 영업 확인분을 가른다', () => {
  const hub = read('hub.js');
  // leads.contact_title  = 고객이 폼에서 낸 것 → 읽기 전용
  // deals.customer_contact_title = 영업이 미팅에서 확인한 것 → 편집 가능
  const portal = hub.slice(hub.indexOf('function portalContactMarkup'), hub.indexOf('function legacyContactMarkup'));
  assert.match(portal, /lead_contact_title/);
  assert.match(portal, /readonly-value/);
  assert.match(hub, /data-deal-field="customer_contact_title"/, '영업 입력칸이 사라졌다');
  // 도입 시기 어휘는 한 곳에서 온다 — 폼과 허브가 갈리면 값이 안 맞는다
  assert.match(hub, /const TIMELINE_OPTIONS = Object\.freeze/);
  const html = read('readiness.html');
  for (const value of ['3m', '6m', '1y', 'unknown']) {
    assert.match(html, new RegExp(`value="${value}"`), `폼에 ${value} 가 없다`);
    assert.match(hub, new RegExp(`'${value}'`), `허브에 ${value} 가 없다`);
  }
});
