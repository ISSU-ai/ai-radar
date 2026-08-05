'use strict';

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

const user = { id: '00000000-0000-0000-0000-000000000001', name: '김영업', email: 'sales@issu.ai', role: 'admin' };
const refs = {
  stages: ['들어온 데이터', 'AI 준비도 진단', 'ISV 조합 추천', '딜 사이즈', '피치 준비'],
  // 기획안 §7 고객 진입 시나리오 (034). 보안 환경이 아니라 구매 동기로 갈린다.
  tracks: [
    { id: 'E-1', name: '빠른 도입형', why: '기존 업무환경을 활용해 단기간 내 생산성 효과를 확인하는 딜입니다. Business 시트 + 환경 설정 + 사용자 교육으로 시작합니다.', warn: '02 OpenAI Ready 의 표준 구축은 무상입니다. 심화 교육·맞춤 연계·PoC 는 별도 산정이므로 범위를 먼저 고정하세요.' },
    { id: 'E-2', name: '개발 생산성형', why: '개발조직 KPI 를 기준으로 코드·테스트 자동화의 Codex 효과를 검증하는 딜입니다.', warn: 'Codex 는 Workspace Credit 종량제입니다. 개발자별 월 한도를 먼저 정하지 않으면 비용이 튑니다.' },
    { id: 'E-3', name: '서비스 개발형', why: 'API 기반 고객·사내 서비스를 PoC 후 상용화하고 유지 관리하는 딜입니다.', warn: 'API 사용량은 변동성이 큽니다. 상용 전환 전에 사용량·비용 한도와 운영 이관 주체를 확정하세요.' }
  ],

  // 기획안 5대 코어 오퍼링 = 딜사이징 단위 (035). 단가는 기획안에 없어 전부 미정이다.
  packages: [
    { id: 'STARTER', name: 'OpenAI Starter Package', scale: 'S', period: '3개월 (MS Light 기준)', target: '라이선스 도입부터 초기 설정·온보딩·운영관리까지 한 패키지로 시작', base_md: 0, unit_price: 0, price_is_placeholder: true, items: [{ label: 'AI Readiness Assessment 6대 영역 진단 리포트 (기본 제공)' }] },
    { id: 'P01', name: 'AI Consulting', scale: 'S', period: '2주', target: '고객의 AI 준비 수준과 업무 목표를 진단하고 최적의 OpenAI 도입안 설계', base_md: 10, unit_price: 800000, price_is_placeholder: true, items: [{ label: 'AI Readiness Assessment 및 주요 Gap 분석' }, { label: 'Seat·Credit·API 사용량 및 TCO·예산 시뮬레이션' }] },
    { id: 'P02', name: 'OpenAI Ready', scale: 'M', period: '3~4주', target: '기업용 OpenAI 제품을 공급하고 안전하게 사용할 수 있는 기본 환경 구성', base_md: 20, unit_price: 850000, price_is_placeholder: true, items: [{ label: 'Workspace·관리자·사용자·그룹·권한 설정' }, { label: 'SSO, 도메인, 보존정책 등 OpenAI Native 관리·보안 기능 설정' }] },
    { id: 'P03', name: 'AIR Service', scale: 'L', period: '규모별 산정 (4~10주 기준)', target: '고객 데이터와 업무시스템을 연결하여 기업용 AI 서비스와 Agent 를 구축하는 전문서비스', base_md: 70, unit_price: 832143, price_is_placeholder: true, items: [{ label: '고객 업무와 데이터에 최적화된 RAG·Vector DB·Search 구축' }, { label: '도메인/업무 목적별 AI Agent·Multi-Agent·Workflow 설계 및 구현' }] },
    { id: 'P04', name: 'AI Adoption & Change Management', scale: 'M', period: '4주', target: '사용자 정착과 조직 변화·전사 확산', base_md: 20, unit_price: 750000, price_is_placeholder: true, items: [{ label: 'AI Champion 선발·육성, Community 및 내부 지원체계 운영' }] },
    { id: 'P05', name: 'Billing & Managed Service', scale: 'O', period: '상시', target: 'OpenAI 라이선스·사용량·비용·운영 관리', base_md: 10, unit_price: 900000, price_is_placeholder: true, items: [{ label: '달러 사용료의 원화 환산·청구 및 정산 지원' }, { label: '월간 사용량·비용·품질 리포트와 추가 최적화·확장 권고' }] }
  ],
  // slug 가 있어야 ISV 확장 패키지의 구성 제품이 카탈로그와 이어진다.
  // 번들 멤버로 쓰이는 것을 몇 종 섞어 둔다 — 없으면 「조합에 추가」 경로를 못 본다.
  solutions: [
    { id: 's1', slug: 'openai-enterprise', name: 'OpenAI Enterprise', category: 'Enterprise AI', jtbd: '전사 지식업무 생산성과 안전한 AI 활용', grade: 3, scale: 'L', focal_name: '박포컬', status_op: 'active' },
    { id: 's2', slug: 'litellm', name: 'LiteLLM', category: 'LLM Gateway', jtbd: '멀티 모델 라우팅과 비용 통제', grade: 2, scale: 'M', focal_name: '이기술', tech_note: '고객 인증 체계 사전 확인', status_op: 'active' },
    { id: 's3', slug: 'portal26', name: 'Portal26', category: 'AI Governance', jtbd: 'Shadow AI·사용 현황 가시화와 통제', grade: 2, scale: 'M', focal_name: null, status_op: 'active' },
    { id: 's4', slug: 'trend-micro', name: 'Trend Micro', category: 'AI Security', jtbd: 'AI 애플리케이션·Agent 보안', grade: 2, scale: 'M', focal_name: null, status_op: 'active' },
    { id: 's5', slug: 'slack', name: 'Slack', category: 'Collaboration', jtbd: '협업 흐름에서 AI 활용', grade: 1, scale: 'M', focal_name: null, status_op: 'active' }
  ]
};

