'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  STATUS, STATUS_LABEL, evidenceOf, readinessEvidence, buildHandoffSnapshot, summariseSnapshot
} = require('../lib/handoff-snapshot');
const { EDITABLE_DEAL_FIELDS } = require('../lib/hub-domain');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const ITEMS = [{ code: 'S1', text: '경영진 방향' }, { code: 'D2', text: '데이터 품질' },
  { code: 'G3', text: '망분리 환경' }];

test('상태 어휘가 Deployment Brief §B 원문과 같다', () => {
  // 인계받는 쪽이 두 문서를 나란히 놓고 본다. 말이 갈리면 같은 것을 다르게 읽는다.
  assert.equal(STATUS_LABEL.confirmed, '확인됨');
  assert.equal(STATUS_LABEL.likely, '가능성 높음');
  assert.equal(STATUS_LABEL.open, '미해결');
  // 넷째는 우리 것이다 — 049 이전 딜은 셋 중 어느 것도 말할 수 없다.
  assert.equal(STATUS_LABEL.unknown, '구분 불가');
});

test('원본이 없으면 값이 있어도 「확인됨」이 아니다', () => {
  // 049 이전 딜. 지금 값을 원본이라고 치면 **틀린 것을 확인됨으로 만든다** —
  // 인계에서 가장 비싼 실수다.
  assert.deepEqual(evidenceOf('금융', undefined, false), { status: STATUS.UNKNOWN, source: 'sales' });
  assert.deepEqual(evidenceOf('', undefined, false), { status: STATUS.OPEN, source: 'none' });
});

test('원본과 같으면 확인됨, 다르면 가능성 높음', () => {
  assert.equal(evidenceOf('금융', '금융', true).status, STATUS.CONFIRMED);
  assert.equal(evidenceOf('금융', '금융', true).source, 'customer');
  assert.equal(evidenceOf('제조', '금융', true).status, STATUS.LIKELY);
  assert.equal(evidenceOf('제조', '금융', true).source, 'sales');
  // 고객은 안 냈는데 영업이 채웠다
  assert.equal(evidenceOf('제조', '', true).status, STATUS.LIKELY);
  // 아무도 안 냈다
  assert.equal(evidenceOf('', '', true).status, STATUS.OPEN);
});

test('영업이 손댄 문항을 코드가 아니라 이름으로 뽑는다', () => {
  // 개수만 세면 인계받은 사람이 **어디를 다시 물어야 하는지** 모른다.
  const ev = readinessEvidence({
    customerScores: { S1: 3, D2: 2, G3: 4 },
    salesScores: { S1: 3, D2: 4, G3: 4 },
    items: ITEMS
  });
  assert.equal(ev.comparable, true);
  assert.deepEqual(ev.edited, [{ code: 'D2', text: '데이터 품질', from: 2, to: 4 }]);
  assert.deepEqual(ev.confirmed.map((x) => x.code), ['G3', 'S1']);
  assert.deepEqual(ev.open, []);
});

test('영업이 지운 문항도 손댄 것으로 센다', () => {
  // before=2, after=없음. 예전에는 이게 「확인됨」으로 새어 들어갔다.
  const ev = readinessEvidence({
    customerScores: { S1: 3, D2: 2 }, salesScores: { S1: 3 }, items: ITEMS
  });
  assert.deepEqual(ev.edited, [{ code: 'D2', text: '데이터 품질', from: 2, to: null }]);
  assert.ok(!ev.confirmed.some((x) => x.code === 'D2'), '지운 문항이 확인됨에 들어가면 안 된다');
});

test('032 이전 딜은 42문항도 판정하지 않는다', () => {
  const ev = readinessEvidence({ customerScores: {}, salesScores: { S1: 3, D2: 4 }, items: ITEMS });
  assert.equal(ev.comparable, false);
  assert.deepEqual(ev.confirmed, [], '원본이 없는데 확인됨이라고 말하면 안 된다');
  assert.deepEqual(ev.edited, [], '무엇을 고쳤는지도 알 수 없다');
  // 아무도 안 답한 문항은 원본이 없어도 확실히 말할 수 있다.
  assert.deepEqual(ev.open.map((x) => x.code), ['G3']);
});

test('포탈 딜의 고객사명은 확인됨, 영업이 만든 딜은 가능성 높음', () => {
  const portal = buildHandoffSnapshot({ deal: { customer: '한빛금융', source: 'portal' } });
  assert.equal(portal.fields[0].status, STATUS.CONFIRMED);
  const manual = buildHandoffSnapshot({ deal: { customer: '한빛금융', source: 'manual' } });
  assert.equal(manual.fields[0].status, STATUS.LIKELY);
});

