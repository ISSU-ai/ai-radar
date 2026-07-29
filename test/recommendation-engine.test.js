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
  fqa_totals: {
    A: { score: 1.8, threshold: 3.5, answered: 6, ready: false },
    B: { score: 3.4, threshold: 3.0, answered: 5, ready: true },
    C: { score: 3.2, threshold: 3.0, answered: 5, ready: true },
    D: { score: 3.6, threshold: 3.5, answered: 5, ready: true }
  },
  prereq_confirmations: {}
};

const run = (extra) => recommend({
  deal: lowSecurityDeal, slots, itemCountByCategory: ITEM_COUNTS, ...extra
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
        fqa_coverage: [{ category: 'A', strength: 3 }] },
      { slug: 'covers-b', name: 'B보강', slot: 'llm-platform', status: 'published',
        fqa_coverage: [{ category: 'B', strength: 3 }] }
    ]
  });
  assert.deepEqual(out.eligible.map((x) => x.slug), ['covers-a']);
  assert.equal(out.excluded[0].slug, 'covers-b');
  assert.match(out.excluded[0].excludedBy[0], /미달 카테고리를 메우지 않음/);
});

test('판정 데이터가 비면 제외 사유를 그렇게 밝힌다', () => {
  const out = run({
    solutions: [{ slug: 'empty', name: '미보강', slot: 'llm-platform', status: 'published', fqa_coverage: [] }]
  });
  assert.match(out.excluded[0].excludedBy[0], /판정 데이터\(fqa_coverage\) 미입력/);
});

test('운영중단·미발행·T-D 게이트웨이 중복을 거른다', () => {
  const base = { slot: 'llm-platform', status: 'published', fqa_coverage: [{ category: 'A', strength: 3 }] };
  const out = run({
    solutions: [
      { ...base, slug: 'paused', name: '중단', status_op: 'paused' },
      { ...base, slug: 'draft', name: '초안', status: 'draft' }
    ]
  });
  assert.equal(out.eligible.length, 0);

  const td = recommend({
    deal: { ...lowSecurityDeal, track: 'T-D' }, slots, itemCountByCategory: ITEM_COUNTS,
    solutions: [{ ...base, slug: 'swg', name: 'SWG', slot: 'security-gateway' }]
  });
  assert.match(td.excluded[0].excludedBy[0], /타사 SWG 운영 중\(T-D\)/);
});

test('fqa 전제가 미달이면 적합에서 빠진다', () => {
  const out = run({
    solutions: [{
      slug: 'needs-a', name: 'A전제', slot: 'llm-platform', status: 'published',
      fqa_coverage: [{ category: 'A', strength: 3 }],
      // A 를 메우면서 A 를 요구하는 구조 — Portal26 과 같은 형태
      prerequisites: [{ kind: 'fqa', category: 'A', item: '접근권한과 계정 체계', min: 3, blocking: true, label: 'SSO 인프라' }]
    }]
  });
  assert.equal(out.eligible.length, 0);
  assert.equal(out.excluded.length, 1);
  assert.match(out.excluded[0].excludedBy[0], /전제 미충족: SSO 인프라/);
});

test('numeric 전제는 좌석·예산으로 자동 판정한다', () => {
  const solutions = [{
    slug: 'big-only', name: '대규모전용', slot: 'llm-platform', status: 'published',
    fqa_coverage: [{ category: 'A', strength: 3 }],
    prerequisites: [{ kind: 'numeric', field: 'seats', min: 5000, blocking: true, label: '최소 5,000석' }]
  }];
  assert.equal(run({ solutions }).eligible.length, 0, '2,000석이라 미달이어야 한다');

  solutions[0].prerequisites[0].min = 100;
  assert.equal(run({ solutions }).eligible.length, 1, '2,000석이면 통과해야 한다');
});

test('값이 없으면 전제로 거르지 않는다', () => {
  const out = recommend({
    deal: { ...lowSecurityDeal, customer_meta: { industry: '금융/보험' } }, // 좌석·예산 없음
    slots, itemCountByCategory: ITEM_COUNTS,
    solutions: [{
      slug: 'x', name: 'X', slot: 'llm-platform', status: 'published',
      fqa_coverage: [{ category: 'A', strength: 3 }],
      prerequisites: [{ kind: 'numeric', field: 'seats', min: 5000, blocking: true, label: '5,000석' }]
    }]
  });
  assert.equal(out.eligible.length, 1, '판단 불가면 통과시켜야 한다');
});

