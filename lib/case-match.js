'use strict';

/**
 * 레퍼런스·사례 매칭 (047).
 *
 * 순수 함수로 둔다 — DB 도 pool 도 모른다. 서버와 목업이 **같은 규칙**을 쓰게 하고,
 * 규칙 자체를 DB 없이 검사할 수 있게 하려는 것이다.
 *
 * ⚠ 두 가지가 이 파일의 존재 이유다.
 *   ① **매칭이 0건이면 아무것도 안 준다.** 억지로 붙인 사례가 안 붙인 것보다 나쁘다 —
 *      고객이 "이게 우리랑 무슨 상관이죠" 라고 물으면 그 뒤 문서 전체를 안 믿는다.
 *   ② **승인 없으면 실명을 아예 안 싣는다.** 화면에서 숨기는 방식이면 언젠가 어느
 *      화면이 실수한다. 여기서 잘라 내보내면 실수할 대상이 없다.
 */

const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * 겹치는 만큼 점수를 준다. 업종이 가장 크고, 제품·패키지는 겹친 개수만큼.
 * 하나도 안 겹치면 0 이고, 0 은 후보에서 빠진다.
 */
function scoreCaseStudy(row, { industry, packages = [], slugs = [] } = {}) {
  let score = 0;
  if (industry && row.industry === industry) score += 3;
  const slugSet = new Set(slugs);
  score += asArray(row.isv_slugs).filter((slug) => slugSet.has(slug)).length * 2;
  score += asArray(row.package_ids).filter((id) => packages.includes(id)).length * 2;
  return score;
}

/** 문서에 실어 보낼 모양. **is_named 가 false 면 실명이 여기서 사라진다.** */
function publicShape(row, score) {
  return {
    id: row.id,
    headline: row.headline,
    customer: row.is_named ? row.customer_name : (row.customer_label || '고객사'),
    situation: row.situation || '',
    what_we_did: row.what_we_did || '',
    outcome: row.outcome || '',
    matchScore: score
  };
}

/**
 * 딜에 붙일 사례를 고른다. 겹치는 게 없으면 **빈 배열**이다.
 * 둘까지만 — 셋을 넘기면 사례집이 되고, 읽는 사람은 하나도 안 읽는다.
 */
function pickCaseStudies(rows, context = {}, limit = 2) {
  return asArray(rows)
    .filter((row) => row && row.status === 'published')
    .map((row) => ({ row, score: scoreCaseStudy(row, context) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.id).localeCompare(String(b.row.id)))
    .slice(0, limit)
    .map(({ row, score }) => publicShape(row, score));
}

/** 딜에서 매칭에 쓸 재료를 뽑는다. 서버와 목업이 같은 것을 넘기게 한다. */
function caseContext(deal, solutionSlugs) {
  return {
    industry: (deal?.customer_meta || {}).industry || '',
    packages: asArray(deal?.packages)
      .map((item) => (typeof item === 'string' ? item : item?.id)).filter(Boolean),
    slugs: asArray(solutionSlugs)
  };
}

module.exports = { scoreCaseStudy, pickCaseStudies, caseContext };