test('빈 원본 객체와 원본 없음을 가른다', () => {
  // 049 이후 접수분은 customer_meta 가 비어 있어도 「원본이 있다」가 맞다.
  const after = buildHandoffSnapshot({
    deal: { customer: 'A', customer_meta: { industry: '제조' }, customer_meta_original: {} }
  });
  assert.equal(after.fields.find((f) => f.key === 'industry').status, STATUS.LIKELY);
  const before = buildHandoffSnapshot({
    deal: { customer: 'A', customer_meta: { industry: '제조' } }   // 049 이전 — null
  });
  assert.equal(before.fields.find((f) => f.key === 'industry').status, STATUS.UNKNOWN);
});

test('포탈 원본 연락처를 문서로 복사하지 않는다', () => {
  // leads 의 개인정보는 동의와 같은 표에 둔다(027). 인계 문서는 사람 손을 여러 번 타는데
  // 거기 실으면 동의 범위 밖으로 복사된다. 영업이 확인한 담당자만 싣는다.
  const snapshot = buildHandoffSnapshot({
    deal: {
      customer: 'A', source: 'portal',
      lead_contact_name: '김고객', lead_contact_phone: '02-1111-2222', lead_contact: 'a@corp.co.kr',
      customer_contact_name: '박확인', customer_contact_title: '팀장'
    }
  });
  const dump = JSON.stringify(snapshot);
  for (const leaked of ['김고객', '02-1111-2222', 'a@corp.co.kr']) {
    assert.ok(!dump.includes(leaked), `포탈 원본 ${leaked} 이 스냅샷에 실렸다`);
  }
  assert.ok(dump.includes('박확인'), '영업이 확인한 담당자는 실린다');
});

test('상업 정보와 내부 판단을 부르지 않는다', () => {
  // 구축 담당이 쓸 일이 없다. 「지우는 게 아니라 안 부른다」 — 소스에 그 필드 이름이
  // 아예 없어야 한다(주석은 걷어내고 본다).
  const code = read('lib/handoff-snapshot.js')
    .split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .join('\n');
  for (const field of ['unit_price', 'list_price', 'opinion', 'mzc_sales', 'sections_internal']) {
    assert.ok(!code.includes(field), `${field} 를 읽고 있다`);
  }
});

test('원본 컬럼은 PATCH 로 못 고친다', () => {
  // 고칠 수 있으면 「원본」이라는 말이 거짓이 된다.
  for (const field of ['customer_meta_original', 'readiness_customer_scores']) {
    assert.ok(!EDITABLE_DEAL_FIELDS.includes(field), `${field} 가 편집 허용목록에 있다`);
  }
  // 목업도 같은 허용목록을 거쳐야 한다 — 안 그러면 로컬에서만 원본이 덮어써진다.
  const mock = read('scripts/mock-ui-server.js');
  // 목업은 실서버와 **같은 함수**를 쓴다. 허용목록만 흉내 내면 그 안의 검증이
  // 로컬에서만 빠져 "저장됐는데 서버에서는 튕기는" 상태가 된다.
  assert.ok(mock.includes('patch = normaliseDealPatch(req.body)'),
    '목업 PATCH 가 실서버 검증을 안 거친다');
});

test('접수 때 원본을 얼리고 hasColumn 으로 가린다', () => {
  const routes = read('routes/hub.js');
  assert.ok(routes.includes("hasColumn('deals', 'customer_meta_original')"),
    '049 미적용 구간에 접수가 통째로 실패한다');
  // 목업도 같이 얼려야 로컬에서 근거 상태를 볼 수 있다.
  assert.ok(read('scripts/mock-ui-server.js').includes('customer_meta_original:'),
    '목업이 원본을 안 얼린다');
});

test('049 는 소급해서 채우지 않는다', () => {
  const sql = read('db/migrations/049_deal_customer_meta_original.sql');
  assert.ok(sql.includes('add column if not exists customer_meta_original'));
  // 기존 딜의 지금 값은 영업이 고친 뒤일 수 있다. 원본이라고 적으면 거짓말이 된다.
  assert.ok(!/^\s*update\s+deals\s+set\s+customer_meta_original/im.test(sql),
    '소급 백필이 있으면 틀린 것을 「확인됨」으로 만든다');
});

test('집계가 상태별 개수를 낸다', () => {
  const snapshot = buildHandoffSnapshot({
    deal: {
      customer: 'A', source: 'portal',
      customer_meta: { industry: '금융', companySize: '1000+' },
      customer_meta_original: { industry: '금융' }
    }
  });
  const counts = summariseSnapshot(snapshot);
  assert.equal(counts.confirmed, 2, '고객사명 + 업종');
  assert.equal(counts.likely, 1, '영업이 채운 조직 규모');
  assert.ok(counts.open >= 4, '나머지는 미해결');
  assert.equal(counts.unknown, 0, '원본이 있으므로 구분 불가가 없다');
});