test('manual 전제는 확인 전까지 "확인 필요"로 보류한다', () => {
  const solutions = [{
    slug: 'legal', name: '법무필요', slot: 'llm-platform', status: 'published',
    fqa_coverage: [{ category: 'A', strength: 3 }],
    prerequisites: [{ kind: 'manual', label: '법무 검토 완료', blocking: true }]
  }];
  const pending = run({ solutions });
  assert.equal(pending.needsConfirmation.length, 1);
  assert.equal(pending.eligible.length, 0);

  const confirmed = recommend({
    deal: { ...lowSecurityDeal, prereq_confirmations: { legal: { '법무 검토 완료': true } } },
    slots, itemCountByCategory: ITEM_COUNTS, solutions
  });
  assert.equal(confirmed.eligible.length, 1);
});

test('enabled_by 가 적합 후보에 있으면 번들로 살린다', () => {
  const out = run({
    solutions: [
      { slug: 'zscaler', name: 'Zscaler', slot: 'security-gateway', status: 'published',
        fqa_coverage: [{ category: 'A', items: ['보안 게이트웨이 준비도'], strength: 3 }] },
      { slug: 'portal26', name: 'Portal26', slot: 'ai-usage-governance', status: 'published',
        fqa_coverage: [{ category: 'A', items: ['감사 로그와 추적성'], strength: 3 }],
        prerequisites: [{ kind: 'fqa', category: 'A', item: '보안 게이트웨이 준비도', min: 3,
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
      fqa_coverage: [{ category: 'A', items: ['규제·컴플라이언스 검토'], strength: 2 }],
      prerequisites: [{ kind: 'fqa', category: 'A', item: '접근권한과 계정 체계', min: 3,
        blocking: true, label: 'IAM 관리 엔지니어' }]
    }],
    packages: [{
      id: 'SECURITY', slug: 'SECURITY', name: 'AI Security Readiness',
      fqa_coverage: [{ category: 'A', items: ['접근권한과 계정 체계', '규제·컴플라이언스 검토'], strength: 3 }]
    }]
  });
  assert.equal(out.eligible.length, 1);
  assert.equal(out.eligible[0].kind, 'package');
  assert.equal(out.bundles.length, 1);
  assert.equal(out.bundles[0].enabler.slug, 'SECURITY');
  assert.ok(out.bundles[0].reasons.some((r) => /패키지로 준비도를 올린 뒤/.test(r)));
});

/**
 * readiness_lift 는 카테고리 단위, 전제는 문항 단위다. 카테고리만 맞춰 보면 엉뚱한
 * 패키지가 "이걸 하면 전제가 풀린다"고 말한다 — 영업이 고객 앞에서 못 지킬 약속을
 * 하게 되므로, 아래 네 건은 그 경계를 지킨다.
 */

/** D 가 미달인 딜. 예산·구매 준비도 계열 전제를 시험하는 데 쓴다. */
const lowBusinessDeal = {
  track: 'T-B',
  customer_meta: { industry: '제조', targetUsers: '500명', investment: '2억' },
  fqa_totals: {
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
    deal: lowBusinessDeal, slots, itemCountByCategory: ITEM_COUNTS,
    solutions: [{
      slug: 'needs-budget', name: '예산전제ISV', slot: 'llm-platform', status: 'published',
      fqa_coverage: [{ category: 'D', items: ['명확한 업무 문제'], strength: 2 }],
      prerequisites: [{ kind: 'fqa', category: 'D', item: '예산·구매 준비도', min: 3,
        blocking: true, label: '예산·구매 준비도 3 이상' }]
    }],
    packages: [{
      id: 'ADOPTION', slug: 'ADOPTION', name: '도입 확산 키트',
      fqa_coverage: [{ category: 'D', items: ['현업 오너십', '변화관리·교육'], strength: 3 }],
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
    deal: lowBusinessDeal, slots, itemCountByCategory: ITEM_COUNTS,
    solutions: [{
      slug: 'needs-devenv', name: '개발환경전제ISV', slot: 'llm-platform', status: 'published',
      fqa_coverage: [{ category: 'B', items: ['모델·벤더 전환성'], strength: 2 }],
      prerequisites: [{ kind: 'fqa', category: 'B', item: '개발·테스트 환경', min: 3,
        blocking: true, label: '개발·테스트 환경 3 이상' }]
    }],
    packages: [
      { id: 'INTEGRATION', slug: 'INTEGRATION', name: 'AI Integration',
        fqa_coverage: [{ category: 'B', items: ['업무 시스템 연동성', '지식 소스 품질'], strength: 3 }],
        readiness_lift: { B: 1.5 } },
      { id: 'POC', slug: 'POC', name: 'AI PoC',
        fqa_coverage: [{ category: 'B', items: ['개발·테스트 환경'], strength: 2 },
          { category: 'D', items: ['명확한 업무 문제'], strength: 2 }],
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
      fqa_coverage: [{ category: 'A', items: ['감사 로그와 추적성'], strength: 2 }],
      prerequisites: [
        { kind: 'fqa', category: 'A', item: '데이터 보존·삭제 정책', min: 4,
          blocking: true, label: '보존정책 4 이상' },
        { kind: 'fqa', category: 'A', item: '접근권한과 계정 체계', min: 3,
          blocking: true, label: 'IAM 3 이상' }
      ]
    }],
    packages: [{
      id: 'SECURITY', slug: 'SECURITY', name: 'AI Security Readiness',
      fqa_coverage: [{ category: 'A', items: ['접근권한과 계정 체계'], strength: 3 }],
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

test('검토 여부에 따라 라벨이 달라진다', () => {
  assert.equal(run({ solutions: [] }).label, '고객 자가응답 기준 잠정 추천');
  const reviewed = recommend({
    deal: { ...lowSecurityDeal, fqa_reviewed_at: '2026-07-28T00:00:00Z' },
    slots, itemCountByCategory: ITEM_COUNTS, solutions: []
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
  // 012·014 를 그대로 읽어 회귀를 잡는다. 판정 데이터를 고치면 여기서 드러난다.
  const seed = fs.readFileSync(path.join(root, 'db', 'migrations', '012_seed_recommendation_rules.sql'), 'utf8');
  const pkgSeed = fs.readFileSync(path.join(root, 'db', 'migrations', '014_seed_package_coverage.sql'), 'utf8');
  const pick = (block, field) => {
    const m = block.match(new RegExp(`${field} = '([\\s\\S]*?)'::jsonb`));
    return m ? JSON.parse(m[1]) : [];
  };

  const solutions = [...seed.matchAll(/update solutions set([\s\S]*?)where slug = '([a-z0-9-]+)';/g)]
    .map((m) => ({
      slug: m[2], name: m[2], slot: 'llm-platform', status: 'published',
      fqa_coverage: pick(m[1], 'fqa_coverage'),
      prerequisites: pick(m[1], 'prerequisites'),
      red_flags: pick(m[1], 'red_flags')
    }));
  const packages = [...pkgSeed.matchAll(/update packages set fqa_coverage = '([\s\S]*?)'::jsonb where id = '(\w+)'/g)]
    .map((m) => ({ id: m[2], slug: m[2], name: m[2], fqa_coverage: JSON.parse(m[1]) }));

  assert.equal(solutions.length, 9, '012 는 9종을 심는다');
  assert.equal(packages.length, 6, '014 는 패키지 6종을 심는다');

  const out = recommend({
    deal: {
      ...lowSecurityDeal,
      fqa_totals: {
        ...lowSecurityDeal.fqa_totals,
        C: { score: 2.1, threshold: 3.0, answered: 5, ready: false }
      }
    },
    solutions, packages, slots, itemCountByCategory: ITEM_COUNTS
  });

  // A·C 가 미달인 고객에게는 그 두 축을 덮는 패키지가 먼저 와야 한다.
  assert.ok(out.eligible.length > 0, '적합 후보가 하나도 없으면 안 된다');
  assert.ok(out.eligible.every((x) => x.kind === 'package'),
    `준비도가 낮으면 ISV 는 전제에 걸린다: ${out.eligible.map((x) => x.name).join(', ')}`);
  assert.deepEqual(out.eligible.map((x) => x.name).sort(), ['OPERATE', 'SECURITY']);
  // 걸린 ISV 들은 버리지 않고 번들로 살아남아야 한다.
  assert.ok(out.bundles.length >= 3, `번들 후보가 너무 적다: ${out.bundles.length}`);
});
