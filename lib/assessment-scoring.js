'use strict';

/**
 * 도입 판정 기준 채점 — 기획안 Appendix A 10평가영역.
 *
 * 42문항(고객이 답한다)과 다른 층이다. 이쪽은 **"이 제품을 지금 넣을 수 있나"** 를
 * 묻는 게이트고, 037 bridge 가 42문항 응답에서 8개를 채운다. 나머지 둘(저장·보존 /
 * 계정·접근통제)은 제품 설정이라 영업이 STEP03 에서 후보별로 확인한다.
 *
 * 순수 함수로 둔 이유는 readiness-scoring 과 같다 — 눈으로 검증하기 어려운 종류라
 * 테스트가 값만 넣고 확인할 수 있어야 한다.
 */

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const round2 = (n) => Math.round(n * 100) / 100;

const isScore = (value) => Number.isFinite(Number(value))
  && Number(value) >= 1 && Number(value) <= 5;

/**
 * 42문항 응답으로 평가영역 점수를 만든다.
 *
 * 여러 문항이 한 영역을 채우면 **평균**이다. 최댓값이면 하나만 잘해도 통과하고,
 * 최솟값이면 하나만 못해도 막힌다 — 둘 다 판정을 왜곡한다.
 *
 * @param {Array}  bridge  [{item_code, area_id}]
 * @param {Object} readinessScores  {S1: 3, ...}
 */
function bridgeAssessmentScores(bridge, readinessScores) {
  const scores = asObject(readinessScores);
  const buckets = new Map();
  for (const link of Array.isArray(bridge) ? bridge : []) {
    const value = Number(scores[link?.item_code]);
    if (!isScore(value)) continue;
    if (!buckets.has(link.area_id)) buckets.set(link.area_id, []);
    buckets.get(link.area_id).push(value);
  }
  const result = {};
  for (const [area, list] of buckets) {
    result[area] = round2(list.reduce((a, b) => a + b, 0) / list.length);
  }
  return result;
}

/**
 * 영역별·대분류별 집계.
 *
 * @param {Array}  areas    assessment_areas 행 (id·domain_id·name·threshold·weight)
 * @param {Array}  domains  assessment_domains 행 (id·name)
 * @param {Object} rawScores {A01: 3, ...}
 */
function scoreAssessment(areas, domains, rawScores) {
  const list = Array.isArray(areas) ? areas : [];
  const scores = asObject(rawScores);

  const areaRows = list.map((area) => {
    const value = Number(scores[area.id]);
    const answered = isScore(value);
    const threshold = Number(area.threshold) || 3;
    return {
      area: area.id,
      domain: area.domain_id,
      name: area.name,
      score: answered ? round2(value) : null,
      threshold,
      weight: Number(area.weight) || 4,
      answered,
      // 모르는 것을 미달로 치지 않는다. 답이 없는 것과 낮은 것은 다르다.
      ready: answered ? value >= threshold : null
    };
  });

  const domainRows = {};
  for (const domain of (Array.isArray(domains) ? domains : [])) {
    const rows = areaRows.filter((r) => r.domain === domain.id && r.answered);
    const total = areaRows.filter((r) => r.domain === domain.id).length;
    if (!rows.length) {
      domainRows[domain.id] = {
        name: domain.name, score: null, threshold: null,
        answered: 0, total, ready: null
      };
      continue;
    }
    // 가중평균. 유출·계정통제처럼 되돌릴 수 없는 것이 더 무겁다(036).
    const weighted = rows.reduce((sum, r) => sum + r.score * r.weight, 0);
    const weight = rows.reduce((sum, r) => sum + r.weight, 0);
    const score = round2(weighted / weight);
    const threshold = Math.max(...rows.map((r) => r.threshold));
    domainRows[domain.id] = {
      name: domain.name, score, threshold,
      answered: rows.length, total, ready: score >= threshold
    };
  }

  const answeredCount = areaRows.filter((r) => r.answered).length;
  return {
    areas: areaRows,
    domains: domainRows,
    answeredCount,
    totalCount: areaRows.length,
    // 영업이 확인해야 하는 것. STEP03 에서 후보별로 묻는 대상이다.
    unanswered: areaRows.filter((r) => !r.answered).map((r) => r.area)
  };
}

/**
 * 추천 엔진에 넘길 갭 입력. 평가영역과 42문항 축을 한 맵에 담는다.
 * 키가 겹치지 않아(A01~A10 vs SPDTBG) 솔루션과 패키지가 각자 맞물린다.
 */
function buildGapTotals(assessmentTotals, readinessTotals) {
  const totals = {};
  const labels = {};
  const itemCount = {};

  for (const row of (asObject(assessmentTotals).areas || [])) {
    if (!row?.answered) continue;
    totals[row.area] = { score: row.score, threshold: row.threshold, answered: 1 };
    labels[row.area] = row.name;
    itemCount[row.area] = 1;
  }
  for (const row of (asObject(readinessTotals).areas || [])) {
    if (!Number.isFinite(Number(row?.score))) continue;
    // 42문항 축의 기준은 3.0 이다 — 미흡 영역 표시와 같은 선을 쓴다.
    totals[row.area] = { score: Number(row.score), threshold: 3, answered: Number(row.answered) || 1 };
    labels[row.area] = row.name;
    itemCount[row.area] = Number(row.total) || Number(row.answered) || 1;
  }
  return { totals, labels, itemCount };
}

module.exports = { scoreAssessment, bridgeAssessmentScores, buildGapTotals };
