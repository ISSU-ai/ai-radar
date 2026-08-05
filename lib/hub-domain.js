'use strict';

const PIPELINE_STAGES = Object.freeze([
  '들어온 데이터',
  'AI 준비도 진단',
  'ISV 조합 추천',
  '딜 사이즈',
  '피치 준비'
]);

const EDITABLE_DEAL_FIELDS = Object.freeze([
  'customer',
  'customer_meta',
  // 평가영역(036). 037 bridge 가 8개를 채우고 나머지는 영업이 확인해 넣는다.
  'assessment_scores',
  // 42문항. 포탈로 들어온 딜에는 고객 응답이 들어 있고, 수동·시트 딜은 비어 있어
  // 영업이 채운다. 고객 원본은 readiness_customer_scores 에 따로 남는다(032).
  'readiness_scores',
  // 42문항으로 못 채우는 전제조건을 영업이 후보 옆에서 확인한 결과 (010).
  'prereq_confirmations',
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

/**
 * 전화번호. 공백만 정리하고 자릿수로만 판정한다.
 *
 * 형식을 강제하지 않는 이유: "02-1234-5678 (내선 301)" · "+82 10-1234-5678" 처럼
 * 정상인데 모양이 제각각인 입력이 흔하다. 패턴을 잡으면 그런 번호를 거절해 **리드를
 * 통째로 잃는다.** 리드 폼에서 하나 잃는 비용이 모양이 지저분한 번호를 받는 비용보다
 * 크다. 허용 문자를 걸러내는 방식도 써 봤는데 "내선" 이 지워져 "( 301)" 이 남았다 —
 * 지우는 것보다 그대로 두는 편이 낫다.
 *
 * 값은 파라미터 바인딩으로 저장되고 화면에서 escapeHtml 을 거치므로 그대로 둬도 안전하다.
 */
function cleanPhone(value, fieldName) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error(`${fieldName}을(를) 입력해주세요.`);
  const digits = text.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    throw new Error(`${fieldName} 형식을 확인해주세요. 숫자 8~15자리가 필요합니다.`);
  }
  return text.slice(0, 60);
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

/**
 * 고객 진입 시나리오 (기획안 §7 · 034).
 *
 * 예전에는 보안 환경(Zscaler 유무)으로 갈랐다. 그건 기술 제약이지 **구매 동기**가
 * 아니다. 보안 환경이 같아도 사는 이유는 다르고, 무엇을 먼저 팔지는 후자에서 갈린다.
 * 보안 환경은 customer_meta.securityStack 에 그대로 남아 추천 필터가 직접 본다.
 *
 * 42문항으로는 **E-1 과 E-3 만 가른다.**
 *   E-3 서비스 개발형 — B3(AI 가 사내 시스템에 직접 접근해 처리)·T1(개발→배포 자동화)이
 *       이미 높다는 것은 API 로 서비스를 만들어 본 조직이라는 뜻이다
 *   E-2 개발 생산성형 — 42문항에 **개발조직 유무를 묻는 문항이 없다.** 억지로 추론하면
 *       엉뚱한 제안이 나간다. 영업이 STEP02 에서 고른다
 * 응답이 없으면 E-1 이다. 초기값일 뿐이고 최종 선택은 영업이 한다.
 */
function inferTrack(customerMeta = {}, readinessScores = {}) {
  ensurePlainObject(customerMeta, '고객 정보');
  const scores = ensurePlainObject(readinessScores, '준비도 응답');
  const high = (code) => Number(scores[code]) >= 4;
  return (high('B3') || high('T1')) ? 'E-3' : 'E-1';
}

function validateLead(input) {
  const body = ensurePlainObject(input, '요청');
  const customerMeta = ensurePlainObject(body.customer_meta, '고객 정보');
  if (body.consent !== true) {
    throw new Error('개인정보 수집·이용에 동의해주세요.');
  }
  return {
    customer: cleanText(body.customer, 120, '회사명'),
    contact: cleanText(body.contact, 200, '이메일'),
    // 개인정보라 leads 에 컬럼으로 들어간다(027). customer_meta 로 보내지 않는다 —
    // 거기 두면 deals 로 흘러가 어디까지 퍼졌는지 추적할 수 없다.
    contact_name: cleanText(body.contact_name, 60, '담당자 이름'),
    contact_phone: cleanPhone(body.contact_phone, '전화번호'),
    message: optionalText(body.message, 2000),
    customer_meta: customerMeta,
    fqa_scores: ensurePlainObject(body.fqa_scores, '진단 점수'),
    // 42문항 응답. 채점과 21문항 채우기는 서버가 한다(030 bridge).
    readiness_scores: ensurePlainObject(body.readiness_scores, '준비도 응답'),
    track: inferTrack(customerMeta, body.readiness_scores),
    consent: true
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
    else if (['customer_meta', 'assessment_scores', 'readiness_scores', 'prereq_confirmations'].includes(field)) {
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
  cleanPhone,
  clampStage,
  inferTrack,
  normaliseDealPatch,
  validateDealCreate,
  validateLead
};
