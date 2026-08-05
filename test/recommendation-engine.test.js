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

/**
 * 갭 키가 두 어휘로 들어온다. 키가 겹치지 않아 한 맵에 두어도 섞이지 않는다.
 *   A01~A10     기획안 Appendix A 평가영역 — ISV 도입 게이트
 *   S P D T B G 42문항 6축 — 고객 준비도 (패키지 선정)
 * 평가영역은 한 칸이 한 점수라 문항 수가 1 이고, 축은 7문항이다.
 */
const AREA_COUNTS = {
  A01: 1, A02: 1, A03: 1, A04: 1, A05: 1, A06: 1, A07: 1, A08: 1, A09: 1, A10: 1,
  S: 7, P: 7, D: 7, T: 7, B: 7, G: 7
};

const LABELS = {
  A01: '데이터 보호', A02: '저장·보존', A03: '계정·접근통제', A04: '데이터 권한 연계',
  A05: '감사·모니터링', A06: 'AI 행동 통제', A07: '정확성·신뢰성', A08: '개인정보·규제',
  A09: '저작권·계약', A10: '비용·확장성',
  S: '전략·리더십', P: '인재·조직문화', D: '데이터 기반',
  T: '시스템·인프라', B: '업무 적용·성과', G: '신뢰·안전 관리'
};

const slots = new Map([
  ['llm-platform', { name: '범용 LLM 플랫폼', layer: 'L1', is_competitive: true }],
  ['security-gateway', { name: '네트워크 보안·SWG', layer: 'L4', is_competitive: true }],
  ['ai-usage-governance', { name: 'AI 사용 가시성·거버넌스', layer: 'L4', is_competitive: false }]
]);

/**
 * 예전 픽스처의 "A 카테고리(보안·거버넌스) 전체 미달, 나머지 충족" 을 대응표대로
 * 옮긴 것이다. A 6문항이 A01·A02·A03·A05·A08 로 흩어진다.
 */
const LOW_SECURITY_TOTALS = {
  A01: { score: 1.8, threshold: 3.5, answered: 1 },   // 데이터 보호
  A02: { score: 1.8, threshold: 3.5, answered: 1 },   // 저장·보존
  A03: { score: 1.8, threshold: 3.5, answered: 1 },   // 계정·접근통제
  A05: { score: 1.8, threshold: 3.0, answered: 1 },   // 감사·모니터링
  A08: { score: 1.8, threshold: 3.5, answered: 1 },   // 개인정보·규제
  A04: { score: 3.6, threshold: 3.5, answered: 1 },
  A06: { score: 3.4, threshold: 3.0, answered: 1 },
  A07: { score: 3.4, threshold: 3.0, answered: 1 },
  A09: { score: 3.2, threshold: 3.0, answered: 1 },
  A10: { score: 3.4, threshold: 3.0, answered: 1 },
  S: { score: 3.2, threshold: 3, answered: 7 },
  P: { score: 3.2, threshold: 3, answered: 7 },
  D: { score: 3.2, threshold: 3, answered: 7 },
  T: { score: 3.2, threshold: 3, answered: 7 },
  B: { score: 3.2, threshold: 3, answered: 7 },
  G: { score: 3.2, threshold: 3, answered: 7 }
};

const lowSecurityDeal = {
  track: 'E-1',
  customer_meta: { industry: '금융/보험', targetUsers: '전사 2,000명', investment: '3억' },
  prereq_confirmations: {}
};

const run = (extra) => recommend({
  deal: lowSecurityDeal, slots, totals: LOW_SECURITY_TOTALS,
  categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS, ...extra
});

