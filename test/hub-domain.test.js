'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateFqaTotals,
  clampStage,
  inferTrack,
  normaliseDealPatch,
  validateDealCreate,
  validateLead
} = require('../lib/hub-domain');

test('calculateFqaTotals applies weights and readiness threshold', () => {
  const totals = calculateFqaTotals([
    { category: 'A', no: 1, weight: 5, threshold: 3.5 },
    { category: 'A', no: 2, weight: 1, threshold: 3.5 },
    { category: 'B', no: 3, weight: 2, threshold: 3.0 }
  ], { 1: 4, 2: 2, 3: 2.5 });

  assert.deepEqual(totals.A, { score: 3.67, threshold: 3.5, answered: 2, ready: true });
  assert.deepEqual(totals.B, { score: 2.5, threshold: 3, answered: 1, ready: false });
});

test('calculateFqaTotals ignores unanswered and out-of-range values', () => {
  const totals = calculateFqaTotals([
    { category: 'A', no: 1, weight: 1, threshold: 3.5 },
    { category: 'A', no: 2, weight: 1, threshold: 3.5 }
  ], { 1: 6 });
  assert.deepEqual(totals, {});
});

test('진입 시나리오는 구매 동기로 갈린다 — 보안 환경이 아니다', () => {
  // 034. 보안 환경이 같아도 사는 이유가 다르다. 보안 환경은 customer_meta 에 남아
  // 추천 필터가 직접 본다.
  assert.equal(inferTrack({ securityStack: 'zscaler' }), 'E-1', '보안 환경으로 갈리면 안 된다');
  assert.equal(inferTrack({ securityStack: 'other-swg' }), 'E-1');
  assert.equal(inferTrack({}, {}), 'E-1', '응답이 없으면 기본값');

  // B3·T1 이 높으면 API 로 서비스를 만들어 본 조직이다
  assert.equal(inferTrack({}, { B3: 4 }), 'E-3');
  assert.equal(inferTrack({}, { T1: 5 }), 'E-3');
  assert.equal(inferTrack({}, { B3: 3, T1: 3 }), 'E-1', '3점은 아직 아니다');

  // E-2 는 추론하지 않는다 — 42문항에 개발조직 유무를 묻는 문항이 없다
  const inferred = new Set([
    inferTrack({}, {}), inferTrack({}, { B3: 5 }), inferTrack({ securityStack: 'none' }, { T1: 1 })
  ]);
  assert.ok(!inferred.has('E-2'), '없는 근거로 E-2 를 만들면 엉뚱한 제안이 나간다');
});

test('validateLead normalises public input and blocks missing contact', () => {
  // 027 로 담당자 이름·전화번호가 필수가 됐다. 둘 다 개인정보라 customer_meta 가
  // 아니라 별도 필드로 나온다 — leads 컬럼으로 저장돼 동의 이력과 같은 자리에 있는다.
  assert.deepEqual(validateLead({
    customer: '  A사\n 본사 ',
    contact: ' owner@example.com ',
    contact_name: ' 김 담당 ',
    contact_phone: ' 02-1234-5678 ',
    consent: true,
    customer_meta: { securityStack: 'zscaler' },
    fqa_scores: { 1: 4 }
  }), {
    customer: 'A사 본사',
    contact: 'owner@example.com',
    contact_name: '김 담당',
    contact_phone: '02-1234-5678',
    // 045 로 직함이 붙었다. 개인정보라 같은 자리(leads)로 가되 **필수는 아니다** —
    // 이것 때문에 폼을 못 내면 리드를 통째로 잃는다.
    contact_title: '',
    message: '',
    customer_meta: { securityStack: 'zscaler' },
    fqa_scores: { 1: 4 },
    // 031 로 42문항 응답도 리드에 실린다. 안 보내면 빈 객체로 지나간다.
    readiness_scores: {},
    track: 'E-1',
    consent: true,
    // 046 — 판정이 아니라 신호다. 이 입력은 걸릴 게 없다.
    spam_signals: []
  });

  const complete = {
    customer: 'A사', contact: 'a@example.com',
    contact_name: '김담당', contact_phone: '02-1234-5678', consent: true
  };
  assert.throws(() => validateLead({ ...complete, contact: undefined }), /이메일/);
  assert.throws(() => validateLead({ ...complete, contact_name: undefined }), /담당자 이름/);
  assert.throws(() => validateLead({ ...complete, contact_phone: undefined }), /전화번호/);
  // 직함은 없어도 접수된다
  assert.equal(validateLead({ ...complete, contact_title: undefined }).contact_title, '');
  assert.equal(validateLead({ ...complete, contact_title: ' 상무 ' }).contact_title, '상무');
  assert.throws(() => validateLead({ ...complete, consent: undefined }), /동의/);
});

test('deal validation permits only known patch shapes', () => {
  assert.deepEqual(validateDealCreate({ customer: ' A사 ', source: 'sheet' }), {
    customer: 'A사', customer_meta: {}, source: 'sheet'
  });
  assert.deepEqual(normaliseDealPatch({ stage: 4, isv_combo: ['one'] }), {
    stage: 4, isv_combo: ['one']
  });
  assert.equal(clampStage(0), 0);
  // 051 이 「배포 인계」를 6번째 단계로 넣었다. 범위는 PIPELINE_STAGES 를 따라간다.
  assert.throws(() => normaliseDealPatch({ stage: 6 }), /0부터 5/);
  assert.throws(() => normaliseDealPatch({ owner_id: 'not-allowed' }), /변경사항/);
  assert.throws(() => normaliseDealPatch({ fqa_totals: { '<img src=x>': { score: 5 } } }), /변경사항/);
});
