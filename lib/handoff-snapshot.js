'use strict';

/**
 * ⚠ 화면(hub.js)이 <script> 로 나란히 불러온다. **IIFE 로 감싸지 않으면**
 *   여기 top-level const(asArray 등)가 전역에서 겹쳐 SyntaxError 로 죽는다 —
 *   node require 검사는 통과하고 브라우저에서만 터진다.
 */
(function wrap(global) {

/**
 * 내부 인계 스냅샷.
 *
 * 영업이 딜을 구축·PS 엔지니어에게 넘길 때, 인계받는 사람이 가장 먼저 알아야 하는 것은
 * 값 자체가 아니라 **그 값을 믿어도 되는가**다. "전사 2,000명" 이 고객이 말한 숫자면
 * 그대로 설계하고, 영업이 어림한 숫자면 첫 미팅에서 다시 물어야 한다. 둘을 구분 못 하면
 * 인계받은 사람이 결국 전부 다시 묻고, 인계 문서는 시간을 아끼는 게 아니라 한 벌 더
 * 만드는 일이 된다.
 *
 * **이 판정을 할 수 있는 것은 ai-radar 뿐이다.** 고객 원본과 영업 수정본을 둘 다 가진
 * 유일한 곳이라서다 — 032 의 readiness_customer_scores, 049 의 customer_meta_original.
 *
 * ⚠ **문서가 아니라 스냅샷을 만든다.** ~/CC/deployment-Brief 가 같은 일을 하는데
 *   Brief Template v1.0 §A 필드 원문이 아직 없다. 문서를 바로 짜 놓으면 규격이 나왔을 때
 *   두 번 만든다. 여기서는 `{key, label, value, status, source}` 레코드만 내고 사람이
 *   읽는 문서는 그 뷰로 만든다 — 규격이 나오면 key 매핑만 고치면 된다.
 *
 * ⚠ **모르면 판정하지 않는다.** 049 이전 딜은 원본이 없어 구분할 수 없다. 그때
 *   `unknown` 을 쓰고 문서가 「구분할 수 없음」이라고 말한다. 지금 값을 원본이라고
 *   치면 틀린 것을 「확인됨」으로 만든다 — 인계에서 가장 비싼 실수다.
 *
 * ⚠ **개인정보와 상업 정보를 안 부른다.** 이 문서는 사람 손을 여러 번 탄다.
 *   포탈 원본 연락처(leads.contact_*)는 동의와 함께 leads 에 두기로 한 것이라 문서로
 *   복사하지 않고(027), 마진·딜 사이즈 전략은 구축 담당이 쓸 일이 없다. 지우는 게
 *   아니라 **애초에 이 파일이 그 필드를 읽지 않는다.**
 */

/**
 * 상태 어휘. **Deployment Brief Template §B 원문 표기를 그대로 쓴다** —
 * 인계받는 쪽이 두 문서를 나란히 놓고 보기 때문에 말이 갈리면 안 된다.
 *
 * 문서는 셋(확인됨 / 가능성 높음 / 미해결)인데 우리는 **넷째가 필요하다.**
 * 049 이전 딜은 접수 원본이 없어 「고객이 말한 것」과 「영업이 적은 것」을 **판정할 수
 * 없다.** 그때 셋 중 아무거나 고르면 셋 다 거짓말이 된다 — 구분되는 척하지 않는다.
 */
const STATUS = Object.freeze({
  CONFIRMED: 'confirmed',   // 고객이 직접 낸 값 그대로
  LIKELY: 'likely',         // 영업이 넣거나 고친 값 — 틀렸다는 뜻이 아니라 재확인 대상
  OPEN: 'open',             // 아직 아무도 모른다
  UNKNOWN: 'unknown'        // 원본이 없어 어느 쪽인지 **판정할 수 없다** (ai-radar 전용)
});

const STATUS_LABEL = Object.freeze({
  confirmed: '확인됨',       // 문서 §B 원문
  likely: '가능성 높음',      // 문서 §B 원문
  open: '미해결',            // 문서 §B 원문
  unknown: '구분 불가'        // 049 이전 딜
});

const SOURCE_LABEL = Object.freeze({
  customer: '고객 원본', sales: '영업 입력', catalog: '카탈로그', none: '—'
});

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const blank = (value) => value === null || value === undefined || String(value).trim() === '';

/**
 * 한 필드의 근거 상태. 원본(original)과 현재 값(current)을 견준다.
 *
 * hasOriginal 이 false 면 049 이전 딜이라 **비교할 대상 자체가 없다.** 값이 있어도
 * 「구분 불가」로 남긴다 — 원본이 없는데 확인됐다고 말할 근거가 없다.
 */
function evidenceOf(current, original, hasOriginal) {
  if (blank(current)) return { status: STATUS.OPEN, source: 'none' };
  if (!hasOriginal) return { status: STATUS.UNKNOWN, source: 'sales' };
  if (blank(original)) return { status: STATUS.LIKELY, source: 'sales' };
  return String(current) === String(original)
    ? { status: STATUS.CONFIRMED, source: 'customer' }
    : { status: STATUS.LIKELY, source: 'sales' };
}

/** 고객 맥락 필드. 라벨은 화면(STEP01)과 같은 말을 쓴다. */
const CONTEXT_FIELDS = Object.freeze([
  ['industry', '업종'],
  ['companySize', '조직 규모'],
  ['targetUsers', '도입 대상'],
  ['timeline', '도입 희망 시기'],
  ['securityStack', '보안 게이트웨이'],
  ['investment', '투자 준비도']
]);

/**
 * 42문항의 근거 상태. **영업이 고친 문항을 이름으로 뽑는 것이 핵심이다.**
 * 개수만 세면 인계받은 사람이 어디를 다시 물어야 하는지 모른다.
 */
function readinessEvidence({ customerScores, salesScores, items }) {
  const original = asObject(customerScores);
  const current = asObject(salesScores);
  const byCode = new Map(asArray(items).map((item) => [item.code, item]));
  const hasOriginal = Object.keys(original).length > 0;

  const edited = [];
  const confirmed = [];
  const open = [];

  for (const code of new Set([...Object.keys(original), ...Object.keys(current), ...byCode.keys()])) {
    const text = byCode.get(code)?.text || '';
    const before = original[code];
    const after = current[code];

    // 아무도 답하지 않았다. 032 이전 딜에서도 이건 확실히 말할 수 있다.
    if (blank(before) && blank(after)) { open.push({ code, text }); continue; }
    // 032 이전 딜은 원본이 없어 **고친 것과 고객이 낸 것을 가를 수 없다.** 판정하지 않는다.
    if (!hasOriginal) continue;
    // 영업이 채웠다 / 지웠다 / 바꿨다 — 셋 다 「영업이 손댄 문항」이다. from·to 를 같이
    // 남겨야 인계받은 사람이 무엇을 다시 물어야 하는지 안다.
    if (blank(before)) { edited.push({ code, text, from: null, to: after }); continue; }
    if (blank(after)) { edited.push({ code, text, from: before, to: null }); continue; }
    if (Number(before) !== Number(after)) {
      edited.push({ code, text, from: before, to: after });
    } else {
      confirmed.push({ code, text, score: after });
    }
  }

  const bySortKey = (a, b) => String(a.code).localeCompare(String(b.code));
  return {
    comparable: hasOriginal,
    confirmed: confirmed.sort(bySortKey),
    edited: edited.sort(bySortKey),
    open: open.sort(bySortKey)
  };
}

/**
 * 인계 스냅샷을 만든다. 순수 함수 — DOM 도 DB 도 모른다.
 *
 * @param {object} input
 *   deal          딜 행 (customer_meta · customer_meta_original · readiness_* 포함)
 *   readinessItems 42문항 (code·text)
 *   openItems     아직 확인 안 된 것들 (화면의 collectOpenItems 결과)
 *   decisions     확정된 구성 { combo:[{name,why}], packages:[{name,period,target}] }
 */
function buildHandoffSnapshot({ deal, readinessItems = [], openItems = [], decisions = {} } = {}) {
  const row = asObject(deal);
  const meta = asObject(row.customer_meta);
  const originalMeta = row.customer_meta_original;
  // null 과 {} 를 가른다. 049 이후 접수분은 빈 객체라도 「원본이 있다」가 맞다.
  const hasOriginalMeta = originalMeta !== null && originalMeta !== undefined;
  const original = asObject(originalMeta);

  const fields = [];
  // 고객사명은 포탈 접수분이면 고객이 낸 것이다. 영업이 만든 딜은 우리가 적은 것이다.
  fields.push({
    key: 'customer', label: '고객사', value: row.customer || '',
    ...(blank(row.customer)
      ? { status: STATUS.OPEN, source: 'none' }
      : row.source === 'portal'
        ? { status: STATUS.CONFIRMED, source: 'customer' }
        : { status: STATUS.LIKELY, source: 'sales' })
  });

  for (const [key, label] of CONTEXT_FIELDS) {
    fields.push({
      key, label, value: meta[key] ?? '',
      ...evidenceOf(meta[key], original[key], hasOriginalMeta)
    });
  }

  // 담당자는 **영업이 확인한 값만** 싣는다. 포탈 원본(leads.contact_*)은 동의와 함께
  // leads 에 두기로 한 것이라 문서로 복사하지 않는다(027). 인계받는 사람이 연락할
  // 상대는 어차피 영업이 확인해 준 사람이다.
  const contact = [row.customer_contact_name, row.customer_contact_title,
    row.customer_contact_dept].filter(Boolean).join(' · ');
  fields.push({
    key: 'contact', label: '고객 담당자 (영업 확인)', value: contact,
    ...(blank(contact) ? { status: STATUS.OPEN, source: 'none' }
      : { status: STATUS.LIKELY, source: 'sales' })
  });

  return {
    customer: row.customer || '',
    fields,
    readiness: readinessEvidence({
      customerScores: row.readiness_customer_scores,
      salesScores: row.readiness_scores,
      items: readinessItems
    }),
    // 고객이 남긴 원문. 요약하지 않는다 — 요약하는 순간 그건 영업의 말이 된다.
    verbatim: row.lead_message || '',
    openItems: asArray(openItems),
    decisions: {
      combo: asArray(decisions.combo),
      packages: asArray(decisions.packages)
    }
  };
}

/** 문서 머리에 쓰는 한 줄 집계. 「이 인계가 얼마나 단단한가」를 숫자로 먼저 보여준다. */
function summariseSnapshot(snapshot) {
  const counts = { confirmed: 0, likely: 0, open: 0, unknown: 0 };
  for (const field of asArray(snapshot?.fields)) {
    if (counts[field.status] !== undefined) counts[field.status] += 1;
  }
  return counts;
}

const api = {
  STATUS, STATUS_LABEL, SOURCE_LABEL, CONTEXT_FIELDS,
  evidenceOf, readinessEvidence, buildHandoffSnapshot, summariseSnapshot
};

/**
 * 화면(hub.js)도 **같은 파일**을 쓴다 — 규칙을 두 곳에 적으면 갈린다.
 * ⚠ module.exports 를 맨몸으로 두면 브라우저에서 ReferenceError 로 죽는다.
 *   화면은 조용히 버튼만 안 먹고, 로컬 require 검사는 통과한다.
 */
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.IssuHandoffSnapshot = api;
})(typeof window === 'undefined' ? globalThis : window);
