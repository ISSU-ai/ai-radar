'use strict';

/**
 * 추천 엔진. 결정은 전부 규칙이라 같은 입력이면 같은 결과가 나와야 한다 —
 * 같은 딜에 어제와 오늘 다른 추천이 나오면 영업이 고객 앞에서 신뢰를 잃는다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  recommend, analyseGaps, parseSeats, parseBudget, scaleConflicts
} = require('../lib/recommendation-engine');

const root = path.resolve(__dirname, '..');
const ITEM_COUNTS = { A: 6, B: 5, C: 5, D: 5 };

const slots = new Map([
  ['llm-platform', { name: '범용 LLM 플랫폼', layer: 'L1', is_competitive: true }],
  ['security-gateway', { name: '네트워크 보안·SWG', layer: 'L4', is_competitive: true }],
  ['ai-usage-governance', { name: 'AI 사용 가시성·거버넌스', layer: 'L4', is_competitive: false }]
]);

/** A 미달, 나머지 충족. */
const lowSecurityDeal = {
  track: 'T-B',
  customer_meta: { industry: '금융/보험', targetUsers: '전사 2,000명', investment: '3억' },
  totals: {
    A: { score: 1.8, threshold: 3.5, answered: 6, ready: false },
    B: { score: 3.4, threshold: 3.0, answered: 5, ready: true },
    C: { score: 3.2, threshold: 3.0, answered: 5, ready: true },
    D: { score: 3.6, threshold: 3.5, answered: 5, ready: true }
  },
  prereq_confirmations: {}
};

/**
 * 문항별 점수. 전제가 특정 문항을 지목하면 엔진은 **그 문항 점수만** 본다 —
 * 카테고리 평균으로 때우지 않는다. 42문항이 030 bridge 로 채우는 것은 21문항 중
 * 13개뿐이라, 나머지를 카테고리 평균으로 판정하면 조용히 틀린다.
 *
 * 그래서 여기 없는 문항은 "모른다" 가 되고, 후보는 제외가 아니라 확인 필요로 간다.
 */
const ITEM_SCORES = {
  '데이터 분류와 민감도 기준': 2,
  '접근권한과 계정 체계': 1.8,
  '감사 로그와 추적성': 2,
  '데이터 보존·삭제 정책': 1.5,
  '보안 게이트웨이 준비도': 1.5,
  '개발·테스트 환경': 3.4,
  '예산·구매 준비도': 3.6
};

const run = (extra) => recommend({
  deal: lowSecurityDeal, slots, itemCountByCategory: AREA_COUNTS,  ...extra
});

test('갭 분석이 미달 여부와 신뢰도를 계산한다', () => {
  const gaps = analyseGaps(lowSecurityDeal.fqa_totals, ITEM_COUNTS);
  assert.equal(gaps.A.failing, true);
  assert.equal(gaps.A.magnitude, 1.7);
  assert.equal(gaps.A.confidence, 1);           // 6문항 전부 응답
  assert.equal(gaps.B.failing, false);

  // 6문항 중 2개만 답하면 신뢰도가 3분의 1이다.
  const partial = analyseGaps({ A: { score: 1, threshold: 3.5, answered: 2 } }, ITEM_COUNTS);
  assert.ok(Math.abs(partial.A.confidence - 1 / 3) < 0.01);
});

test('미달 카테고리를 안 메우는 후보는 제외한다', () => {
  const out = run({
    solutions: [
      { slug: 'covers-a', name: 'A보강', slot: 'llm-platform', status: 'published',
        coverage: [{ category: 'A01', strength: 3 }] },
      { slug: 'covers-b', name: 'B보강', slot: 'llm-platform', status: 'published',
        coverage: [{ category: 'A04', strength: 3 }] }
    ]
  });
  assert.deepEqual(out.eligible.map((x) => x.slug), ['covers-a']);
  assert.equal(out.excluded[0].slug, 'covers-b');
  assert.match(out.excluded[0].excludedBy[0], /미달 카테고리를 메우지 않음/);
});

test('판정 데이터가 비면 제외 사유를 그렇게 밝힌다', () => {
  const out = run({
    solutions: [{ slug: 'empty', name: '미보강', slot: 'llm-platform', status: 'published', coverage: [] }]
  });
  assert.match(out.excluded[0].excludedBy[0], /판정 데이터\(fqa_coverage\) 미입력/);
});