test('갭 분석이 미달 여부와 신뢰도를 계산한다', () => {
  const gaps = analyseGaps(LOW_SECURITY_TOTALS, AREA_COUNTS, LABELS);
  assert.equal(gaps.A03.failing, true);
  assert.equal(gaps.A03.magnitude, 1.7);
  assert.equal(gaps.A03.label, '계정·접근통제', '이름표는 호출자가 넘긴다');
  assert.equal(gaps.A04.failing, false);

  // 42축은 7문항이라 3개만 답하면 신뢰도가 7분의 3이다.
  const partial = analyseGaps({ G: { score: 1, threshold: 3, answered: 3 } }, AREA_COUNTS, LABELS);
  assert.ok(Math.abs(partial.G.confidence - 3 / 7) < 0.01);
  assert.equal(partial.G.label, '신뢰·안전 관리');
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
    deal: { ...lowSecurityDeal, customer_meta: { ...lowSecurityDeal.customer_meta, securityStack } },
    slots, totals: LOW_SECURITY_TOTALS, categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS,
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
    slots, totals: LOW_SECURITY_TOTALS, categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS,
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
    slots, totals: LOW_SECURITY_TOTALS, categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS, solutions
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
/**
 * 선행 패키지는 **막힌 전제를 실제로 다루는지** 로 고른다. 상승폭(lift)만 보고
 * 고르면 엉뚱한 패키지가 "이걸 하면 전제가 풀린다"고 말한다 — 영업이 고객 앞에서
 * 못 지킬 약속을 하게 된다.
 *
 * 038 이후 패키지는 두 어휘를 갖는다. 후보 선정은 42축(coverage), 선행 판정은
 * 평가영역(enablerCoverage·lift)이다.
 */
const LOW_BUSINESS_TOTALS = {
  A01: { score: 3.6, threshold: 3.5, answered: 1 },
  A03: { score: 3.6, threshold: 3.5, answered: 1 },
  A04: { score: 2.4, threshold: 3.0, answered: 1 },   // 데이터 권한 연계 미달
  A07: { score: 2.4, threshold: 3.0, answered: 1 },   // 정확성·신뢰성 미달
  A10: { score: 2.0, threshold: 3.0, answered: 1 },   // 비용·확장성 미달
  D: { score: 2.4, threshold: 3, answered: 7 },
  B: { score: 2.0, threshold: 3, answered: 7 }
};

const lowBusinessDeal = {
  track: 'E-1',
  customer_meta: { industry: '제조', targetUsers: '500명', investment: '2억' },
  prereq_confirmations: {}
};

/**
 * 실제 시드를 읽어 엔진에 먹인다.
 *
 * 038 이 판정 데이터를 평가영역·6축으로 옮겼다. 솔루션의 assessment_coverage 는
 * SQL 이 **대응표로 기계 변환**해 만들기 때문에 파일에 리터럴로 없다 — 여기서 같은
 * 대응표를 적용해 만든다. 대응표가 어긋나면 이 검사가 먼저 깨진다.
 */
const ITEM_TO_AREA = Object.freeze({
  'A|데이터 분류와 민감도 기준': 'A01', 'A|보안 게이트웨이 준비도': 'A01',
  'A|데이터 보존·삭제 정책': 'A02', 'A|접근권한과 계정 체계': 'A03',
  'A|감사 로그와 추적성': 'A05', 'A|규제·컴플라이언스 검토': 'A08',
  'B|업무 시스템 연동성': 'A04', 'B|지식 소스 품질': 'A07',
  'B|확장성·성능 기준': 'A10', 'B|모델·벤더 전환성': 'A10',
  'C|품질 평가 체계': 'A07', 'C|장애 대응 체계': 'A05',
  'C|비용 모니터링': 'A10', 'C|변경·배포 관리': 'A06'
});

function loadSeeds() {
  const read = (f) => fs.readFileSync(path.join(root, 'db', 'migrations', f), 'utf8');
  const pick = (block, field) => {
    const m = block.match(new RegExp(`${field} = '([\\s\\S]*?)'::jsonb`));
    return m ? JSON.parse(m[1]) : [];
  };

  // 깊이가 여럿이면 깊은 쪽을 쓴다 — 얕은 쪽에 맞추면 선행 판정에서 밀린다.
  const toAreas = (coverage) => {
    const best = new Map();
    for (const entry of coverage) {
      for (const item of (entry.items || [])) {
        const area = ITEM_TO_AREA[`${entry.category}|${item}`];
        if (!area) continue;
        const strength = Number(entry.strength) || 0;
        if (strength > (best.get(area) || 0)) best.set(area, strength);
      }
    }
    return [...best.entries()].sort()
      .map(([category, strength]) => ({ category, strength }));
  };
  const toPrereqs = (list) => list.map((p) => {
    if (p.kind !== 'fqa') return p;
    const area = ITEM_TO_AREA[`${p.category}|${p.item}`];
    return area
      ? { kind: 'assessment', area, min: p.min, blocking: p.blocking,
          label: p.label, enabled_by: p.enabled_by || [] }
      : { kind: 'manual', blocking: p.blocking, label: p.label || `${p.item} ${p.min} 이상` };
  });

  const solutionsIn = (sql) => [...sql.matchAll(
    /update solutions set\s*\n([\s\S]*?)where slug (?:=|in) \(?((?:'[a-z0-9-]+'(?:,\s*)?)+)\)?;/g
  )].flatMap((m) => {
    const coverage = toAreas(pick(m[1], 'fqa_coverage'));
    const prerequisites = toPrereqs(pick(m[1], 'prerequisites'));
    const flags = pick(m[1], 'red_flags');
    return [...m[2].matchAll(/'([a-z0-9-]+)'/g)]
      .map((hit) => ({
        slug: hit[1], name: hit[1], slot: 'llm-platform', status: 'published',
        coverage, prerequisites, red_flags: flags
      }));
  }).filter((row) => row.coverage.length);

  // 패키지는 038 이 리터럴로 심는다 — 후보 선정은 42축, 선행 판정은 평가영역.
  const judgement = read('038_assessment_judgement.sql');
  const grab = (field) => new Map([...judgement.matchAll(
    new RegExp(`${field} = '([\\s\\S]*?)'::jsonb[\\s\\S]{0,240}?where id = '(\\w+)'`, 'g')
  )].map((m) => [m[2], JSON.parse(m[1])]));
  const axes = grab('readiness_coverage');
  const enablerCov = grab('assessment_coverage');
  const lifts = grab('assessment_lift');

  const packages = [...axes.keys()].map((id) => ({
    id, slug: id, name: id,
    coverage: (axes.get(id) || []).map((e) => ({ category: e.axis, strength: e.strength })),
    enablerCoverage: (enablerCov.get(id) || []).map((e) => ({ category: e.area, strength: e.strength })),
    lift: lifts.get(id) || {}
  }));

  return {
    solutions: [...solutionsIn(read('012_seed_recommendation_rules.sql')),
      ...solutionsIn(read('019_isv_offering_alignment.sql'))],
    packages,
    lifts
  };
}

test('전제를 안 덮는 패키지는 lift 가 있어도 선행으로 쓰지 않는다', () => {
  // 04 Adoption & Change 는 42축 B 를 올리지만 **평가영역은 하나도 풀지 않는다**(038).
  // "변화관리를 하면 비용·확장성 전제가 풀린다" 고 말하면 안 된다.
  const out = recommend({
    deal: lowBusinessDeal, slots, totals: LOW_BUSINESS_TOTALS,
    categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS,
    solutions: [{
      slug: 'needs-cost', name: '비용전제ISV', slot: 'llm-platform', status: 'published',
      coverage: [{ category: 'A04', strength: 2 }],
      prerequisites: [{ kind: 'assessment', area: 'A10', min: 3,
        blocking: true, label: '비용·확장성 3 이상' }]
    }],
    packages: [{
      id: 'P04', slug: 'P04', name: 'AI Adoption & Change Management',
      coverage: [{ category: 'B', strength: 3 }],   // 후보 선정은 42축
      enablerCoverage: [],                          // 평가영역은 풀지 않는다
      lift: {}
    }]
  });

  assert.equal(out.bundles.length, 0,
    `근거 없는 번들: ${out.bundles.map((b) => b.reasons.at(-1)).join(' / ')}`);
  assert.ok(out.excluded.some((x) => x.slug === 'needs-cost'));
  assert.ok(out.excluded.find((x) => x.slug === 'needs-cost')
    .excludedBy.some((r) => /비용·확장성/.test(r)));
});

test('상승폭이 커도 그 영역을 덮는 패키지가 선행이 된다', () => {
  // 03 AIR Service 의 lift(A10 +1.5)가 STARTER(A10 +0.5)보다 크지만, 목록 순서와
  // 무관하게 **실제로 그 영역을 덮는** 쪽이 이겨야 한다. 둘 다 덮으면 깊은 쪽이다.
  const isv = {
    slug: 'needs-cost', name: '비용전제ISV', slot: 'llm-platform', status: 'published',
    coverage: [{ category: 'A04', strength: 2 }],
    prerequisites: [{ kind: 'assessment', area: 'A10', min: 3,
      blocking: true, label: '비용·확장성 3 이상' }]
  };
  const air = {
    id: 'P03', slug: 'P03', name: 'AIR Service',
    coverage: [{ category: 'D', strength: 3 }],
    enablerCoverage: [{ category: 'A10', strength: 3 }],
    lift: { A10: 1.5 }
  };
  const starter = {
    id: 'STARTER', slug: 'STARTER', name: 'OpenAI Starter Package',
    coverage: [{ category: 'B', strength: 1 }],
    enablerCoverage: [{ category: 'A10', strength: 2 }],
    lift: { A10: 0.5 }
  };

  for (const order of [[air, starter], [starter, air]]) {
    const out = recommend({
      deal: lowBusinessDeal, slots, totals: LOW_BUSINESS_TOTALS,
      categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS,
      solutions: [isv], packages: order
    });
    assert.equal(out.bundles.length, 1, `순서 ${order.map((p) => p.id).join('→')} 에서 번들이 없다`);
    assert.equal(out.bundles[0].enabler.slug, 'P03',
      `순서 ${order.map((p) => p.id).join('→')} 에서 얕게 다루는 쪽이 뽑혔다`);
  }
});

test('번들 사유의 수치는 enabler 가 실제로 푸는 전제를 가리킨다', () => {
  // 두 전제가 걸렸다. 03 AIR Service 는 A10 만 덮으므로 수치는 그쪽(min 3)이어야
  // 한다. 먼저 걸린 A02(min 4)를 집으면 두 번 거짓말이 된다 — 덮지도 않고
  // 2.0 + 1.5 = 3.5 라 4 를 넘지도 못하는데 "전제 4 충족" 이라 말하게 된다.
  const out = recommend({
    deal: lowBusinessDeal, slots,
    totals: { ...LOW_BUSINESS_TOTALS, A02: { score: 2.0, threshold: 4, answered: 1 } },
    categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS,
    solutions: [{
      slug: 'needs-two', name: '두전제ISV', slot: 'llm-platform', status: 'published',
      coverage: [{ category: 'A04', strength: 2 }],
      prerequisites: [
        { kind: 'assessment', area: 'A02', min: 4, blocking: true, label: '보존정책 4 이상' },
        { kind: 'assessment', area: 'A10', min: 3, blocking: true, label: '비용·확장성 3 이상' }
      ]
    }],
    packages: [{
      id: 'P03', slug: 'P03', name: 'AIR Service',
      coverage: [{ category: 'D', strength: 3 }],
      enablerCoverage: [{ category: 'A10', strength: 3 }],
      lift: { A10: 1.5 }
    }]
  });

  assert.equal(out.bundles.length, 1);
  const numeric = out.bundles[0].reasons.find((r) => /예상/.test(r));
  assert.ok(numeric, out.bundles[0].reasons.join(' / '));
  // 막힌 전제 요약에는 둘 다 나온다 — 보존정책은 여전히 미해결이라 숨기면 안 된다
  assert.ok(out.bundles[0].reasons.some((r) => /보존정책 4 이상 \/ 비용·확장성 3 이상/.test(r)));
  assert.match(numeric, /A10 2 → 3\.5 예상 \(전제 3 충족\)/);
  assert.doesNotMatch(numeric, /전제 4 충족/, '넘지도 못하는 임계값을 충족이라 말하면 안 된다');
});

test('검토 여부에 따라 라벨이 달라진다', () => {
  assert.equal(run({ solutions: [] }).label, '고객 자가응답 기준 잠정 추천');
  const reviewed = recommend({
    deal: { ...lowSecurityDeal, fqa_reviewed_at: '2026-07-28T00:00:00Z' },
    slots, totals: LOW_SECURITY_TOTALS, categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS, solutions: []
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

  // replit 은 「B 개발·테스트 환경」 하나만 덮었는데 10평가영역에 대응이 없다.
  // Appendix A 는 위험·통제 체크리스트라 개발 환경을 묻지 않는다. 개발 생산성은
  // 033 의 AI Developer 번들이 STEP03 에서 따로 보여준다.
  // **다른 것이 조용히 빠지면 여기서 걸린다.**
  assert.equal(solutions.length, 16, '012 의 9종 + 019 의 8종 − replit');
  assert.ok(!solutions.some((x) => x.slug === 'replit'), '알려진 누락은 replit 하나여야 한다');
  assert.equal(packages.length, 6, '038 은 STARTER + P01~P05 에 축을 심는다');

  // 평가영역이 전반적으로 낮고 42축도 낮은 고객.
  const low = {
    A01: { score: 1.8, threshold: 3.5, answered: 1 },
    A02: { score: 1.8, threshold: 3.5, answered: 1 },
    A03: { score: 1.8, threshold: 3.5, answered: 1 },
    A04: { score: 2.0, threshold: 3.5, answered: 1 },
    A05: { score: 2.1, threshold: 3.0, answered: 1 },
    A06: { score: 2.2, threshold: 3.0, answered: 1 },
    A07: { score: 2.1, threshold: 3.0, answered: 1 },
    A08: { score: 1.9, threshold: 3.5, answered: 1 },
    A09: { score: 2.4, threshold: 3.0, answered: 1 },
    A10: { score: 2.0, threshold: 3.0, answered: 1 },
    S: { score: 2.0, threshold: 3, answered: 7 },
    P: { score: 2.0, threshold: 3, answered: 7 },
    D: { score: 2.1, threshold: 3, answered: 7 },
    T: { score: 2.2, threshold: 3, answered: 7 },
    B: { score: 2.0, threshold: 3, answered: 7 },
    G: { score: 2.1, threshold: 3, answered: 7 }
  };
  const out = recommend({
    deal: lowSecurityDeal, solutions, packages, slots,
    totals: low, categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS
  });

  // 이 변경의 핵심 — 01·04 가 살아남는다. 10평가영역만 봤으면 커버리지가 전멸했다.
  const ids = out.eligible.map((x) => x.slug);
  assert.ok(ids.includes('P01'), `S 미달인데 01 AI Consulting 이 없다: ${ids.join(', ')}`);
  assert.ok(ids.includes('P04'), `P 미달인데 04 Adoption & Change 가 없다: ${ids.join(', ')}`);
  assert.ok(ids.includes('P02'), `G 미달인데 02 OpenAI Ready 가 없다: ${ids.join(', ')}`);

  // 전제에 걸린 ISV 는 버리지 않고 번들로 살아남아야 한다.
  assert.ok(out.bundles.length >= 1, `번들 후보가 없다: ${out.bundles.length}`);
});

test('038 — 판정 데이터가 대응표로 옮겨졌는가', () => {
  const { solutions, packages } = loadSeeds();

  // 솔루션은 전부 평가영역으로만 말한다. 21문항 카테고리가 남으면 안 된다.
  for (const solution of solutions) {
    for (const entry of solution.coverage) {
      assert.match(entry.category, /^A\d\d$/, `${solution.slug} 가 옛 어휘를 쓴다: ${entry.category}`);
    }
    for (const prereq of solution.prerequisites) {
      assert.ok(prereq.kind !== 'fqa', `${solution.slug} 에 kind:'fqa' 가 남았다`);
    }
  }

  // 패키지는 42축으로 뽑히고 평가영역으로 푼다. 01·04 는 푸는 것이 없다.
  const byId = Object.fromEntries(packages.map((p) => [p.id, p]));
  for (const entry of byId.P01.coverage) {
    assert.match(entry.category, /^[SPDTBG]$/, '패키지 후보 선정은 42축이어야 한다');
  }
  assert.equal(byId.P01.enablerCoverage.length, 0,
    '"컨설팅을 하면 SSO 가 생긴다" 가 되면 안 된다');
  assert.equal(byId.P04.enablerCoverage.length, 0);
  assert.ok(byId.P02.enablerCoverage.length > 0, '02 OpenAI Ready 는 보안 영역을 푼다');
  for (const entry of byId.P02.enablerCoverage) {
    assert.match(entry.category, /^A\d\d$/);
  }
});

test('전제가 지목한 영역을 모르면 다른 영역으로 때우지 않는다', () => {
  // 037 bridge 가 8개를 채우고 저장·보존·계정통제는 안 찬다. 모르는 것을 조용히
  // 통과시키면 막혔어야 할 후보가 추천에 올라온다 — 낙관적으로 틀리는 쪽이다.
  const isv = {
    slug: 'needs-iam', name: 'IAM전제ISV', slot: 'llm-platform', status: 'published',
    coverage: [{ category: 'A05', strength: 2 }],
    prerequisites: [{ kind: 'assessment', area: 'A03', min: 3, blocking: true, label: 'IAM 3 이상' }]
  };
  // A03 을 뺀 갭. 나머지는 그대로다.
  const withoutA03 = { ...LOW_SECURITY_TOTALS };
  delete withoutA03.A03;

  const unknown = recommend({
    deal: lowSecurityDeal, slots, totals: withoutA03,
    categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS, solutions: [isv]
  });
  assert.equal(unknown.excluded.length, 0, '모르는데 제외하면 근거 없이 후보를 버린다');
  assert.equal(unknown.needsConfirmation.length, 1, '확인 필요로 가야 한다');
  assert.deepEqual(
    unknown.needsConfirmation[0].prerequisites.pendingManual.map((p) => p.label),
    ['IAM 3 이상']
  );

  // 확인하면 통과한다
  const confirmed = recommend({
    deal: { ...lowSecurityDeal, prereq_confirmations: { 'needs-iam': { 'IAM 3 이상': true } } },
    slots, totals: withoutA03, categoryLabels: LABELS,
    itemCountByCategory: AREA_COUNTS, solutions: [isv]
  });
  assert.equal(confirmed.eligible.length, 1, '확인했는데 안 통과하면 확인이 무의미하다');

  // 값이 있으면 확인 없이 자동 판정한다 — bridge 가 채운 8개가 이 경로다
  assert.equal(run({ solutions: [isv] }).excluded.length, 1, 'A03 1.8 이라 제외여야 한다');
  const passing = recommend({
    deal: lowSecurityDeal, slots,
    totals: { ...LOW_SECURITY_TOTALS, A03: { score: 4, threshold: 3.5, answered: 1 } },
    categoryLabels: LABELS, itemCountByCategory: AREA_COUNTS, solutions: [isv]
  });
  assert.equal(passing.eligible.length, 1);
});