let deals = [
  { id: 'd1', customer: '한빛금융', customer_meta: { industry: 'Finance', companySize: '1,000명 초과', targetUsers: '전사 1,200명', securityStack: 'zscaler' }, track: 'E-1', track_name: '빠른 도입형', isv_combo: ['s1', 's2'], packages: [{ id: 'P03', md: 28 }], stage: 2, source: 'manual', owner_id: user.id, owner_name: user.name, updated_at: new Date().toISOString() },
  // 포탈로 들어온 딜. 027 이후 담당자 이름·전화번호가 leads 에 남고 허브는 읽기 전용으로
  // 보여준다. 업종·규모는 taxonomy.js 어휘(SFDC 코드 · 진단기준 구간)로 저장된다.
  { id: 'd2', customer: '온누리제조',
    customer_meta: { industry: 'Manufacturing', companySize: '501~1,000명', securityStack: 'none' },
    track: 'E-3', track_name: '서비스 개발형',
    isv_combo: [], packages: [], stage: 0, source: 'portal',
    lead_contact: 'park@onnuri.co.kr', lead_contact_name: '박담당',
    lead_contact_phone: '031-987-6543 (내선 12)',
    lead_message: '전사 문서 검색부터 검토 중입니다.',
    owner_id: null, owner_name: null, updated_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'd3', customer: '다온커머스', customer_meta: { industry: '유통' }, track: 'E-1', track_name: '빠른 도입형', isv_combo: ['s1'], packages: [{ id: 'P01', md: 8 }], stage: 4, source: 'sheet', owner_id: user.id, owner_name: user.name, updated_at: new Date(Date.now() - 86400000).toISOString() }
];

