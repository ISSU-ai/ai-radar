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

test('inferTrack keeps internal classification deterministic', () => {
  assert.equal(inferTrack({ securityStack: 'zscaler' }), 'T-C');
  assert.equal(inferTrack({ securityStack: 'other-swg' }), 'T-D');
  assert.equal(inferTrack({ securityStack: 'none', needsInfrastructure: true, investment: 'high' }), 'T-A');
  assert.equal(inferTrack({ securityStack: 'none', investment: 'low' }), 'T-B');
});

test('validateLead normalises public input and blocks missing contact', () => {
  assert.deepEqual(validateLead({
    customer: '  A사\n 본사 ',
    contact: ' owner@example.com ',
    consent: true,
    customer_meta: { securityStack: 'zscaler' },
    fqa_scores: { 1: 4 }
  }), {
    customer: 'A사 본사',
    contact: 'owner@example.com',
    message: '',
    customer_meta: { securityStack: 'zscaler' },
    fqa_scores: { 1: 4 },
    track: 'T-C',
    consent: true
  });
  assert.throws(() => validateLead({ customer: 'A사', consent: true }), /연락처/);
  assert.throws(() => validateLead({ customer: 'A사', contact: 'a@example.com' }), /동의/);
});

test('deal validation permits only known patch shapes', () => {
  assert.deepEqual(validateDealCreate({ customer: ' A사 ', source: 'sheet' }), {
    customer: 'A사', customer_meta: {}, source: 'sheet'
  });
  assert.deepEqual(normaliseDealPatch({ stage: 4, isv_combo: ['one'] }), {
    stage: 4, isv_combo: ['one']
  });
  assert.equal(clampStage(0), 0);
  assert.throws(() => normaliseDealPatch({ stage: 5 }), /0부터 4/);
  assert.throws(() => normaliseDealPatch({ owner_id: 'not-allowed' }), /변경사항/);
  assert.throws(() => normaliseDealPatch({ fqa_totals: { '<img src=x>': { score: 5 } } }), /변경사항/);
});
