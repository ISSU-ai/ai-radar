'use strict';

/**
 * AI 준비도 42문항 채점.
 *
 * 1단계에서는 축 점수·성숙도·우선 개선 축까지만 낸다. 오퍼링 점수는 2단계에서
 * 가중치 행렬(readiness_offering_weights)이 들어온 뒤 이 파일에 더한다.
 *
 * 순수 함수로 둔 이유: DB 도 HTTP 도 모르므로 테스트가 값만 넣고 확인할 수 있다.
 * 점수 계산은 눈으로 검증하기 어려운 종류의 코드라 이게 중요하다.
 */

const AREA_ORDER = Object.freeze(['S', 'P', 'D', 'T', 'B', 'G']);

/**
 * 성숙도 5단계. nimble-dragon 의 구간을 그대로 쓴다.
 * 경계는 [min, max) 로 잡되 마지막만 5.0 을 포함한다.
 */
const MATURITY_LEVELS = Object.freeze([
  { level: 1, min: 0,   name: '초기',   en: 'Initial',      note: 'AI 도입 전 단계 — 전략·기반 부재' },
  { level: 2, min: 2.0, name: '준비',   en: 'Preparation',  note: '일부 시도 중 — 체계적 기반 구축 필요' },
  { level: 3, min: 3.0, name: '정착',   en: 'Settlement',   note: 'AI 내재화 진행 중 — 운영 체계 강화 필요' },
  { level: 4, min: 3.9, name: '확산',   en: 'Expansion',    note: '전사 AI 확산 단계 — 고도화·최적화 필요' },
  { level: 5, min: 4.5, name: '최적화', en: 'Optimization', note: 'AI 선도 기업 수준 — 자율 진화·신사업 단계' }
]);

const maturityFor = (average) =>
  [...MATURITY_LEVELS].reverse().find((l) => average >= l.min) || MATURITY_LEVELS[0];

const round2 = (n) => Math.round(n * 100) / 100;

function fail(message) {
  const error = new Error(message);
  error.expected = true;   // 라우트가 400 으로 내려보내는 표시
  throw error;
}

/**
 * @param {Array} items  readiness_items 행 (code·area·seq·text·rubric·target)
 * @param {Array} areas  readiness_areas 행 (id·name·sort_order)
 * @param {Object} rawScores  { S1: 3, S2: 1, ... }
 */
function scoreReadiness(items, areas, rawScores) {
  if (!Array.isArray(items) || items.length === 0) fail('진단 문항을 불러오지 못했습니다.');
  const scores = rawScores && typeof rawScores === 'object' && !Array.isArray(rawScores)
    ? rawScores : fail('응답은 객체여야 합니다.');

  // 미응답·범위 밖을 먼저 걸러낸다. 부분 응답으로 점수를 내면 "3점을 안 골랐는데
  // 3점으로 계산된" 결과가 나온다 — nimble 이 미응답을 막는 이유와 같다.
  const unanswered = [];
  const invalid = [];
  for (const item of items) {
    const raw = scores[item.code];
    if (raw === undefined || raw === null || raw === '') { unanswered.push(item.code); continue; }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 5) invalid.push(item.code);
  }
  const known = new Set(items.map((i) => i.code));
  const unknown = Object.keys(scores).filter((code) => !known.has(code));

  if (unknown.length) fail(`알 수 없는 문항이 있습니다: ${unknown.slice(0, 5).join(', ')}`);
  if (invalid.length) fail(`1~5 범위를 벗어난 응답이 있습니다: ${invalid.slice(0, 5).join(', ')}`);
  if (unanswered.length) {
    const error = new Error(`선택하지 않은 문항이 ${unanswered.length}개 있습니다.`);
    error.expected = true;
    error.unanswered = unanswered;
    throw error;
  }

  const areaName = new Map((areas || []).map((a) => [a.id, a.name]));
  const byArea = new Map();
  for (const item of items) {
    if (!byArea.has(item.area)) byArea.set(item.area, []);
    byArea.get(item.area).push(item);
  }

  const areaScores = [...byArea.entries()]
    .map(([id, list]) => {
      const sum = list.reduce((acc, item) => acc + Number(scores[item.code]), 0);
      return {
        area: id,
        name: areaName.get(id) || id,
        score: round2(sum / list.length),
        answered: list.length
      };
    })
    .sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area));

  // 종합은 문항 평균이 아니라 **축 평균의 평균**이다. 축마다 문항 수가 같아
  // 지금은 결과가 같지만, 문항이 늘어도 축 하나가 종합을 끌고 가지 않는다.
  const average = round2(areaScores.reduce((acc, a) => acc + a.score, 0) / areaScores.length);
  const maturity = maturityFor(average);

  const ranked = [...areaScores].sort((a, b) => a.score - b.score);
  const weakest = ranked[0];
  const strongest = ranked[ranked.length - 1];
  const low = ranked.filter((a) => a.score < 3.0);

  // 문항별 응답 + 고른 루브릭 문장. "왜 이 점수인지" 가 결과에 남아야 근거가 된다.
  const answers = items.map((item) => {
    const value = Number(scores[item.code]);
    const rubric = Array.isArray(item.rubric) ? item.rubric : [];
    return {
      code: item.code, area: item.area, text: item.text,
      respondent: item.respondent, score: value,
      rubric: rubric[value - 1] || '',
      gap: Math.max(0, Number(item.target ?? 4) - value)
    };
  });

  return {
    average,
    maturity: { ...maturity },
    areas: areaScores,
    weakest, strongest,
    lowAreas: low.map((a) => a.name),
    // 2단계에서 오퍼링 순위로 갈아끼운다. 지금은 최저 축 3개를 낸다.
    priorities: ranked.slice(0, 3).map((a) => ({
      area: a.area, name: a.name, score: a.score,
      items: answers
        .filter((x) => x.area === a.area)
        .sort((x, y) => x.score - y.score || x.code.localeCompare(y.code))
        .slice(0, 3)
        .map(({ code, text, score, rubric }) => ({ code, text, score, rubric }))
    })),
    insight: `현재 종합 AI 성숙도는 ${average.toFixed(2)}점(${maturity.name} 단계)입니다.`
      + ` 6대 영역 중 '${strongest.name}'(${strongest.score.toFixed(2)}점)이 가장 높고,`
      + ` '${weakest.name}'(${weakest.score.toFixed(2)}점)이 가장 낮습니다.`
      + (low.length ? ` ${low.map((a) => a.name).join(', ')} 영역은 3점 미만으로 우선 보강이 필요합니다.` : ''),
    answers
  };
}

module.exports = { scoreReadiness, maturityFor, MATURITY_LEVELS, AREA_ORDER };
