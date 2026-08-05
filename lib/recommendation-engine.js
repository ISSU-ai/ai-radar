'use strict';

/**
 * STEP 03 ISV·패키지 추천 엔진.
 *
 * 설계 근거: docs/planning/recommendation-engine-design.md
 *
 * 두 가지가 이 엔진의 성격을 결정한다.
 *
 * 1) 평면 순위가 아니라 슬롯 채우기다. 22종의 category 고유값이 20개라 서로 비교
 *    가능한 집합이 아니다. Eleven Labs 와 Zscaler 를 한 줄로 세우는 것은 의미가 없다.
 *    그래서 "이 슬롯이 이 고객에게 필요한가"를 먼저 판정하고, 순위는 같은 슬롯
 *    안에서만 매긴다.
 *
 * 2) 전제 미충족은 탈락이 아니라 번들 기회다. Portal26 은 A 갭을 메우면서 동시에
 *    A[보안 게이트웨이]를 요구한다. 그냥 떨어뜨리면 SWG 미보유 고객에게 영원히
 *    안 나오는데, 실제 영업에서 그건 Zscaler + Portal26 을 함께 파는 자리다.
 *
 * 결정은 전부 규칙이다. 같은 딜에 어제와 오늘 다른 추천이 나오면 영업이 고객 앞에서
 * 신뢰를 잃는다. LLM 은 이 파일에 관여하지 않는다.
 *
 * red_flags 는 자동 판정하지 않는다. "SWG 미보유·도입계획 없음" 같은 산문 신호라
 * 기계가 참·거짓을 정할 수 없다. 자동 판정이 필요한 것은 prerequisites 로 옮겨 적고,
 * red_flags 는 영업이 눈으로 확인하도록 근거에 함께 실어 보낸다.
 */

/**
 * 갭 키의 이름표. 038 이후 두 어휘가 한 맵에 들어온다.
 *   A01~A10  기획안 Appendix A 평가영역 — ISV 도입 게이트
 *   S P D T B G  42문항 6축 — 고객 준비도 (패키지 선정)
 * 키가 겹치지 않아 한 맵에 두어도 섞이지 않는다. 이름표는 호출자가 넘긴다 —
 * 여기 적으면 시드를 고칠 때마다 엔진을 같이 고쳐야 한다.
 */
const CATEGORY_LABEL = Object.freeze({});

const SYNERGY_SCORE = Object.freeze({ '매우 높음': 1, '높음': 0.7, '중': 0.4 });

/**
 * 패키지의 딜 내 역할. ISV 와 한 줄로 세우지 않기 위한 축이다.
 * 패키지에는 synergy·grade·bundle_potential 이 없어 가중치 0.45 를 구조적으로 못 받는다.
 * 점수로 비교하면 아무리 잘 맞아도 ISV 보다 낮게 나온다 — 사과와 오렌지다.
 */
const PACKAGE_ROLE_LABEL = Object.freeze({
  entry: '진입·설계', enabler: '전제 해소', adopt: '정착·확산', operate: '지속 운영'
});

const DEFAULT_WEIGHTS = Object.freeze({
  gap_fit: 0.4, bundle: 0.25, industry_fit: 0.15, synergy: 0.1, grade: 0.1
});

const DEFAULT_FILTERS = Object.freeze({
  status: true, gap_relevance: true, scale: true, security_stack: true,
  budget: false, industry: false
});

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

const asObject = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try { const p = JSON.parse(value); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
  }
  return typeof value === 'object' ? value : {};
};

/** "전사 2,000명" · "1200" 처럼 자유 서술로 들어오는 값에서 좌석 수를 뽑는다. */
function parseSeats(meta) {
  const sim = Number(meta?.sim?.seats);
  if (Number.isFinite(sim) && sim > 0) return Math.round(sim);
  for (const key of ['targetUsers', 'companySize']) {
    const raw = String(meta?.[key] || '').replace(/,/g, '');
    const match = raw.match(/(\d{2,})/);
    if (match) return Number(match[1]);
  }
  return null;
}

