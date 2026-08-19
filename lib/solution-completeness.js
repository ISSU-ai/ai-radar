'use strict';

/**
 * 솔루션 발행 전 완성도 검사.
 *
 * 왜 필요한가: 카탈로그 22종 중 7종이 §3.2 페르소나 문장을 글자 하나 다르지 않게
 * 공유하고 있고, 그 안에 `{name}` 플레이스홀더가 치환되지 않은 채 프로덕션에 들어가
 * viewer 에게 노출되고 있었다. ISV BU 에게 등록 권한을 열면서 게이트를 세우지 않으면
 * 같은 사고가 반복된다.
 *
 * 추천 엔진 관점에서도 필요하다. 근거가 없는 솔루션은 추천돼도 "왜 이 조합인가"를
 * 설명할 수 없고, 본문이 긴 솔루션이 계속 상위에 뜨는 편향이 생긴다.
 *
 * blocking = 발행 차단, warning = 발행은 되나 표시.
 * 판정은 순수 함수다 — DB 접근은 호출자가 하고 여기로 넘긴다.
 */

const { splitSectionText } = require('./section-privacy');

/** 치환되지 않은 템플릿 자리표시자. `업데이트 예정` 은 앱이 쓰는 정식 마커라 제외한다. */
const PLACEHOLDER_PATTERNS = Object.freeze([
  { re: /\{\s*[A-Za-z_]\w*\s*\}/, label: '치환되지 않은 {변수} 자리표시자' },
  { re: /\{\{|\}\}/, label: '치환되지 않은 {{템플릿}} 구문' },
  { re: /\b(TODO|TBD|FIXME|XXX)\b/, label: 'TODO/TBD 등 작업 표시' },
  { re: /Lorem ipsum/i, label: '더미 텍스트' },
  { re: /여기에 (입력|작성)/, label: '작성 안내 문구가 남음' },
  { re: /_{4,}/, label: '빈칸(____)이 남음' }
]);

/** 복붙 판정 최소 길이. 짧은 줄은 우연히 겹칠 수 있다. */
const SHARED_LINE_MIN_LENGTH = 30;

/**
 * 겹쳐도 정상인 줄. 8섹션은 공통 서식이라 헤딩은 당연히 같다
 * (`### 7.3 부적합 신호: Red Flag (5가지)` 는 11종이 공유한다).
 * 헤딩까지 세면 잘 쓴 문서도 전부 복붙으로 잡힌다.
 */
const isStructuralLine = (line) => /^#{2,4}\s/.test(line) || /^[-*]\s*$/.test(line);

/** 본문 복붙으로 판정할 최소 줄 수. 한두 줄 우연한 일치로 발행을 막지 않는다. */
const SHARED_LINE_BLOCK_THRESHOLD = 3;

const SECTION_MIN_LENGTH = Object.freeze({ 1: 500, 7: 300 });

const asObject = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? value : {};
};

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const normaliseLine = (line) => line.trim().replace(/\s+/g, ' ');

/**
 * 다른 솔루션과 글자 그대로 겹치는 본문 줄을 찾는다.
 * 템플릿을 복사해 이름만 바꾼 문서를 잡아내는 것이 목적이다.
 */
function findSharedLines(target, others) {
  const targetSections = asObject(target.sections);
  const mine = new Map();
  for (const [key, text] of Object.entries(targetSections)) {
    for (const raw of String(text || '').split('\n')) {
      const line = normaliseLine(raw);
      if (line.length >= SHARED_LINE_MIN_LENGTH && !isStructuralLine(line)) mine.set(line, key);
    }
  }
  if (mine.size === 0) return [];

  const hits = new Map();
  for (const other of others) {
    if (!other || other.slug === target.slug) continue;
    const sections = asObject(other.sections);
    for (const text of Object.values(sections)) {
      for (const raw of String(text || '').split('\n')) {
        const line = normaliseLine(raw);
        if (!mine.has(line)) continue;
        if (!hits.has(line)) hits.set(line, { section: mine.get(line), line, others: [] });
        const entry = hits.get(line);
        if (!entry.others.includes(other.name || other.slug)) entry.others.push(other.name || other.slug);
      }
    }
  }
  return [...hits.values()];
}

/**
 * @param {object} solution               검사 대상 (DB 행 형태)
 * @param {object} context
 * @param {Map<string,{layer:string}>} context.slots       슬롯 분류표
 * @param {Array}  context.otherSolutions 다른 솔루션들 {slug,name,sections}
 * @param {Set<string>} context.knownSlugs red_flags 대안이 가리킬 수 있는 슬러그
 * @returns {{ok:boolean, blocking:Array, warnings:Array}}
 */
