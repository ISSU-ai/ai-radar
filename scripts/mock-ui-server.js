'use strict';

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

const user = { id: '00000000-0000-0000-0000-000000000001', name: '김영업', email: 'sales@issu.ai', role: 'admin' };
const refs = {
  stages: ['들어온 데이터', 'PoC 검증', 'ISV 조합', '딜 사이즈', '피치 준비'],
  tracks: [
    { id: 'T-A', name: '인프라 동반형', why: '보안·AI 기반을 함께 설계합니다.', warn: '인프라 범위를 먼저 확정하세요.' },
    { id: 'T-B', name: '경량 도입형', why: '빠르게 가치를 검증합니다.', warn: '성공 기준을 수치로 합의하세요.' },
    { id: 'T-C', name: 'Zscaler 보유형', why: '기존 환경과 연결합니다.', warn: '테넌트 정책을 확인하세요.' }
  ],
  fqaItems: [
    { category: 'A', no: 1, name: '데이터 분류와 민감도 기준', detail: 'AI에 투입 가능한 데이터가 정의되어 있나요?', weight: 5, threshold: 3.5 },
    { category: 'A', no: 2, name: '접근권한과 계정 체계', detail: '사용자와 관리자 권한이 분리되어 있나요?', weight: 5, threshold: 3.5 },
    { category: 'B', no: 3, name: '업무 시스템 연동성', detail: '핵심 시스템에 API로 연결할 수 있나요?', weight: 4, threshold: 3 },
    { category: 'C', no: 4, name: '운영 책임자 지정', detail: '운영 책임자가 지정되어 있나요?', weight: 5, threshold: 3 },
    { category: 'D', no: 5, name: '성과 KPI', detail: 'PoC 성공 KPI가 합의되어 있나요?', weight: 5, threshold: 3.5 }
  ],
  packages: [
    { id: 'DISCOVERY', name: 'AI Opportunity Discovery', scale: 'S', period: '2주', target: '우선 과제와 성공 기준 확정', items: [{ label: '실행 로드맵' }] },
    { id: 'POC', name: 'Enterprise AI PoC', scale: 'M', period: '4~6주', target: '핵심 업무 기술·가치 검증', items: [{ label: '평가 리포트' }] },
    { id: 'OPERATE', name: 'Managed AI Operations', scale: 'O', period: '상시', target: '품질·비용 운영 체계', items: [{ label: '월간 운영 리포트' }] }
  ],
  solutions: [
    { id: 's1', name: 'OpenAI Enterprise', category: 'Enterprise AI', jtbd: '전사 지식업무 생산성과 안전한 AI 활용', grade: 3, scale: 'L', focal_name: '박포컬', status_op: 'active' },
    { id: 's2', name: 'LiteLLM', category: 'LLM Gateway', jtbd: '멀티 모델 라우팅과 비용 통제', grade: 2, scale: 'M', focal_name: '이기술', tech_note: '고객 인증 체계 사전 확인', status_op: 'active' },
    { id: 's3', name: 'AI Guard', category: 'Security', jtbd: 'Enterprise AI 보안 통제', grade: 1, scale: 'S', focal_name: null, status_op: 'paused' }
  ]
};

let deals = [
  { id: 'd1', customer: '한빛금융', customer_meta: { industry: 'Finance', companySize: '1,000명 초과', targetUsers: '전사 1,200명', securityStack: 'zscaler' }, fqa_scores: { 1: 4, 2: 3, 3: 4, 4: 3, 5: 4 }, fqa_totals: { A: { score: 3.5, ready: true, answered: 2 }, B: { score: 4, ready: true, answered: 1 }, C: { score: 3, ready: true, answered: 1 }, D: { score: 4, ready: true, answered: 1 } }, track: 'T-C', track_name: 'Zscaler 보유형', isv_combo: ['s1', 's2'], packages: [{ id: 'POC', md: 28 }], stage: 2, source: 'manual', owner_id: user.id, owner_name: user.name, updated_at: new Date().toISOString() },
  // 포탈로 들어온 딜. 027 이후 담당자 이름·전화번호가 leads 에 남고 허브는 읽기 전용으로
  // 보여준다. 업종·규모는 taxonomy.js 어휘(SFDC 코드 · 진단기준 구간)로 저장된다.
  { id: 'd2', customer: '온누리제조',
    customer_meta: { industry: 'Manufacturing', companySize: '501~1,000명', securityStack: 'none' },
    fqa_scores: {}, fqa_totals: {}, track: 'T-A', track_name: '인프라 동반형',
    isv_combo: [], packages: [], stage: 0, source: 'portal',
    lead_contact: 'park@onnuri.co.kr', lead_contact_name: '박담당',
    lead_contact_phone: '031-987-6543 (내선 12)',
    lead_message: '전사 문서 검색부터 검토 중입니다.',
    owner_id: null, owner_name: null, updated_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'd3', customer: '다온커머스', customer_meta: { industry: '유통' }, fqa_scores: {}, fqa_totals: {}, track: 'T-B', track_name: '경량 도입형', isv_combo: ['s1'], packages: [{ id: 'DISCOVERY', md: 8 }], stage: 4, source: 'sheet', owner_id: user.id, owner_name: user.name, updated_at: new Date(Date.now() - 86400000).toISOString() }
];