test('운영중단·미발행·게이트웨이 중복을 거른다', () => {
  const base = { slot: 'llm-platform', status: 'published', coverage: [{ category: 'A01', strength: 3 }] };
  const out = run({
    solutions: [
      { ...base, slug: 'paused', name: '중단', status_op: 'paused' },
      { ...base, slug: 'draft', name: '초안', status: 'draft' }
    ]
  });
  assert.equal(out.eligible.length, 0);

  // 034 로 트랙이 구매 동기가 되면서 판정 근거를 customer_meta.securityStack 으로
  // 옮겼다. 트랙은 영업이 손으로 바꿀 수 있어 보안 환경과 어긋날 수 있었다.
  const swgDeal = (securityStack) => recommend({
    deal: { ...lowSecurityDeal, track: 'E-1', customer_meta: { ...lowSecurityDeal.customer_meta, securityStack } },
    slots, itemCountByCategory: AREA_COUNTS, 
    solutions: [{ ...base, slug: 'swg', name: 'SWG', slot: 'security-gateway' }]
  });
  assert.match(swgDeal('other-swg').excluded[0].excludedBy[0], /타사 SWG 운영 중/);

  // Zscaler 보유 고객은 예전에도 안 걸렸다. 범위를 넓히지 않는다.
  assert.equal(swgDeal('zscaler').excluded.length, 0, 'Zscaler 고객까지 걸면 판정이 바뀐다');
  assert.equal(swgDeal('none').excluded.length, 0);
});

test('fqa 전제가 미달이면 적합에서 빠진다', () => {
  const out = run({
    solutions: [{
      slug: 'needs-a', name: 'A전제', slot: 'llm-platform', status: 'published',
      coverage: [{ category: 'A01', strength: 3 }],
      // A 를 메우면서 A 를 요구하는 구조 — Portal26 과 같은 형태
      prerequisites: [{ kind: 'assessment', area: 'A03', min: 3, blocking: true, label: 'SSO 인프라' }]
    }]
  });
  assert.equal(out.eligible.length, 0);
  assert.equal(out.excluded.length, 1);
  assert.match(out.excluded[0].excludedBy[0], /전제 미충족: SSO 인프라/);
});

test('numeric 전제는 좌석·예산으로 자동 판정한다', () => {
  const solutions = [{
    slug: 'big-only', name: '대규모전용', slot: 'llm-platform', status: 'published',
    coverage: [{ category: 'A01', strength: 3 }],
    prerequisites: [{ kind: 'numeric', field: 'seats', min: 5000, blocking: true, label: '최소 5,000석' }]
  }];
  assert.equal(run({ solutions }).eligible.length, 0, '2,000석이라 미달이어야 한다');

  solutions[0].prerequisites[0].min = 100;
  assert.equal(run({ solutions }).eligible.length, 1, '2,000석이면 통과해야 한다');
});

test('값이 없으면 전제로 거르지 않는다', () => {
  const out = recommend({
    deal: { ...lowSecurityDeal, customer_meta: { industry: '금융/보험' } }, // 좌석·예산 없음
    slots, itemCountByCategory: AREA_COUNTS,
    solutions: [{
      slug: 'x', name: 'X', slot: 'llm-platform', status: 'published',
      coverage: [{ category: 'A01', strength: 3 }],
      prerequisites: [{ kind: 'numeric', field: 'seats', min: 5000, blocking: true, label: '5,000석' }]
    }]
  });
  assert.equal(out.eligible.length, 1, '판단 불가면 통과시켜야 한다');
});

test('manual 전제는 확인 전까지 "확인 필요"로 보류한다', () => {
  const solutions = [{
    slug: 'legal', name: '법무필요', slot: 'llm-platform', status: 'published',
    coverage: [{ category: 'A01', strength: 3 }],
    prerequisites: [{ kind: 'manual', label: '법무 검토 완료', blocking: true }]
  }];
  const pending = run({ solutions });
  assert.equal(pending.needsConfirmation.length, 1);
  assert.equal(pending.eligible.length, 0);

  const confirmed = recommend({
    deal: { ...lowSecurityDeal, prereq_confirmations: { legal: { '법무 검토 완료': true } } },
    slots, itemCountByCategory: AREA_COUNTS, solutions
  });
  assert.equal(confirmed.eligible.length, 1);
});

