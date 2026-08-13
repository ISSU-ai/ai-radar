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
  'stage',
  // ── 041 딜 확장 ──────────────────────────────────────────────
  // 담당 코어세일즈와 MSP 진행 여부. MSP 고객을 먼저 치기 위한 우선순위 신호다.
  'mzc_sales',
  'msp_status',
  // 문의가 들어온 날. 단계 정체(F/U) 판정의 기준값.
  'inquiry_date',
  // 고객 담당자 — **개인정보**. leads(고객이 동의와 함께 남긴 원본)와 다른 출처로,
  // 영업이 미팅에서 확인한 값이다. 목록 API 에 싣지 않고 딜 삭제 시 함께 지운다.
  'customer_contact_name',
  'customer_contact_dept',
  'customer_contact_title',
  'customer_contact_email',
  // 고객이 문의한 제품. isv_combo(우리가 제안한 조합)와 다르다 — 문의 ≠ 제안.
  'inquiry_products'
]);

/**
 * 서버만 쓰는 딜 컬럼. **화이트리스트에 넣으면 안 된다.**
 *
 * stage_changed_at 이 화면에서 고쳐지면 정체 시계를 되돌릴 수 있고,
 * deleted_at 이 고쳐지면 지운 딜이 되살아난다. 목록 삼아 적어 두고 검사로 건다.
 */
const SERVER_OWNED_DEAL_FIELDS = Object.freeze(['stage_changed_at', 'deleted_at', 'deleted_by']);

const MSP_STATUSES = Object.freeze(['yes', 'no', 'unknown']);

/**
 * MSP 진행 여부. boolean 이 아닌 이유는 **모르는 것을 「아님」으로 읽으면 안 되기**
 * 때문이다. `if (deal.msp)` 한 줄에서 「확인 필요」가 「미운영」이 되면 MSP 고객을
 * 우선순위에서 놓치는데, 그게 이 필드가 잡으려던 실패 그 자체다.
 */
function normaliseMspStatus(value) {
  const text = String(value ?? '').trim() || 'unknown';
  if (!MSP_STATUSES.includes(text)) {
    throw new Error(`MSP 여부는 ${MSP_STATUSES.join(' · ')} 중 하나여야 합니다.`);
  }
  return text;
}

/**
 * 달력 입력(YYYY-MM-DD)만 받는다. 빈 값은 null — 「모른다」를 오늘로 때우지 않는다.
 *
 * Date 로 파싱해 되돌리지 않는 이유: 시간대가 끼면 하루가 밀린다. 문자열 그대로
 * 저장하고 실재 날짜인지만 확인한다(2026-02-31 같은 값을 거른다).
 */
/** 날짜 한 칸. 형식이 어긋나면 저장하지 않는다 — 잘못 들어간 날짜는 되짚을 때 거짓말을 한다. */
function normaliseDate(value, fieldName) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  }
  const [y, m, d] = text.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`${fieldName}이(가) 실제 날짜가 아닙니다.`);
  }
  return text;
}

/**
 * 회의록(050). **본문을 다듬지 않는다** — 붙여넣은 그대로 둔다.
 * 앞뒤 공백만 떼고, 줄바꿈·들여쓰기는 원문이라 손대지 않는다. 여기서 정규화하면
 * 나중에 발췌한 인용이 원문과 안 맞는다.
 *
 * 참석자 칸은 없다. 만드는 순간 개인정보 「수집」이 되고 고지 대상이 된다.
 */
const MEETING_NOTE_KINDS = new Set(['meeting', 'call', 'mail', 'visit']);
const MEETING_NOTE_LIMIT = 40000;

function validateMeetingNote(input) {
  const body = ensurePlainObject(input, '요청');
  const text = String(body.body ?? '').trim();
  if (!text) throw new Error('회의록 내용을 입력해주세요.');
  if (text.length > MEETING_NOTE_LIMIT) {
    throw new Error(`회의록은 ${MEETING_NOTE_LIMIT.toLocaleString('en-US')}자 이하여야 합니다.`);
  }
  const kind = String(body.kind ?? 'meeting').trim() || 'meeting';
  if (!MEETING_NOTE_KINDS.has(kind)) throw new Error('회의록 종류가 올바르지 않습니다.');
  return {
    met_on: normaliseDate(body.met_on, '미팅 일자'),
    kind,
    title: optionalText(body.title, 120) || null,
    body: text
  };
}

function normaliseInquiryDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('문의 유입 시점은 YYYY-MM-DD 형식이어야 합니다.');
  }
  const [y, m, d] = text.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error('문의 유입 시점이 실제 날짜가 아닙니다.');
  }
  return text;
}

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

/**
 * 스팸 의심 신호. **막지 않고 표시만 한다.**
 *
 * 자동으로 버리면 진짜 고객을 잃는다. 소상공인은 정말 gmail 을 쓰고, 회사 이름이
 * 짧은 곳도 있다. 그래서 판정이 아니라 **신호**를 낸다 — 영업이 목록에서 보고
 * 직접 고른다(041 딜 삭제).
 *
 * 이 시스템은 42문항 게이트가 이미 가장 강한 필터다(requireReadinessScores).
 * 42문항을 끝까지 답한 사람은 구조적으로 고관여라, 여기서는 그 앞단의 노이즈만
 * 본다. 기준을 느슨하게 잡는다 — 걸러내는 것보다 놓치는 게 낫다.
 *
 * 점수 하나로 합치지 않는다. 왜 걸렸는지 못 보면 나중에 기준을 못 고친다.
 */