app.get('/api/auth/me', (_req, res) => res.json({ user }));
app.post('/api/auth/logout', (_req, res) => res.json({ message: 'ok' }));
app.get('/api/hub/reference-data', (_req, res) => res.json(refs));
app.get('/api/hub/public/fqa-items', (_req, res) => res.json(refs.fqaItems.map(({ weight, threshold, ...item }) => item)));
app.get('/api/hub/public/packages', (_req, res) => res.json(refs.packages.map(({ scale, ...pkg }) => pkg)));
app.post('/api/hub/public/diagnose', (req, res) => {
  const scores = Object.values(req.body.fqa_scores || {}).map(Number);
  const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
  const answeredIn = (category) => refs.fqaItems
    .filter((item) => item.category === category && (req.body.fqa_scores || {})[item.no]).length;
  res.json({
    summary: average >= 4 ? '확장 준비 단계' : average >= 3 ? '검증 준비 단계' : '기반 정비 단계',
    categories: ['A', 'B', 'C', 'D'].map((category) => ({
      category, score: average, answered: answeredIn(category),
      status: average >= 3.5 ? 'ready' : 'strengthen'
    }))
  });
});
// 실제 서버와 같은 검증을 거친다. 목업이 무조건 201 을 주면 폼 오류를 화면에서 못 본다.
const { validateLead } = require('../lib/hub-domain');
const mockLeads = [];
app.post('/api/hub/public/leads', (req, res) => {
  let lead;
  try { lead = validateLead(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  mockLeads.push({ ...lead, id: `mock-${mockLeads.length + 1}`, created_at: new Date().toISOString() });
  res.status(201).json({ message: '접수 완료(목업)', reference: mockLeads[mockLeads.length - 1].id });
});
// 저장된 리드 확인용. 실제 서버에는 없는 목업 전용 경로다.
app.get('/api/hub/public/_leads', (_req, res) => res.json(mockLeads));
app.get('/api/hub/deals', (_req, res) => res.json(deals.map(({ fqa_scores, fqa_totals, isv_combo, packages, ...deal }) => deal)));
app.post('/api/hub/deals', (req, res) => {
  const deal = { id: `d${deals.length + 1}`, customer: req.body.customer, customer_meta: req.body.customer_meta || {}, fqa_scores: {}, fqa_totals: {}, track: null, isv_combo: [], packages: [], stage: 0, source: req.body.source || 'manual', owner_id: user.id, owner_name: user.name, updated_at: new Date().toISOString() };
  deals.unshift(deal); res.status(201).json(deal);
});
app.get('/api/hub/deals/:id', (req, res) => {
  const deal = deals.find((item) => item.id === req.params.id);
  deal ? res.json(deal) : res.status(404).json({ error: 'not found' });
});
app.patch('/api/hub/deals/:id', (req, res) => {
  const index = deals.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'not found' });
  deals[index] = { ...deals[index], ...req.body, updated_at: new Date().toISOString() };
  res.json(deals[index]);
});
app.post('/api/hub/deals/:id/claim', (req, res) => {
  const deal = deals.find((item) => item.id === req.params.id);
  Object.assign(deal, { owner_id: user.id, owner_name: user.name }); res.json(deal);
});
app.get('/api/hub/events', (_req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`event: ready\ndata: ${JSON.stringify({ user: user.id })}\n\n`);
});