app.get('/api/auth/me', (_req, res) => res.json({ user }));
app.post('/api/auth/logout', (_req, res) => res.json({ message: 'ok' }));
/**
 * 기획안 §6 ISV 확장 패키지. 019(번들·멤버)와 033(개명·분리·신호)을 직접 읽는다.
 * 베껴 두면 실제와 어긋나 화면 확인이 거짓말이 된다 — 030 파싱과 같은 이유.
 */
const isvBundles = (() => {
  const read = (f) => require('fs').readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', f), 'utf8');
  const base = read('019_isv_offering_alignment.sql');
  const realign = read('033_isv_bundle_realign.sql');

  const bundles = new Map();
  const push = (id, fields) => bundles.set(id, { ...(bundles.get(id) || { id, members: [] }), ...fields });

  // 019 의 insert — id, 이름, 가치제안, sort_order
  const insertBlock = base.slice(base.indexOf('insert into isv_bundles'));
  for (const m of insertBlock.matchAll(/\('(\w+)', '([^']+)',\s*\n\s*'((?:[^']|'')*)',\s*\n\s*(true|false),\s*(?:'((?:[^']|'')*)'|null), (\d+)\)/g)) {
    push(m[1], { name: m[2], value_prop: m[3].replace(/''/g, "'"), sort_order: Number(m[6]) });
  }
  // 019 의 멤버
  const memberBlock = base.slice(base.indexOf('insert into isv_bundle_members'));
  for (const m of memberBlock.matchAll(/\('(\w+)',\s*'([a-z0-9-]+)',\s*(\d+)\)/g)) {
    const b = bundles.get(m[1]); if (b) b.members.push({ slug: m[2], sort_order: Number(m[3]), is_option: false });
  }
  // 026 이 더한 멤버
  const extra = read('026_bundle_products.sql');
  for (const m of extra.slice(extra.indexOf('insert into isv_bundle_members')).matchAll(/\('(\w+)',\s*'([a-z0-9-]+)',\s*(\d+)\)/g)) {
    const b = bundles.get(m[1]); if (b) b.members.push({ slug: m[2], sort_order: Number(m[3]), is_option: false });
  }

  // 033 — 신규 번들
  for (const m of realign.matchAll(/\('(AI_SECURITY)', '([^']+)',\s*\n\s*'((?:[^']|'')*)'\s*\n?\s*\|\| '((?:[^']|'')*)',\s*\n?\s*(true|false), '([^']*)', (\d+)\)/g)) {
    push(m[1], { name: m[2], value_prop: (m[3] + m[4]).replace(/''/g, "'"), sort_order: Number(m[7]), members: [] });
  }
  // 025 의 적용 기준. 033 이 안 건드린 번들도 문장을 갖게 한다.
  const triggers = read('025_isv_bundle_triggers.sql');
  for (const m of triggers.matchAll(/update isv_bundles set([\s\S]*?)where id = '(\w+)'/g)) {
    const applies = m[1].match(/applies_when = '((?:[^']|'')*)'/);
    const b2 = bundles.get(m[2]);
    if (b2 && applies) b2.applies_when = applies[1].replace(/''/g, "'");
  }

  // 033 — 개명·신호·순서
  for (const m of realign.matchAll(/update isv_bundles set([\s\S]*?)where id = '(\w+)'/g)) {
    const body = m[1], id = m[2];
    const b = bundles.get(id) || { id, members: [] };
    const name = body.match(/name = '([^']+)'/);
    const applies = body.match(/applies_when = '((?:[^']|'')*)'/);
    const signal = body.match(/readiness_signal = '(\[[\s\S]*?\])'::jsonb/);
    const order = body.match(/sort_order = (\d+)/);
    if (name) b.name = name[1];
    if (applies) b.applies_when = applies[1].replace(/''/g, "'");
    if (signal) b.readiness_signal = JSON.parse(signal[1]);
    if (order) b.sort_order = Number(order[1]);
    bundles.set(id, b);
  }
  // 033 — AI_TRUST 멤버 정리 + AI_SECURITY 멤버
  const gov = bundles.get('AI_TRUST');
  if (gov) gov.members = gov.members.filter((x) => x.slug === 'portal26');
  const sec = bundles.get('AI_SECURITY');
  if (sec) {
    const block = realign.slice(realign.indexOf("('AI_SECURITY', 'trend-micro'"));
    sec.members = [...block.matchAll(/\('AI_SECURITY', '([a-z0-9-]+)',\s*(\d+), (true|false)\)/g)]
      .map((m) => ({ slug: m[1], sort_order: Number(m[2]), is_option: m[3] === 'true' }));
  }

  const names = new Map(refs.solutions.map((s2) => [s2.slug, s2.name]));
  return [...bundles.values()]
    .map((b) => ({
      ...b, readiness_signal: b.readiness_signal || [],
      members: b.members
        .sort((x, y) => (x.is_option ? 1 : 0) - (y.is_option ? 1 : 0) || x.sort_order - y.sort_order)
        .map((m) => ({ ...m, name: names.get(m.slug) || m.slug }))
    }))
    .sort((a, b) => a.sort_order - b.sort_order);
})();