/** 투자 여력 서술을 원화 상한으로 바꾼다. 모르면 null — 모를 때는 거르지 않는다. */
function parseBudget(meta) {
  const raw = String(meta?.investment || meta?.budget || '');
  const eok = raw.match(/(\d+(?:\.\d+)?)\s*억/);
  if (eok) return Number(eok[1]) * 100000000;
  const cheon = raw.match(/(\d+(?:,\d{3})*)\s*만/);
  if (cheon) return Number(cheon[1].replace(/,/g, '')) * 10000;
  const plain = raw.replace(/,/g, '').match(/(\d{7,})/);
  return plain ? Number(plain[1]) : null;
}

/**
 * 카테고리별 미달 폭과 신뢰도를 계산한다.
 * confidence = 응답 문항 수 / 전체 문항 수. 6문항 중 2개만 답한 갭과 6개 다 답한
 * 갭은 같은 무게로 다룰 수 없다.
 */
function analyseGaps(fqaTotals, itemCountByCategory, categoryLabels) {
  const labels = { ...CATEGORY_LABEL, ...asObject(categoryLabels) };
  const gaps = {};
  for (const [category, total] of Object.entries(asObject(fqaTotals))) {
    const score = Number(total?.score) || 0;
    const threshold = Number(total?.threshold) || 3;
    const answered = Number(total?.answered) || 0;
    const totalItems = Number(itemCountByCategory?.[category]) || answered || 1;
    gaps[category] = {
      category,
      label: labels[category] || category,
      score,
      threshold,
      answered,
      totalItems,
      failing: score < threshold,
      magnitude: Math.max(0, threshold - score),
      confidence: totalItems ? Math.min(1, answered / totalItems) : 0
    };
  }
  return gaps;
}

/** 후보가 미달 카테고리를 얼마나, 얼마나 확실하게 메우는가. 0~1 로 정규화. */
function scoreGapFit(coverage, gaps) {
  const reasons = [];
  let raw = 0;
  let maxPossible = 0;

  for (const entry of asArray(coverage)) {
    const gap = gaps[entry?.category];
    if (!gap) continue;
    const strength = Math.min(3, Math.max(0, Number(entry.strength) || 0)) / 3;
    maxPossible += strength * 1; // 미달 폭 최대치를 1 로 본다(threshold 5 - score 0 는 비현실적)
    if (!gap.failing || strength === 0) continue;

    const normalisedGap = Math.min(1, gap.magnitude / gap.threshold);
    const contribution = normalisedGap * strength * gap.confidence;
    raw += contribution;

    const items = asArray(entry.items).filter(Boolean);
    reasons.push({
      category: gap.category,
      text: `준비도 ${gap.category}(${gap.label}) ${gap.score}/5 — 임계값 ${gap.threshold} 미달`
        + `, ${gap.answered}/${gap.totalItems}문항 응답`
        + (items.length ? ` · "${items.join('", "')}" 보강` : '')
    });
  }

  return { score: maxPossible ? Math.min(1, raw / maxPossible) : 0, reasons };
}

/** 규모 표기(S/M/L 또는 서술)와 좌석 수가 어긋나는지. 판단 불가면 통과시킨다. */
function scaleConflicts(scale, seats) {
  if (!scale || !seats) return false;
  const text = String(scale).toUpperCase();
  if (/\bL\b|대형|엔터프라이즈/.test(text) && seats < 100) return true;
  if (/\bS\b|소형|스타트업/.test(text) && seats > 3000) return true;
  return false;
}

/**
 * 전제 조건을 판정한다.
 * @returns {{met:boolean, blockedBy:Array, pendingManual:Array, enablers:Array}}
 */
