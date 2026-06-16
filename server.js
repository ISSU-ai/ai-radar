const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-issu-ai-radar';
const OPINION_EXPOSE_POLICY = process.env.OPINION_EXPOSE_POLICY || 'B'; // A: Expose to all, B: Admin only

if (!process.env.DATABASE_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('Missing required Supabase environment variables in .env.');
  process.exit(1);
}

// app.js의 simulatorStepsData 구조 복사 (시나리오 역매핑 룩업용)
const simulatorStepsData = {
  q1: {
    title: " 전사 임직원 생산성 향상 관련 고민",
    options: [
      { text: "보안이 극도로 강한 규제 산업 환경이며 20만 자 이상의 분석이 필요합니다.", recommendations: ["Anthropic", "LiteLLM"] },
      { text: "이미 구글 워크스페이스 환경을 사용하고 있어, 긴밀한 오피스 연동을 원합니다.", recommendations: ["Gemini Workspace", "OpenAI Enterprise"] },
      { text: "시장 표준 챗봇과 풍부한 노코드 확장 플랫폼(GPTs)을 선호합니다.", recommendations: ["OpenAI Enterprise", "LiteLLM"] },
      { text: "한국어 성능이 우수하고 국내 소버린 AI 인프라 자가 구축이 목적입니다.", recommendations: ["NC AI", "MZC AIR Platform"] },
      { text: "종합적 AI/ML 인프라와 강력한 엔터프라이즈 AI 거버넌스를 희망합니다.", recommendations: ["IBM", "Databricks"] }
    ]
  },
  q2: {
    title: " 특정 부서 업무 자동화 관련 고민",
    options: [
      { text: "보안상 외부 인터넷 망 연결이 100% 차단된 내부망(에어갭) 환경이 필수적입니다.", recommendations: ["Articul8", "MZC AIR Platform"] },
      { text: "IT 운영 관리(ITSM)나 인사(HR) 등 백오피스 통합 워크플로우를 혁신하고 싶습니다.", recommendations: ["ServiceNow AI", "Salesforce AgentForce"] },
      { text: "영업 파이프라인 관리 및 대고객 마케팅 대응 자동화를 추진하고 싶습니다.", recommendations: ["Salesforce AgentForce", "ServiceNow AI"] },
      { text: "공급망 관리(SCM), 재무 예측 등 전사 ERP 기반 분석 및 자동화가 필요합니다.", recommendations: ["SAP Joule", "Databricks"] },
      { text: "다국어 동영상 파일의 인물/동작 자연어 검색 및 시점 요약이 필요합니다.", recommendations: ["TwelveLabs", "ElevenLabs"] },
      { text: "고객 문의 응대를 위해 정밀한 AI 음성 및 보이스 에이전트를 구축하고자 합니다.", recommendations: ["ElevenLabs", "TwelveLabs"] },
      { text: "금융 리서치 및 컴플라이언스(준법감시)를 자동 보조할 전문 금융 에이전트를 원합니다.", recommendations: ["Unique", "Anthropic"] },
      { text: "게임, 이커머스 제작에 필요한 3D 에셋 그래픽 생성을 자동화하고 싶습니다.", recommendations: ["MeshyAI", "OpenAI Enterprise"] }
    ]
  },
  q3: {
    title: " 개발자 및 데이터 과학자 지원 관련 고민",
    options: [
      { text: "가벼운 웹 브라우저 기반 코딩 환경과 간편한 AI 개발 협업 도구를 원합니다.", recommendations: ["Replit", "Posit (RStudio)"] },
      { text: "현업 분석가(Citizen DS)가 코딩 없이 ML 예측 알고리즘을 학습하고 운영하고자 합니다.", recommendations: ["Dataiku", "DataRobot"] },
      { text: "R/Python 기반의 과학적 통계 분석 및 정밀 통계 웹 보고서 배포 플랫폼이 필요합니다.", recommendations: ["Posit (RStudio)", "Anaconda"] },
      { text: "파이썬 패키지 공급망 전반의 보안 취약점과 거버넌스를 완벽히 제어하고 싶습니다.", recommendations: ["Anaconda", "Dataiku"] },
      { text: "오픈소스 데이터분석 워크플로우를 노코드로 설계하여 파이프라인을 구축하고자 합니다.", recommendations: ["KNIME", "Fivetran"] }
    ]
  },
  q4: {
    title: " 에이전트 제어 및 LLM 비용 통제 관련 고민",
    options: [
      { text: "장시간 구동되는 에이전트의 중단 장애 발생 시 자가 치유와 상태 보존이 필수입니다.", recommendations: ["Temporal", "MZC AIR Platform"] },
      { text: "MZC 표준 프레임워크를 기반으로 멀티 LLM 제어 및 에이전트 조립을 조율하고 싶습니다.", recommendations: ["MZC AIR Platform", "LiteLLM"] },
      { text: "사내 API 호출 비용 모니터링, 가상키 할당 및 다중 모델 비용 최적화 라우팅이 시급합니다.", recommendations: ["LiteLLM", "MZC AIR Platform"] }
    ]
  },
  q0: {
    title: " 데이터 레이크/DW 기반 AI 연동 관련 고민",
    options: [
      { text: "데이터 레이크와 ML, GenAI(Mosaic) 개발 전체를 단일 플랫폼으로 통합하고 싶습니다.", recommendations: ["Databricks", "Snowflake"] },
      { text: "클라우드 데이터 웨어하우스(DW) 내 데이터를 복제 없이 Cortex AI와 연동해 쓰고 싶습니다.", recommendations: ["Snowflake", "Databricks"] },
      { text: "사일로화된 분산 데이터를 물리적으로 복제하지 않고 RAG에 실시간 가상 연결하고 싶습니다.", recommendations: ["Denodo", "Informatica"] },
      { text: "정제되고 거버넌스가 확보된 전사 마스터 데이터(MDM)를 AI 솔루션에 동반 연계하고 싶습니다.", recommendations: ["Informatica", "Denodo"] },
      { text: "기존의 하이브리드/온프레미스 데이터레이크(Hadoop 등) 환경 위에 AI RAG를 얹고 싶습니다.", recommendations: ["Cloudera", "IBM"] },
      { text: "이기종 데이터 소스들(수백 개 이상)을 DW/분석마트로 실시간 자동 ELT 적재하고 싶습니다.", recommendations: ["Fivetran", "Trocco"] }
    ]
  },
  q4_q0: {
    title: " 벡터 저장소 및 실시간 RAG 구성 관련 고민",
    options: [
      { text: "RAG 지연속도와 비용을 획기적으로 낮출 벡터검색 및 세맨틱 캐시 레이어가 필요합니다.", recommendations: ["Redis", "Pinecone"] },
      { text: "실시간 이벤트 스트리밍(Kafka) 데이터를 지체 없이 가공해 RAG 데이터로 밀어넣고 싶습니다.", recommendations: ["Confluent", "Redis"] },
      { text: "초대형 RAG 인프라 환경에서 대규모 운영 NoSQL 데이터베이스와 벡터검색을 통합 운영하고 싶습니다.", recommendations: ["Datastax", "Couchbase"] },
      { text: "기존 관계형 DB(PostgreSQL) 자산을 고스란히 활용해 벡터 스토어를 겸용하고 싶습니다.", recommendations: ["EDB (PSQL)", "Redis"] },
      { text: "단순 벡터 검색으로 해결 불가능한 복잡한 다단계 관계형 지식 그래프(GraphRAG)를 연계하고 싶습니다.", recommendations: ["Tigergraph", "Databricks"] }
    ]
  }
};