test('enabled_by 가 적합 후보에 있으면 번들로 살린다', () => {
  const out = run({
    solutions: [
      { slug: 'zscaler', name: 'Zscaler', slot: 'security-gateway', status: 'published',
        coverage: [{ category: 'A01', strength: 3 }] },
      { slug: 'portal26', name: 'Portal26', slot: 'ai-usage-governance', status: 'published',
        coverage: [{ category: 'A05', strength: 3 }],
        prerequisites: [{ kind: 'assessment', area: 'A01', min: 3,
          blocking: true, label: 'SWG 보유', enabled_by: ['zscaler'] }] }
    ]
  });
  assert.deepEqual(out.eligible.map((x) => x.slug), ['zscaler']);
  assert.equal(out.bundles.length, 1);
  assert.equal(out.bundles[0].slug, 'portal26');
  assert.equal(out.bundles[0].enabler.slug, 'zscaler');
  assert.ok(out.bundles[0].reasons.some((r) => /Zscaler 선행 시 도입 가능/.test(r)));
});

test('enabled_by 가 없어도 갭을 메우는 패키지를 선행으로 잇는다', () => {
  // 실데이터에서 준비도 낮은 고객의 ISV 가 전부 탈락했다. 답은 "패키지로 준비도를
  // 먼저 올린다"이고, 그 연결은 커버리지 대조로 자동으로 나와야 한다.
  const out = run({
    solutions: [{
      slug: 'needs-a', name: 'A전제ISV', slot: 'llm-platform', status: 'published',
      coverage: [{ category: 'A08', strength: 2 }],
      prerequisites: [{ kind: 'assessment', area: 'A03', min: 3,
        blocking: true, label: 'IAM 관리 엔지니어' }]
    }],
    packages: [{
      id: 'SECURITY', slug: 'SECURITY', name: 'AI Security Readiness',
      coverage: [{ category: 'A03', strength: 3 }, { category: 'A08', strength: 3 }]
    }]
  });
  assert.equal(out.eligible.length, 1);
  assert.equal(out.eligible[0].kind, 'package');
  assert.equal(out.bundles.length, 1);
  assert.equal(out.bundles[0].enabler.slug, 'SECURITY');
  assert.ok(out.bundles[0].reasons.some((r) => /패키지로 준비도를 올린 뒤/.test(r)));
});

/**
 * 시드 SQL 을 그대로 읽어 후보를 만든다. 판정 데이터를 손대면 아래 검사들이 반응한다.
 * 012(ISV 9종) + 019(ISV 8종 추가) + 017(패키지 6종, 014·016 대체).
 */
/**
 * 21문항 전체에 카테고리 점수를 펼친 문항별 점수.
 *
 * 실데이터 검사는 "네 축이 모두 낮은 고객" 을 만들어 번들이 나오는지 본다. 엔진은
 * 이제 전제가 지목한 문항 점수만 보므로, 카테고리만 주면 전부 "모름" 이 되어
 * 후보가 확인 필요로 빠진다 — 검사하려던 것이 검사되지 않는다.
 *
 * 화면에서는 030 bridge 가 채운 13개만 값이 있고 나머지는 확인 필요로 간다.
 * 여기서는 그 구분이 논점이 아니므로 전부 채워 번들 계산 자체를 본다.
 */
function itemScoresFromCategories(fqaTotals) {
  const seed = fs.readFileSync(path.join(root, 'db', 'migrations', '001_enablement_hub.sql'), 'utf8');
  const scores = {};
  for (const m of seed.matchAll(/\('([ABCD])',\s*\d+,\s*'([^']+)'/g)) {
    const category = fqaTotals[m[1]];
    if (category) scores[m[2]] = Number(category.score);
  }
  return scores;
}