function evaluateCompleteness(solution, context = {}) {
  const slots = context.slots instanceof Map ? context.slots : new Map();
  const knownSlugs = context.knownSlugs instanceof Set ? context.knownSlugs : new Set();
  const others = Array.isArray(context.otherSolutions) ? context.otherSolutions : [];

  const blocking = [];
  const warnings = [];
  const add = (list, code, message, detail) => list.push(detail ? { code, message, detail } : { code, message });

  const sections = asObject(solution.sections);
  const coverage = asArray(solution.assessment_coverage);
  const prerequisites = asArray(solution.assessment_prerequisites);
  const redFlags = asArray(solution.red_flags);

  // ── 추천 후보가 되기 위한 최소 조건 ──────────────────────────
  if (!solution.slot) {
    add(blocking, 'slot_missing', '슬롯이 배정되지 않았습니다. 슬롯이 없으면 추천 후보가 되지 않습니다.');
  } else if (!slots.has(solution.slot)) {
    add(blocking, 'slot_unknown', `슬롯 '${solution.slot}' 이 분류표에 없습니다.`);
  } else if (slots.get(solution.slot).layer !== solution.layer) {
    add(blocking, 'layer_mismatch',
      `레이어 불일치: 솔루션은 ${solution.layer}, 슬롯 '${solution.slot}' 은 ${slots.get(solution.slot).layer} 입니다.`);
  }

  if (coverage.length === 0) {
    add(blocking, 'coverage_missing',
      '메우는 평가영역(assessment_coverage)이 비어 있습니다. 이대로는 어떤 고객에게도 추천되지 않습니다.');
  }

  // ── 치환되지 않은 템플릿 ─────────────────────────────────────
  for (const [key, text] of Object.entries(sections)) {
    for (const { re, label } of PLACEHOLDER_PATTERNS) {
      const match = String(text || '').match(re);
      if (match) {
        add(blocking, 'placeholder', `§${key} 에 ${label} 이(가) 남아 있습니다.`, match[0].slice(0, 60));
        break; // 섹션당 하나만 보고한다
      }
    }
  }

  // ── 다른 솔루션에서 복사한 문장 ──────────────────────────────
  const shared = findSharedLines(solution, others);
  if (shared.length > 0) {
    const sample = shared[0];
    const who = sample.others.slice(0, 3).join(', ');
    const detail = `§${sample.section}: ${sample.line.slice(0, 80)}`;
    if (shared.length >= SHARED_LINE_BLOCK_THRESHOLD) {
      add(blocking, 'duplicated_copy',
        `다른 솔루션에서 복사한 문장이 ${shared.length}줄 있습니다 (${who}). 템플릿을 그대로 두면 이 솔루션만의 근거가 없습니다.`,
        detail);
    } else {
      add(warnings, 'duplicated_copy_minor',
        `다른 솔루션과 겹치는 문장이 ${shared.length}줄 있습니다 (${who}).`, detail);
    }
  }

  // ── red_flags 무결성 ────────────────────────────────────────
  redFlags.forEach((flag, index) => {
    if (!flag || !flag.signal) {
      add(blocking, 'red_flag_invalid', `red_flags[${index}] 에 signal 이 없습니다.`);
      return;
    }
    const alternatives = asArray(flag.alternatives);
    if (alternatives.length === 0) {
      add(blocking, 'red_flag_no_alternative',
        `부적합 신호 "${String(flag.signal).slice(0, 40)}" 에 대안이 없습니다. 제외로만 끝나면 영업이 다음 행동을 못 합니다.`);
    }
    for (const alt of alternatives) {
      if (alt && alt.slug && !knownSlugs.has(alt.slug)) {
        add(blocking, 'red_flag_dead_link', `대안 슬러그 '${alt.slug}' 이 카탈로그에 없습니다.`);
      }
    }
  });

  // ── 경고 ────────────────────────────────────────────────────
  if (prerequisites.length === 0) {
    add(warnings, 'prerequisites_empty',
      '전제 조건이 비어 있습니다. 정말 아무 조건 없이 도입 가능한지 확인하세요.');
  }
  if (redFlags.length === 0) {
    add(warnings, 'red_flags_empty',
      '부적합 신호가 없습니다. 모든 고객에게 맞는 솔루션은 드뭅니다.');
  }
  if (!/○/.test(String(sections['3'] || ''))) {
    add(warnings, 'industry_fit_missing', '§3 에 "○ 매우 적합" 산업이 표시되지 않았습니다.');
  }
  for (const [key, min] of Object.entries(SECTION_MIN_LENGTH)) {
    // 내부 문단을 뺀 공개 본문 기준으로 잰다.
    const publicText = splitSectionText(sections[key] || '').publicText;
    if (publicText.length < min) {
      add(warnings, 'section_thin', `§${key} 본문이 ${publicText.length}자로 짧습니다 (권장 ${min}자 이상).`);
    }
  }
  if (solution.bundle_potential == null) {
    add(warnings, 'bundle_potential_missing', '번들 확장성이 지정되지 않아 정렬에서 불리합니다.');
  }

  return { ok: blocking.length === 0, blocking, warnings };
}

module.exports = {
  evaluateCompleteness,
  findSharedLines,
  isStructuralLine,
  PLACEHOLDER_PATTERNS,
  SHARED_LINE_MIN_LENGTH,
  SHARED_LINE_BLOCK_THRESHOLD
};
