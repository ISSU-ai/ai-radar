'use strict';

const PIPELINE_STAGES = Object.freeze([
  '들어온 데이터',
  'PoC 검증',
  'ISV 조합',
  '딜 사이즈',
  '피치 준비'
]);

const EDITABLE_DEAL_FIELDS = Object.freeze([
  'customer',
  'customer_meta',
  'fqa_scores',
  'fqa_totals',
  'track',
  'isv_combo',
  'packages',
  'stage'
]);

function clampStage(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= PIPELINE_STAGES.length) {
    throw new Error('단계는 0부터 4 사이의 정수여야 합니다.');
  }
  return parsed;
}

function cleanText(value, maxLength, fieldName) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error(`${fieldName}을(를) 입력해주세요.`);
  if (text.length > maxLength) throw new Error(`${fieldName}은(는) ${maxLength}자 이하여야 합니다.`);
  return text;
}

function optionalText(value, maxLength) {
  const text = String(value ?? '').trim();
  return text.slice(0, maxLength);
}

function ensurePlainObject(value, fieldName) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName}은(는) 객체여야 합니다.`);
  }
  return value;
}

function ensureArray(value, fieldName, maxItems = 50) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName}은(는) 배열이어야 합니다.`);
  if (value.length > maxItems) throw new Error(`${fieldName} 항목이 너무 많습니다.`);
  return value;
}

function calculateFqaTotals(items, rawScores) {
  const scores = ensurePlainObject(rawScores, '진단 점수');
  const totals = {};

  for (const item of items) {
    const score = Number(scores[item.no] ?? scores[String(item.no)]);
    if (!Number.isFinite(score) || score < 1 || score > 5) continue;

    const category = item.category;
    const weight = Number(item.weight) || 1;
    const threshold = Number(item.threshold) || 3;
    const bucket = totals[category] || { weighted: 0, weight: 0, answered: 0, threshold };
    bucket.weighted += score * weight;
    bucket.weight += weight;
    bucket.answered += 1;
    bucket.threshold = Math.max(bucket.threshold, threshold);
    totals[category] = bucket;
  }

  return Object.fromEntries(Object.entries(totals).map(([category, bucket]) => {
    const score = bucket.weight ? Number((bucket.weighted / bucket.weight).toFixed(2)) : 0;
    return [category, {
      score,
      threshold: bucket.threshold,
      answered: bucket.answered,
      ready: score >= bucket.threshold
    }];
  }));
}

function inferTrack(customerMeta = {}) {
  const meta = ensurePlainObject(customerMeta, '고객 정보');
  const security = String(meta.securityStack || meta.security || '').toLowerCase();
  const investment = String(meta.investment || meta.budget || '').toLowerCase();
  const needsInfrastructure = Boolean(meta.needsInfrastructure);

  if (security.includes('zscaler')) return 'T-C';
  if (security && !['none', '없음', 'unknown', '미정'].includes(security)) return 'T-D';
  if (needsInfrastructure && !['low', '낮음'].includes(investment)) return 'T-A';
  return 'T-B';
}

function validateLead(input) {
  const body = ensurePlainObject(input, '요청');
  const customerMeta = ensurePlainObject(body.customer_meta, '고객 정보');
  return {
    customer: cleanText(body.customer, 120, '회사명'),
    contact: cleanText(body.contact, 200, '연락처'),
    message: optionalText(body.message, 2000),
    customer_meta: customerMeta,
    fqa_scores: ensurePlainObject(body.fqa_scores, '진단 점수'),
    track: inferTrack(customerMeta)
  };
}

function validateDealCreate(input) {
  const body = ensurePlainObject(input, '요청');
  return {
    customer: cleanText(body.customer, 120, '고객사'),
    customer_meta: ensurePlainObject(body.customer_meta, '고객 정보'),
    source: ['manual', 'sheet'].includes(body.source) ? body.source : 'manual'
  };
}

function normaliseDealPatch(input) {
  const body = ensurePlainObject(input, '요청');
  const patch = {};

  for (const field of EDITABLE_DEAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    if (field === 'customer') patch.customer = cleanText(body.customer, 120, '고객사');
    else if (field === 'customer_meta' || field === 'fqa_scores' || field === 'fqa_totals') {
      patch[field] = ensurePlainObject(body[field], field);
    } else if (field === 'isv_combo' || field === 'packages') {
      patch[field] = ensureArray(body[field], field);
    } else if (field === 'stage') patch.stage = clampStage(body.stage);
    else if (field === 'track') patch.track = body.track ? optionalText(body.track, 20) : null;
  }

  if (!Object.keys(patch).length) throw new Error('저장할 변경사항이 없습니다.');
  return patch;
}

module.exports = {
  PIPELINE_STAGES,
  calculateFqaTotals,
  clampStage,
  inferTrack,
  normaliseDealPatch,
  validateDealCreate,
  validateLead
};
