'use strict';

/**
 * ⚠ 화면(hub.js)이 <script> 로 나란히 불러온다. **IIFE 로 감싸지 않으면**
 *   여기 top-level const(asArray 등)가 전역에서 겹쳐 SyntaxError 로 죽는다 —
 *   node require 검사는 통과하고 브라우저에서만 터진다.
 */
(function wrap(global) {

/**
 * 배포 인계 필드 정의 (051).
 *
 * ChatGPT Deployment Brief Template §A 의 14필드 중 **시스템이 모르는 것만** 여기서
 * 받는다. 나머지는 진단·구성·문의 제품·전제에서 끌어온다 — 이미 아는 것을 다시 물으면
 * 아무도 안 채운다.
 *
 * ⚠ **문서1 전체를 받지 않는다.** 11 섹션·수십 개 표를 입력 화면으로 만들면 입력란이
 *   100개를 넘고, 안 채워진 문서는 없는 것과 같다. 문서2 §A 가 스스로 「최소 근거
 *   패키지」라고 부르는 범위에 맞춘다.
 *
 * ⚠ **값과 근거를 같이 담는다.** { value, quote } 다. quote 는 050 의 인용 앵커라
 *   「이 값이 어느 미팅에서 나왔나」를 되짚을 수 있다.
 */

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const text = (value) => (value === null || value === undefined ? '' : String(value));
const filled = (value) => text(value).trim() !== '';

/** 한 칸의 상한. 넘어가면 인계 문서가 아니라 회의록이 된다 — 회의록은 050 에 있다. */
const FIELD_LIMIT = 2000;

/**
 * 새로 받는 여섯 칸. `brief` 는 문서2 §A 의 항목 번호다 — 규격이 바뀌면 여기만 고친다.
 *
 * `ask` 는 못 채웠을 때 인터뷰 가이드에 나갈 질문이다(문서1 §10). **빈칸을 그냥 두지
 * 않고 질문으로 바꾸는 것**이 이 시스템이 낼 수 있는 값이다.
 */
const HANDOFF_FIELDS = Object.freeze([
  Object.freeze({
    key: 'workflow', brief: 4, label: '우선 워크플로',
    hint: '무엇을 · 누가 · 얼마나 자주 · 사람이 어디서 검토하는가',
    placeholder: '예: 신규 계약 검토 요약. 법무 12명, 주 40건. 최종 발송 전 팀장 승인.',
    // 문서1 §2 는 10필드를 받지만 하나를 제대로 아는 것이 열을 어설프게 아는 것보다 낫다.
    ask: 'ChatGPT 가 가장 먼저 지원해야 할 구체적인 업무는 무엇이고, 현재 누가 얼마나 자주 하고 있습니까?'
  }),
  Object.freeze({
    key: 'pilotGroup', brief: 2, label: '초기 사용자 그룹',
    hint: '규모와 조직 범위, 그리고 **확정 여부**',
    placeholder: '예: 법무팀 12명 (확정) / 재무팀 30명은 검토 중',
    // 「50명 예정」과 「50명 확정」은 배포에서 완전히 다르다.
    ask: '누가 가장 먼저 사용하며, 그 범위는 확정된 것입니까 아니면 검토 중입니까?'
  }),
  Object.freeze({
    key: 'successCriteria', brief: 6, label: '성공 기준',
    hint: '기준값 → 목표값 → 측정 방법',
    placeholder: '예: 요약 작성 40분 → 25분, 4주간 품질 검토 예외 증가 없음',
    // 기준값 없는 목표값은 검증이 안 된다.
    ask: '어떤 지표가 개선되어야 하며, 지금 기준값은 얼마이고 누가 측정합니까?'
  }),
  Object.freeze({
    key: 'stakeholders', brief: 7, label: '이해관계자',
    hint: '경영진 스폰서 · 비즈니스 성과 책임자 · 워크스페이스 관리자',
    placeholder: '예: 스폰서 CFO / 성과 책임 법무팀장 / 워크스페이스 IT인프라팀',
    // 9역할·RACI 는 deployment-Brief 자리다. 여기서는 셋만 받는다.
    ask: '결과를 책임지고 다음 의사결정을 내리는 사람은 누구이며, 워크스페이스는 누가 관리합니까?'
  }),
  Object.freeze({
    key: 'scope', brief: 8, label: '범위 경계',
    hint: '포함 / 제외 / 나중에 볼 것',
    placeholder: '예: 포함 — 계약 요약. 제외 — 법률 자문·외부 발송. 보류 — 타 언어',
    // 「제외」가 성급한 수행 약속을 막는다.
    ask: '이번 범위에 명시적으로 포함되는 것과 제외되는 것은 무엇입니까?'
  }),
  Object.freeze({
    key: 'nextSteps', brief: 14, label: '즉시 다음 단계',
    hint: '조치 · 책임자 · 기한',
    placeholder: '예: 8/28 보안 검토 회의 (IT 김OO) / 9/5 파일럿 계정 발급',
    ask: '다음 회의·의사결정·산출물은 무엇이며 책임자와 기한은 누구/언제입니까?'
  })
]);

/**
 * 사용사례 품질 점검 (문서2 §F). **판정만 받는다** — 여섯 줄이라 부담이 없고,
 * 「진행 가능한가」를 사람이 스스로 묻게 만드는 것이 목적이다.
 */
const QUALITY_CHECKS = Object.freeze([
  Object.freeze({ key: 'realWorkflow', label: '실제 워크플로', question: '사람들이 지금 실제로 하는 업무인가?' }),
  Object.freeze({ key: 'frequency', label: '빈도 · 업무 마찰', question: '검증을 정당화할 만큼 자주 발생하거나 부담이 큰가?' }),
  Object.freeze({ key: 'observable', label: '관찰 가능성', question: '첫 합의 기간 안에 유용성·품질을 관찰할 수 있는가?' }),
  Object.freeze({ key: 'pilotFit', label: '초기 사용자 적합성', question: '대상 사용자가 접근 가능하고 피드백을 줄 수 있는가?' }),
  Object.freeze({ key: 'dependencies', label: '관리 가능한 의존성', question: '소스·정책·접근·거버넌스 의존성이 감당 가능한가?' }),
  Object.freeze({ key: 'decisionBasis', label: '후속 의사결정 근거', question: '진행·개선·범위조정·중단을 정할 근거가 나오는가?' })
]);

/** 문서 원문 표기를 그대로 쓴다(§F). */
const QUALITY_LEVELS = Object.freeze([
  ['met', '충족'], ['partial', '부분 충족'], ['unmet', '미충족']
]);
const qualityLabel = (value) => (QUALITY_LEVELS.find(([key]) => key === value) || [])[1] || '';

const FIELD_KEYS = Object.freeze(HANDOFF_FIELDS.map((f) => f.key));
const QUALITY_KEYS = Object.freeze(QUALITY_CHECKS.map((c) => c.key));
const QUALITY_VALUES = new Set(QUALITY_LEVELS.map(([key]) => key));

/**
 * 저장 전에 모양을 강제한다. **모르는 키를 버린다** — jsonb 한 칸이라 아무거나 들어올
 * 수 있고, 한 번 들어가면 다음에 읽는 코드가 그걸 진짜인 줄 안다.
 *
 * 인용은 **출처가 붙어 있을 때만** 남긴다. note_id·met_on 이 없으면 되짚을 수 없어
 * 근거 구실을 못 한다(050 의 buildQuote 와 같은 규칙).
 */
function normaliseHandoff(input) {
  const source = asObject(input);
  const out = {};
  for (const key of FIELD_KEYS) {
    const entry = asObject(source[key]);
    const value = text(entry.value).trim().slice(0, FIELD_LIMIT);
    const anchor = asObject(entry.quote);
    const hasQuote = filled(anchor.quote) && filled(anchor.note_id) && filled(anchor.met_on);
    if (!value && !hasQuote) continue;
    out[key] = hasQuote
      ? { value, quote: {
        quote: text(anchor.quote).slice(0, 400),
        note_id: text(anchor.note_id),
        met_on: text(anchor.met_on),
        note_title: text(anchor.note_title),
        source: anchor.source === 'extracted' ? 'extracted' : 'human'
      } }
      : { value };
  }
  const quality = asObject(source.quality);
  const checks = {};
  for (const key of QUALITY_KEYS) {
    if (QUALITY_VALUES.has(quality[key])) checks[key] = quality[key];
  }
  if (Object.keys(checks).length) out.quality = checks;
  return out;
}

/**
 * 인계 준비도. **여섯 칸 중 몇 개가 찼는가**로만 센다.
 * 품질 6기준은 판정이지 근거가 아니라 여기 안 넣는다 — 섞으면 「체크만 하고 칸은 비운」
 * 딜이 준비된 것처럼 보인다.
 */
function handoffReadiness(handoff) {
  const source = asObject(handoff);
  const missing = [];
  let filledCount = 0;
  let sourced = 0;
  for (const field of HANDOFF_FIELDS) {
    const entry = asObject(source[field.key]);
    if (filled(entry.value)) {
      filledCount += 1;
      if (asObject(entry.quote).note_id) sourced += 1;
    } else {
      missing.push(field);
    }
  }
  return { total: HANDOFF_FIELDS.length, filled: filledCount, sourced, missing };
}

/**
 * 못 채운 칸을 **질문으로** 바꾼다 (문서1 §10). 이미 아는 것은 안 묻는다 —
 * 답한 것을 또 물으면 고객이 "지난번에 말했는데요"라고 한다.
 */
function interviewQuestions(handoff) {
  return handoffReadiness(handoff).missing.map((field) => ({
    key: field.key, brief: field.brief, label: field.label, question: field.ask
  }));
}

/** 품질 점검에서 미충족·부분 충족으로 표시된 것. 문서2 §F 의 「근거/공백」 칸이다. */
function qualityGaps(handoff) {
  const checks = asObject(asObject(handoff).quality);
  return QUALITY_CHECKS
    .filter((check) => checks[check.key] && checks[check.key] !== 'met')
    .map((check) => ({ ...check, level: checks[check.key], levelLabel: qualityLabel(checks[check.key]) }));
}

const api = {
  HANDOFF_FIELDS, QUALITY_CHECKS, QUALITY_LEVELS, FIELD_KEYS, QUALITY_KEYS, FIELD_LIMIT,
  qualityLabel, normaliseHandoff, handoffReadiness, interviewQuestions, qualityGaps,
  asArray
};

/**
 * 화면(hub.js)도 **같은 파일**을 쓴다 — 규칙을 두 곳에 적으면 갈린다.
 * ⚠ module.exports 를 맨몸으로 두면 브라우저에서 ReferenceError 로 죽는다.
 *   화면은 조용히 버튼만 안 먹고, 로컬 require 검사는 통과한다.
 */
if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.IssuHandoffFields = api;
})(typeof window === 'undefined' ? globalThis : window);
