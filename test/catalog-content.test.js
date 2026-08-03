'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { evaluateCompleteness } = require('../lib/solution-completeness');
const { splitSectionText } = require('../lib/section-privacy');

const root = path.join(__dirname, '..');

/**
 * 022 Portal26 · 023 Cohere — 조사해서 채운 카탈로그 본문의 정합성을 고정한다.
 * 이 두 건은 공개 자료가 얇아 "모르는 것을 아는 척 쓰기" 쉬운 영역이라,
 * 벤더 주장 표기와 미확인 항목이 살아 있는지를 구조로 지킨다.
 */

/** jsonb_build_object 안 E'...' 리터럴을 섹션 객체로 되돌린다. */
function sectionsOf(file) {
  const sql = fs.readFileSync(path.join(root, 'db', 'migrations', file), 'utf8');
  const out = {};
  for (const m of sql.matchAll(/'(\d)',\s*E'((?:[^'\\]|\\.|'')*)'/g)) {
    out[m[1]] = m[2].replace(/\\n/g, '\n').replace(/''/g, "'");
  }
  return out;
}

const sections = sectionsOf('022_portal26_content.sql');
const cohere = sectionsOf('023_cohere.sql');

test('8탭이 모두 채워져 있다', () => {
  // 노출 목록 8종 중 하나인데 상세가 비면 영업이 열어봐야 볼 게 없다.
  for (let i = 1; i <= 8; i += 1) {
    assert.ok(sections[String(i)], `§${i} 가 비어 있다`);
  }
});

test('발행 게이트를 통과한다', () => {
  const result = evaluateCompleteness({
    slug: 'portal26', name: 'Portal26', layer: 'L4', slot: 'ai-usage-governance',
    delivery: 'SaaS', synergy: '높음', category: 'AI 거버넌스·가시성 (AI TRiSM)',
    jtbd: '누가 어떤 AI를 얼마나 쓰는지 가시화', value_chain: 'AI Governance',
    sections, bundle_potential: 3,
    fqa_coverage: [{ category: 'A', items: ['감사 로그와 추적성'], strength: 3 }],
    prerequisites: [{ kind: 'fqa', category: 'A', item: '접근권한과 계정 체계', min: 3, blocking: true, label: '계정 체계' }],
    red_flags: [{ signal: 'AI 사용 인원이 수십 명 규모', alternatives: [{ label: '벤더 관리자 콘솔' }] }]
  }, {
    slots: new Map([['ai-usage-governance', { id: 'ai-usage-governance', name: 'AI 사용 가시성·거버넌스', layer: 'L4' }]]),
    knownSlugs: new Set(['portal26', 'zscaler', 'new-relic', 'articul8'])
  });

  assert.equal(result.blocking.length, 0, result.blocking.map((b) => b.message).join(' / '));
  assert.equal(result.warnings.length, 0, result.warnings.map((w) => w.message).join(' / '));
});

test('내부 전략 문단이 공개본에서 빠진다', () => {
  // §8 에 번들 마진 얘기가 들어 있다. 고객에게 보이면 안 되는 문단이다.
  const { publicText, internalText } = splitSectionText(sections['8']);
  assert.ok(internalText && internalText.length > 0, '내부 문단이 잡히지 않았다');
  assert.ok(!/마진/.test(publicText), '마진 문구가 공개본에 남았다');
  assert.match(internalText, /마진/);
  assert.match(publicText, /CISO 설득 화법/, '공개용 영업 팁은 남아 있어야 한다');
});

test('벤더 주장 수치에 출처 표기가 붙어 있다', () => {
  // 200%·40%·72시간은 Portal26 이 스스로 낸 수치다. 우리 검증치처럼 쓰면 PoC 에서 깨진다.
  const body = Object.values(sections).join('\n');
  for (const claim of ['200%', '40%']) {
    const at = body.indexOf(claim);
    assert.ok(at > 0, `${claim} 주장이 본문에 있어야 한다`);
    const around = body.slice(Math.max(0, at - 120), at + 60);
    assert.match(around, /벤더 (주장|발표|공개)/, `${claim} 옆에 출처 표기가 없다`);
  }
  assert.match(sections['8'], /벤더 수치.*우리 검증치처럼 말하지/,
    '§8 에 수치 인용 주의가 있어야 한다');
});

test('모르는 것을 아는 척 쓰지 않았다', () => {
  // 배포·연동 방식은 공개 자료에 없다. 지어내면 PoC 첫 미팅에서 드러난다.
  assert.match(sections['4'], /미확인 구간/, '§4 에 미확인 표시가 있어야 한다');
  assert.match(sections['7'], /7\.4 벤더 확인 필요/, '§7 에 확인 항목 절이 있어야 한다');
  assert.match(sections['7'], /로그 수집 방식/);
  assert.match(sections['7'], /데이터 저장 위치|국내 리전/, '금융·공공에서 먼저 막히는 항목');
});

