'use strict';

/**
 * sections 본문에서 "대외/사내 공개용 카피"와 "관리자 전용 내부 코멘트"를 가르는 단일 규칙.
 *
 * 배경: seed 본문은 공개 카피와 내부 전략 코멘트가 한 jsonb blob에 섞여 있다.
 *   - §1: `- **AI Tech 의견 (PreSales)**: …` 불릿 + 뒤따르는 `[의견] …` 문단
 *   - §8: `- **마진 확보 전략**: …` 류의 수익화 불릿 (솔루션당 1줄)
 * opinion 컬럼은 policy B로 viewer에게 마스킹되지만, 같은 내용이 sections 안에
 * 중복 저장돼 있어 마스킹을 우회했다.
 *
 * 해결: 009 마이그레이션으로 solutions.sections_internal 컬럼을 만들고
 * scripts/split-internal-sections.js 로 내부 문단을 옮긴다. 서버는
 *   (1) non-admin 응답에서 sections_internal 을 아예 제외하고
 *   (2) sections 에 남아 있을 수 있는 내부 마커 줄도 런타임에 제거한다.
 * (2) 덕분에 마이그레이션 적용 전에도 non-admin 에게 내부 문단이 나가지 않는다.
 */

/** 내부 전용으로 취급하는 불릿의 볼드 라벨. 실제 seed 본문에서 확인된 7종. */
const INTERNAL_BULLET_LABELS = Object.freeze([
  'AI Tech 의견',
  '마진 확보 전략',
  'SI 번들 마진 전략',
  '딜 사이즈 극대화',
  'MZC 시너지 번들링',
  'MZC 수익화 전략',
  'SI 번들 딜 구성'
]);

/** 분리 후에도 남으면 사람이 확인해야 하는 위험 키워드 (스크립트 리포트용). */
const RESIDUE_PATTERN = /마진|리셀러|재판매|딜 사이즈|수익화/;

const BULLET_PATTERN = /^\s*[-*]\s+/;
const HEADING_PATTERN = /^\s*#{1,6}\s/;
const OPINION_PARAGRAPH_PATTERN = /^\s*\[의견\]/;

const isInternalBullet = (line) => {
  if (!BULLET_PATTERN.test(line)) return false;
  const bold = line.match(/\*\*(.+?)\*\*/);
  const label = bold ? bold[1] : line.replace(BULLET_PATTERN, '');
  return INTERNAL_BULLET_LABELS.some((known) => label.includes(known));
};

/**
 * 한 섹션 본문을 공개/내부로 가른다.
 * 불릿 라벨이 내부 목록에 걸리면 그 불릿과 이어지는 연속 줄(새 불릿·헤딩 전까지)을 내부로 본다.
 * @param {string} text
 * @returns {{ publicText: string, internalText: string }}
 */
function splitSectionText(text) {
  const source = typeof text === 'string' ? text : String(text ?? '');
  if (!source) return { publicText: '', internalText: '' };

  const publicLines = [];
  const internalLines = [];
  let inInternal = false;

  for (const line of source.split('\n')) {
    if (isInternalBullet(line)) {
      inInternal = true;
    } else if (OPINION_PARAGRAPH_PATTERN.test(line)) {
      inInternal = true;
    } else if (BULLET_PATTERN.test(line) || HEADING_PATTERN.test(line)) {
      inInternal = false;
    }
    // 그 외(빈 줄·이어지는 본문)는 직전 상태를 유지한다.
    (inInternal ? internalLines : publicLines).push(line);
  }

  return {
    publicText: trimBlankEdges(publicLines).join('\n'),
    internalText: trimBlankEdges(internalLines).join('\n')
  };
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}

const toSectionsObject = (value) => {
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

/**
 * non-admin 응답용. sections 에서 내부 문단을 제거한 새 객체를 돌려준다.
 * 마이그레이션이 이미 적용돼 내부 문단이 옮겨진 뒤라면 아무것도 바꾸지 않는다(멱등).
 */
function stripInternalSections(sections) {
  const source = toSectionsObject(sections);
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = splitSectionText(value).publicText;
  }
  return result;
}

/** 마이그레이션 스크립트용. 내부 문단만 뽑아 { 섹션키: 내부본문 } 으로 돌려준다(빈 값 제외). */
function extractInternalSections(sections) {
  const source = toSectionsObject(sections);
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const { internalText } = splitSectionText(value);
    if (internalText.trim() !== '') result[key] = internalText;
  }
  return result;
}

/** 분리 후 공개 본문에 남은 위험 키워드 줄 (검수 리포트용). */
function findResidueLines(text) {
  const source = typeof text === 'string' ? text : String(text ?? '');
  return source.split('\n').filter((line) => RESIDUE_PATTERN.test(line));
}

module.exports = {
  INTERNAL_BULLET_LABELS,
  splitSectionText,
  stripInternalSections,
  extractInternalSections,
  findResidueLines,
  toSectionsObject
};
