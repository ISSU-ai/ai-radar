'use strict';

/**
 * 041 딜 확장 필드 + 딜 삭제.
 *
 * 여기서 잡으려는 것은 **화면에는 티가 안 나는 실패**들이다.
 *   · 화이트리스트 누락 → PATCH 가 200 을 주고 「자동 저장됨」도 뜨는데 값이 안 들어간다
 *   · JSONB 등록 누락 → 그 필드를 처음 고르는 순간 500
 *   · 삭제 필터 누락 → 지운 딜이 그 경로에서만 되살아난다
 *   · 목록 API 에 개인정보 → 화면에 안 그려도 응답 JSON 에 실려 전 직원에게 간다
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const routes = read('routes/hub.js');
const domainSrc = read('lib/hub-domain.js');
const serverSrc = read('server.js');
const migration = read('db/migrations/041_deal_pipeline_fields.sql');
const mock = read('scripts/mock-ui-server.js');
const hubJs = read('hub.js');
const hubHtml = read('hub.html');
const hubCss = read('hub.css');

const {
  EDITABLE_DEAL_FIELDS, SERVER_OWNED_DEAL_FIELDS, normaliseDealPatch
} = require('../lib/hub-domain');

const CONTACT_FIELDS = ['customer_contact_name', 'customer_contact_dept',
  'customer_contact_title', 'customer_contact_email'];

// ── 정규화 ────────────────────────────────────────────────────────
test('새 필드가 전부 정규화되어 patch 에 담긴다', () => {
  // normaliseDealPatch 는 body 가 아니라 **화이트리스트를 순회**한다. 분기를 안 쓰면
  // 화이트리스트에 넣어도 조용히 누락된다 — 저장은 200 이고 화면도 저장됐다고 한다.
  const patch = normaliseDealPatch({
    mzc_sales: '정코어', msp_status: 'yes', inquiry_date: '2026-08-05',
    customer_contact_name: '김디지털', customer_contact_dept: '디지털혁신본부',
    customer_contact_title: '상무', customer_contact_email: 'kim@x.co.kr',
    inquiry_products: ['s1', 's3']
  });
  for (const field of ['mzc_sales', 'msp_status', 'inquiry_date', 'inquiry_products', ...CONTACT_FIELDS]) {
    assert.ok(field in patch, `${field} 가 patch 에 안 담겼다`);
  }
  assert.deepEqual(patch.inquiry_products, ['s1', 's3']);
});

test('MSP 여부는 세 값만 받고 빈 값은 「확인 필요」다', () => {
  // boolean 이면 안 되는 이유: null/false 를 「MSP 아님」으로 읽으면 MSP 고객을
  // 우선순위에서 놓친다 — 이 필드가 잡으려던 실패 그 자체다.
  assert.equal(normaliseDealPatch({ msp_status: 'yes' }).msp_status, 'yes');
  assert.equal(normaliseDealPatch({ msp_status: 'no' }).msp_status, 'no');
  assert.equal(normaliseDealPatch({ msp_status: '' }).msp_status, 'unknown');
  assert.throws(() => normaliseDealPatch({ msp_status: 'maybe' }), /MSP/);
  assert.throws(() => normaliseDealPatch({ msp_status: true }), /MSP/);
});

test('문의 시점은 실재하는 날짜만 받고 빈 값은 null 이다', () => {
  assert.equal(normaliseDealPatch({ inquiry_date: '2026-08-05' }).inquiry_date, '2026-08-05');
  assert.equal(normaliseDealPatch({ inquiry_date: '' }).inquiry_date, null);
  assert.throws(() => normaliseDealPatch({ inquiry_date: '어제' }), /YYYY-MM-DD/);
  assert.throws(() => normaliseDealPatch({ inquiry_date: '2026-13-01' }), /날짜/);
  assert.throws(() => normaliseDealPatch({ inquiry_date: '2026-02-31' }), /날짜/);
  // Date 로 파싱해 되돌리면 시간대가 끼어 하루가 밀린다. 문자열 그대로 저장한다.
  assert.equal(typeof normaliseDealPatch({ inquiry_date: '2026-01-01' }).inquiry_date, 'string');
});

test('서버가 소유하는 컬럼은 화면이 못 고친다', () => {
  // stage_changed_at 이 고쳐지면 정체 시계를 되돌릴 수 있고,
  // deleted_at 이 고쳐지면 지운 딜이 되살아난다.
  for (const field of SERVER_OWNED_DEAL_FIELDS) {
    assert.ok(!EDITABLE_DEAL_FIELDS.includes(field), `${field} 가 화이트리스트에 있다`);
  }
  assert.throws(() => normaliseDealPatch({
    stage_changed_at: '2020-01-01', deleted_at: null, deleted_by: 'x', owner_id: 'y'
  }), /변경사항/);
});

// ── 서버 ──────────────────────────────────────────────────────────
test('jsonb 로 정규화되는 필드가 전부 JSONB_DEAL_FIELDS 에 있다', () => {
  // 빠뜨리면 node-postgres 가 JS 배열을 PG 배열 리터럴({a,b})로 직렬화해
  // "invalid input syntax for type json" 500 이 난다. 그 필드를 처음 쓰는 순간이다.
  const set = routes.slice(routes.indexOf('const JSONB_DEAL_FIELDS'),
    routes.indexOf('const fields = Object.keys(patch)'));
  const jsonish = domainSrc.match(/patch\[field\] = ensureArray|ensurePlainObject\(body\[field\]/g) || [];
  assert.ok(jsonish.length, '정규화 분기를 못 찾았다');
  for (const field of ['customer_meta', 'isv_combo', 'packages', 'assessment_scores',
    'readiness_scores', 'prereq_confirmations', 'inquiry_products']) {
    assert.match(set, new RegExp(`'${field}'`), `${field} 가 JSONB_DEAL_FIELDS 에 없다`);
  }
});

test('목록 API 에 개인정보를 싣지 않는다', () => {
  // ⚠ 이 목록에는 소유자 게이트가 없다 — 승인된 전 직원이 본다.
  const block = routes.slice(routes.indexOf("router.get('/deals'"), routes.indexOf("router.post('/deals'"));
  for (const field of CONTACT_FIELDS) {
    assert.ok(!block.includes(field), `목록 SELECT 에 ${field} 가 있다`);
  }
  // 주석으로 「넣지 마라」를 적는 건 괜찮다. SQL 참조 형태만 막는다.
  assert.ok(!/d\.customer_contact/.test(block), '고객 담당자 컬럼이 목록 SELECT 에 실렸다');
  // customer_meta 는 여전히 3키 화이트리스트여야 한다
  assert.match(block, /jsonb_build_object\(\s*'industry'/);
  assert.ok(!/select d\.\*/.test(block), 'd.* 를 쓰면 새 컬럼이 자동으로 새어 나간다');
  // 배지·필터가 쓰는 것은 실어야 한다. 없으면 조용히 안 뜬다.
  for (const field of ['msp_status', 'inquiry_date', 'stage_changed_at']) {
    assert.match(block, new RegExp(`d\\.${field}`), `목록에 ${field} 가 없다`);
  }
  assert.match(block, /d\.deleted_at is null/, '지운 딜이 목록에 남는다');
});