test('022 는 1회성 시드라 자동 실행 목록에 없다', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts', 'apply-migrations.js'), 'utf8');
  assert.ok(!runner.includes('022_portal26_content.sql'),
    'ISSU 가 어드민에서 고친 본문을 덮어쓴다');
});

test('목업이 022 본문을 그대로 읽는다', () => {
  // 목업에 따로 베껴 두면 둘이 어긋나고, 화면 확인이 거짓말이 된다.
  const mock = fs.readFileSync(path.join(root, 'scripts', 'mock-ui-server.js'), 'utf8');
  assert.match(mock, /022_portal26_content\.sql/);
  assert.match(mock, /sections: portal26Sections/);
});

// ── 023 Cohere ───────────────────────────────────────────────────
test('023 — Cohere 8탭이 채워지고 발행 게이트를 통과한다', () => {
  for (let i = 1; i <= 8; i += 1) assert.ok(cohere[String(i)], `§${i} 가 비어 있다`);

  const result = evaluateCompleteness({
    slug: 'cohere', name: 'Cohere', layer: 'L1', slot: 'llm-platform',
    delivery: 'SaaS / VPC / On-prem', synergy: '높음',
    category: 'GenAI / 범용 LLM (데이터 주권형)', jtbd: '데이터 주권형 LLM',
    value_chain: 'AI Platform', sections: cohere, bundle_potential: 3,
    fqa_coverage: [{ category: 'B', items: ['지식 소스 품질'], strength: 3 }],
    prerequisites: [{ kind: 'manual', label: '배포 형태 확정', blocking: true }],
    red_flags: [{ signal: '반출 제약 없음', alternatives: [{ slug: 'openai-enterprise', label: 'OpenAI' }] }]
  }, {
    slots: new Map([['llm-platform', { id: 'llm-platform', name: '범용 LLM 플랫폼', layer: 'L1' }]]),
    knownSlugs: new Set(['cohere', 'openai-enterprise', 'anthropic-claude', 'articul8'])
  });
  assert.equal(result.blocking.length, 0, result.blocking.map((b) => b.message).join(' / '));
  assert.equal(result.warnings.length, 0, result.warnings.map((w) => w.message).join(' / '));
});

test('023 — Cohere 는 OpenAI·Claude 의 대체재로 서술된다', () => {
  // 같은 슬롯(llm-platform)이라 셋 중 하나만 추천된다. 보완재처럼 쓰면 "SaaS LLM +
  // 온프레 LLM 을 같이 제안" 하는 꼴이 되어 고객이 혼란스러워한다.
  const sql = fs.readFileSync(path.join(root, 'db', 'migrations', '023_cohere.sql'), 'utf8');
  assert.match(sql, /slot = 'llm-platform'/);
  assert.match(cohere['2'], /대체재/, '§2 에 대체 관계가 명시돼야 한다');
  assert.match(cohere['8'], /Articul8[\s\S]{0,80}같이 제안하지 마십시오/,
    'Articul8 과 동시 제안을 막는 문구가 있어야 한다');
  // red_flag 가 실제로 대안을 가리켜야 슬롯 경쟁이 화면에서 설명된다
  assert.match(sql, /"slug":"openai-enterprise"/);
  assert.match(sql, /"slug":"articul8"/);
});

test('023 — 모르는 것과 벤더 주장을 구분해 적었다', () => {
  assert.match(cohere['1'], /벤더 주장/);
  assert.match(cohere['4'], /⚠ 미확인/);
  assert.match(cohere['7'], /7\.4 벤더 확인 필요/);
  assert.match(cohere['7'], /국내 리전/, '금융·공공에서 먼저 막히는 항목');
  assert.match(cohere['8'], /확인된 자료가 없습니다|PoC 없이 약속하지/);
});

test('023 — 021 노출 목록과 목업이 Cohere 를 안다', () => {
  const seed = fs.readFileSync(path.join(root, 'db', 'migrations', '021_seed_visible_catalog.sql'), 'utf8');
  assert.ok(seed.includes("('cohere')"), '021 keep 목록에 있어야 노출된다');

  const mock = fs.readFileSync(path.join(root, 'scripts', 'mock-ui-server.js'), 'utf8');
  assert.match(mock, /023_cohere\.sql/, '목업이 023 본문을 직접 읽어야 어긋나지 않는다');
  assert.match(mock, /sections: cohereSections/);

  const runner = fs.readFileSync(path.join(root, 'scripts', 'apply-migrations.js'), 'utf8');
  assert.ok(!runner.includes('023_cohere.sql'), '1회성 시드라 자동 실행 목록에서 빠져야 한다');
});