function loadSeeds() {
  const read = (f) => fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8');
  const pick = (block, field) => {
    const m = block.match(new RegExp(`${field} = '([\\s\\S]*?)'::jsonb`));
    return m ? JSON.parse(m[1]) : [];
  };
  const solutionsIn = (sql) => [...sql.matchAll(
    /update solutions set\s*\n([\s\S]*?)where slug (?:=|in) \(?((?:'[a-z0-9-]+'(?:,\s*)?)+)\)?;/g
  )].flatMap((m) => [...m[2].matchAll(/'([a-z0-9-]+)'/g)].map((s) => ({
    slug: s[1], name: s[1], slot: 'llm-platform', status: 'published',
    coverage: pick(m[1], 'fqa_coverage'),
    prerequisites: pick(m[1], 'prerequisites'),
    red_flags: pick(m[1], 'red_flags')
  }))).filter((s) => s.fqa_coverage.length);

  // 035 가 패키지를 기획안 5대 오퍼링으로 재편했다. 017 의 옛 6종을 읽으면
  // 이미 DB 에 없는 것을 검사하게 된다.
  const offering = read('035_offering_packages.sql');
  const lifts = new Map([...offering.matchAll(
    /readiness_lift = '(\{[\s\S]*?\})'::jsonb\s*\n\s*where id = '(\w+)'/g
  )].map((m) => [m[2], JSON.parse(m[1])]));
  const packages = [...offering.matchAll(
    /update packages set\s*\n\s*fqa_coverage = '([\s\S]*?)'::jsonb,\s*\n\s*readiness_lift = '\{[\s\S]*?\}'::jsonb\s*\n\s*where id = '(\w+)'/g
  )].map((m) => ({
    id: m[2], slug: m[2], name: m[2],
    coverage: JSON.parse(m[1]), readiness_lift: lifts.get(m[2]) || {}
  }));

  return {
    solutions: [...solutionsIn(read('012_seed_recommendation_rules.sql')),
      ...solutionsIn(read('019_isv_offering_alignment.sql'))],
    packages,
    lifts
  };
}

/**
 * readiness_lift 는 카테고리 단위, 전제는 문항 단위다. 카테고리만 맞춰 보면 엉뚱한
 * 패키지가 "이걸 하면 전제가 풀린다"고 말한다 — 영업이 고객 앞에서 못 지킬 약속을
 * 하게 되므로, 아래 네 건은 그 경계를 지킨다.
 */

/** D 가 미달인 딜. 예산·구매 준비도 계열 전제를 시험하는 데 쓴다. */
/** lowBusinessDeal 용 문항 점수. 카테고리 점수와 같게 둬 기존 번들 계산을 보존한다. */
const BUSINESS_ITEM_SCORES = {
  '개발·테스트 환경': 2.4,
  '모델·벤더 전환성': 2.4,
  '예산·구매 준비도': 2.0,
  '현업 오너십': 2.0,
  '접근권한과 계정 체계': 3.6
};

const lowBusinessDeal = {
  track: 'T-B',
  customer_meta: { industry: '제조', targetUsers: '500명', investment: '2억' },
  totals: {
    A: { score: 3.6, threshold: 3.0, answered: 6, ready: true },
    B: { score: 2.4, threshold: 3.0, answered: 5, ready: false },
    C: { score: 3.4, threshold: 3.0, answered: 5, ready: true },
    D: { score: 2.0, threshold: 3.0, answered: 5, ready: false }
  },
  prereq_confirmations: {}
};

test('문항을 안 덮는 패키지는 lift 가 있어도 선행으로 쓰지 않는다', () => {
  // ADOPTION 은 D 를 1.2 올리지만 덮는 것은 현업 오너십·변화관리·교육이다.
  // 예산·구매 준비도는 손도 대지 않으므로 "이걸 하면 예산 전제가 풀린다"고 말하면 안 된다.
  const out = recommend({
    deal: lowBusinessDeal, slots, itemCountByCategory: AREA_COUNTS, itemScores: BUSINESS_ITEM_SCORES,
    solutions: [{
      slug: 'needs-budget', name: '예산전제ISV', slot: 'llm-platform', status: 'published',
      coverage: [/* 대응 없음 */],
      prerequisites: [{ kind: 'manual',
        blocking: true, label: '예산·구매 준비도 3 이상' }]
    }],
    packages: [{
      id: 'ADOPTION', slug: 'ADOPTION', name: '도입 확산 키트',
      coverage: [/* 대응 없음 */],
      readiness_lift: { D: 1.2 }
    }]
  });

  assert.equal(out.bundles.length, 0,
    `근거 없는 번들: ${out.bundles.map((b) => b.reasons.at(-1)).join(' / ')}`);
  assert.deepEqual(out.excluded.map((x) => x.slug), ['needs-budget']);
  assert.ok(out.excluded[0].excludedBy.some((r) => /예산·구매 준비도/.test(r)));
});

