'use strict';

/**
 * 접수 자동 회신 — 결과 링크(044)와 발송 지점.
 *
 * 여기서 잡으려는 것은 **고객 쪽으로 새는 것**과 **접수를 막는 것** 둘이다.
 *   · 결과 링크는 인증 없이 열린다 → 담당자 이름·전화·이메일이 실리면 안 된다
 *   · 메일이 안 나가도 접수는 성공해야 한다 → 발송이 예외를 던지면 안 된다
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const routes = read('routes/hub.js');
const serverSrc = read('server.js');
const notifySrc = read('lib/notify.js');
const migration = read('db/migrations/044_lead_result_token.sql');
const mock = read('scripts/mock-ui-server.js');
const readinessJs = read('readiness.js');

const { buildLeadReceipt, sendLeadReceipt, mailEnabled, absolute } = require('../lib/notify');

const SAMPLE = {
  average: 2.67,
  maturity: { level: 2, name: '준비', note: '일부 시도 중' },
  priorities: [{ name: '데이터 기반', score: 2.14, items: [{ fix: '세 종류부터 한곳에 모읍니다.' }] }]
};

test('메일이 안 나가도 접수는 성공한다', async () => {
  // 고객은 이미 폼을 냈다. 우리 발송 실패를 고객 화면에서 볼 이유가 없다.
  assert.equal(mailEnabled(), false, '테스트 환경에 발송 env 가 켜져 있다');
  const result = await sendLeadReceipt({
    lead: { customer: 'A사', contact: 'a@b.co' }, readiness: SAMPLE, resultPath: '/r/x'
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'disabled');
  // 연락처가 없어도 던지지 않는다
  assert.deepEqual(await sendLeadReceipt({ lead: {}, readiness: null }), { sent: false, reason: 'no_contact' });
  // 부르는 쪽이 void 로 부른다 — 응답을 막지 않는다
  assert.match(routes, /void sendLeadReceipt\(/);
  // slackNotify 와 같은 규약이다
  assert.match(notifySrc, /env 가 없으면 조용히 no-op/);
});

test('메일 본문에 결과 링크와 처방이 들어간다', () => {
  const mail = buildLeadReceipt({ customer: '한빛금융', readiness: SAMPLE, resultUrl: 'https://x.test/r/abc' });
  assert.match(mail.subject, /한빛금융/);
  assert.match(mail.text, /2\.67 \/ 5\.00/);
  assert.match(mail.text, /세 종류부터 한곳에 모읍니다\./, '처방이 빠지면 요약만 남는다');
  assert.match(mail.text, /https:\/\/x\.test\/r\/abc/);
  assert.match(mail.html, /href="https:\/\/x\.test\/r\/abc"/);
  // 리포트를 통째로 넣지 않는다 — 긴 메일은 안 읽힌다
  assert.ok(mail.text.length < 1200, `본문이 ${mail.text.length}자다`);
  // 서버가 PDF 를 만들지 않으므로 첨부를 약속하지 않는다
  assert.ok(!/첨부/.test(mail.text));
  assert.match(mail.text, /PDF·Word 로 내려받을 수 있습니다/);
  // 상대 경로는 메일에서 안 열린다
  assert.match(absolute('/r/abc'), /^https?:\/\/.+\/r\/abc$/);
});

test('결과 링크에 개인정보를 싣지 않는다', () => {
  // 인증 없이 열리는 주소다.
  const block = routes.slice(routes.indexOf("router.get('/public/result/:token'"),
    routes.indexOf("router.post('/public/leads'"));
  assert.match(block, /select l\.customer/);
  for (const field of ['l.contact', 'contact_name', 'contact_phone', 'l.message']) {
    assert.ok(!block.includes(field), `결과 응답에 ${field} 가 실렸다`);
  }
  // 영업이 고친 점수가 아니라 고객 원본으로 다시 채점한다(032)
  assert.match(block, /d\.readiness_customer_scores as scores/);
  assert.ok(!/d\.readiness_scores\b/.test(block), '영업이 고친 값을 고객에게 보여준다');
  // 유효기간은 보유기간과 같다
  assert.match(block, /interval '1 year'/);
  assert.match(block, /410/, '만료와 없음을 가르지 않으면 고객이 할 일을 모른다');
  // 토큰 모양을 먼저 본다 — 아무 문자열로 DB 를 두드리게 두지 않는다
  assert.match(block, /\^\[0-9a-f-\]\{36\}\$/i);
  assert.match(block, /hasColumn\('leads', 'result_token'\)/);
});

test('결과 링크는 색인되지 않고 서페이스 게이트를 통과한다', () => {
  assert.match(serverSrc, /'Disallow: \/r\/'/, '특정 고객의 진단 결과가 색인된다');
  // ⚠ 이걸 빠뜨리면 로컬(all)에서는 멀쩡하고 프로덕션에서만 404 다
  const gate = serverSrc.slice(serverSrc.indexOf('const allowed = {'), serverSrc.indexOf('hub: commonPath'));
  for (const p of ["'/readiness'", "'/r/'", "'/report.js'", "'/taxonomy.js'"]) {
    assert.ok(gate.includes(p), `APP_SURFACE offering 분기에 ${p} 가 없다`);
  }
  assert.match(serverSrc, /app\.get\('\/r\/:token', sendFrontendFile\('readiness\.html'\)\)/,
    '결과 페이지를 따로 만들면 고객이 받은 링크와 방금 푼 결과가 갈라진다');
});

test('044 는 다시 돌려도 안전하고 토큰이 겹치지 않는다', () => {
  const body = migration.split('-- 확인')[0];
  assert.match(body, /add column if not exists result_token uuid not null default gen_random_uuid\(\)/);
  assert.match(body, /create unique index if not exists/, '토큰이 겹치면 남의 결과가 열린다');
  assert.ok(!/^\s*(insert|delete|drop)/im.test(body), '행을 만들거나 지운다');
  assert.match(read('scripts/apply-migrations.js'), /'044_lead_result_token\.sql'/);
});

test('결과 링크 화면은 진단 화면을 재사용한다', () => {
  assert.match(readinessJs, /function initResultLink/);
  assert.match(readinessJs, /pathname\.match\(\/\^\\\/r\\\/\(\[0-9a-fA-F-\]\{36\}\)/);
  // 문항·상담 폼을 숨긴다 — 이미 낸 사람이다
  assert.match(readinessJs, /\['#intro', '#assessment', '#contact'\]/);
  assert.match(readinessJs, /rd-result-only/);
  assert.match(read('readiness.css'), /body\.rd-result-only/);
  // 목업도 같은 규칙이라야 로컬 확인이 거짓말을 안 한다
  assert.match(mock, /app\.get\('\/api\/hub\/public\/result\/:token'/);
  assert.match(mock, /readiness_scores/);
  const mockBlock = mock.slice(mock.indexOf("app.get('/api/hub/public/result/:token'"));
  assert.ok(!/contact_name|contact_phone/.test(mockBlock.slice(0, 1400)), '목업이 개인정보를 준다');
});