test('딜을 읽고 고치는 모든 쿼리가 삭제된 딜을 거른다', () => {
  // 하나만 빠지면 지운 딜이 그 경로에서만 되살아나는데 화면에는 티가 안 난다.
  const authed = routes.slice(routes.indexOf('router.use(authenticateToken)'));
  const gated = (authed.match(/liveDeal\(/g) || []).length;
  assert.equal(gated, 5, `liveDeal 이 걸린 쿼리가 ${gated}곳이다 (읽기2·snapshot·claim·owner)`);
  // 나머지 둘은 조건절이 아니라 선조회 뒤 JS 로 본다
  const patchBlock = authed.slice(authed.indexOf("router.patch('/deals/:id'"), authed.indexOf("router.delete('/deals/:id'"));
  assert.match(patchBlock, /if \(current\.deleted_at\) return res\.status\(404\)/,
    '지운 딜에 잔여 PATCH 가 들어가면 updated_at 이 갱신되고 SSE 가 다른 브라우저를 깨운다');
  const deleteBlock = authed.slice(authed.indexOf("router.delete('/deals/:id'"));
  assert.match(deleteBlock, /where id = \$1 and deleted_at is null/, '이미 지운 딜을 또 지운다');
});

test('041 미적용 구간에 새 컬럼을 저장하려 하면 503 으로 막는다', () => {
  // 그냥 UPDATE 하면 42703 으로 patch 전체가 실패해 같이 실린 메모·단계까지 날아간다.
  // 조용히 버리지도 않는다 — 값이 안 들어갔는데 「자동 저장됨」이 뜨는 쪽이 더 나쁘다.
  const block = routes.slice(routes.indexOf("router.patch('/deals/:id'"), routes.indexOf("router.delete('/deals/:id'"));
  assert.match(block, /hasColumn\('deals', 'stage_changed_at'\)/);
  assert.match(block, /PIPELINE_FIELDS_041/);
  assert.match(block, /041 마이그레이션을 확인하세요/);
  // 단계가 **실제로 바뀔 때만** 정체 시계를 리셋한다
  assert.match(block, /hasOwnProperty\.call\(patch, 'stage'\) && patch\.stage !== current\.stage[\s\S]{0,120}patch\.stage_changed_at/);
  // 화이트리스트에 있는 041 필드가 전부 가드 목록에 있어야 한다
  const guard = routes.slice(routes.indexOf('const PIPELINE_FIELDS_041'), routes.indexOf('const STALE_RATE_LIMIT_MS'));
  for (const field of ['mzc_sales', 'msp_status', 'inquiry_date', 'inquiry_products', ...CONTACT_FIELDS]) {
    assert.match(guard, new RegExp(`'${field}'`), `${field} 가 503 가드에서 빠졌다`);
  }
});

test('삭제는 soft 이고 개인정보는 함께 지운다', () => {
  const block = routes.slice(routes.indexOf("router.delete('/deals/:id'"), routes.indexOf("router.post('/deals/:id/claim'"));
  assert.match(block, /set deleted_at = now\(\), deleted_by = \$1/);
  // soft delete 만 하면 이름·이메일이 아무 화면에도 안 보이는 행에 영구히 남는다.
  for (const field of CONTACT_FIELDS) {
    assert.match(block, new RegExp(`${field} = null`), `삭제 시 ${field} 가 안 지워진다`);
  }
  assert.ok(!/delete from deals/i.test(routes), 'hard delete 는 leads FK 때문에 실패한다');
  // 미배정 딜은 「담당하기 후 삭제」라고 읽을 수 있게 답해야 한다
  assert.match(block, /미배정 딜입니다/);
  assert.match(block, /담당자만 이 딜을 삭제할 수 있습니다/);
  assert.match(block, /auditLog\(req\.user\.id, 'delete', `deal:/);
  // Slack 채널은 보존기간 관리 밖이다
  const slack = block.slice(block.indexOf('slackNotify'), block.indexOf('auditLog'));
  assert.ok(!/customer_contact/.test(slack), 'Slack 문구에 개인정보가 들어갔다');
  assert.match(block, /hasColumn\('deals', 'deleted_at'\)[\s\S]{0,200}503/);
});

test('date 컬럼을 문자열로 받는다', () => {
  // 기본 파서는 지역시간 자정 Date 로 만들고, JSON 으로 나가며 UTC 로 밀린다.
  // 한국 시간대 서버에서는 문의 시점이 하루 전으로 뜨고 저장할수록 계속 밀린다.
  assert.match(serverSrc, /setTypeParser\(1082/);
});

// ── 마이그레이션 · 목업 삼각 검증 ─────────────────────────────────
test('041 이 심는 컬럼이 코드·목업과 어긋나지 않는다', () => {
  const columns = [...migration.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
  assert.equal(columns.length, 11, `컬럼이 ${columns.length}개다`);
  const known = new Set([...EDITABLE_DEAL_FIELDS, ...SERVER_OWNED_DEAL_FIELDS]);
  for (const column of columns) {
    assert.ok(known.has(column), `${column} 이 화이트리스트에도 서버소유 목록에도 없다`);
    assert.ok(mock.includes(column), `목업 딜 픽스처에 ${column} 이 없다 — 로컬 확인이 거짓말이 된다`);
  }
});

test('041 은 다시 돌려도 안전하고 기존 행을 오염시키지 않는다', () => {
  const body = migration.split('-- 확인')[0];
  // 백필은 전부 빈 값에만
  for (const update of body.match(/update deals[\s\S]*?;/g) || []) {
    assert.ok(/is null|coalesce\([^)]*\)\s*=\s*''|like '%@%'/.test(update),
      `조건 없는 백필이 있다: ${update.slice(0, 80)}`);
  }
  // ⚠ 한 줄로 default now() 를 주면 PG11+ 가 기존 행까지 채워 「전 딜이 방금 이동」이 된다
  assert.match(body, /add column if not exists stage_changed_at timestamptz;/);
  assert.match(body, /alter column stage_changed_at set default now\(\)/);
  assert.ok(!/add column if not exists stage_changed_at timestamptz default/.test(body),
    'default 를 한 줄로 주면 기존 딜이 전부 「방금 단계 이동」이 된다');
  // 이메일이 아닌 값은 추측해서 옮기지 않는다
  assert.match(body, /customer_meta ->> 'contact' like '%@%'/);
  assert.match(migration, /select id, customer, customer_meta ->> 'contact'/, '남은 행을 뽑는 확인 쿼리가 없다');
  assert.match(read('scripts/apply-migrations.js'), /'041_deal_pipeline_fields\.sql'/);
});

test('목업이 실제 서버처럼 목록에서 개인정보를 벗긴다', () => {
  // 목업이 딜 객체를 통째로 주면 누출을 로컬에서 영영 못 본다.
  const block = mock.slice(mock.indexOf('const DEAL_LIST_FIELDS'), mock.indexOf("app.post('/api/hub/deals'"));
  for (const field of CONTACT_FIELDS) {
    assert.ok(!block.includes(field), `목업 목록에 ${field} 가 실린다`);
  }
  assert.match(block, /industry:[\s\S]{0,120}companySize:[\s\S]{0,120}targetUsers:/);
  assert.match(block, /deal\.deleted_at/, '지운 딜이 목업 목록에 남는다');
  assert.match(mock, /app\.delete\('\/api\/hub\/deals\/:id'/, '목업에 삭제가 없으면 화면 확인을 못 한다');
  assert.match(mock, /patch\.stage !== deals\[index\]\.stage[\s\S]{0,120}stage_changed_at/);
});

// ── 화면 ──────────────────────────────────────────────────────────
test('정체 판정 기준은 한 곳에만 적는다', () => {
  // 숫자가 여러 곳에 박히면 화면과 문서가 갈린다.
  assert.equal((hubJs.match(/STALL_DAYS = Object\.freeze/g) || []).length, 1);
  assert.match(hubJs, /inflowWarn: 30, inflowLate: 60, stageWarn: 14, stageLate: 30/);
  // 문서용 한 줄도 같은 계산을 쓴다
  assert.match(hubJs, /function stallReportLine[\s\S]{0,200}stallState\(state\.deal\)/);
  // updated_at 은 메모 한 글자에도 갱신되므로 정체를 못 잰다
  const stall = hubJs.slice(hubJs.indexOf('function stallState'), hubJs.indexOf('const STALL_CLASS'));
  assert.ok(!/updated_at/.test(stall), 'updated_at 으로 정체를 재면 모든 딜이 늘 신선해 보인다');
  // 문의 시점이 없으면 라벨을 바꾼다 — 없는 것을 있는 척하지 않는다
  assert.match(stall, /inquiry_date \? '유입' : '등록'/);
});

test('고객 연락처가 customer_meta 로 복사되던 경로를 닫았다', () => {
  // 리드 이메일이 미리 채워진 편집 칸이라 한 글자만 건드려도 개인정보가 jsonb 로 갔다.
  assert.ok(!/data-meta-field="contact"/.test(hubJs), 'meta.contact 입력칸이 남아 있다');
  assert.ok(!/meta\.contact \|\| state\.deal\.lead_contact/.test(hubJs), '리드 이메일 폴백이 남아 있다');
  // 리드 이메일은 읽기 전용으로 옮겼다
  const portal = hubJs.slice(hubJs.indexOf('function portalContactMarkup'), hubJs.indexOf('function legacyContactMarkup'));
  assert.match(portal, /lead_contact_name/);
  assert.match(portal, /state\.deal\.lead_contact\b/);
  assert.match(portal, /readonly-value/);
  // 못 옮긴 값은 눈앞에서 사라지지 않는다
  assert.match(hubJs, /function legacyContactMarkup[\s\S]{0,400}readonly-value/);
});

test('문의 제품 토글이 화면을 다시 그리지 않는다', () => {
  // renderStage() 를 부르면 <details> 가 접히고 스크롤이 튄다. "왜 자꾸 닫히지" 로만 보고된다.
  const block = hubJs.slice(hubJs.indexOf("$$('[data-inquiry-product]')"), hubJs.indexOf("$$('[data-meta-field]')"));
  assert.ok(!/renderStage\(\)/.test(block), '토글에서 renderStage 를 부른다');
  assert.match(block, /renderInquiryProductChips\(\)/);
  assert.match(block, /scheduleSave\(\{ inquiry_products: picked \}, true\)/);
  // 카탈로그에서 내려간 id 를 조용히 감추지 않는다
  assert.match(hubJs, /카탈로그에 없는 제품/);
});

test('삭제 UI 는 새 딜 창과 닫기 속성이 다르다', () => {
  // data-close-dialog 위임이 #new-deal-dialog 를 하드코딩해 닫는다.
  // 같은 속성을 쓰면 삭제창의 「취소」가 엉뚱한 창을 닫는다.
  assert.match(hubHtml, /id="delete-deal-dialog"/);
  assert.match(hubHtml, /data-close-delete-dialog/);
  const dialog = hubHtml.slice(hubHtml.indexOf('id="delete-deal-dialog"'), hubHtml.indexOf('id="new-deal-dialog"'));
  assert.ok(!/data-close-dialog\b/.test(dialog), '삭제창이 새 딜 창의 닫기 속성을 쓴다');
  // 무엇이 지워지는지 문서 안에서 말한다
  assert.match(dialog, /함께 지워집니다/);
  assert.match(dialog, /id="delete-deal-customer"/);
  // 버튼은 워크스페이스 상단에 — 딜 카드 자체가 <button> 이라 중첩할 수 없다
  assert.match(hubHtml, /id="delete-deal-button"[\s\S]{0,120}trash-2/);
  assert.match(hubJs, /\$\('#delete-deal-button'\)\.classList\.toggle\('hidden', !isOwner\(\)\)/);
  assert.match(hubCss, /\.danger-button/);
});

test('MSP 필터와 배지가 화면에 실제로 붙어 있다', () => {
  assert.match(hubHtml, /data-filter="msp"/);
  assert.match(hubCss, /\.deal-segments \{[^}]*repeat\(4, 1fr\)/, '세그먼트가 3분할이면 네 번째가 눌린다');
  assert.match(hubJs, /msp: \(deal\) => deal\.msp_status === 'yes'/);
  // 「확인 필요」를 전 딜에 띄우면 소음이 되어 아무도 안 본다
  assert.match(hubJs, /deal\.msp_status === 'yes' \? '<span class="msp-tag">MSP<\/span>' : ''/);
});

test('목업이 새 딜에 041 기본값을 그대로 붙인다', () => {
  // DB 기본값(msp_status unknown · inquiry_products [] · stage_changed_at now())을
  // 목업이 안 흉내 내면 **새로 만든 딜만** 로컬에서 다르게 보인다.
  // 실서버는 「단계 0일」인데 로컬은 「기록없음」이 되는 식이라 알아채기 어렵다.
  const block = mock.slice(mock.indexOf("app.post('/api/hub/deals'"), mock.indexOf("app.get('/api/hub/deals/:id'"));
  assert.match(block, /msp_status: 'unknown'/);
  assert.match(block, /inquiry_products: \[\]/);
  assert.match(block, /stage_changed_at: now/);
  assert.match(block, /created_at: now/);
  // 041 이 default 를 주는 것과 안 주는 것이 갈린다
  assert.match(block, /inquiry_date: null/, '문의 시점은 영업이 직접 적는다 — 기본값 없음');
  assert.match(migration, /add column if not exists msp_status text not null default 'unknown'/);
  assert.match(migration, /add column if not exists inquiry_products jsonb not null default '\[\]'::jsonb/);
});

test('정체 표시가 STEP01 과 컨텍스트 카드에 같이 갱신된다', () => {
  // 컨텍스트 카드는 다섯 단계 내내 보이고 STEP01 것은 문의 시점을 고칠 때의 즉시
  // 피드백이다. 갱신을 부르는 쪽에 맡기면 한쪽만 옛 숫자로 남는다.
  assert.match(hubHtml, /<dt>경과<\/dt><dd id="context-stall">/);
  const body = hubJs.slice(hubJs.indexOf('function renderStallSummary'), hubJs.indexOf('const MSP_LABELS'));
  assert.match(body, /getElementById\('stall-summary'\)/);
  assert.match(body, /getElementById\('context-stall'\)/, '컨텍스트 카드가 안 갱신된다');
  // 딜을 닫은 뒤에도 옛 딜의 숫자가 남으면 안 된다
  assert.match(body, /state\.deal \?[\s\S]{0,80}: '—'/);
  // 워크스페이스를 그릴 때 한 번 채운다
  assert.match(hubJs, /\$\('#context-updated'\)\.textContent = formatDate\(deal\.updated_at\);\s*renderStallSummary\(\)/);
  assert.match(hubCss, /#context-stall/);
});

test('정체 칩이 마우스오버로 자기 판정 기준을 말한다', () => {
  const body = hubJs.slice(hubJs.indexOf('function stallHint'), hubJs.indexOf('/** 계산 결과만. 입력칸과 분리해야 문의 시점'));
  // 기준 숫자를 설명에 다시 적으면 STALL_DAYS 를 고쳤을 때 설명만 옛 숫자로 남는다.
  assert.match(body, /STALL_DAYS\.inflowWarn, STALL_DAYS\.inflowLate/);
  assert.match(body, /STALL_DAYS\.stageWarn, STALL_DAYS\.stageLate/);
  assert.ok(!/0~29|30일 이상|0~13|14일 이상/.test(body), '설명에 숫자를 손으로 적었다');
  // 두 칩이 각자 다른 기준을 쓴다 — 유입과 단계는 임계값이 다르다
  assert.match(body, /stallHint\('inflow'/);
  assert.match(body, /stallHint\('stage'/);
  // title 은 속성이라 이스케이프가 필요하다
  assert.match(body, /title="\$\{escapeHtml\(/);
  // 문의 시점이 없으면 그 사실을 설명에 밝힌다
  assert.match(body, /문의 시점 미입력/);
});

test('목업 딜 목록이 실제 라우트와 같은 조건·정렬을 쓴다', () => {
  // 파라미터를 무시하면 검색과 「내 딜」 필터가 로컬에서만 아무 반응이 없다.
  // 기능이 멀쩡한데 안 되는 것처럼 보이는 쪽이라 더 나쁘다.
  const block = mock.slice(mock.indexOf("app.get('/api/hub/deals'"), mock.indexOf("app.post('/api/hub/deals'"));
  assert.match(block, /req\.query/, '파라미터를 안 읽는다');
  for (const param of ['q', 'stage', 'track', 'mine']) {
    assert.match(block, new RegExp(`\\b${param}\\b`), `${param} 를 안 본다`);
  }
  assert.match(block, /mine === 'true' && deal\.owner_id !== user\.id/);
  // 정렬도 같아야 한다 — 임자 없는 신규 리드가 맨 위
  assert.match(block, /source === 'portal' && !d\.owner_id/);
  // 실제 라우트가 지원하는 파라미터와 목업이 어긋나지 않는지 대조
  const real = routes.slice(routes.indexOf("router.get('/deals'"), routes.indexOf("router.post('/deals'"));
  assert.match(real, /const \{ q = '', stage = '', track = '', mine = '' \} = req\.query/);
});

test('솔루션 목록이 노출 상태로 묶여 정렬된다', () => {
  // 「숨김」을 누르면 그 행이 아래 묶음으로 내려가야 지금 무엇이 대외에
  // 나가고 있는지가 목록 위쪽만 봐도 잡힌다.
  const admin = read('admin.html');
  const block = admin.slice(admin.indexOf('function renderSolutionsMenu'), admin.indexOf('function selectSolution'));
  assert.match(block, /const visibilityRank = \(item\) => \(item\.is_archived \? 2 : item\.is_hidden \? 1 : 0\)/);
  // 같은 상태 안에서는 서버가 준 순서를 지킨다 — 안 그러면 토글할 때마다 목록이 흔들린다
  assert.match(block, /a\.index - b\.index/);
  assert.match(block, /\['노출 중', '숨김', '아카이브'\]\[rank\]/, '왜 이 순서인지 알려주는 라벨이 없다');
  assert.match(admin, /\.sol-group-label \{/);
  // 토글 뒤 재조회 없이 바로 다시 그린다
  const toggle = admin.slice(admin.indexOf('async function toggleSolutionVisibility'), admin.indexOf('function renderSolutionsMenu'));
  assert.match(toggle, /renderSolutionsMenu\(\)/);
});

test('솔루션 조사 서식이 admin 폼·마이그레이션에서 항목을 직접 읽는다', () => {
  // 서식에 항목을 손으로 적으면 화면이 바뀌었을 때 서식만 옛말을 한다.
  const gen = read('scripts/build-solution-survey.py');
  assert.match(gen, /admin\.html/);
  assert.match(gen, /011_slot_taxonomy_and_layer_fixes\.sql/, '슬롯을 손으로 적었다');
  assert.match(gen, /036_assessment_criteria\.sql/, '평가영역을 손으로 적었다');
  assert.match(gen, /simulatorOptionsConfig/);
  // 선택지 목록을 파이썬 쪽에 다시 적지 않았는지
  assert.ok(!/'매우 높음'|'L1 \(/.test(gen), '드롭다운 값을 서식 쪽에 다시 적었다');
  // 엑셀 인라인 목록은 쉼표로 값을 가른다 — 값에 쉼표가 있으면 조용히 쪼개진다
  assert.match(gen, /if any\(',' in c for c in choices\)/);
  // 조사자에게 JSON 을 쓰게 하지 않는다
  assert.match(gen, /평문으로/);
  assert.ok(!/kind":"fqa|"signal":/.test(gen), 'JSON 예시를 조사 서식에 넣었다');
});