const GENERIC_NAMES = Object.freeze([
  'test', 'testing', 'tester', 'demo', 'sample', 'example', 'temp', 'dummy',
  'asdf', 'qwer', 'qwerty', 'abcd', 'aaaa', '1234', 'none', 'null', 'undefined',
  '테스트', '테스트회사', '샘플', '없음', 'ㅁㄴㅇㄹ', 'ㅁㅁㅁ'
]);

/** 무료·개인 메일. **스팸이 아니다** — 1인 기업과 소상공인은 정말 이걸 쓴다. 신호일 뿐이다. */
const PERSONAL_MAIL_DOMAINS = Object.freeze([
  'gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'nate.com', 'kakao.com',
  'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me'
]);

/** 일회용 메일. 이건 응답을 받을 생각이 없다는 뜻이라 신호가 세다. */
const DISPOSABLE_MAIL_DOMAINS = Object.freeze([
  'mailinator.com', 'tempmail.com', 'temp-mail.org', '10minutemail.com',
  'guerrillamail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'throwawaymail.com', 'maildrop.cc'
]);

function detectSpamSignals({ customer, contact, contact_name: contactName, contact_phone: contactPhone }) {
  const signals = [];
  const add = (code, label, hit) => signals.push({ code, label, hit: String(hit || '').slice(0, 60) });

  const name = String(customer || '').trim().toLowerCase().replace(/\s+/g, '');
  if (name && GENERIC_NAMES.includes(name)) {
    add('generic_customer', '회사명이 일반명사·테스트 값입니다', customer);
  } else if (name && /^(.)\1{2,}$/.test(name)) {
    // ㅋㅋㅋ · aaa · 111 — 같은 글자만 반복
    add('repeated_customer', '회사명이 같은 글자의 반복입니다', customer);
  }

  const domain = String(contact || '').split('@')[1]?.toLowerCase() || '';
  if (domain && DISPOSABLE_MAIL_DOMAINS.includes(domain)) {
    add('disposable_mail', '일회용 이메일 주소입니다', domain);
  } else if (domain && PERSONAL_MAIL_DOMAINS.includes(domain)) {
    // 신호일 뿐이다. 이것만으로는 아무것도 판정하지 않는다.
    add('personal_mail', '회사 도메인이 아닌 개인 메일입니다', domain);
  }

  const person = String(contactName || '').trim().toLowerCase().replace(/\s+/g, '');
  if (person && (GENERIC_NAMES.includes(person) || /^(.)\1{2,}$/.test(person))) {
    add('generic_name', '담당자 이름이 테스트 값으로 보입니다', contactName);
  }

  const digits = String(contactPhone || '').replace(/\D/g, '');
  if (digits && (/^(\d)\1+$/.test(digits) || digits.endsWith('00000000') || digits === '01012345678')) {
    add('placeholder_phone', '전화번호가 예시 값으로 보입니다', contactPhone);
  }

  return signals;
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
    // 직함도 개인정보다. 같은 자리로 간다(045). 필수는 아니다 — 이것 때문에
    // 폼을 못 내면 리드를 통째로 잃는다.
    contact_title: optionalText(body.contact_title, 60),
    message: optionalText(body.message, 2000),
    customer_meta: customerMeta,
    fqa_scores: ensurePlainObject(body.fqa_scores, '진단 점수'),
    // 42문항 응답. 채점과 21문항 채우기는 서버가 한다(030 bridge).
    readiness_scores: ensurePlainObject(body.readiness_scores, '준비도 응답'),
    track: inferTrack(customerMeta, body.readiness_scores),
    consent: true,
    // 판정이 아니라 신호다. 접수를 막지 않는다.
    spam_signals: detectSpamSignals({
      customer: body.customer, contact: body.contact,
      contact_name: body.contact_name, contact_phone: body.contact_phone
    })
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
    else if (field === 'msp_status') patch.msp_status = normaliseMspStatus(body.msp_status);
    else if (field === 'inquiry_date') patch.inquiry_date = normaliseInquiryDate(body.inquiry_date);
    else if (field === 'inquiry_products') patch.inquiry_products = ensureArray(body.inquiry_products, field);
    else {
      // mzc_sales · customer_contact_* 넷. 빈 문자열은 null 로 — 「지웠다」를
      // 빈 문자열로 남기면 화면에서 "입력됨" 과 구분이 안 된다.
      patch[field] = optionalText(body[field], 120) || null;
    }
  }

  if (!Object.keys(patch).length) throw new Error('저장할 변경사항이 없습니다.');
  return patch;
}

module.exports = {
  detectSpamSignals,
  EDITABLE_DEAL_FIELDS,
  MEETING_NOTE_LIMIT,
  validateMeetingNote,
  SERVER_OWNED_DEAL_FIELDS,
  MSP_STATUSES,
  PIPELINE_STAGES,
  calculateFqaTotals,
  cleanPhone,
  clampStage,
  inferTrack,
  normaliseDealPatch,
  validateDealCreate,
  validateLead
};