test('같은 카테고리라도 문항을 덮는 패키지가 선행이 된다', () => {
  // INTEGRATION 의 lift(B +1.5)가 POC(B +0.8)보다 크고 목록에도 먼저 오지만,
  // "개발·테스트 환경"을 덮는 것은 POC 뿐이다. 큰 숫자가 아니라 맞는 문항이 이긴다.
  const out = recommend({
    deal: lowBusinessDeal, slots, itemCountByCategory: AREA_COUNTS, itemScores: BUSINESS_ITEM_SCORES,
    solutions: [{
      slug: 'needs-devenv', name: '개발환경전제ISV', slot: 'llm-platform', status: 'published',
      coverage: [{ category: 'A10', strength: 2 }],
      prerequisites: [{ kind: 'manual',
        blocking: true, label: '개발·테스트 환경 3 이상' }]
    }],
    packages: [
      { id: 'INTEGRATION', slug: 'INTEGRATION', name: 'AI Integration',
        coverage: [{ category: 'A04', strength: 3 }, { category: 'A07', strength: 3 }],
        readiness_lift: { B: 1.5 } },
      { id: 'POC', slug: 'POC', name: 'AI PoC',
        coverage: [/* 대응 없음 */,
          /* 대응 없음 */],
        readiness_lift: { B: 0.8, D: 0.8 } }
    ]
  });

  assert.equal(out.bundles.length, 1);
  assert.equal(out.bundles[0].enabler.slug, 'POC');
  assert.ok(out.bundles[0].reasons.some((r) => /B 2\.4 → 3\.2 예상 \(전제 3 충족\)/.test(r)),
    out.bundles[0].reasons.join(' / '));
});

test('번들 사유의 수치는 enabler 가 실제로 푸는 전제를 가리킨다', () => {
  // 두 전제가 걸렸고 둘 다 A 다. SECURITY 는 접근권한만 덮으므로 수치는 그쪽(min 3)
  // 이어야 한다. 먼저 걸린 보존정책(min 4)을 집으면 두 번 거짓말이 된다 — 덮지도 않고
  // 1.8 + 1.5 = 3.3 이라 4 를 넘지도 못하는데 "전제 4 충족"이라 말하게 된다.
  const out = run({
    solutions: [{
      slug: 'needs-two-a', name: 'A두전제ISV', slot: 'llm-platform', status: 'published',
      coverage: [{ category: 'A05', strength: 2 }],
      prerequisites: [
        { kind: 'assessment', area: 'A02', min: 4,
          blocking: true, label: '보존정책 4 이상' },
        { kind: 'assessment', area: 'A03', min: 3,
          blocking: true, label: 'IAM 3 이상' }
      ]
    }],
    packages: [{
      id: 'SECURITY', slug: 'SECURITY', name: 'AI Security Readiness',
      coverage: [{ category: 'A03', strength: 3 }],
      readiness_lift: { A: 1.5 }
    }]
  });

  assert.equal(out.bundles.length, 1);
  assert.equal(out.bundles[0].enabler.slug, 'SECURITY');
  const numeric = out.bundles[0].reasons.find((r) => /예상/.test(r));
  assert.ok(numeric, out.bundles[0].reasons.join(' / '));
  // 막힌 전제 요약에는 둘 다 나온다 — 보존정책은 여전히 미해결이라 숨기면 안 된다.
  assert.ok(out.bundles[0].reasons.some((r) => /보존정책 4 이상 \/ IAM 3 이상/.test(r)));
  assert.match(numeric, /A 1\.8 → 3\.3 예상 \(전제 3 충족\)/);
  assert.doesNotMatch(numeric, /전제 4 충족/, '넘지도 못하는 임계값을 충족이라 말하면 안 된다');
});