function evaluatePrerequisites(candidate, deal, gaps) {
  const blockedBy = [];
  const pendingManual = [];
  const enablers = [];
  // 화면이 넘겨주는 키와 같아야 한다. 패키지는 slug 가 없어 id 로 떨어진다 —
  // 여기만 slug 를 보면 패키지 확인이 영영 반영되지 않는다.
  const confirmations = asObject(deal.prereq_confirmations)[candidate.slug || candidate.id] || {};
  const meta = asObject(deal.customer_meta);
  const seats = parseSeats(meta);
  const budget = parseBudget(meta);

  for (const prereq of asArray(candidate.prerequisites)) {
    if (!prereq) continue;

    if (prereq.kind === 'assessment') {
      // 전제가 지목한 평가영역의 점수만 본다. 다른 영역 평균으로 때우지 않는다 —
      // 「계정·접근통제」를 「데이터 보호」 점수로 판정하면 조용히 틀린다.
      //
      // 모르면 영업에게 물어본다. 판정을 지어내지 않는다. 037 bridge 가 8개를
      // 채우고, 못 채우는 저장·보존·계정통제가 여기로 온다.
      const area = prereq.area || prereq.category;
      const actual = gaps[area]?.score;
      const label = prereq.label || `${area} ${prereq.min} 이상`;
      if (!Number.isFinite(actual)) {
        if (confirmations[label] !== true && prereq.blocking !== false) {
          pendingManual.push({ label, kind: 'assessment', area, min: Number(prereq.min) });
        }
        continue;
      }
      if (actual < Number(prereq.min)) {
        const entry = {
          label, category: area, area,
          actual, required: Number(prereq.min),
          enabled_by: asArray(prereq.enabled_by)
        };
        if (prereq.blocking !== false) blockedBy.push(entry);
        if (entry.enabled_by.length) enablers.push(...entry.enabled_by);
      }
      continue;
    }

    if (prereq.kind === 'numeric') {
      const actual = prereq.field === 'seats' ? seats
        : prereq.field === 'annual_budget_krw' ? budget : null;
      if (!Number.isFinite(actual)) continue; // 값이 없으면 통과
      const tooLow = Number.isFinite(prereq.min) && actual < Number(prereq.min);
      const tooHigh = Number.isFinite(prereq.max) && actual > Number(prereq.max);
      if (tooLow || tooHigh) {
        const entry = { label: prereq.label, actual, required: prereq.min ?? prereq.max };
        if (prereq.blocking !== false) blockedBy.push(entry);
      }
      continue;
    }

    // manual — 영업이 확인해야 한다. 확인 전에는 판정을 보류한다.
    if (confirmations[prereq.label] !== true && prereq.blocking !== false) {
      pendingManual.push({ label: prereq.label });
    }
  }

  return { met: blockedBy.length === 0, blockedBy, pendingManual, enablers: [...new Set(enablers)] };
}

/**
 * @param {object} input
 * @param {object} input.deal              customer_meta · track · prereq_confirmations
 * @param {Array}  input.solutions         후보 솔루션
 * @param {Array}  input.packages          후보 패키지
 * @param {Map}    input.slots             슬롯 분류표 id → {name, layer, is_competitive}
 * @param {object} input.itemCountByCategory 카테고리별 전체 문항 수 (신뢰도 계산용)
 * @param {object} input.config            {weights, filters}
 */