// Supabase & PostgreSQL Pool Initialization
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 6
});

// Run DB Migrations
pool.query('ALTER TABLE public.solutions ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false', (err) => {
  if (err) {
    console.error('Error running migrations (is_archived column):', err);
  } else {
    console.log('Database migration successful: is_archived column verified.');
  }
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);


// Middleware
app.use(express.json());
app.use(cookieParser());

// Audit Logger
const auditLog = (userId, action, target, query = '') => {
  const now = new Date().toISOString();
  pool.query(`
    INSERT INTO audit_log (user_id, action, target, query, created_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [userId, action, target, query, now], (err) => {
    if (err) console.error('Error logging audit:', err);
  });
};

// Auth Authentication Middleware
const authenticateToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: '인증 토큰이 없습니다. 로그인이 필요합니다.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: '인증 토큰이 만료되었거나 유효하지 않습니다.' });
    }
    req.user = user;
    next();
  });
};

// Admin Only Authorization Middleware
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: '접근 권한이 없습니다. 관리자 전용 기능입니다.' });
  }
};

// ----------------------------------------------------
// Authentication API Routes (Supabase Auth Integration)
// ----------------------------------------------------

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError || !authData.user) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const userId = authData.user.id;

    const profileRes = await pool.query('SELECT * FROM profiles WHERE id = $1', [userId]);
    const profile = profileRes.rows[0];

    if (!profile) {
      return res.status(403).json({ error: '등록된 사용자 프로필을 찾을 수 없습니다.' });
    }

    if (!profile.approved) {
      return res.status(403).json({ error: '사내 미승인 계정입니다. 관리자 승인이 필요합니다.' });
    }

    const token = jwt.sign(
      { id: profile.id, email: profile.email, name: profile.full_name || '사내 임직원', role: profile.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });

    auditLog(profile.id, 'login', 'System');

    res.json({
      message: '로그인 성공',
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.full_name,
        role: profile.role
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '로그인 처리 중 서버 오류가 발생했습니다.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  auditLog(req.user.id, 'logout', 'System');
  res.clearCookie('token');
  res.json({ message: '로그아웃 성공' });
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// ----------------------------------------------------
// Solutions API Routes (Viewer / Admin)
// ----------------------------------------------------

// GET /api/solutions
app.get('/api/solutions', authenticateToken, async (req, res) => {
  const { layer, synergy, delivery, category, q, industry, simulator_mapping } = req.query;
  
  let queryStr = 'SELECT id, legacy_id, slug, name, delivery, layer, synergy, category, jtbd, value_chain, opinion, status, version, updated_at, simulator_mappings, industries FROM solutions';
  let conditions = ['is_archived = false'];
  let params = [];

  let paramIdx = 1;

  if (req.user.role === 'viewer') {
    conditions.push(`status = $${paramIdx++}`);
    params.push('published');
  }

  if (layer && layer !== 'all') {
    conditions.push(`layer LIKE $${paramIdx++}`);
    params.push(`%${layer}%`);
  }
  if (synergy && synergy !== 'all') {
    conditions.push(`synergy = $${paramIdx++}`);
    params.push(synergy);
  }
  if (delivery && delivery !== 'all') {
    conditions.push(`delivery LIKE $${paramIdx++}`);
    params.push(`%${delivery}%`);
  }
  if (category && category !== 'all') {
    conditions.push(`category = $${paramIdx++}`);
    params.push(category);
  }
  if (industry && industry !== 'all') {
    // industries [ { industry, fit } ] 객체 배열 내에서 특정 industry 찾기
    conditions.push(`industries @> $${paramIdx++}::jsonb`);
    params.push(JSON.stringify([{ industry: industry }]));
  }
  if (simulator_mapping) {
    const parts = simulator_mapping.split('_');
    const qKey = parts[0];
    const optIdx = parseInt(parts[1], 10) - 1;
    
    if (simulatorStepsData[qKey] && simulatorStepsData[qKey].options[optIdx]) {
      const scenarioText = simulatorStepsData[qKey].options[optIdx].text;
      conditions.push(`simulator_mappings @> $${paramIdx++}::jsonb`);
      params.push(JSON.stringify([{ scenario: scenarioText }]));
    } else {
      conditions.push('1 = 0');
    }
  }

  if (q && q.trim() !== '') {
    const searchVal = `%${q.trim()}%`;
    conditions.push(`(name LIKE $${paramIdx} OR category LIKE $${paramIdx} OR jtbd LIKE $${paramIdx} OR sections::text LIKE $${paramIdx})`);
    params.push(searchVal);
    paramIdx++;
    
    auditLog(req.user.id, 'search', 'SearchQuery', q.trim());
  }

  if (conditions.length > 0) {
    queryStr += ' WHERE ' + conditions.join(' AND ');
  }

  try {
    const result = await pool.query(queryStr, params);
    
    const maskedRows = result.rows.map(row => {
      const copy = { ...row };
      
      copy.simulator_mappings = typeof copy.simulator_mappings === 'string' ? JSON.parse(copy.simulator_mappings) : (copy.simulator_mappings || []);
      copy.industries = typeof copy.industries === 'string' ? JSON.parse(copy.industries) : (copy.industries || []);

      if (OPINION_EXPOSE_POLICY === 'B' && req.user.role === 'viewer') {
        delete copy.opinion;
      }
      return copy;
    });

    // 우선순위(★★★ > ★★ > ★)가 높은 것부터 내림차순 정렬
    const getPriorityWeight = (row) => {
      if (row.layer && row.layer.includes('L0')) return 1;
      if (row.synergy === '매우 높음') return 3;
      if (row.synergy === '높음') return 2;
      return 1;
    };
    maskedRows.sort((a, b) => getPriorityWeight(b) - getPriorityWeight(a));

    res.json(maskedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '데이터 조회 오류가 발생했습니다.' });
  }
});

// GET /api/solutions/:slug
app.get('/api/solutions/:slug', authenticateToken, async (req, res) => {
  const slug = req.params.slug;

  try {
    const result = await pool.query('SELECT * FROM solutions WHERE slug = $1 AND is_archived = false', [slug]);
    const row = result.rows[0];


    if (!row) {
      return res.status(404).json({ error: '솔루션을 찾을 수 없습니다.' });
    }

    if (req.user.role === 'viewer' && row.status !== 'published') {
      return res.status(403).json({ error: '해당 솔루션 가이드는 작성 중(Draft) 상태이므로 조회할 수 없습니다.' });
    }

    auditLog(req.user.id, 'view', slug);

    row.sections = typeof row.sections === 'string' ? JSON.parse(row.sections) : (row.sections || {});
    row.simulator_mappings = typeof row.simulator_mappings === 'string' ? JSON.parse(row.simulator_mappings) : (row.simulator_mappings || []);
    row.industries = typeof row.industries === 'string' ? JSON.parse(row.industries) : (row.industries || []);

    if (OPINION_EXPOSE_POLICY === 'B' && req.user.role === 'viewer') {
      delete row.opinion;
    }

    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '상세 정보 조회 오류가 발생했습니다.' });
  }
});

// ----------------------------------------------------
// Admin API Routes (Admin Only)
// ----------------------------------------------------

app.post('/api/admin/solutions', authenticateToken, adminOnly, async (req, res) => {
  const { name, delivery, layer, synergy, category, jtbd, value_chain, sections, opinion, simulator_mappings, industries } = req.body;

  if (!name || !layer) {
    return res.status(400).json({ error: '솔루션 이름과 레이어는 필수 항목입니다.' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const now = new Date().toISOString();
  const sectionsJson = JSON.stringify(sections || {});
  const simMappingsJson = JSON.stringify(simulator_mappings || []);

  // industries 데이터를 [{ industry, fit: 'high' }] 구조로 하이브리드 포맷팅
  const formattedIndustries = (industries || []).map(ind => {
    if (typeof ind === 'object' && ind.industry) return ind;
    return { industry: ind, fit: 'high' };
  });
  const indJson = JSON.stringify(formattedIndustries);

  try {
    const insertQuery = `
      INSERT INTO solutions (slug, name, delivery, layer, synergy, category, jtbd, value_chain, sections, opinion, status, version, updated_by, updated_at, simulator_mappings, industries)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', 1, $11, $12, $13, $14)
      RETURNING id;
    `;
    
    const result = await pool.query(insertQuery, [
      slug, name, delivery, layer, synergy, category, jtbd, value_chain, sectionsJson, opinion, req.user.id, now, simMappingsJson, indJson
    ]);
    
    const solId = result.rows[0].id;
    auditLog(req.user.id, 'edit', slug, 'Created Draft');

    res.json({ message: '솔루션 초안(Draft)이 성공적으로 생성되었습니다.', id: solId, slug });
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('unique constraint')) {
      return res.status(400).json({ error: '이미 동일한 이름이나 slug의 솔루션이 존재합니다.' });
    }
    res.status(500).json({ error: '솔루션 생성에 실패했습니다.' });
  }
});

app.put('/api/admin/solutions/:id', authenticateToken, adminOnly, async (req, res) => {
  const solId = req.params.id;
  const { name, delivery, layer, synergy, category, jtbd, value_chain, sections, opinion, status, simulator_mappings, industries } = req.body;

  if (!name || !layer) {
    return res.status(400).json({ error: '솔루션 이름과 레이어는 필수 항목입니다.' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const now = new Date().toISOString();
  const sectionsJson = JSON.stringify(sections || {});
  const simMappingsJson = JSON.stringify(simulator_mappings || []);

  const formattedIndustries = (industries || []).map(ind => {
    if (typeof ind === 'object' && ind.industry) return ind;
    return { industry: ind, fit: 'high' };
  });
  const indJson = JSON.stringify(formattedIndustries);

  try {
    const currentRes = await pool.query('SELECT * FROM solutions WHERE id = $1', [solId]);
    const current = currentRes.rows[0];
    
    if (!current) {
      return res.status(404).json({ error: '수정할 솔루션을 찾을 수 없습니다.' });
    }

    const updateQuery = `
      UPDATE solutions
      SET slug = $1, name = $2, delivery = $3, layer = $4, synergy = $5, category = $6, jtbd = $7, value_chain = $8, sections = $9, opinion = $10, status = $11, updated_by = $12, updated_at = $13, simulator_mappings = $14, industries = $15
      WHERE id = $16
    `;
    
    await pool.query(updateQuery, [
      slug, name, delivery, layer, synergy, category, jtbd, value_chain, sectionsJson, opinion, status || current.status, req.user.id, now, simMappingsJson, indJson, solId
    ]);

    auditLog(req.user.id, 'edit', slug, 'Updated solution details');
    res.json({ message: '솔루션 정보가 저장되었습니다.', slug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '솔루션 정보 업데이트에 실패했습니다.' });
  }
});

app.post('/api/admin/solutions/:id/publish', authenticateToken, adminOnly, async (req, res) => {
  const solId = req.params.id;
  const now = new Date().toISOString();

  try {
    const solRes = await pool.query('SELECT * FROM solutions WHERE id = $1', [solId]);
    const sol = solRes.rows[0];

    if (!sol) {
      return res.status(404).json({ error: '발행할 솔루션을 찾을 수 없습니다.' });
    }

    const newVersion = sol.version + 1;

    await pool.query(`
      UPDATE solutions
      SET status = 'published', version = $1, updated_by = $2, updated_at = $3
      WHERE id = $4
    `, [newVersion, req.user.id, now, solId]);

    const updatedRes = await pool.query('SELECT * FROM solutions WHERE id = $1', [solId]);
    const updatedSol = updatedRes.rows[0];

    const snapshot = JSON.stringify({
      slug: updatedSol.slug,
      name: updatedSol.name,
      delivery: updatedSol.delivery,
      layer: updatedSol.layer,
      synergy: updatedSol.synergy,
      category: updatedSol.category,
      jtbd: updatedSol.jtbd,
      value_chain: updatedSol.value_chain,
      sections: typeof updatedSol.sections === 'string' ? JSON.parse(updatedSol.sections) : (updatedSol.sections || {}),
      opinion: updatedSol.opinion,
      status: updatedSol.status,
      version: updatedSol.version,
      simulator_mappings: typeof updatedSol.simulator_mappings === 'string' ? JSON.parse(updatedSol.simulator_mappings) : (updatedSol.simulator_mappings || []),
      industries: typeof updatedSol.industries === 'string' ? JSON.parse(updatedSol.industries) : (updatedSol.industries || [])
    });

    await pool.query(`
      INSERT INTO solution_versions (solution_id, snapshot, editor, created_at)
      VALUES ($1, $2, $3, $4)
    `, [solId, snapshot, req.user.id, now]);

    auditLog(req.user.id, 'publish', updatedSol.slug, `Published Version v${updatedSol.version}`);
    res.json({ message: `성공적으로 발행되었습니다 (버전: v${updatedSol.version})`, version: updatedSol.version });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '솔루션 발행에 실패했습니다.' });
  }
});

// DELETE /api/admin/solutions/:id (Archive solution)
app.delete('/api/admin/solutions/:id', authenticateToken, adminOnly, async (req, res) => {
  const solId = req.params.id;
  const now = new Date().toISOString();
  try {
    const solRes = await pool.query('SELECT * FROM solutions WHERE id = $1', [solId]);
    const sol = solRes.rows[0];
    if (!sol) {
      return res.status(404).json({ error: '아카이브할 솔루션을 찾을 수 없습니다.' });
    }
    
    await pool.query('UPDATE solutions SET is_archived = true, updated_by = $1, updated_at = $2 WHERE id = $3', [req.user.id, now, solId]);
    auditLog(req.user.id, 'archive', sol.slug);
    res.json({ message: '솔루션이 성공적으로 아카이브(숨김) 처리되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '솔루션 아카이브 처리에 실패했습니다.' });
  }
});


app.get('/api/admin/solutions/:id/versions', authenticateToken, adminOnly, async (req, res) => {
  const solId = req.params.id;

  try {
    const result = await pool.query('SELECT id, editor, created_at, snapshot FROM solution_versions WHERE solution_id = $1 ORDER BY id DESC', [solId]);
    
    const editorIds = result.rows.map(r => r.editor).filter(id => id !== null);
    let editorsMap = {};
    if (editorIds.length > 0) {
      const editorsRes = await pool.query('SELECT id, full_name FROM profiles WHERE id = ANY($1)', [editorIds]);
      editorsRes.rows.forEach(e => {
        editorsMap[e.id] = e.full_name;
      });
    }

    const versions = result.rows.map(row => {
      let parsed = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : (row.snapshot || {});
      return {
        id: row.id,
        version: parsed.version || 1,
        editor: editorsMap[row.editor] || '시스템 시드',
        created_at: row.created_at,
        snapshot: parsed
      };
    });

    res.json(versions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '버전 기록 목록을 가져오는 데 실패했습니다.' });
  }
});

app.post('/api/admin/solutions/:id/rollback', authenticateToken, adminOnly, async (req, res) => {
  const solId = req.params.id;
  const { versionId } = req.body;

  if (!versionId) {
    return res.status(400).json({ error: '롤백할 버전 ID가 누락되었습니다.' });
  }

  try {
    const verRes = await pool.query('SELECT * FROM solution_versions WHERE id = $1 AND solution_id = $2', [versionId, solId]);
    const version = verRes.rows[0];

    if (!version) {
      return res.status(404).json({ error: '롤백 스냅샷 버전을 찾을 수 없습니다.' });
    }

    const snapshot = typeof version.snapshot === 'string' ? JSON.parse(version.snapshot) : (version.snapshot || {});
    const curRes = await pool.query('SELECT version FROM solutions WHERE id = $1', [solId]);
    const curSol = curRes.rows[0];

    if (!curSol) {
      return res.status(500).json({ error: '현재 솔루션 조회 실패' });
    }

    const nextVersion = curSol.version + 1;
    const now = new Date().toISOString();
    const sectionsJson = JSON.stringify(snapshot.sections || {});
    const simMappingsJson = JSON.stringify(snapshot.simulator_mappings || []);
    const indJson = JSON.stringify(snapshot.industries || []);

    const updateQuery = `
      UPDATE solutions
      SET slug = $1, name = $2, delivery = $3, layer = $4, synergy = $5, category = $6, jtbd = $7, value_chain = $8, sections = $9, opinion = $10, status = 'published', version = $11, updated_by = $12, updated_at = $13, simulator_mappings = $14, industries = $15
      WHERE id = $16
    `;

    await pool.query(updateQuery, [
      snapshot.slug,
      snapshot.name,
      snapshot.delivery,
      snapshot.layer,
      snapshot.synergy,
      snapshot.category,
      snapshot.jtbd,
      snapshot.value_chain,
      sectionsJson,
      snapshot.opinion,
      nextVersion,
      req.user.id,
      now,
      simMappingsJson,
      indJson,
      solId
    ]);

    const newSnapshot = JSON.stringify({
      slug: snapshot.slug,
      name: snapshot.name,
      delivery: snapshot.delivery,
      layer: snapshot.layer,
      synergy: snapshot.synergy,
      category: snapshot.category,
      jtbd: snapshot.jtbd,
      value_chain: snapshot.value_chain,
      sections: snapshot.sections,
      opinion: snapshot.opinion,
      status: 'published',
      version: nextVersion,
      simulator_mappings: snapshot.simulator_mappings,
      industries: snapshot.industries
    });

    await pool.query(`
      INSERT INTO solution_versions (solution_id, snapshot, editor, created_at)
      VALUES ($1, $2, $3, $4)
    `, [solId, newSnapshot, req.user.id, now]);

    auditLog(req.user.id, 'publish', snapshot.slug, `Rollback to version v${snapshot.version} (Created v${nextVersion})`);
    res.json({ message: `버전 v${snapshot.version}으로 롤백이 승인 및 발행되었습니다 (신규 버전: v${nextVersion})` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '롤백을 적용하는 데 실패했습니다.' });
  }
});

app.get('/api/admin/usage', authenticateToken, adminOnly, async (req, res) => {
  const todayStr = new Date().toISOString().substring(0, 10);
  
  const totalLogsQ = 'SELECT COUNT(*) as cnt FROM audit_log';
  const dailyUniqueUsersQ = `
    SELECT COUNT(DISTINCT user_id) as cnt 
    FROM audit_log 
    WHERE created_at::text LIKE $1 AND action = 'login'
  `;
  const actionCountsQ = `
    SELECT action, COUNT(*) as cnt 
    FROM audit_log 
    GROUP BY action
  `;
  const keywordRankingQ = `
    SELECT query, COUNT(*) as cnt 
    FROM audit_log 
    WHERE action = 'search' AND query IS NOT NULL AND query != ''
    GROUP BY query 
    ORDER BY cnt DESC 
    LIMIT 10
  `;
  const solutionRankingQ = `
    SELECT target, COUNT(*) as cnt 
    FROM audit_log 
    WHERE action = 'view' AND target != 'System' AND target != 'SearchQuery'
    GROUP BY target 
    ORDER BY cnt DESC 
    LIMIT 10
  `;
  const recentLogsQ = `
    SELECT a.id, a.action, a.target, a.query, a.created_at, u.full_name as user_name, u.role as user_role, u.team as user_team
    FROM audit_log a
    LEFT JOIN profiles u ON a.user_id = u.id
    ORDER BY a.id DESC
    LIMIT 100
  `;

  try {
    const [total, dailyUsers, actionCounts, keywords, solutions, logs] = await Promise.all([
      pool.query(totalLogsQ).then(r => r.rows),
      pool.query(dailyUniqueUsersQ, [`%${todayStr}%`]).then(r => r.rows),
      pool.query(actionCountsQ).then(r => r.rows),
      pool.query(keywordRankingQ).then(r => r.rows),
      pool.query(solutionRankingQ).then(r => r.rows),
      pool.query(recentLogsQ).then(r => r.rows)
    ]);

    res.json({
      totalLogs: parseInt(total[0].cnt, 10),
      dailyActiveUsers: parseInt(dailyUsers[0].cnt || 0, 10),
      actionCounts: actionCounts.reduce((acc, curr) => {
        acc[curr.action] = parseInt(curr.cnt, 10);
        return acc;
      }, {}),
      keywordRanking: keywords.map(k => ({ query: k.query, cnt: parseInt(k.cnt, 10) })),
      solutionRanking: solutions.map(s => ({ target: s.target, cnt: parseInt(s.cnt, 10) })),
      recentLogs: logs
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '통계 지표 수집에 실패했습니다.' });
  }
});

app.post('/api/admin/suggest-edit', authenticateToken, adminOnly, async (req, res) => {
  const { solutionId, prompt } = req.body;

  if (!solutionId || !prompt) {
    return res.status(400).json({ error: '솔루션 ID와 자연어 프롬프트는 필수입니다.' });
  }

  try {
    const solRes = await pool.query('SELECT * FROM solutions WHERE id = $1', [solutionId]);
    const sol = solRes.rows[0];

    if (!sol) {
      return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
    }

    let sections = typeof sol.sections === 'string' ? JSON.parse(sol.sections || '{}') : (sol.sections || {});
    let industries = typeof sol.industries === 'string' ? JSON.parse(sol.industries || '[]') : (sol.industries || []);
    let simulator_mappings = typeof sol.simulator_mappings === 'string' ? JSON.parse(sol.simulator_mappings || '[]') : (sol.simulator_mappings || []);

    let targetSection = null;
    let oldContent = '';
    let newContent = '';
    let suggestionMessage = '';

    const promptNormalized = prompt.toLowerCase();
    
    const numbers = prompt.match(/\d+/);
    if (numbers) {
      targetSection = numbers[0];
    } else {
      if (promptNormalized.includes('개요') || promptNormalized.includes('차별점')) targetSection = '1';
      else if (promptNormalized.includes('매핑') || promptNormalized.includes('레이어')) targetSection = '2';
      else if (promptNormalized.includes('적합 고객') || promptNormalized.includes('페르소나') || promptNormalized.includes('고객군')) targetSection = '3';
      else if (promptNormalized.includes('아키텍처') || promptNormalized.includes('통합')) targetSection = '4';
      else if (promptNormalized.includes('유즈케이스') || promptNormalized.includes('도입 시나리오')) targetSection = '5';
      else if (promptNormalized.includes('경쟁') || promptNormalized.includes('비교') || promptNormalized.includes('매트릭스')) targetSection = '6';
      else if (promptNormalized.includes('체크리스트') || promptNormalized.includes('검토 기준')) targetSection = '7';
      else if (promptNormalized.includes('영업') || promptNormalized.includes('팁') || promptNormalized.includes('tip') || promptNormalized.includes('faq')) targetSection = '8';
    }

    if (!targetSection || !sections[targetSection]) {
      targetSection = '7';
    }

    oldContent = sections[targetSection] || '';

    if (targetSection === '7') {
      const checkItems = prompt.replace(/(7번|체크리스트|에|을|를|추가|제안|수정|항목)/g, '').trim();
      const newItemText = checkItems ? `- [ ] ${checkItems}` : '- [ ] MZC 보안 프록시를 결합하여 Zscaler 테넌트 제한 규칙이 완벽히 준수되는가?';
      newContent = oldContent + `\n${newItemText}`;
      suggestionMessage = `[Mock AI] ${sol.name}의 7번 체크리스트에 새로운 항목을 추가할 것을 제안합니다.`;
    } else if (targetSection === '1') {
      const cleanPrompt = prompt.replace(/(1번|개요|에|을|를|추가|제안|수정)/g, '').trim();
      const addText = cleanPrompt ? `\n- **추가 정보**: ${cleanPrompt}` : '\n- **추가 비즈니스 가치**: 2026년 하반기 업그레이드 지원 포함';
      newContent = oldContent + addText;
      suggestionMessage = `[Mock AI] ${sol.name}의 1번 개요 및 차별점에 새로운 비즈니스 가치를 추가할 것을 제안합니다.`;
    } else {
      const cleanPrompt = prompt.replace(new RegExp(`(${targetSection}번|에|을|를|추가|제안|수정)`, 'g'), '').trim();
      const appendText = cleanPrompt ? `\n\n* ${cleanPrompt} (AI 추가 제안)*` : '\n\n* (신규 비즈니스 정합성 피치 추가)*';
      newContent = oldContent + appendText;
      suggestionMessage = `[Mock AI] ${sol.name}의 ${targetSection}번 섹션에 내용을 덧붙일 것을 제안합니다.`;
    }

    let explanation = `사용자 지시 "${prompt}"에 따라 분석하여, ${sol.name}의 ${targetSection}번 섹션 본문을 수정 제안합니다. (SSOT 규율에 따라 즉시 저장되지 않고, 'Approve & Commit' 승인이 있어야 반영됩니다)`;

    if (promptNormalized.includes('업종') || promptNormalized.includes('산업군')) {
      const domains = ['금융/보험', '공공/국방', '제조', '유통/CS/서비스', 'IT/미디어/테크'];
      let added = [];
      domains.forEach(d => {
        const cleanD = d.split('/')[0];
        if (promptNormalized.includes(cleanD) && !industries.includes(d)) {
          industries.push({ industry: d, fit: 'high' });
          added.push(d);
        }
      });
      if (added.length > 0) {
        explanation = `사용자 지시 "${prompt}"에 따라 분석하여, ${sol.name}의 적합 업종에 [${added.join(', ')}]을(를) 추가할 것을 제안합니다.`;
        suggestionMessage = `[Mock AI] ${sol.name}의 적합 업종 도메인을 갱신할 것을 제안합니다.`;
      }
    }

    res.json({
      success: true,
      section: targetSection,
      oldContent,
      newContent,
      suggestionMessage,
      explanation,
      suggestedMetadata: {
        industries,
        simulator_mappings
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI 편집 제안 처리 과정에서 에러가 발생했습니다.' });
  }
});

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin/usage', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-usage.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` ISSU AI Radar Server running on http://localhost:${PORT}`);
  console.log(` OPINION_EXPOSE_POLICY: ${OPINION_EXPOSE_POLICY}`);
  console.log(`====================================================`);
});