test('실데이터 — 035 의 lift 가 근거 없는 수치를 만들지 않는다', () => {
  // 035 가 판정 데이터를 5대 오퍼링 패키지로 옮겼다. 값을 고치면 여기서 드러난다.
  const { solutions, packages, lifts } = loadSeeds();

  assert.equal(lifts.size, 5, '035 는 P01~P05 다섯에 lift 를 넣는다');
  assert.deepEqual(lifts.get('P02'), { A: 1.5 }, '02 OpenAI Ready 가 A 를 +1.5 — 가장 자주 쓰이는 값');
  // POC+INTEGRATION 합본. lift 는 합산하지 않고 큰 값을 쓴다.
  assert.deepEqual(lifts.get('P03'), { B: 1.5, A: 0.8, D: 0.8 },
    '합쳤다고 상승폭이 더해지면 안 된다');

  // 네 축이 모두 낮은 고객. 번들이 가장 많이 나오는 조건이라 위반도 여기서 드러난다.
  const lowAll = {
    A: { score: 1.8, threshold: 3.5, answered: 6, ready: false },
    B: { score: 2.2, threshold: 3.0, answered: 5, ready: false },
    C: { score: 2.1, threshold: 3.0, answered: 5, ready: false },
    D: { score: 2.0, threshold: 3.5, answered: 5, ready: false }
  };
  const out = recommend({
    deal: { ...lowSecurityDeal, totals: lowAll },
    solutions, packages, slots, itemCountByCategory: AREA_COUNTS,
  });

  assert.ok(out.bundles.length > 0, '번들이 하나도 없으면 이 검사가 무의미하다');

  const covers = (pkg, need) => (pkg.fqa_coverage || []).some((e) => e.category === need.category
    && (Number(e.strength) || 0) >= 2
    && (!need.item || !(e.items || []).length || (e.items || []).includes(need.item)));

  for (const bundle of out.bundles) {
    const numeric = bundle.reasons.find((r) => /→ .* 예상 \(전제 .* 충족\)/.test(r));
    if (!numeric) continue;
    const pkg = packages.find((p) => p.slug === bundle.enabler.slug);
    if (!pkg) continue; // ISV 가 선행인 경우는 lift 를 쓰지 않는다
    assert.ok(bundle.prerequisites.blockedBy.some((need) => covers(pkg, need)),
      `${bundle.enabler.slug} 는 ${bundle.slug} 의 막힌 문항을 덮지 않는데 수치를 말한다: ${numeric}`);
  }
});

test('검토 여부에 따라 라벨이 달라진다', () => {
  assert.equal(run({ solutions: [] }).label, '고객 자가응답 기준 잠정 추천');
  const reviewed = recommend({
    deal: { ...lowSecurityDeal, fqa_reviewed_at: '2026-07-28T00:00:00Z' },
    slots, itemCountByCategory: AREA_COUNTS, solutions: []
  });
  assert.equal(reviewed.label, '실사 반영 추천');
  assert.equal(reviewed.reviewed, true);
});

test('보조 파서 — 좌석·예산·규모', () => {
  assert.equal(parseSeats({ targetUsers: '전사 2,000명' }), 2000);
  assert.equal(parseSeats({ sim: { seats: 350 } }), 350);
  assert.equal(parseSeats({}), null);
  assert.equal(parseBudget({ investment: '3억' }), 300000000);
  assert.equal(parseBudget({ investment: '5,000만' }), 50000000);
  assert.equal(parseBudget({ investment: '미정' }), null);
  assert.equal(scaleConflicts('L', 50), true);
  assert.equal(scaleConflicts('S', 9000), true);
  assert.equal(scaleConflicts(null, 2000), false, '판단 불가면 통과');
});

test('실데이터 — 준비도 낮은 딜은 패키지가 먼저 나온다', () => {
  const { solutions, packages } = loadSeeds();

  assert.equal(solutions.length, 17, '012 의 9종 + 019 의 8종');
  assert.equal(packages.length, 5, '035 는 기획안 5대 오퍼링으로 심는다');

  const lowAC = {
    ...lowSecurityDeal.fqa_totals,
    C: { score: 2.1, threshold: 3.0, answered: 5, ready: false }
  };
  const out = recommend({
    deal: { ...lowSecurityDeal, totals: lowAC },
    solutions, packages, slots, itemCountByCategory: AREA_COUNTS,
  });

  // A·C 가 미달인 고객에게는 그 두 축을 덮는 패키지가 나와야 한다.
  const names = out.eligible.map((x) => x.name);
  assert.ok(out.eligible.length > 0, '적합 후보가 하나도 없으면 안 된다');
  assert.ok(names.includes('P02'), `A 미달인데 02 OpenAI Ready 가 없다: ${names.join(', ')}`);
  assert.ok(names.includes('P05'), `C 미달인데 05 Billing & MS 가 없다: ${names.join(', ')}`);

  // 019 이후 New Relic 도 여기 들어온다. C(품질·장애·비용)를 덮고 그 전제(B 개발·테스트
  // 환경 3, C 운영 책임자 2)를 이 딜이 충족하기 때문이다 — 판정 데이터를 채운 효과다.
  assert.ok(names.includes('new-relic'),
    `019 로 판정 데이터가 생긴 New Relic 이 C 갭 고객에게 안 나온다: ${names.join(', ')}`);

  // 전제에 걸린 ISV 들은 버리지 않고 번들로 살아남아야 한다.
  assert.ok(out.bundles.length >= 3, `번들 후보가 너무 적다: ${out.bundles.length}`);
});