// 기획안 Appendix A 평가영역 (036). 036 시드를 직접 읽는다.
const assessment = (() => {
  const sql = require('fs').readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '036_assessment_criteria.sql'), 'utf8');
  const domains = [...sql.matchAll(/\('(D\d)', '([^']+)',\s*(\d+)\)/g)]
    .map((m) => ({ id: m[1], name: m[2], sort_order: Number(m[3]) }));
  const areas = [...sql.matchAll(
    /\('(A\d\d)', '(D\d)', '([^']+)',\s*\n\s*'([^']+)',\s*\n\s*'([^']+)',\s*\n\s*(\d), (\d\.\d), (\d+)\)/g
  )].map((m) => ({
    id: m[1], domain_id: m[2], name: m[3], checkpoints: m[4], concerns: m[5],
    weight: Number(m[6]), threshold: Number(m[7]), sort_order: Number(m[8])
  }));
  return { domains, areas };
})();

app.get('/api/hub/reference-data', (_req, res) => res.json({
  ...refs, readinessAreas: readiness.areas, readinessItems: readiness.items,
  assessmentDomains: assessment.domains, assessmentAreas: assessment.areas, isvBundles
}));
app.get('/api/hub/public/packages', (_req, res) => res.json(refs.packages.map(({ scale, ...pkg }) => pkg)));
// 실제 서버와 같은 검증을 거친다. 목업이 무조건 201 을 주면 폼 오류를 화면에서 못 본다.
const { validateLead } = require('../lib/hub-domain');
const mockLeads = [];
app.post('/api/hub/public/leads', (req, res) => {
  let lead;
  try { lead = validateLead(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  mockLeads.push({ ...lead, id: `mock-${mockLeads.length + 1}`, created_at: new Date().toISOString() });

  // 실제 서버와 같이 딜을 만든다. 이게 없으면 /readiness 로 제출한 결과가 허브에
  // 나타나는지를 로컬에서 확인할 수 없다.
  const readinessResult = Object.keys(lead.readiness_scores || {}).length
    ? mockApplyReadiness(lead.readiness_scores) : null;
  const assessed = readinessResult ? mockApplyAssessment(lead.readiness_scores, null) : null;
  deals.push({
    id: `d${deals.length + 1}`, customer: lead.customer,
    customer_meta: lead.customer_meta || {},
    track: lead.track, track_name: null,
    isv_combo: [], packages: [], stage: 0, source: 'portal',
    readiness_scores: lead.readiness_scores || {},
    readiness_customer_scores: lead.readiness_scores || {},
    readiness_totals: readinessResult || {},
    assessment_scores: assessed ? assessed.scores : {},
    assessment_totals: assessed ? { ...assessed.totals, bridged: assessed.bridged } : {},
    lead_contact: lead.contact, lead_contact_name: lead.contact_name,
    lead_contact_phone: lead.contact_phone, lead_message: lead.message,
    owner_id: null, owner_name: null, updated_at: new Date().toISOString()
  });
  res.status(201).json({ message: '접수 완료(목업)', reference: mockLeads[mockLeads.length - 1].id });
});
// 저장된 리드 확인용. 실제 서버에는 없는 목업 전용 경로다.
app.get('/api/hub/public/_leads', (_req, res) => res.json(mockLeads));
app.get('/api/hub/deals', (_req, res) => res.json(deals.map(({ assessment_scores, assessment_totals, isv_combo, packages, ...deal }) => deal)));
app.post('/api/hub/deals', (req, res) => {
  const deal = { id: `d${deals.length + 1}`, customer: req.body.customer, customer_meta: req.body.customer_meta || {}, track: null, isv_combo: [], packages: [], stage: 0, source: req.body.source || 'manual', owner_id: user.id, owner_name: user.name, updated_at: new Date().toISOString() };
  deals.unshift(deal); res.status(201).json(deal);
});
app.get('/api/hub/deals/:id', (req, res) => {
  const deal = deals.find((item) => item.id === req.params.id);
  deal ? res.json(deal) : res.status(404).json({ error: 'not found' });
});
app.patch('/api/hub/deals/:id', (req, res) => {
  const index = deals.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'not found' });
  const patch = { ...req.body };
  // 실제 서버와 같이 다시 채점하고 평가영역을 다시 채운다. 목업이 그냥 저장만 하면
  // 축 점수가 안 바뀌어 화면 확인이 거짓말이 된다.
  if (patch.readiness_scores) {
    patch.readiness_totals = mockApplyReadiness(patch.readiness_scores, { partial: true });
    const previouslyBridged = new Set(deals[index].assessment_totals?.bridged || []);
    const manual = {};
    for (const [area, value] of Object.entries(deals[index].assessment_scores || {})) {
      if (!previouslyBridged.has(area)) manual[area] = value;
    }
    const applied = mockApplyAssessment(patch.readiness_scores, manual);
    patch.assessment_scores = applied.scores;
    patch.assessment_totals = { ...applied.totals, bridged: applied.bridged };
  }
  deals[index] = { ...deals[index], ...patch, updated_at: new Date().toISOString() };
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
    assessment_coverage: [{ area: 'A07', strength: 2 }],
    assessment_prerequisites: [
      { kind: 'numeric', field: 'seats', min: 150, blocking: true, label: '최소 도입 인원 150명 (ChatGPT Enterprise 기준)' },
      { kind: 'assessment', area: 'A03', min: 3, blocking: true, label: 'SSO(Okta/Azure AD) 인프라' },
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
    assessment_coverage: [{ area: 'A01', strength: 3 }, { area: 'A07', strength: 2 }],
    assessment_prerequisites: [
      { kind: 'numeric', field: 'annual_budget_krw', min: 100000000, blocking: true, label: '연간 예산 1억원 이상 (GPU 서버 구축비 포함)' },
      { kind: 'manual', blocking: true, label: 'Kubernetes 관리 인프라 엔지니어' }
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
    assessment_coverage: [{ area: 'A01', strength: 2 }, { area: 'A05', strength: 3 }, { area: 'A10', strength: 2 }],
    assessment_prerequisites: [
      { kind: 'assessment', area: 'A03', min: 3, blocking: true, label: '사용자·부서 식별이 가능한 계정 체계' },
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
    assessment_coverage: [{ area: 'A01', strength: 2 }, { area: 'A07', strength: 2 }],
    assessment_prerequisites: [
      { kind: 'assessment', area: 'A03', min: 3, blocking: true, label: 'SSO 인프라' },
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
    assessment_coverage: [{ area: 'A04', strength: 2 }, { area: 'A07', strength: 3 }],
    assessment_prerequisites: [
      { kind: 'assessment', area: 'A01', min: 3, blocking: true, label: '검색 인덱스 대상 데이터 범위 확정' },
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
    assessment_coverage: [],
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

// ── AI 준비도 42문항 (029) ────────────────────────────────
// 목업이 실제와 어긋나면 화면 확인이 거짓말이 된다. 029 시드를 직접 파싱해 쓴다.
const { scoreReadiness } = require('../lib/readiness-scoring');
const { scoreAssessment, bridgeAssessmentScores } = require('../lib/assessment-scoring');
const readiness = (() => {
  const sql = require('fs').readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '029_readiness_items.sql'), 'utf8');
  const areas = [...sql.matchAll(/\('([SPDTBG])', '([^']+)', (\d+)\)/g)]
    .map((m) => ({ id: m[1], name: m[2], sort_order: Number(m[3]) }));
  const items = [...sql.matchAll(
    /\('([SPDTBG]\d+)', '([SPDTBG])', (\d+), '(exec|it|staff|all)',\s*\n\s*'((?:[^']|'')*)',\s*\n\s*'((?:[^']|'')*)',\s*\n\s*'(\[[^']*\])'::jsonb\)/g
  )].map((m) => ({
    code: m[1], area: m[2], seq: Number(m[3]), respondent: m[4],
    text: m[5].replace(/''/g, "'"), detail: m[6].replace(/''/g, "'"),
    rubric: JSON.parse(m[7]), target: 4
  }));
  return { areas, items };
})();

// 037 bridge. 어느 42문항이 어느 평가영역을 채우는지 — 시드에서 직접 읽는다.
const assessmentBridge = (() => {
  const sql = require('fs').readFileSync(
    path.join(__dirname, '..', 'db', 'migrations', '037_readiness_assessment_bridge.sql'), 'utf8');
  const body = sql.slice(sql.indexOf('insert into readiness_assessment_bridge'));
  return [...body.matchAll(/\('([SPDTBG]\d+)', '(A\d\d)', '(exact|good)'/g)]
    .map((m) => ({ item_code: m[1], area_id: m[2], fidelity: m[3] }));
})();

/** 실제 서버의 applyReadiness 와 같은 일. 채점만 한다. */
function mockApplyReadiness(scores, options = {}) {
  return scoreReadiness(readiness.items, readiness.areas, scores, options);
}

/** 실제 서버의 applyAssessment 와 같은 일. 037 bridge 로 평가영역을 채운다. */
function mockApplyAssessment(readinessScores, manualScores) {
  const bridged = bridgeAssessmentScores(assessmentBridge, readinessScores);
  const scores = { ...bridged, ...(manualScores || {}) };
  return {
    scores,
    totals: scoreAssessment(assessment.areas, assessment.domains, scores),
    bridged: Object.keys(bridged)
  };
}

app.get('/api/hub/public/readiness-items', (_req, res) => res.json(readiness));
app.post('/api/hub/public/readiness', (req, res) => {
  try {
    res.json(scoreReadiness(readiness.items, readiness.areas, req.body?.scores));
  } catch (error) {
    res.status(400).json({ error: error.message, unanswered: error.unanswered });
  }
});
app.get(['/readiness', '/readiness.html'], (_req, res) =>
  res.sendFile(path.join(__dirname, '..', 'readiness.html')));

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'admin.html')));

// 프로덕션의 / 는 랜딩(offering.html)이다. express.static 보다 먼저 걸어야
// index.html(=/radar 영업 화면)이 대신 뜨지 않는다 — 그러면 로컬 확인이 거짓말이 된다.
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'offering.html')));

app.use(express.static(path.join(__dirname, '..')));
app.get('/hub', (_req, res) => res.sendFile(path.join(__dirname, '..', 'hub.html')));
app.get(['/offering', '/offering.html'], (_req, res) => res.sendFile(path.join(__dirname, '..', 'offering.html')));
app.get(['/radar', '/radar/'], (_req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

app.listen(4173, '127.0.0.1', () => console.log('Mock UI server: http://127.0.0.1:4173'));