// ── /admin 편집기 목업 ────────────────────────────────────────────
// 판정 데이터 폼(2-2b)과 완성도 패널(2-2c)을 DB 없이 눈으로 확인하기 위한 최소 구현.
const { evaluateCompleteness } = require('../lib/solution-completeness');

// 슬롯 분류표는 011 에서 그대로 읽는다. 목업이 실제와 어긋나면 검사 결과가 거짓말을 한다.
const mockSlots = (() => {
  const sql = require('fs').readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '011_slot_taxonomy_and_layer_fixes.sql'), 'utf8');
  const block = sql.slice(sql.indexOf('insert into solution_slots'), sql.indexOf('on conflict (id) do update'));
  const assigned = {};
  const assignBlock = sql.slice(sql.indexOf('update solutions set slot = v.slot'), sql.indexOf('as v(slug, slot)'));
  for (const m of assignBlock.matchAll(/\('([a-z0-9-]+)',\s*'([a-z0-9-]+)'\)/g)) {
    assigned[m[2]] = (assigned[m[2]] || 0) + 1;
  }
  const rows = [];
  for (const m of block.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*'(L[0-4])',\s*(true|false)/g)) {
    rows.push({ id: m[1], name: m[2], layer: m[3], is_competitive: m[4] === 'true', candidates: assigned[m[1]] || 0 });
  }
  return rows;
})();

// 실제 DB 상태를 그대로 반영한다. 012 가 판정 데이터를 넣은 것은 상세 작성 9종이고
// (openai-enterprise · articul8 · anthropic-claude · twelve-labs · eleven-labs ·
//  replit · dataiku · litellm · anaconda), Trust Layer 4종과 껍데기 9종은 비어 있다.
// Portal26 초안은 아직 DB 에 넣지 않았으므로 여기서도 비어 있어야 한다.
// Portal26 본문은 022 시드에서 그대로 읽는다. 목업에 따로 베껴 두면 둘이 어긋난다.
const portal26Sections = (() => {
  const sql = require('fs').readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '022_portal26_content.sql'), 'utf8');
  const out = {};
  for (const m of sql.matchAll(/'(\d)',\s*E'((?:[^'\\]|\\.|'')*)'/g)) {
    out[m[1]] = m[2].replace(/\\n/g, '\n').replace(/''/g, "'");
  }
  return out;
})();

const cohereSections = (() => {
  const sql = require('fs').readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '023_cohere.sql'), 'utf8');
  const out = {};
  for (const m of sql.matchAll(/'(\d)',\s*E'((?:[^'\\]|\\.|'')*)'/g)) {
    out[m[1]] = m[2].replace(/\\n/g, '\n').replace(/''/g, "'");
  }
  return out;
})();