test('035 — 예산·구매 준비도를 덮는 패키지가 있다', () => {
  // 016 까지는 6종 중 아무도 이 문항을 못 덮어, 여기 막힌 ISV 는 선행 후보를 찾지
  // 못하고 전부 탈락했다. 기획안 01 의 "TCO 및 예산 시뮬레이션"이 그 구멍을 메운다.
  const { packages } = loadSeeds();
  const covers = (pkg, category, item) => (pkg.fqa_coverage || []).some((e) =>
    e.category === category && (e.items || []).includes(item));

  const budget = packages.filter((p) => covers(p, 'D', '예산·구매 준비도'));
  assert.deepEqual(budget.map((p) => p.id), ['P01'],
    'TCO·예산 시뮬레이션을 내는 01 AI Consulting 만 이 문항을 덮어야 한다');

  // OPERATE 는 도입 후 비용 관리라 일부러 뺐다. 넣으면 "운영 패키지를 먼저 하면
  // 예산 준비가 된다"는 순서가 뒤집힌 제안이 나온다.
  assert.ok(!covers(packages.find((p) => p.id === 'P05'), 'D', '예산·구매 준비도'),
    '05 Billing & MS 는 도입 후 비용 관리다 — 도입 전 예산 확보와 섞으면 안 된다');

  // 실제로 막힌 ISV 가 번들로 살아나는지 끝까지 확인한다.
  const budgetGapTotals = {
    A: { score: 3.6, threshold: 3.0, answered: 6, ready: true },
    B: { score: 3.4, threshold: 3.0, answered: 5, ready: true },
    C: { score: 3.4, threshold: 3.0, answered: 5, ready: true },
    D: { score: 2.0, threshold: 3.0, answered: 5, ready: false }
  };
  const out = recommend({
    deal: {
      track: 'T-B',
      customer_meta: { industry: '제조', targetUsers: '500명', investment: '2억' },
      prereq_confirmations: {},
      totals: budgetGapTotals
    },
    slots, itemCountByCategory: AREA_COUNTS, packages,
    solutions: [{
      slug: 'needs-budget', name: '예산전제ISV', slot: 'llm-platform', status: 'published',
      coverage: [/* 대응 없음 */],
      prerequisites: [{ kind: 'manual',
        blocking: true, label: '예산·구매 준비도 3 이상' }]
    }]
  });

  assert.equal(out.bundles.length, 1, '선행 패키지를 찾아 번들로 살아나야 한다');
  assert.equal(out.bundles[0].enabler.slug, 'P01');
  assert.ok(out.bundles[0].reasons.some((r) => /D 2 → 3\.2 예상 \(전제 3 충족\)/.test(r)),
    out.bundles[0].reasons.join(' / '));
});