function recommend(input = {}) {
  const deal = asObject(input.deal);
  const slots = input.slots instanceof Map ? input.slots : new Map();
  const weights = { ...DEFAULT_WEIGHTS, ...asObject(input.config?.weights) };
  const filters = { ...DEFAULT_FILTERS, ...asObject(input.config?.filters) };
  // 평가영역(A01~A10)과 42문항 축(SPDTBG)이 한 맵에 들어온다. 키가 겹치지 않아
  // 솔루션은 평가영역으로, 패키지는 축으로 각자 맞물린다.
  const gaps = analyseGaps(input.totals ?? deal.assessment_totals,
    input.itemCountByCategory, input.categoryLabels);
  const failingCategories = Object.values(gaps).filter((g) => g.failing);
  const meta = asObject(deal.customer_meta);
  const seats = parseSeats(meta);
  const industry = String(meta.industry || '').trim();

  const evaluateCandidate = (candidate, kind) => {
    const reasons = [];
    const excludedBy = [];

    if (filters.status) {
      if (candidate.status_op === 'paused') excludedBy.push('운영 중단(status_op=paused)');
      if (kind === 'solution' && candidate.status && candidate.status !== 'published') {
        excludedBy.push('미발행(draft)');
      }
    }

    // 호출자가 어휘를 맞춰 넘긴다. 솔루션은 평가영역, 패키지는 42문항 축이다.
    const coverage = asArray(candidate.coverage);
    if (filters.gap_relevance) {
      const touches = coverage.some((entry) => gaps[entry?.category]?.failing);
      if (!touches) {
        excludedBy.push(coverage.length
          ? '미달 카테고리를 메우지 않음'
          : '판정 데이터(assessment_coverage) 미입력');
      }
    }

    if (filters.scale && scaleConflicts(candidate.scale, seats)) {
      excludedBy.push(`규모 불일치(${candidate.scale} vs ${seats}석)`);
    }

    // 타사 SWG 를 이미 쓰면 보안 게이트웨이 슬롯을 새로 넣을 때 충돌한다.
    //
    // 예전에는 track === 'T-D' 로 봤다. 트랙이 구매 동기로 바뀌면서(034) 그 대리
    // 지표가 사라졌고, 원래 근거인 securityStack 을 직접 본다. 더 정확하기도 하다 —
    // 트랙은 영업이 손으로 바꿀 수 있어 보안 환경과 어긋날 수 있었다.
    // 판정 범위는 그대로 둔다. 예전 T-D 는 "Zscaler 가 아닌 타사 SWG" 였고 Zscaler
    // 보유 고객(T-C)은 걸리지 않았다. 여기서 범위까지 넓히면 트랙 교체 때문인지
    // 판정 변경 때문인지 구분할 수 없게 된다.
    const swg = String(meta.securityStack || meta.security || '').toLowerCase();
    const otherSwg = swg && !swg.includes('zscaler')
      && !['none', '없음', 'unknown', '미정'].includes(swg);
    if (filters.security_stack && otherSwg && candidate.slot === 'security-gateway') {
      excludedBy.push('타사 SWG 운영 중 — 게이트웨이 중복');
    }

    const industries = asArray(candidate.industries);
    const industryEntry = industry
      ? industries.find((e) => String(e?.industry || '').includes(industry) || industry.includes(String(e?.industry || '')))
      : null;
    if (filters.industry && industryEntry && industryEntry.fit === 'low') {
      excludedBy.push(`업종 부적합(${industry})`);
    }

    const gapFit = scoreGapFit(coverage, gaps);
    reasons.push(...gapFit.reasons.map((r) => r.text));

    const prereq = kind === 'solution'
      ? evaluatePrerequisites(candidate, deal, gaps)
      : { met: true, blockedBy: [], pendingManual: [], enablers: [] };

    const industryFit = industryEntry
      ? (industryEntry.fit === 'high' ? 1 : industryEntry.fit === 'mid' ? 0.5 : 0.2)
      : 0.2;
    if (industryEntry?.fit === 'high') reasons.push(`업종 ${industryEntry.industry} 적합(high)`);

    const bundlePotential = (Number(candidate.bundle_potential) || 0) / 3;
    const synergy = SYNERGY_SCORE[candidate.synergy] || 0;
    const grade = (Number(candidate.grade) || 0) / 3;

    const score = Number((
      weights.gap_fit * gapFit.score
      + weights.bundle * bundlePotential
      + weights.industry_fit * industryFit
      + weights.synergy * synergy
      + weights.grade * grade
    ).toFixed(4));

    const slot = slots.get(candidate.slot);
    return {
      kind,
      id: candidate.id,
      slug: candidate.slug || candidate.id,
      name: candidate.name,
      slot: candidate.slot || null,
      slotName: slot?.name || null,
      domain: slot?.domain || null,
      domainName: slot?.domain_name || null,
      layer: candidate.layer || slot?.layer || null,
      score,
      gapFit: Number(gapFit.score.toFixed(4)),
      reasons,
      redFlags: asArray(candidate.red_flags),
      role: candidate.role || null,
      roleLabel: PACKAGE_ROLE_LABEL[candidate.role] || null,
      dependsOn: asArray(candidate.depends_on),
      // 040 이 packages.readiness_lift 를 지운다. 038 의 assessment_lift 가 호출자에서
      // candidate.lift 로 온다 — 옛 컬럼 폴백을 남기면 죽은 경로가 살아 있는 척한다.
      readinessLift: asObject(candidate.lift),
      rawCoverage: coverage,
      // 번들 선행 판정은 **다른 어휘**를 쓴다. 패키지는 42문항 축으로 뽑히지만
      // 푸는 것은 평가영역이다. 둘을 한 필드에 두면 후보 점수가 이중으로 계산된다.
      enablerCoverage: asArray(candidate.enablerCoverage ?? coverage),
      prerequisites: prereq,
      excludedBy
    };
  };

  const evaluated = [
    ...asArray(input.solutions).map((s) => evaluateCandidate(s, 'solution')),
    ...asArray(input.packages).map((p) => evaluateCandidate(p, 'package'))
  ];

  const eligible = [];
  const excluded = [];
  const needsConfirmation = [];
  const blocked = [];

  for (const item of evaluated) {
    if (item.excludedBy.length) { excluded.push(item); continue; }
    if (!item.prerequisites.met) { blocked.push(item); continue; }
    if (item.prerequisites.pendingManual.length) { needsConfirmation.push(item); continue; }
    eligible.push(item);
  }

  // 전제를 못 넘긴 후보 중, 그 전제를 메워줄 후보가 적합 목록에 있으면 번들로 살린다.
  const eligibleBySlug = new Map(eligible.map((item) => [item.slug, item]));

  /**
   * "이 후보가 그 전제를 실제로 다루는가."
   *
   * 전제는 문항 단위인데(D "예산·구매 준비도") readiness_lift 는 카테고리 단위다.
   * 카테고리만 맞춰 보면 역할별 교육 키트(ADOPTION, D 상승 1.2)가 예산·구매 전제를
   * 풀어준다고 말한다 — 그 패키지가 덮는 것은 현업 오너십·변화관리인데도. 영업이
   * 고객 앞에서 못 지킬 약속을 하는 셈이라, 어느 경로로 오든 이 판정을 통과해야 한다.
   */
  const strengthFor = (cand, need) => {
    let best = 0;
    for (const entry of asArray(cand.enablerCoverage)) {
      if (entry?.category !== need.category) continue;
      const strength = Number(entry.strength) || 0;
      if (strength < 2) continue;
      const items = asArray(entry.items);
      if (need.item && items.length && !items.includes(need.item)) continue;
      if (strength > best) best = strength;
    }
    return best;
  };

  const coversNeed = (cand, need) => strengthFor(cand, need) > 0;

  /**
   * 같은 전제를 여러 후보가 풀 수 있으면 가장 깊게 다루는 쪽을 고른다.
   *
   * 017 이후 A "접근권한과 계정 체계"를 02 AI Trust(strength 3)와 03 AI-Ready(2)가
   * 함께 덮는다. 먼저 찾은 것을 쓰면 6~10주짜리 03 이 3~4주짜리 02 를 제치고 붙을 수
   * 있고, 그 순서는 DB 가 행을 돌려주는 순서에 달려 있다 — 같은 딜에 어제와 오늘
   * 다른 추천이 나오는 바로 그 상황이다.
   */
  const pickBest = (cands, need) => {
    let best = null;
    let bestKey = null;
    for (const cand of cands) {
      const key = [strengthFor(cand, need), cand.score];
      if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
        best = cand;
        bestKey = key;
      }
    }
    return best;
  };

  /**
   * 후보가 그 전제를 수치로 넘겨주면 { lift, projected } 를, 아니면 null 을 준다.
   * 판정은 반올림 전 값으로 하고 표시만 반올림한다 — 2.96 을 3.0 으로 올려 "충족"
   * 이라 말하지 않기 위해서다.
   */
  const liftFor = (cand, need) => {
    if (!need?.category || !coversNeed(cand, need)) return null;
    const lift = Number(cand.readinessLift?.[need.category]);
    if (!Number.isFinite(lift) || lift <= 0) return null;
    const projected = (Number(need.actual) || 0) + lift;
    if (projected < Number(need.required)) return null;
    return { lift, projected: Number(projected.toFixed(1)) };
  };

  /**
   * enabled_by 가 비어 있어도 전제를 메워줄 후보를 찾는다.
   *
   * 실데이터를 돌려보니 준비도가 낮은 고객일수록 모든 ISV 가 전제 미충족으로
   * 탈락했다. A(보안)를 메우는 ISV 들이 하필 A·C 항목을 전제로 요구하기 때문이다.
   * 도움이 가장 필요한 고객이 아무것도 못 받는 셈이다.
   *
   * 실제 답은 "ISV 전에 MZC 패키지로 준비도를 먼저 올린다"이고, 그 연결은
   * 패키지의 enablerCoverage 와 막힌 전제의 평가영역을 대조하면 자동으로 나온다.
   * enabled_by 를 일일이 적지 않아도 되므로 ISSU 입력 부담도 줄어든다.
   */
  const findImplicitEnabler = (blockedBy) => {
    for (const need of blockedBy) {
      if (!need.category) continue;
      // readiness_lift 가 있으면 그것을 먼저 본다. "얼마나 올려주는가"를 아는 후보가
      // "그 영역을 다룬다"만 아는 후보보다 근거가 강하다.
      const byLift = pickBest(eligible.filter((cand) => liftFor(cand, need)), need);
      if (byLift) return byLift;

      const match = pickBest(eligible.filter((cand) => coversNeed(cand, need)), need);
      if (match) return match;
    }
    return null;
  };

  const bundles = [];
  for (const item of blocked) {
    const enabler = item.prerequisites.enablers
      .map((slug) => eligibleBySlug.get(slug))
      .find(Boolean)
      || findImplicitEnabler(item.prerequisites.blockedBy);
    if (enabler) {
      bundles.push({
        ...item,
        enabler: { slug: enabler.slug, name: enabler.name, slot: enabler.slot },
        score: Number(((item.score + enabler.score) / 2).toFixed(4)),
        reasons: [
          ...item.reasons,
          `단, ${item.prerequisites.blockedBy.map((b) => b.label).join(' / ')} 전제가 충족되지 않음`,
          bundleEnablerReason(item, enabler)
        ]
      });
    } else {
      excluded.push({
        ...item,
        excludedBy: item.prerequisites.blockedBy.map((b) => `전제 미충족: ${b.label}`)
      });
    }
  }

  /**
   * "SECURITY 선행 → A 1.8 → 3.3 예상, 전제 3.0 충족" 처럼 수치까지 말한다.
   * 수치는 enabler 가 그 문항을 실제로 덮을 때만 붙인다. 못 덮으면 근거 없는 숫자가
   * 되므로, 막힌 전제 중 하나라도 통과하는 것을 찾고 없으면 문장으로만 말한다.
   */
  function bundleEnablerReason(item, enabler) {
    for (const need of item.prerequisites.blockedBy) {
      const hit = liftFor(enabler, need);
      if (!hit) continue;
      return `→ ${enabler.name} 선행 시 ${need.category} ${need.actual} → ${hit.projected} 예상`
        + ` (전제 ${need.required} 충족)`;
    }
    return `→ ${enabler.kind === 'package' ? `${enabler.name} 패키지로 준비도를 올린 뒤` : `${enabler.name} 선행 시`} 도입 가능`;
  }

  const bySlotThenScore = (a, b) => (a.slot || '').localeCompare(b.slot || '') || b.score - a.score;
  const byScore = (a, b) => b.score - a.score;

  return {
    gaps: Object.values(gaps).sort((a, b) => b.magnitude - a.magnitude),
    failingCategories: failingCategories.map((g) => `${g.category}(${g.label})`),
    // 영업이 평가영역을 직접 확인했으면 "실사 반영" 이다. 예전에는 deals.fqa_reviewed_at
    // 이라는 별도 표시를 썼는데 040 이 그 컬럼을 지운다 — 확인 자체가 곧 표시다.
    reviewed: Boolean(deal.assessment_reviewed_at)
      || Object.keys(asObject(deal.prereq_confirmations)).length > 0,
    label: (Boolean(deal.assessment_reviewed_at)
      || Object.keys(asObject(deal.prereq_confirmations)).length > 0)
      ? '실사 반영 추천' : '고객 자가응답 기준 잠정 추천',
    // 제안 3단 구조. 패키지를 ISV 와 같은 목록에 섞지 않는다.
    //   준비(entry·enabler) → 도입(ISV) → 정착·운영(adopt·operate)
    proposal: {
      prepare: eligible.filter((x) => x.kind === 'package' && ['entry', 'enabler'].includes(x.role)),
      adopt: eligible.filter((x) => x.kind === 'solution'),
      operate: eligible.filter((x) => x.kind === 'package' && ['adopt', 'operate'].includes(x.role)),
      unclassified: eligible.filter((x) => x.kind === 'package' && !x.role)
    },
    eligible: eligible.sort(byScore),
    bundles: bundles.sort(byScore),
    needsConfirmation: needsConfirmation.sort(byScore),
    excluded: excluded.sort(bySlotThenScore)
  };
}

module.exports = {
  recommend,
  PACKAGE_ROLE_LABEL,
  analyseGaps,
  scoreGapFit,
  evaluatePrerequisites,
  parseSeats,
  parseBudget,
  scaleConflicts,
  DEFAULT_WEIGHTS,
  DEFAULT_FILTERS,
  CATEGORY_LABEL
};
