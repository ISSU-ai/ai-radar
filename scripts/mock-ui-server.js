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
  { id: 'd1', customer: '한빛금융', customer_meta: { industry: '금융', targetUsers: '전사 1,200명', securityStack: 'zscaler' }, fqa_scores: { 1: 4, 2: 3, 3: 4, 4: 3, 5: 4 }, fqa_totals: { A: { score: 3.5, ready: true, answered: 2 }, B: { score: 4, ready: true, answered: 1 }, C: { score: 3, ready: true, answered: 1 }, D: { score: 4, ready: true, answered: 1 } }, track: 'T-C', track_name: 'Zscaler 보유형', isv_combo: ['s1', 's2'], packages: [{ id: 'POC', md: 28 }], stage: 2, source: 'manual', owner_id: user.id, owner_name: user.name, updated_at: new Date().toISOString() },
  { id: 'd2', customer: '온누리제조', customer_meta: { industry: '제조' }, fqa_scores: {}, fqa_totals: {}, track: 'T-A', track_name: '인프라 동반형', isv_combo: [], packages: [], stage: 0, source: 'portal', owner_id: null, owner_name: null, updated_at: new Date(Date.now() - 3600000).toISOString() },
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
  res.json({ summary: average >= 4 ? '확장 준비 단계' : average >= 3 ? '검증 준비 단계' : '기반 정비 단계', categories: ['A','B','C','D'].map((category) => ({ category, score: average, status: average >= 3.5 ? 'ready' : 'strengthen' })) });
});
app.post('/api/hub/public/leads', (_req, res) => res.status(201).json({ message: '접수 완료', reference: 'mock-lead' }));
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

const mockSlots = [
  { id: 'llm-platform', name: '범용 LLM 플랫폼', layer: 'L1', is_competitive: true, candidates: 3 },
  { id: 'security-gateway', name: '네트워크 보안·SWG', layer: 'L4', is_competitive: true, candidates: 2 },
  { id: 'ai-usage-governance', name: 'AI 사용 가시성·거버넌스', layer: 'L4', is_competitive: false, candidates: 1 },
  { id: 'data-platform', name: '통합 데이터·레이크하우스', layer: 'L0', is_competitive: true, candidates: 0 }
];

const mockSolutions = [
  {
    id: 'sol-1', slug: 'portal26', name: 'Portal26', layer: 'L4', slot: 'ai-usage-governance',
    delivery: 'SaaS', synergy: '높음', category: 'AI 거버넌스·가시성',
    jtbd: '누가 어떤 AI를 얼마나 쓰는지 가시화', value_chain: 'AI Infra',
    status: 'draft', version: 1, grade: 2, scale: 'M', bundle_potential: 3,
    sections: { 1: 'Portal26은 생성형 AI 사용 가시성과 AI TRiSM에 특화된 SaaS 플랫폼입니다.', 3: '- ○ 매우 적합: 금융/보험', 7: '### 7.1 필수 요건' },
    sections_internal: {}, industries: [], simulator_mappings: [],
    fqa_coverage: [{ category: 'A', items: ['접근권한과 계정 체계'], strength: 3 }],
    prerequisites: [{ kind: 'fqa', category: 'A', item: '보안 게이트웨이 준비도', min: 3, blocking: true, label: 'SWG 보유', enabled_by: ['zscaler'] }],
    red_flags: [{ signal: 'SWG 미보유', alternatives: [{ slug: 'zscaler', label: 'Zscaler' }] }],
    price_type: null, unit_price: 0, currency: 'KRW', price_tiers: [], price_is_placeholder: true
  },
  {
    id: 'sol-2', slug: 'ibm', name: 'IBM', layer: 'L1', slot: null,
    delivery: 'SW', synergy: '중', category: '종합 AI/ML(watsonx)', jtbd: '엔터프라이즈 거버넌스 AI',
    value_chain: 'AI Platform', status: 'draft', version: 1, bundle_potential: null,
    sections: { 1: '짧은 본문', 3: '- **CIO / CDO (의사결정자)**: 데이터 자산화 및 통합 AI 거버넌스 수립이 주요 관심사 ➔ **{name}의 엔터프라이즈 제어 기능 강조**' },
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
app.get('/api/solutions', (_req, res) => res.json(mockSolutions.map(({ sections, ...rest }) => rest)));
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
