'use strict';

/**
 * 리드 스팸 신호(046).
 *
 * 여기서 잡으려는 것은 **거짓 양성**이다. 진짜 고객이 걸리면 그 리드를 잃는다.
 * 반대로 놓치는 것은 영업이 목록에서 보고 지우면 된다(041) — 비용이 다르다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { detectSpamSignals, validateLead } = require('../lib/hub-domain');

const codes = (input) => detectSpamSignals(input).map((s) => s.code).sort();

test('진짜 고객을 걸러내지 않는다', () => {
  // 거짓 양성이 이 기능의 유일한 실패 방식이다.
  assert.deepEqual(codes({
    customer: '한빛금융', contact: 'kim@hanbit.co.kr',
    contact_name: '김디지털', contact_phone: '02-3456-7890'
  }), []);
  assert.deepEqual(codes({
    customer: 'AB180', contact: 'ceo@ab180.co', contact_name: '이대표', contact_phone: '010-2345-6789'
  }), [], '짧은 회사명·짧은 도메인은 신호가 아니다');
  // 빈 입력에 신호를 만들지 않는다 — 필수 검증은 validateLead 의 일이다
  assert.deepEqual(codes({}), []);
});

test('개인 메일은 신호일 뿐 스팸이 아니다', () => {
  // 1인 기업과 소상공인은 정말 gmail 을 쓴다.
  assert.deepEqual(codes({
    customer: '온누리컨설팅', contact: 'ceo@gmail.com',
    contact_name: '박대표', contact_phone: '010-2345-6789'
  }), ['personal_mail']);
  // 일회용은 신호가 더 세다 — 응답을 받을 생각이 없다는 뜻이다
  assert.ok(codes({ contact: 'x@mailinator.com' }).includes('disposable_mail'));
  // 둘을 같이 매기지 않는다
  assert.equal(codes({ contact: 'x@mailinator.com' }).filter((c) => c === 'personal_mail').length, 0);
});

test('테스트 입력을 잡는다', () => {
  const found = codes({
    customer: 'test', contact: 'a@mailinator.com', contact_name: 'asdf', contact_phone: '010-0000-0000'
  });
  assert.deepEqual(found, ['disposable_mail', 'generic_customer', 'generic_name', 'placeholder_phone']);
  assert.ok(codes({ customer: 'ㅁㅁㅁ' }).includes('generic_customer'));
  assert.ok(codes({ customer: '테스트' }).includes('generic_customer'));
});

test('신호는 점수가 아니라 목록이다', () => {
  // "스팸 점수 0.7" 만 보면 왜 걸렸는지 모르고, 모르면 기준을 못 고친다.
  const signals = detectSpamSignals({ customer: 'test', contact: 'a@gmail.com' });
  assert.ok(Array.isArray(signals));
  for (const signal of signals) {
    assert.ok(signal.code && signal.label, '코드와 설명이 있어야 한다');
    assert.equal(typeof signal.hit, 'string', '무엇이 걸렸는지 남아야 한다');
  }
  const domain = read('lib/hub-domain.js');
  assert.ok(!/spam_score|spamScore/.test(domain), '점수 하나로 뭉쳤다');
});

test('접수를 막지 않는다', () => {
  // 자동으로 버리면 진짜 고객을 잃는다. 삭제는 사람이 한다(041).
  const lead = validateLead({
    customer: 'test', contact: 'a@mailinator.com', contact_name: 'asdf',
    contact_phone: '010-0000-0000', consent: true
  });
  assert.equal(lead.customer, 'test', '신호가 있어도 리드는 정상 생성된다');
  assert.equal(lead.spam_signals.length, 4);

  const routes = read('routes/hub.js');
  const block = routes.slice(routes.indexOf("router.post('/public/leads'"), routes.indexOf('await client.query(\'commit\')'));
  assert.ok(!/spam_signals[\s\S]{0,80}(return|throw|status\(4)/.test(block), '신호로 접수를 막는다');
  assert.match(block, /leadColumns\.push\('spam_signals'\)/);
  assert.match(block, /hasColumn\('leads', 'spam_signals'\)/);
});

test('목록에는 개수만, 상세에 목록을 준다', () => {
  const routes = read('routes/hub.js');
  const list = routes.slice(routes.indexOf("router.get('/deals'"), routes.indexOf("router.post('/deals'"));
  // 목록은 소유자 게이트가 없어 전 직원이 본다 — 걸린 값까지 보낼 이유가 없다
  assert.match(list, /jsonb_array_length\(l\.spam_signals\)/);
  assert.ok(!/l\.spam_signals as|lead_spam_signals/.test(list), '목록에 신호 내용이 실렸다');
  assert.match(list, /spam_count/);

  const hub = read('hub.js');
  assert.match(hub, /class="spam-tag">확인 필요 \$\{deal\.spam_count\}/);
  // 왜 걸렸는지는 딜을 열면 본다
  assert.match(hub, /function spamSignalMarkup/);
  assert.match(hub, /자동 감지라 틀릴 수 있습니다/, '틀릴 수 있다고 말해야 사람이 판단한다');
  assert.match(read('hub.css'), /\.spam-tag/);
});

test('046 은 소급 판정하지 않는다', () => {
  const sql = read('db/migrations/046_lead_spam_signals.sql');
  const body = sql.split('-- 확인')[0];
  assert.match(body, /add column if not exists spam_signals jsonb not null default '\[\]'::jsonb/);
  // 접수 시점의 판정이라 옛 건을 지금 규칙으로 다시 매기면 뜻이 달라진다
  assert.ok(!/^\s*update leads/im.test(body), '기존 리드를 소급 판정한다');
  assert.match(read('scripts/apply-migrations.js'), /'046_lead_spam_signals\.sql'/);
});