const mockSolutions = [
  {
    id: 'sol-1', slug: 'openai-enterprise', name: 'OpenAI Enterprise', layer: 'L1', slot: 'llm-platform',
    delivery: 'SaaS/API', synergy: '매우 높음', category: 'GenAI / 범용 LLM',
    jtbd: '생태계 1위 및 친숙한 UI', value_chain: 'AI Platform',
    status: 'published', version: 3, grade: 3, scale: 'L', bundle_potential: 3,
    sections: {
      1: 'OpenAI Enterprise는 Fortune 500 기업의 92% 이상이 선택한 시장 표준 Generative AI 플랫폼입니다. 임직원의 친숙도가 가장 높고, API 생태계와 노코드 확장 플랫폼을 기반으로 사내 지식 베이스 구축부터 고난도 비전/음성 비즈니스 영역까지 대응이 가능합니다.\n- **제품 라인업**: ChatGPT Enterprise, ChatGPT Team, ChatGPT Edu, API Platform\n- **차별적 비즈니스 가치**: 최강의 범용 추론 성능, 높은 임직원 친숙도, 커스텀 GPTs 노코드 제작, 검증된 데이터 프라이버시, 강력한 관리자 통제를 모두 갖춘 구성입니다. SOC 2 Type II 인증과 DPA 명문화로 기업 원시 데이터를 격리합니다.',
      3: '### 3.1 산업 적합도\n- **○ 매우 적합**: 전 산업 사무직 중심 대기업\n### 3.2 핵심 의사결정 페르소나\n- **CIO / CDO (의사결정자)**: 그림자 IT 방지 및 공식 보안 거버넌스 수립이 주요 관심사',
      7: '### 7.1 필수 요건 (5가지)\n- [ ] 최소 도입 인원이 150명 이상인가?\n- [ ] 사내 로그인 연동을 위한 SSO 인프라가 갖춰져 있는가?\n- [ ] 사내 데이터 전송에 법무/보안 규정상 문제가 없는가?\n- [ ] AI 도입 총괄 챔피언이 지정되어 있는가?\n- [ ] 글로벌 DPA 표준안을 수용할 수 있는가?'
    },
    sections_internal: {}, industries: [], simulator_mappings: [],
    fqa_coverage: [
      { category: 'D', items: ['명확한 업무 문제'], strength: 2 },
      { category: 'B', items: ['지식 소스 품질'], strength: 2 }
    ],
    prerequisites: [
      { kind: 'numeric', field: 'seats', min: 150, blocking: true, label: '최소 도입 인원 150명 (ChatGPT Enterprise 기준)' },
      { kind: 'fqa', category: 'A', item: '접근권한과 계정 체계', min: 3, blocking: true, label: 'SSO(Okta/Azure AD) 인프라' },
      { kind: 'manual', label: '사내 데이터의 OpenAI 클라우드 전송에 법무·보안 승인', blocking: true }
    ],
    red_flags: [
      { signal: '외부 인터넷 100% 차단 에어갭 환경', alternatives: [{ slug: 'articul8', label: 'Articul8' }] },
      { signal: '50명 이하 소규모인데 Enterprise 등급 요구', alternatives: [{ label: 'ChatGPT Team' }] }
    ],
    price_type: null, unit_price: 0, currency: 'KRW', price_tiers: [], price_is_placeholder: true
  },
  {
    id: 'sol-2', slug: 'articul8', name: 'Articul8', layer: 'L2', slot: 'private-domain-platform',
    delivery: 'SW (On-prem/Airgap)', synergy: '매우 높음', category: '도메인특화 모델·오케스트레이션',
    jtbd: '에어갭/온프레미스 고보안 제조업 최적화', value_chain: 'AI Platform',
    status: 'published', version: 2, grade: 3, scale: 'L', bundle_potential: 3,
    sections: {
      1: 'Articul8은 인텔에서 스핀오프된 엔터프라이즈 특화 AI 플랫폼입니다. 데이터 외부 반출이 완전히 차단된 폐쇄망(에어갭) 및 온프레미스 하이브리드 환경 배포를 완벽히 지원하며, 산업별 도메인 특화 모델(DSM)과 독자적인 다중 모델 오케스트레이션(ModelMesh)을 핵심 강점으로 내세웁니다. 배포 유연성이 최대 강점으로, 플랫폼이 고객 보안경계 내에 100% 셀프컨테인드로 배포되어 외부 SaaS 로 데이터가 나가는 구조를 요구하지 않습니다.',
      3: '### 3.1 산업 적합도\n- **○ 매우 적합**: 반도체/디스플레이 제조, 방위산업/국방, 중공업, 공공 기밀 기관',
      7: '### 7.1 필수 요건 (5가지)\n- [ ] GPU 서버 인프라 예산이 확보되어 있는가?\n- [ ] Kubernetes 를 관리할 인프라 엔지니어가 있는가?\n- [ ] 도메인 학습용 사내 기밀 텍스트 데이터셋이 충분한가?'
    },
    sections_internal: { 1: '- **AI Tech 의견 (PreSales)**: 마진율이 가장 높은 고수익성 카드입니다.' },
    industries: [], simulator_mappings: [],
    fqa_coverage: [
      { category: 'A', items: ['데이터 분류와 민감도 기준', '보안 게이트웨이 준비도'], strength: 3 },
      { category: 'B', items: ['지식 소스 품질'], strength: 2 }
    ],
    prerequisites: [
      { kind: 'numeric', field: 'annual_budget_krw', min: 100000000, blocking: true, label: '연간 예산 1억원 이상 (GPU 서버 구축비 포함)' },
      { kind: 'fqa', category: 'C', item: '운영 책임자 지정', min: 3, blocking: true, label: 'Kubernetes 관리 인프라 엔지니어' }
    ],
    red_flags: [
      { signal: '연간 예산 1억원 미만 · GPU 서버 구축비 지출 불가', alternatives: [{ label: '퍼블릭 Cloud RAG' }] },
      { signal: '10명 이하 부서에서 경량 문서 작성·검색만 요구', alternatives: [{ slug: 'openai-enterprise', label: '퍼블릭 ChatGPT' }] }
    ],
    price_type: null, unit_price: 0, currency: 'KRW', price_tiers: [], price_is_placeholder: true
  },
  {
    // 022 로 8탭 본문을 채운 상태. 019 가 판정 데이터를 넣었다.
    id: 'sol-3', slug: 'portal26', name: 'Portal26', layer: 'L4', slot: 'ai-usage-governance',
    delivery: 'SaaS', synergy: '높음', category: 'AI 거버넌스·가시성 (AI TRiSM)',
    jtbd: '누가 어떤 AI를 얼마나 쓰는지 가시화하고, Shadow AI·프롬프트 위험·토큰 비용을 통제',
    value_chain: 'AI Governance', status: 'published', version: 2, grade: 2, scale: 'M',
    bundle_potential: 3,
    sections: portal26Sections, sections_internal: {}, industries: [], simulator_mappings: [],
    fqa_coverage: [
      { category: 'A', items: ['감사 로그와 추적성'], strength: 3 },
      { category: 'A', items: ['데이터 분류와 민감도 기준'], strength: 2 },
      { category: 'C', items: ['비용 모니터링'], strength: 2 }
    ],
    prerequisites: [
      { kind: 'fqa', category: 'A', item: '접근권한과 계정 체계', min: 3, blocking: true,
        label: '사용자·부서 식별이 가능한 계정 체계' },
      { kind: 'manual', label: '임직원 AI 사용 로그 수집에 대한 노무·개인정보 검토', blocking: true }
    ],
    red_flags: [
      { signal: 'AI 사용 인원이 수십 명 규모라 가시화 투자 대비 효과가 낮음',
        alternatives: [{ label: 'Enterprise 관리자 콘솔 기본 리포트' }] },
      { signal: '직원 활동 로깅에 대한 사내 합의 불가',
        alternatives: [{ label: '정책 수립 선행' }] }
    ],
    price_type: null, unit_price: 0, currency: 'KRW', price_tiers: [], price_is_placeholder: true
  },
  {
    // Anthropic Claude — 012 가 판정 데이터를 넣은 9종 중 하나. 노출 목록 8종에 포함된다.
    id: 'sol-5', slug: 'anthropic-claude', name: 'Anthropic Claude', layer: 'L1', slot: 'llm-platform',
    delivery: 'API (Bedrock)', synergy: '매우 높음', category: 'GenAI / 범용 LLM',
    jtbd: '긴 문서 추론과 안전성이 중요한 업무에 쓰는 엔터프라이즈 LLM',
    value_chain: 'AI Platform', status: 'published', version: 2, grade: 3, scale: 'L',
    bundle_potential: 3,
    sections: {
      1: 'Anthropic Claude 는 긴 문맥 추론과 안전성(Constitutional AI)에 강점을 둔 엔터프라이즈 LLM 입니다. AWS Bedrock 을 통해 고객 VPC 안에서 호출할 수 있어, 데이터를 외부 SaaS 로 보내기 어려운 고객에게 현실적인 선택지가 됩니다.\n- **제품 라인업**: Claude (claude.ai 기업용), Claude API, AWS Bedrock 경유 호출\n- **차별적 비즈니스 가치**: ① 긴 문서·계약서·규정 해석에서 안정적인 추론 ② Bedrock 경유 시 리전·네트워크 통제를 고객이 유지 ③ Portal26 for Claude 무상 거버넌스 프로그램으로 도입 초기 통제 확보',
      3: '### 3.1 산업 적합도\n- **○ 매우 적합**: 금융·법무·공공 — 긴 규정 문서 해석과 데이터 통제 요구가 큰 영역\n### 3.2 핵심 의사결정 페르소나\n- **CIO / CDO (의사결정자)**: 데이터가 어느 리전에 머무는지가 첫 질문입니다\n- **정보보호 담당 (게이트키퍼)**: Bedrock 경유 여부로 검토 난이도가 크게 갈립니다',
      7: '### 7.1 필수 요건 (5가지)\n- [ ] AWS 계정과 Bedrock 사용 가능 리전이 확보되어 있는가?\n- [ ] 사용자 식별을 위한 SSO 인프라가 있는가?\n- [ ] 사내 데이터의 모델 호출 전송에 법무·보안 승인이 가능한가?\n- [ ] 활용을 이끌 현업 챔피언이 지정되어 있는가?\n- [ ] 응답 품질을 판정할 평가 기준이 있는가?\n### 7.3 부적합 신호: Red Flag (3가지)\n- [ ] 1. 완전 폐쇄망 에어갭 요구 ➔ **Articul8 제안**\n- [ ] 2. 이미지·음성 생성이 주 목적 ➔ **다른 모달리티 특화 제품 제안**\n- [ ] 3. AWS 를 쓰지 않고 도입 계획도 없음 ➔ **직접 API 계약 검토**'
    },
    sections_internal: {}, industries: [], simulator_mappings: [],
    fqa_coverage: [
      { category: 'D', items: ['명확한 업무 문제'], strength: 2 },
      { category: 'B', items: ['지식 소스 품질'], strength: 2 },
      { category: 'A', items: ['데이터 분류와 민감도 기준'], strength: 2 }
    ],
    prerequisites: [
      { kind: 'fqa', category: 'A', item: '접근권한과 계정 체계', min: 3, blocking: true,
        label: 'SSO 인프라' },
      { kind: 'manual', label: 'AWS Bedrock 사용 가능 리전 확보', blocking: true }
    ],
    red_flags: [
      { signal: '완전 폐쇄망 에어갭 환경 요구',
        alternatives: [{ slug: 'articul8', label: 'Articul8' }] }
    ],
    price_type: null, unit_price: 0, currency: 'KRW', price_tiers: [], price_is_placeholder: true
  },
  {
    // Cohere — 023 으로 신규 등록. llm-platform 슬롯이라 OpenAI·Claude 와 경쟁한다.
    id: 'sol-6', slug: 'cohere', name: 'Cohere', layer: 'L1', slot: 'llm-platform',
    delivery: 'SaaS / VPC / On-prem', synergy: '높음',
    category: 'GenAI / 범용 LLM (데이터 주권형)',
    jtbd: '데이터를 외부로 내보내지 않고 다국어 검색·RAG·에이전트를 기업 내부에 구축',
    value_chain: 'AI Platform', status: 'published', version: 1, grade: 2, scale: 'L',
    bundle_potential: 3,
    sections: cohereSections, sections_internal: {}, industries: [], simulator_mappings: [],
    fqa_coverage: [
      { category: 'B', items: ['지식 소스 품질'], strength: 3 },
      { category: 'B', items: ['업무 시스템 연동성'], strength: 2 }
    ],
    prerequisites: [
      { kind: 'fqa', category: 'A', item: '데이터 분류와 민감도 기준', min: 3, blocking: true,
        label: '검색 인덱스 대상 데이터 범위 확정' },
      { kind: 'manual', label: '배포 형태 확정 — Bedrock 경유 / VPC / 온프레·에어갭', blocking: true }
    ],
    red_flags: [
      { signal: '데이터 반출 제약이 없고 임직원 생산성만 목적',
        alternatives: [{ slug: 'openai-enterprise', label: 'OpenAI Enterprise' }] },
      { signal: '제조 현장 데이터 중심 폐쇄망',
        alternatives: [{ slug: 'articul8', label: 'Articul8' }] }
    ],
    price_type: null, unit_price: 0, currency: 'KRW', price_tiers: [], price_is_placeholder: true
  },
  {
    // 껍데기 9종. {name} 플레이스홀더가 그대로 남아 있고 페르소나 문장이 서로 같다.
    id: 'sol-4', slug: 'ibm', name: 'IBM', layer: 'L1', slot: 'llm-platform',
    delivery: 'SW/Cloud', synergy: '중', category: '종합 AI/ML(watsonx)', jtbd: '엔터프라이즈 거버넌스 AI',
    value_chain: 'AI Platform', status: 'published', version: 1, bundle_potential: null,
    sections: {
      1: 'IBM watsonx 는 엔터프라이즈 거버넌스 AI 플랫폼입니다.',
      3: '- **CIO / CDO (의사결정자)**: 데이터 자산화 및 통합 AI 거버넌스 수립이 주요 관심사 ➔ **{name}의 엔터프라이즈 제어 기능 강조**\n- **플랫폼 엔지니어 / IT 운영 리더**: 인프라 복잡성 완화 및 운영비용(FinOps) 최적화가 관심사 ➔ **MZC MSP 관리 서비스 연계**'
    },
    sections_internal: {}, industries: [], simulator_mappings: [],
    fqa_coverage: [], prerequisites: [], red_flags: [],
    price_type: null, unit_price: 0, currency: 'KRW', price_tiers: [], price_is_placeholder: true
  }
];

