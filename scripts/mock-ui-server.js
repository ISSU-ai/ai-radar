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

app.use(express.static(path.join(__dirname, '..')));
app.get('/hub', (_req, res) => res.sendFile(path.join(__dirname, '..', 'hub.html')));
app.get('/offering', (_req, res) => res.sendFile(path.join(__dirname, '..', 'offering.html')));

app.listen(4173, '127.0.0.1', () => console.log('Mock UI server: http://127.0.0.1:4173'));