test('035 — 한 문항을 둘이 덮으면 더 깊게 다루는 쪽이 선행이 된다', () => {
  // 03 AIR Service 가 A(데이터 분류·접근권한)를 strength 2 로 다루고,
  // 02 OpenAI Ready 는 같은 문항을 strength 3 으로 다룬다. 목록 순서와 무관하게
  // 02 가 이겨야 한다 — 아니면 3~4주 과업 자리에 규모별 산정 과업이 붙는다.
  const { packages } = loadSeeds();
  const byId = (id) => packages.find((p) => p.id === id);
  const deal = {
    track: 'E-1',
    customer_meta: { industry: '금융/보험', targetUsers: '전사 2,000명', investment: '3억' },
    prereq_confirmations: {},
    totals: {
      A: { score: 2.4, threshold: 3.0, answered: 6, ready: false },
      B: { score: 2.4, threshold: 3.0, answered: 5, ready: false },
      C: { score: 3.4, threshold: 3.0, answered: 5, ready: true },
      D: { score: 3.6, threshold: 3.0, answered: 5, ready: true }
    }
  };
  const isv = {
    slug: 'needs-iam', name: 'IAM전제ISV', slot: 'llm-platform', status: 'published',
    coverage: [{ category: 'A05', strength: 2 }],
    prerequisites: [{ kind: 'assessment', area: 'A03', min: 3,
      blocking: true, label: 'IAM 3 이상' }]
  };

  // 두 패키지 모두 전제를 넘긴다(2.4+1.5=3.9 / 2.4+0.8=3.2). 순서만 뒤집어 넣는다.
  for (const order of [['P03', 'P02'], ['P02', 'P03']]) {
    const out = recommend({
      deal, slots, itemCountByCategory: AREA_COUNTS, solutions: [isv],
      packages: order.map(byId)
    });
    assert.equal(out.bundles.length, 1, `순서 ${order.join('→')} 에서 번들이 없다`);
    assert.equal(out.bundles[0].enabler.slug, 'P02',
      `순서 ${order.join('→')} 에서 얕게 다루는 쪽이 뽑혔다`);
  }
});

test('전제가 지목한 문항을 모르면 카테고리 평균으로 때우지 않는다', () => {
  // 42문항이 030 bridge 로 채우는 것은 21문항 중 13개다. A 는 6문항 중 2개만 찬다.
  // 다른 두 문항의 평균으로 "접근권한이 3 이상인가" 를 판정하면 조용히 틀린다.
  const isv = {
    slug: 'needs-iam', name: 'IAM전제ISV', slot: 'llm-platform', status: 'published',
    coverage: [{ category: 'A05', strength: 2 }],
    prerequisites: [{ kind: 'assessment', area: 'A03', min: 3,
      blocking: true, label: 'IAM 3 이상' }]
  };

  // ① 그 문항을 모른다 — 카테고리는 1.8 이지만 그것으로 판정하지 않는다
  const unknown = run({ solutions: [isv], itemScores: {} });
  assert.equal(unknown.excluded.length, 0, '모르는데 제외하면 근거 없이 후보를 버린다');
  assert.equal(unknown.needsConfirmation.length, 1, '확인 필요로 가야 한다');
  assert.deepEqual(
    unknown.needsConfirmation[0].prerequisites.pendingManual.map((p) => p.label),
    ['IAM 3 이상']
  );

  // ② 영업이 확인하면 통과한다
  const confirmed = recommend({
    deal: { ...lowSecurityDeal, prereq_confirmations: { 'needs-iam': { 'IAM 3 이상': true } } },
    slots, itemCountByCategory: AREA_COUNTS, itemScores: {}, solutions: [isv]
  });
  assert.equal(confirmed.eligible.length, 1, '확인했는데 안 통과하면 확인이 무의미하다');

  // ③ 문항 점수가 있으면 확인 없이 자동 판정한다 — bridge 가 채운 13개가 이 경로다
  assert.equal(run({ solutions: [isv], itemScores: { '접근권한과 계정 체계': 4 } }).eligible.length, 1);
  assert.equal(run({ solutions: [isv], itemScores: { '접근권한과 계정 체계': 2 } }).excluded.length, 1);
});

test('문항을 지목하지 않은 전제는 여전히 카테고리로 본다', () => {
  // item 이 없으면 카테고리 전체를 묻는 전제다. 그건 평균이 맞는 답이다.
  const isv = {
    slug: 'needs-a-area', name: 'A영역전제ISV', slot: 'llm-platform', status: 'published',
    coverage: [{ category: 'A05', strength: 2 }],
    prerequisites: [{ kind: 'fqa', category: 'A', min: 3, blocking: true, label: 'A 영역 3 이상' }]
  };
  const out = run({ solutions: [isv], itemScores: {} });
  assert.equal(out.excluded.length, 1, 'A 1.8 이므로 제외여야 한다');
  assert.equal(out.needsConfirmation.length, 0);
});