app.get('/api/auth/me', (_req, res) => res.json({ user }));
app.post('/api/auth/logout', (_req, res) => res.json({ message: 'ok' }));
app.get('/api/admin/slots', (_req, res) => res.json(mockSlots));
app.get('/api/admin/focal-contacts', (_req, res) => res.json([{ id: 'f1', name: '박포컬', org: 'ISSU' }]));
app.get('/api/admin/profiles', (_req, res) => res.json([{ id: user.id, email: user.email, full_name: user.name, team: 'ISSU', role: 'admin', approved: true }]));
app.get('/api/admin/packages', (_req, res) => res.json(refs.packages.map((p) => ({ ...p, base_md: 20, unit_price: 0, price_is_placeholder: true }))));
app.get('/api/admin/settings', (_req, res) => res.json({ usd_krw: 1400 }));
app.get('/api/solutions', (req, res) => {
  // 실제 서버는 include_hidden / include_archived 가 1 일 때만 돌려준다 (server.js).
  const showHidden = String(req.query.include_hidden) === '1';
  const showArchived = String(req.query.include_archived) === '1';
  res.json(mockSolutions
    .filter((sol) => (showHidden || !sol.is_hidden) && (showArchived || !sol.is_archived))
    .map(({ sections, ...rest }) => ({
      ...rest, is_hidden: Boolean(rest.is_hidden), is_archived: Boolean(rest.is_archived)
    })));
});
app.patch('/api/admin/solutions/:id/visibility', (req, res) => {
  const sol = mockSolutions.find((item) => item.id === req.params.id);
  if (!sol) return res.status(404).json({ error: '솔루션을 찾을 수 없습니다.' });
  if (typeof req.body?.hidden === 'boolean') sol.is_hidden = req.body.hidden;
  if (typeof req.body?.archived === 'boolean') sol.is_archived = req.body.archived;
  res.json({
    slug: sol.slug, name: sol.name,
    is_hidden: Boolean(sol.is_hidden), is_archived: Boolean(sol.is_archived),
    message: `${sol.name} — ${sol.is_hidden ? '숨김' : '노출'} 처리했습니다(목업).`
  });
});
app.get('/api/solutions/:slug', (req, res) => {
  const found = mockSolutions.find((s) => s.slug === req.params.slug);
  return found ? res.json(found) : res.status(404).json({ error: 'not found' });
});
app.get('/api/admin/solutions/:id/versions', (_req, res) => res.json([]));
app.get('/api/admin/solutions/:id/completeness', (req, res) => {
  const target = mockSolutions.find((s) => s.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  res.json(evaluateCompleteness(target, {
    slots: new Map(mockSlots.map((s) => [s.id, { layer: s.layer }])),
    knownSlugs: new Set([...mockSolutions.map((s) => s.slug), 'zscaler']),
    otherSolutions: mockSolutions.filter((s) => s.id !== target.id)
  }));
});
app.put('/api/admin/solutions/:id', (req, res) => {
  const index = mockSolutions.findIndex((s) => s.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'not found' });
  mockSolutions[index] = { ...mockSolutions[index], ...req.body };
  res.json({ message: '저장되었습니다(목업).', slug: mockSolutions[index].slug });
});

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'admin.html')));

app.use(express.static(path.join(__dirname, '..')));
app.get('/hub', (_req, res) => res.sendFile(path.join(__dirname, '..', 'hub.html')));
app.get('/offering', (_req, res) => res.sendFile(path.join(__dirname, '..', 'offering.html')));

app.listen(4173, '127.0.0.1', () => console.log('Mock UI server: http://127.0.0.1:4173'));
