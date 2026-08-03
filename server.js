const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createHubRouter } = require('./routes/hub');
const { stripInternalSections } = require('./lib/section-privacy');
const { evaluateCompleteness } = require('./lib/solution-completeness');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const OPINION_EXPOSE_POLICY = process.env.OPINION_EXPOSE_POLICY || 'B'; // A: Expose to all, B: Admin only
const APP_SURFACE = process.env.APP_SURFACE || 'all';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 10;
const HEALTH_QUERY_TIMEOUT_MS = 3000;
// robots.txt / sitemap.xml 의 절대 URL 용. 대외 도메인이 정해지면 env 로 덮어쓴다.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://ai-radar-7pg2.onrender.com').replace(/\/+$/, '');
// 배포 확인용. 바뀐 파일이 전부 인증 뒤에 있으면 밖에서 배포 여부를 판별할 수 없어
// 매번 추측하게 된다. Render 가 RENDER_GIT_COMMIT 을 넣어준다.
// 짧은 해시만 노출한다 — 저장소가 비공개라 해시 자체로는 아무것도 알 수 없고,
// 브랜치·빌드 상세는 넣지 않는다.
const BUILD_VERSION = String(process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || 'dev';
const STARTED_AT = new Date().toISOString();
let isShuttingDown = false;

function parseJsonColumn(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

app.disable('x-powered-by');

if (!process.env.DATABASE_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !JWT_SECRET) {
  console.error('Missing required environment variables. Copy .env.example to .env and inject secrets locally.');
  process.exit(1);
}

if (JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must contain at least 32 characters.');
  process.exit(1);
}

if (!['all', 'hub', 'offering', 'admin'].includes(APP_SURFACE)) {
  console.error('APP_SURFACE must be one of: all, hub, offering, admin.');
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
//
// Do NOT force an IP family here. Supabase's direct connection host
// (db.<ref>.supabase.co) is IPv6-only, while the connection pooler host
// (aws-0-<region>.pooler.supabase.com) is IPv4-only. IPv4-only platforms such
// as Render must use the pooler, so hardcoding `family: 6` made every DB call
// time out ("database_unavailable"). Let pg resolve whatever the configured
// host actually offers; override with DB_IP_FAMILY only if you know you need it.
const dbIpFamily = Number(process.env.DB_IP_FAMILY) || undefined;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  ...(dbIpFamily ? { family: dbIpFamily } : {}),
  connectionTimeoutMillis: 5000
});

// PostgreSQL emits an `error` event when an idle pooled client loses its
// connection. Without a listener Node treats that event as uncaught and exits.
pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

// Run DB Migrations
pool.query('ALTER TABLE public.solutions ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false', (err) => {
  if (err) {
    console.error('Error running migrations (is_archived column):', err);
  } else {
    console.log('Database migration successful: is_archived column verified.');
  }
});

// 스키마 마이그레이션은 수동(DEPLOYMENT.md)이라, 코드가 먼저 배포되고 컬럼이 아직
// 없는 구간이 존재한다. 009 이후 컬럼은 존재 여부를 캐시해두고 있을 때만 참조한다.
// 있음(true)은 되돌아가지 않으니 영구 캐시한다. 없음(false)은 짧게만 캐시한다 —
// 마이그레이션은 서버가 떠 있는 상태에서 SQL Editor 로 적용되므로, 영구 캐시하면
// 적용 후에도 재시작 전까지 새 컬럼을 못 본다.
const COLUMN_MISS_TTL_MS = 60 * 1000;
const columnCache = new Map();
async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  const cached = columnCache.get(key);
  if (cached === true) return true;
  if (cached && cached.missUntil > Date.now()) return false;
  try {
    const result = await pool.query(
      'select 1 from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = $2',
      [table, column]
    );
    const exists = result.rowCount > 0;
    columnCache.set(key, exists ? true : { missUntil: Date.now() + COLUMN_MISS_TTL_MS });
    return exists;
  } catch (error) {
    console.error(`Column probe failed for ${key}:`, error.message);
    return false; // 모르면 없는 것으로 취급 = 내부 컬럼을 내보내지 않는 쪽으로 실패(캐시하지 않음)
  }
}

// GET /api/solutions/:slug 응답 컬럼. SELECT * 는 내부 컬럼(가격·grade·tech_note·
// focal·운영상태)을 role 구분 없이 흘려보내므로 쓰지 않는다.
const SOLUTION_COLUMNS_COMMON = Object.freeze([
  'id', 'legacy_id', 'slug', 'name', 'delivery', 'layer', 'synergy', 'category',
  'jtbd', 'value_chain', 'sections', 'simulator_mappings', 'industries',
  'status', 'updated_at'
]);
const SOLUTION_COLUMNS_ADMIN_ONLY = Object.freeze([
  'opinion', 'sections_internal', 'grade', 'scale', 'status_op', 'note', 'tech_note',
  'focal_id', 'price_type', 'unit_price', 'currency', 'price_tiers',
  'price_is_placeholder', 'version', 'updated_by'
]);

async function solutionColumnsFor(role) {
  // curator 도 내부 본문을 편집해야 하므로 admin 과 같은 컬럼을 받는다.
  if (!isCatalogEditor({ role })) return [...SOLUTION_COLUMNS_COMMON];
  const optional = ['sections_internal', 'price_is_placeholder'];
  const available = [];
  for (const column of SOLUTION_COLUMNS_ADMIN_ONLY) {
    if (optional.includes(column) && !(await hasColumn('solutions', column))) continue;
    available.push(column);
  }
  return [...SOLUTION_COLUMNS_COMMON, ...available];
}

/**
 * sections_internal 을 별도 UPDATE 로 반영한다. 009 적용 전이면 조용히 건너뛴다.
 * 값이 undefined 면 손대지 않아, 이 필드를 모르는 클라이언트가 저장해도 내부 본문이 날아가지 않는다.
 */
async function persistSectionsInternal(executor, solutionId, value) {
  if (value === undefined) return;
  if (!(await hasColumn('solutions', 'sections_internal'))) return;
  const payload = value && typeof value === 'object' ? value : parseJsonColumn(value, {}) || {};
  await executor.query('UPDATE solutions SET sections_internal = $1 WHERE id = $2', [
    JSON.stringify(payload),
    solutionId
  ]);
}

/**
 * 추천 판정 필드(slot·fqa_coverage·prerequisites·red_flags·bundle_potential)를 반영한다.
 * 010 적용 전이면 해당 컬럼만 조용히 건너뛴다. 값이 undefined 면 손대지 않아,
 * 이 필드를 모르는 클라이언트가 저장해도 기존 판정 데이터가 날아가지 않는다.
 */
const RECOMMENDATION_FIELDS = Object.freeze([
  { column: 'slot', json: false },
  { column: 'fqa_coverage', json: true },
  { column: 'prerequisites', json: true },
  { column: 'red_flags', json: true },
  { column: 'bundle_potential', json: false }
]);

async function persistRecommendationFields(executor, solutionId, payload = {}) {
  for (const { column, json } of RECOMMENDATION_FIELDS) {
    const value = payload[column];
    if (value === undefined) continue;
    if (!(await hasColumn('solutions', column))) continue;

    let stored;
    if (json) {
      stored = JSON.stringify(Array.isArray(value) ? value : (parseJsonColumn(value, []) || []));
    } else if (column === 'bundle_potential') {
      const n = Number(value);
      stored = Number.isFinite(n) && n >= 1 && n <= 3 ? Math.round(n) : null;
    } else {
      stored = value === '' ? null : value;
    }
    await executor.query(`UPDATE solutions SET ${column} = $1 WHERE id = $2`, [stored, solutionId]);
  }
}

/** solutions.price_is_placeholder 를 반영한다. 009 적용 전이면 조용히 건너뛴다. */
async function persistPriceFlag(executor, solutionId, value, actor) {
  if (value === undefined) return;
  if (actor && !isAdminUser(actor)) return; // 실단가 확정은 admin 만
  if (!(await hasColumn('solutions', 'price_is_placeholder'))) return;
  const isPlaceholder = !(value === false || value === 'false');
  await executor.query('UPDATE solutions SET price_is_placeholder = $1 WHERE id = $2', [isPlaceholder, solutionId]);
}

/**
 * 완성도 검사에 필요한 주변 데이터를 모은다.
 * 복붙 검출은 다른 솔루션 본문이 있어야 하고, 슬롯·레이어 대조는 분류표가 있어야 한다.
 * 010 이 아직 적용되지 않은 환경에서는 있는 것만으로 검사한다(게이트가 배포를 막지 않도록).
 */
async function loadCompletenessContext(excludeId) {
  const context = { slots: new Map(), knownSlugs: new Set(), otherSolutions: [] };

  try {
    const slotRows = await pool.query('select id, layer from solution_slots');
    slotRows.rows.forEach((row) => context.slots.set(row.id, { layer: row.layer }));
  } catch (error) {
    console.error('Slot table unavailable for completeness check:', error.message);
  }

  try {
    const hasSlot = await hasColumn('solutions', 'slot');
    const rows = await pool.query(
      `select id, slug, name, sections from solutions where is_archived = false${hasSlot ? '' : ''}`
    );
    rows.rows.forEach((row) => {
      context.knownSlugs.add(row.slug);
      if (row.id !== excludeId) {
        context.otherSolutions.push({ slug: row.slug, name: row.name, sections: row.sections });
      }
    });
  } catch (error) {
    console.error('Catalog unavailable for completeness check:', error.message);
  }

  return context;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);


// Middleware
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "frame-src 'self'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'"
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN'
  });
  if (IS_PRODUCTION) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Each production deployment can expose one surface only. Local development uses "all".
app.use((req, res, next) => {
  if (APP_SURFACE === 'all') return next();
  const publicApi = req.path.startsWith('/api/hub/public/');
  const crawlerPath = req.path === '/robots.txt' || req.path === '/sitemap.xml';
  const commonPath = req.path === '/healthz' || req.path === '/style.css' || req.path === '/login' || req.path === '/login.html' || req.path.startsWith('/api/auth/') || crawlerPath;
  const radarPath = req.path === '/radar' || req.path === '/radar/' || req.path === '/index.html' || req.path === '/app.js' || req.path === '/about' || req.path === '/about.html' || req.path.startsWith('/docs/');
  const embeddedAdminPath = req.path.startsWith('/admin') || req.path.startsWith('/api/admin/');
  const allowed = {
    offering: req.path === '/healthz' || crawlerPath || publicApi || req.path === '/' || req.path === '/offering' || req.path.startsWith('/offering.'),
    hub: commonPath || radarPath || embeddedAdminPath || req.path === '/' || req.path === '/hub' || req.path.startsWith('/hub.') || req.path.startsWith('/api/hub/') || req.path.startsWith('/api/solutions'),
    admin: commonPath || req.path === '/' || req.path.startsWith('/admin') || req.path.startsWith('/api/admin/') || req.path.startsWith('/api/solutions')
  }[APP_SURFACE];
  if (!allowed) return res.status(404).send('Not found');
  next();
});

app.get('/healthz', async (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'shutting_down', version: BUILD_VERSION });
  }
  try {
    await pool.query({ text: 'select 1', query_timeout: HEALTH_QUERY_TIMEOUT_MS });
    // version 이 바뀌었으면 새 코드가, startedAt 이 최근이면 방금 재시작된 것이다.
    return res.status(200).json({ status: 'ok', version: BUILD_VERSION, startedAt: STARTED_AT });
  } catch (error) {
    console.error('Readiness check failed:', error.message);
    return res.status(503).json({ status: 'database_unavailable', version: BUILD_VERSION, startedAt: STARTED_AT });
  }
});

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

const readSessionUser = async (req) => {
  const token = req.cookies.token;
  if (!token) {
    return { status: 401, error: '인증 토큰이 없습니다. 로그인이 필요합니다.' };
  }

  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return { status: 403, error: '인증 토큰이 만료되었거나 유효하지 않습니다.', clearCookie: true };
  }

  try {
    const result = await pool.query(
      `select id, email, full_name, role, approved
       from profiles where id = $1`,
      [claims.id]
    );
    const profile = result.rows[0];
    if (!profile || !profile.approved) {
      return { status: 403, error: '현재 사용 승인이 없는 계정입니다.', clearCookie: true };
    }
    return {
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.full_name || '사내 임직원',
        role: profile.role
      }
    };
  } catch (error) {
    console.error('Session profile verification failed:', error.message);
    return { status: 503, error: '계정 권한을 확인하지 못했습니다.' };
  }
};

// API authentication returns JSON errors, while internal pages redirect to login.
const authenticateToken = async (req, res, next) => {
  const session = await readSessionUser(req);
  if (!session.user) {
    if (session.clearCookie) res.clearCookie('token', { path: '/' });
    return res.status(session.status).json({ error: session.error });
  }
  req.user = session.user;
  return next();
};

// 역할 정의.
//   viewer  영업(hub 사용자) — 딜 작업 + 추천 소비 + 카탈로그 읽기
//   curator ISSU — 솔루션 등록·수정·발행, 내부 본문(opinion/sections_internal) 편집
//   admin   시스템 관리 — 위 전부 + 회원 승인 + 실단가 확정 + 롤백
// 가격·회원·롤백을 curator 에서 뺀 이유: ISV 담당자에게 계정 승인 권한까지 주는 것은 과하다.
const CATALOG_EDITOR_ROLES = Object.freeze(['admin', 'curator']);
const isAdminUser = (user) => user?.role === 'admin';
const isCatalogEditor = (user) => CATALOG_EDITOR_ROLES.includes(user?.role);
const roleAllowed = (user, required) => {
  if (!required) return true;
  return Array.isArray(required) ? required.includes(user?.role) : user?.role === required;
};

const requirePageAuth = (canonicalPath, requiredRole = null) => async (req, res, next) => {
  const session = await readSessionUser(req);
  if (!session.user) {
    if (session.clearCookie) res.clearCookie('token', { path: '/' });
    if (session.status === 503) return res.status(503).send('계정 권한을 확인하지 못했습니다.');
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
    return res.redirect(302, `/login.html?next=${encodeURIComponent(`${canonicalPath}${query}`)}`);
  }
  if (!roleAllowed(session.user, requiredRole)) {
    return res.status(403).send('접근 권한이 없습니다.');
  }
  req.user = session.user;
  return next();
};

// 사내 정적 자산용. 페이지처럼 로그인으로 리다이렉트하면 <script> 가 HTML 을 받아
// 원인 모를 파싱 에러가 나므로, 자산은 401/403 을 그대로 돌려준다.
const requireAssetAuth = (canonicalPath, requiredRole = null) => async (req, res, next) => {
  const session = await readSessionUser(req);
  if (!session.user) {
    if (session.clearCookie) res.clearCookie('token', { path: '/' });
    if (session.status === 503) return res.status(503).type('text/plain').send('계정 권한을 확인하지 못했습니다.');
    res.set('X-Login-Path', `/login.html?next=${encodeURIComponent(canonicalPath)}`);
    return res.status(401).type('text/plain').send('로그인이 필요합니다.');
  }
  if (!roleAllowed(session.user, requiredRole)) {
    return res.status(403).type('text/plain').send('접근 권한이 없습니다.');
  }
  req.user = session.user;
  return next();
};

const requireSurfaceRootAuth = (req, res, next) => {
  if (APP_SURFACE === 'hub') return requirePageAuth('/hub')(req, res, next);
  if (APP_SURFACE === 'admin') return requirePageAuth('/admin', CATALOG_EDITOR_ROLES)(req, res, next);
  return next();
};

// Admin Only Authorization Middleware
const adminOnly = (req, res, next) => {
  if (isAdminUser(req.user)) {
    next();
  } else {
    res.status(403).json({ error: '접근 권한이 없습니다. 관리자 전용 기능입니다.' });
  }
};

// 카탈로그 편집(admin + curator). 솔루션 CRUD·발행·판정 데이터가 여기 걸린다.
const catalogEditorOnly = (req, res, next) => {
  if (isCatalogEditor(req.user)) {
    next();
  } else {
    res.status(403).json({ error: '접근 권한이 없습니다. 카탈로그 편집 권한이 필요합니다.' });
  }
};

const loginAttempts = new Map();

const getLoginAttemptKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

const pruneLoginAttempts = (now) => {
  if (loginAttempts.size <= 10000) return;
  for (const [key, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(key);
  }
  while (loginAttempts.size > 10000) {
    loginAttempts.delete(loginAttempts.keys().next().value);
  }
};

const checkLoginRateLimit = (req, res, next) => {
  const now = Date.now();
  pruneLoginAttempts(now);
  const key = getLoginAttemptKey(req);
  const current = loginAttempts.get(key);
  if (current && current.resetAt > now && current.count >= LOGIN_ATTEMPT_LIMIT) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.set({
      'Retry-After': String(retryAfterSeconds),
      'RateLimit-Limit': String(LOGIN_ATTEMPT_LIMIT),
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(Math.ceil(current.resetAt / 1000))
    });
    return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }
  req.loginAttemptKey = key;
  res.set('RateLimit-Limit', String(LOGIN_ATTEMPT_LIMIT));
  res.set('RateLimit-Remaining', String(Math.max(0, LOGIN_ATTEMPT_LIMIT - (current?.count || 0))));
  next();
};

const recordLoginFailure = (req) => {
  const now = Date.now();
  const key = req.loginAttemptKey || getLoginAttemptKey(req);
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
};

const clearLoginFailures = (req) => {
  loginAttempts.delete(req.loginAttemptKey || getLoginAttemptKey(req));
};

// ----------------------------------------------------
// Authentication API Routes (Supabase Auth Integration)
// ----------------------------------------------------

// POST /api/auth/login
app.post('/api/auth/login', checkLoginRateLimit, async (req, res) => {
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
      recordLoginFailure(req);
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const userId = authData.user.id;

    const profileRes = await pool.query('SELECT * FROM profiles WHERE id = $1', [userId]);
    const profile = profileRes.rows[0];

    if (!profile) {
      recordLoginFailure(req);
      return res.status(403).json({ error: '등록된 사용자 프로필을 찾을 수 없습니다.' });
    }

    if (!profile.approved) {
      recordLoginFailure(req);
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
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });

    auditLog(profile.id, 'login', 'System');
    clearLoginFailures(req);

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
  
  const canSeeInternal = isCatalogEditor(req.user);
  // opinion 은 정책상 카탈로그 편집자 전용이면 아예 조회하지 않는다(응답에서 지우는 것보다 안전).
  const exposeOpinion = canSeeInternal || OPINION_EXPOSE_POLICY === 'A';
  const listColumns = [
    'id', 'legacy_id', 'slug', 'name', 'delivery', 'layer', 'synergy', 'category',
    'jtbd', 'value_chain', 'status', 'version', 'updated_at', 'simulator_mappings', 'industries',
    ...(exposeOpinion ? ['opinion'] : [])
  ];
  let queryStr = `SELECT ${listColumns.join(', ')} FROM solutions`;
  let conditions = ['is_archived = false'];
  let params = [];

  let paramIdx = 1;

  if (!canSeeInternal) {
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
    const canSeeInternal = isCatalogEditor(req.user);
    const columns = await solutionColumnsFor(req.user.role);
    const result = await pool.query(
      `SELECT ${columns.join(', ')} FROM solutions WHERE slug = $1 AND is_archived = false`,
      [slug]
    );
    const row = result.rows[0];


    if (!row) {
      return res.status(404).json({ error: '솔루션을 찾을 수 없습니다.' });
    }

    if (!canSeeInternal && row.status !== 'published') {
      return res.status(403).json({ error: '해당 솔루션 가이드는 작성 중(Draft) 상태이므로 조회할 수 없습니다.' });
    }

    auditLog(req.user.id, 'view', slug);

    row.sections = typeof row.sections === 'string' ? JSON.parse(row.sections) : (row.sections || {});
    row.simulator_mappings = typeof row.simulator_mappings === 'string' ? JSON.parse(row.simulator_mappings) : (row.simulator_mappings || []);
    row.industries = typeof row.industries === 'string' ? JSON.parse(row.industries) : (row.industries || []);

    if (canSeeInternal) {
      row.sections_internal = parseJsonColumn(row.sections_internal, {}) || {};
    } else {
      // 009 적용 전이면 내부 문단이 아직 sections 안에 남아 있다. 분리 규칙을 런타임에도
      // 한 번 더 태워서 마이그레이션 시점과 무관하게 non-admin 노출을 막는다(적용 후엔 no-op).
      row.sections = stripInternalSections(row.sections);
    }

    if (OPINION_EXPOSE_POLICY === 'A' && !canSeeInternal) {
      const opinionRow = await pool.query('SELECT opinion FROM solutions WHERE slug = $1', [slug]);
      row.opinion = opinionRow.rows[0]?.opinion ?? null;
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

app.post('/api/admin/solutions', authenticateToken, catalogEditorOnly, async (req, res) => {
  const {
    name, delivery, layer, synergy, category, jtbd, value_chain, sections, opinion,
    simulator_mappings, industries, grade, scale, focal_id, tech_note, status_op, note,
    price_type, unit_price, currency, price_tiers
  } = req.body;

  if (!name || !layer) {
    return res.status(400).json({ error: '솔루션 이름과 레이어는 필수 항목입니다.' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const now = new Date().toISOString();
  const sectionsJson = JSON.stringify(sections || {});
  const simMappingsJson = JSON.stringify(simulator_mappings || []);
  // 가격은 admin 만 정한다. curator 가 보낸 값은 무시하고 미설정으로 생성한다.
  const canEditPrice = isAdminUser(req.user);
  const priceType = canEditPrice && ['seat', 'once', 'mrr'].includes(price_type) ? price_type : null;
  const unitPrice = canEditPrice ? Math.max(0, Math.round(Number(unit_price) || 0)) : 0;
  const currencyVal = canEditPrice && ['KRW', 'USD'].includes(currency) ? currency : 'KRW';
  const priceTiersJson = JSON.stringify(canEditPrice && Array.isArray(price_tiers) ? price_tiers : []);

  // industries 데이터를 [{ industry, fit: 'high' }] 구조로 하이브리드 포맷팅
  const formattedIndustries = (industries || []).map(ind => {
    if (typeof ind === 'object' && ind.industry) return ind;
    return { industry: ind, fit: 'high' };
  });
  const indJson = JSON.stringify(formattedIndustries);

  try {
    const insertQuery = `
      INSERT INTO solutions (
        slug, name, delivery, layer, synergy, category, jtbd, value_chain, sections, opinion,
        status, version, updated_by, updated_at, simulator_mappings, industries,
        grade, scale, focal_id, tech_note, status_op, note, price_type, unit_price, currency, price_tiers
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', 1, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
      RETURNING id;
    `;

    const result = await pool.query(insertQuery, [
      slug, name, delivery, layer, synergy, category, jtbd, value_chain, sectionsJson, opinion,
      req.user.id, now, simMappingsJson, indJson,
      grade ?? null, scale || null, focal_id || null, tech_note || null, status_op || 'draft', note || null,
      priceType, unitPrice, currencyVal, priceTiersJson
    ]);
    
    const solId = result.rows[0].id;
    await persistSectionsInternal(pool, solId, req.body.sections_internal);
    await persistRecommendationFields(pool, solId, req.body);
    await persistPriceFlag(pool, solId, req.body.price_is_placeholder, req.user);
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

app.put('/api/admin/solutions/:id', authenticateToken, catalogEditorOnly, async (req, res) => {
  const solId = req.params.id;
  const {
    name, delivery, layer, synergy, category, jtbd, value_chain, sections, opinion, status,
    simulator_mappings, industries, grade, scale, focal_id, tech_note, status_op, note,
    price_type, unit_price, currency, price_tiers
  } = req.body;

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

    // 가격은 admin 만 바꾼다. curator 의 요청에서는 현재 값을 그대로 유지한다.
    const canEditPrice = isAdminUser(req.user);
    const priceType = (!canEditPrice || price_type === undefined)
      ? (current.price_type ?? null)
      : (['seat', 'once', 'mrr'].includes(price_type) ? price_type : null);
    const unitPrice = (!canEditPrice || unit_price === undefined)
      ? (current.unit_price ?? 0)
      : Math.max(0, Math.round(Number(unit_price) || 0));
    const currencyVal = (!canEditPrice || currency === undefined)
      ? (current.currency || 'KRW')
      : (['KRW', 'USD'].includes(currency) ? currency : 'KRW');
    const priceTiersJson = (!canEditPrice || price_tiers === undefined)
      ? JSON.stringify(current.price_tiers ?? [])
      : JSON.stringify(Array.isArray(price_tiers) ? price_tiers : []);

    const updateQuery = `
      UPDATE solutions
      SET slug = $1, name = $2, delivery = $3, layer = $4, synergy = $5, category = $6,
          jtbd = $7, value_chain = $8, sections = $9, opinion = $10, status = $11,
          updated_by = $12, updated_at = $13, simulator_mappings = $14, industries = $15,
          grade = $16, scale = $17, focal_id = $18, tech_note = $19, status_op = $20, note = $21,
          price_type = $22, unit_price = $23, currency = $24, price_tiers = $25
      WHERE id = $26
    `;

    await pool.query(updateQuery, [
      slug, name, delivery, layer, synergy, category, jtbd, value_chain, sectionsJson, opinion,
      status || current.status, req.user.id, now, simMappingsJson, indJson,
      grade ?? current.grade, scale || null, focal_id || null, tech_note || null,
      status_op || current.status_op || 'active', note || null, priceType, unitPrice,
      currencyVal, priceTiersJson, solId
    ]);

    await persistSectionsInternal(pool, solId, req.body.sections_internal);
    await persistRecommendationFields(pool, solId, req.body);
    await persistPriceFlag(pool, solId, req.body.price_is_placeholder, req.user);

    auditLog(req.user.id, 'edit', slug, 'Updated solution details');
    res.json({ message: '솔루션 정보가 저장되었습니다.', slug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '솔루션 정보 업데이트에 실패했습니다.' });
  }
});

app.post('/api/admin/solutions/:id/publish', authenticateToken, catalogEditorOnly, async (req, res) => {
  const solId = req.params.id;
  const now = new Date().toISOString();
  const payload = req.body || {};

  if (!payload.name || !payload.layer) {
    return res.status(400).json({ error: '솔루션 이름과 레이어는 필수 항목입니다.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('begin');
    const solRes = await client.query('SELECT * FROM solutions WHERE id = $1 FOR UPDATE', [solId]);
    const sol = solRes.rows[0];

    if (!sol) {
      await client.query('rollback');
      return res.status(404).json({ error: '발행할 솔루션을 찾을 수 없습니다.' });
    }

    const name = String(payload.name).trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || sol.slug;
    const newVersion = Number(sol.version || 0) + 1;
    const sections = parseJsonColumn(payload.sections ?? sol.sections, {});
    const simulatorMappings = parseJsonColumn(payload.simulator_mappings ?? sol.simulator_mappings, []);
    const industriesInput = parseJsonColumn(payload.industries ?? sol.industries, []);
    const formattedIndustries = (Array.isArray(industriesInput) ? industriesInput : []).map((industry) => {
      if (industry && typeof industry === 'object' && industry.industry) return industry;
      return { industry, fit: 'high' };
    });

    // 가격은 admin 만 바꾼다(발행 경로로 우회되지 않도록 여기서도 막는다).
    const canEditPrice = isAdminUser(req.user);
    const priceType = (!canEditPrice || payload.price_type === undefined)
      ? (sol.price_type ?? null)
      : (['seat', 'once', 'mrr'].includes(payload.price_type) ? payload.price_type : null);
    const unitPrice = (!canEditPrice || payload.unit_price === undefined)
      ? (sol.unit_price ?? 0)
      : Math.max(0, Math.round(Number(payload.unit_price) || 0));
    const currencyVal = (!canEditPrice || payload.currency === undefined)
      ? (sol.currency || 'KRW')
      : (['KRW', 'USD'].includes(payload.currency) ? payload.currency : 'KRW');
    const priceTiersJson = (!canEditPrice || payload.price_tiers === undefined)
      ? JSON.stringify(parseJsonColumn(sol.price_tiers, []))
      : JSON.stringify(Array.isArray(payload.price_tiers) ? payload.price_tiers : []);

    // 완성도 게이트. 22종 중 7종이 {name} 플레이스홀더를 단 채로, 9종이 서로 같은
    // 템플릿 문장을 그대로 둔 채로 발행돼 있었다. 등록 권한을 여는 이상 여기서 막는다.
    // 우회는 admin 만 가능하다. curator 가 플래그 하나로 게이트를 넘을 수 있으면
    // 게이트가 아니다. 우회 시 감사로그에 남긴다.
    const bypassGate = payload.skip_completeness_check === true && isAdminUser(req.user);
    if (payload.skip_completeness_check === true && !bypassGate) {
      await client.query('rollback');
      return res.status(403).json({ error: '완성도 검사 우회는 관리자만 가능합니다.' });
    }
    if (bypassGate) {
      auditLog(req.user.id, 'publish', slug, 'completeness gate bypassed');
    }
    if (!bypassGate) {
      const candidate = {
        ...sol,
        slug,
        layer: payload.layer,
        sections,
        slot: payload.slot ?? sol.slot,
        fqa_coverage: payload.fqa_coverage ?? sol.fqa_coverage,
        prerequisites: payload.prerequisites ?? sol.prerequisites,
        red_flags: payload.red_flags ?? sol.red_flags,
        bundle_potential: payload.bundle_potential ?? sol.bundle_potential
      };
      const context = await loadCompletenessContext(solId);
      const verdict = evaluateCompleteness(candidate, context);
      if (!verdict.ok) {
        await client.query('rollback');
        return res.status(422).json({
          error: '완성도 검사를 통과하지 못해 발행할 수 없습니다.',
          blocking: verdict.blocking,
          warnings: verdict.warnings
        });
      }
    }

    const updatedRes = await client.query(`
      UPDATE solutions
      SET slug = $1, name = $2, delivery = $3, layer = $4, synergy = $5, category = $6,
          jtbd = $7, value_chain = $8, sections = $9, opinion = $10, status = 'published',
          version = $11, updated_by = $12, updated_at = $13, simulator_mappings = $14,
          industries = $15, grade = $16, scale = $17, focal_id = $18, tech_note = $19,
          status_op = $20, note = $21, price_type = $22, unit_price = $23,
          currency = $24, price_tiers = $25
      WHERE id = $26
      RETURNING *
    `, [
      slug,
      name,
      payload.delivery ?? sol.delivery,
      payload.layer,
      payload.synergy ?? sol.synergy,
      payload.category ?? sol.category,
      payload.jtbd ?? sol.jtbd,
      payload.value_chain ?? sol.value_chain,
      JSON.stringify(sections),
      payload.opinion ?? sol.opinion,
      newVersion,
      req.user.id,
      now,
      JSON.stringify(Array.isArray(simulatorMappings) ? simulatorMappings : []),
      JSON.stringify(formattedIndustries),
      payload.grade ?? sol.grade,
      payload.scale || null,
      payload.focal_id || null,
      payload.tech_note ?? sol.tech_note,
      payload.status_op || sol.status_op || 'active',
      payload.note ?? null,
      priceType,
      unitPrice,
      currencyVal,
      priceTiersJson,
      solId
    ]);
    const updatedSol = updatedRes.rows[0];
    await persistSectionsInternal(client, solId, payload.sections_internal);
    await persistRecommendationFields(client, solId, payload);
    await persistPriceFlag(client, solId, payload.price_is_placeholder, req.user);
    const sectionsInternal = payload.sections_internal !== undefined
      ? (parseJsonColumn(payload.sections_internal, {}) || {})
      : (parseJsonColumn(updatedSol.sections_internal, {}) || {});

    const snapshot = JSON.stringify({
      slug: updatedSol.slug,
      name: updatedSol.name,
      delivery: updatedSol.delivery,
      layer: updatedSol.layer,
      synergy: updatedSol.synergy,
      category: updatedSol.category,
      jtbd: updatedSol.jtbd,
      value_chain: updatedSol.value_chain,
      sections: parseJsonColumn(updatedSol.sections, {}),
      sections_internal: sectionsInternal,
      opinion: updatedSol.opinion,
      status: updatedSol.status,
      version: updatedSol.version,
      simulator_mappings: parseJsonColumn(updatedSol.simulator_mappings, []),
      industries: parseJsonColumn(updatedSol.industries, []),
      grade: updatedSol.grade,
      scale: updatedSol.scale,
      focal_id: updatedSol.focal_id,
      tech_note: updatedSol.tech_note,
      status_op: updatedSol.status_op,
      note: updatedSol.note,
      price_type: updatedSol.price_type,
      unit_price: updatedSol.unit_price,
      currency: updatedSol.currency,
      price_tiers: parseJsonColumn(updatedSol.price_tiers, [])
    });

    await client.query(`
      INSERT INTO solution_versions (solution_id, snapshot, editor, created_at)
      VALUES ($1, $2, $3, $4)
    `, [solId, snapshot, req.user.id, now]);

    await client.query('commit');
    auditLog(req.user.id, 'publish', updatedSol.slug, `Published Version v${updatedSol.version}`);
    res.json({ message: `성공적으로 발행되었습니다 (버전: v${updatedSol.version})`, version: updatedSol.version });
  } catch (err) {
    if (client) await client.query('rollback').catch(() => {});
    console.error(err);
    if (err.code === '23505') return res.status(400).json({ error: '동일한 slug의 솔루션이 이미 존재합니다.' });
    res.status(500).json({ error: '솔루션 발행에 실패했습니다.' });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/admin/solutions/:id (Archive solution)
app.delete('/api/admin/solutions/:id', authenticateToken, catalogEditorOnly, async (req, res) => {
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

app.get('/api/admin/focal-contacts', authenticateToken, catalogEditorOnly, async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, org, vendor_scope, assigned_at FROM focal_contacts ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '포컬 담당자 목록을 불러오지 못했습니다.' });
  }
});

app.post('/api/admin/focal-contacts', authenticateToken, catalogEditorOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const org = String(req.body?.org || '').trim();
  const vendorScope = String(req.body?.vendor_scope || '').trim();
  if (!name) return res.status(400).json({ error: '담당자 이름은 필수입니다.' });
  try {
    const result = await pool.query(
      `INSERT INTO focal_contacts (name, org, vendor_scope)
       VALUES ($1, $2, $3) RETURNING *`,
      [name.slice(0, 120), org.slice(0, 120), vendorScope.slice(0, 500)]
    );
    auditLog(req.user.id, 'create', `focal:${result.rows[0].id}`, name);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '포컬 담당자를 저장하지 못했습니다.' });
  }
});

app.get('/api/admin/packages', authenticateToken, catalogEditorOnly, async (_req, res) => {
  try {
    const result = await pool.query(
      `select p.id, p.name, p.scale, p.period, p.target, p.sort_order, p.status,
              p.base_md, p.unit_price,
              coalesce(json_agg(json_build_object('label', pi.label) order by pi.sort_order)
                filter (where pi.id is not null), '[]') as items
       from packages p left join package_items pi on pi.package_id = p.id
       group by p.id order by p.sort_order, p.id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Admin packages list failed:', err.message);
    res.status(500).json({ error: '패키지 목록을 불러오지 못했습니다.' });
  }
});

app.patch('/api/admin/packages/:id', authenticateToken, adminOnly, async (req, res) => {
  const { id } = req.params;
  const { name, scale, period, target, sort_order, base_md, unit_price } = req.body || {};
  try {
    const curRes = await pool.query('SELECT * FROM packages WHERE id = $1', [id]);
    const cur = curRes.rows[0];
    if (!cur) return res.status(404).json({ error: '패키지를 찾을 수 없습니다.' });

    const baseMd = base_md === undefined ? cur.base_md : Math.max(0, Math.round(Number(base_md) || 0));
    const unitPrice = unit_price === undefined ? cur.unit_price : Math.max(0, Math.round(Number(unit_price) || 0));
    const sortOrder = sort_order === undefined ? cur.sort_order : Math.round(Number(sort_order) || 0);

    const updated = await pool.query(
      `UPDATE packages
       SET name = $1, scale = $2, period = $3, target = $4, sort_order = $5,
           base_md = $6, unit_price = $7
       WHERE id = $8
       RETURNING id, name, scale, period, target, sort_order, base_md, unit_price`,
      [
        name ?? cur.name, scale ?? cur.scale, period ?? cur.period, target ?? cur.target,
        sortOrder, baseMd, unitPrice, id
      ]
    );
    // 실단가 확정 여부. 넘어오지 않으면 현재 값을 유지한다.
    if (req.body?.price_is_placeholder !== undefined && await hasColumn('packages', 'price_is_placeholder')) {
      const confirmed = req.body.price_is_placeholder === false || req.body.price_is_placeholder === 'false';
      await pool.query('UPDATE packages SET price_is_placeholder = $1 WHERE id = $2', [!confirmed, id]);
      updated.rows[0].price_is_placeholder = !confirmed;
      auditLog(req.user.id, 'edit', `package:${id}`, `price_is_placeholder=${!confirmed}`);
    }

    auditLog(req.user.id, 'edit', `package:${id}`, 'Updated package pricing');
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('Admin package update failed:', err.message);
    res.status(500).json({ error: '패키지 저장에 실패했습니다.' });
  }
});

app.get('/api/admin/settings', authenticateToken, adminOnly, async (_req, res) => {
  try {
    const result = await pool.query('select usd_krw from hub_settings where id = true');
    res.json(result.rows[0] || { usd_krw: 1400 });
  } catch (err) {
    console.error('Admin settings failed:', err.message);
    res.status(500).json({ error: '설정을 불러오지 못했습니다.' });
  }
});

app.patch('/api/admin/settings', authenticateToken, adminOnly, async (req, res) => {
  const usdKrw = Math.max(1, Math.round(Number(req.body?.usd_krw) || 0));
  try {
    const result = await pool.query(
      `insert into hub_settings (id, usd_krw) values (true, $1)
       on conflict (id) do update set usd_krw = $1
       returning usd_krw`,
      [usdKrw]
    );
    auditLog(req.user.id, 'edit', 'settings', `usd_krw=${usdKrw}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin settings update failed:', err.message);
    res.status(500).json({ error: '설정 저장에 실패했습니다.' });
  }
});

app.get('/api/admin/profiles', authenticateToken, adminOnly, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, full_name, team, role, approved, created_at
       FROM profiles ORDER BY approved ASC, created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '회원 목록을 불러오지 못했습니다.' });
  }
});

app.patch('/api/admin/profiles/:id', authenticateToken, adminOnly, async (req, res) => {
  const approved = typeof req.body?.approved === 'boolean' ? req.body.approved : null;
  const role = ['admin', 'curator', 'viewer'].includes(req.body?.role) ? req.body.role : null;
  const team = typeof req.body?.team === 'string' ? req.body.team.trim().slice(0, 120) : null;
  if (approved === null && role === null && team === null) {
    return res.status(400).json({ error: '변경할 회원 정보가 없습니다.' });
  }
  if (req.params.id === req.user.id && (approved === false || (role && role !== 'admin'))) {
    return res.status(400).json({ error: '현재 로그인한 관리자 자신의 권한은 해제할 수 없습니다.' });
  }
  try {
    const result = await pool.query(
      `UPDATE profiles SET
         approved = COALESCE($1, approved),
         role = COALESCE($2::app_role, role),
         team = COALESCE($3, team)
       WHERE id = $4
       RETURNING id, email, full_name, team, role, approved, created_at`,
      [approved, role, team, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });
    auditLog(req.user.id, 'edit', `profile:${req.params.id}`, JSON.stringify({ approved, role, team }));
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '회원 정보를 저장하지 못했습니다.' });
  }
});



/**
 * 추천 vs 실제 채택 리포트. 기준 튜닝의 근거이자 콘텐츠 보강 우선순위다.
 *
 * 세 신호를 뽑는다.
 *   miss   추천했는데 안 고름        → 판정 데이터가 현실과 어긋남
 *   manual 추천에 없었는데 고름       → 엔진이 놓친 것. 가장 값지다
 *   nodata 판정 데이터가 없어 빠짐    → 보강 우선순위 (딜에서 걸린 횟수 순)
 */
app.get('/api/admin/recommendation-report', authenticateToken, catalogEditorOnly, async (_req, res) => {
  try {
    if (!(await hasColumn('deals', 'recommendation_snapshot'))) {
      return res.status(503).json({ error: '스냅샷 컬럼이 없습니다. 010 마이그레이션을 확인하세요.' });
    }
    const { rows } = await pool.query(
      `select id, customer, recommendation_snapshot as snap, updated_at
         from deals
        where recommendation_snapshot is not null
          and recommendation_snapshot <> '{}'::jsonb
        order by updated_at desc
        limit 500`
    );

    const tally = new Map(); // slug → {name, recommended, adopted, manual}
    const bump = (slug, name, field) => {
      if (!slug) return;
      if (!tally.has(slug)) tally.set(slug, { slug, name: name || slug, recommended: 0, adopted: 0, manual: 0 });
      tally.get(slug)[field] += 1;
    };
    const nodata = new Map();

    let withRecommendation = 0;
    let withAdoption = 0;
    const bundleStats = { offered: 0, adopted: 0 };

    for (const row of rows) {
      const snap = row.snap || {};
      const rec = snap.recommended || {};
      const adopted = snap.adopted || null;
      if (rec.eligible || rec.bundles) withRecommendation += 1;

      const offered = new Map();
      for (const group of ['eligible', 'bundles', 'needsConfirmation']) {
        for (const item of rec[group] || []) {
          if (item.kind !== 'solution') continue;
          offered.set(item.slug, item);
          bump(item.slug, item.name, 'recommended');
          if (group === 'bundles') bundleStats.offered += 1;
        }
      }
      for (const entry of rec.excludedNoData || []) {
        const key = entry.slug || entry;
        if (!nodata.has(key)) nodata.set(key, { slug: key, name: entry.name || key, count: 0 });
        nodata.get(key).count += 1;
      }

      if (!adopted) continue;
      withAdoption += 1;
      const picked = new Set((adopted.picked || []).map((p) => p.slug).filter(Boolean));
      for (const slug of picked) {
        if (offered.has(slug)) {
          bump(slug, offered.get(slug).name, 'adopted');
          if ((rec.bundles || []).some((b) => b.slug === slug)) bundleStats.adopted += 1;
        } else {
          const meta = (adopted.picked || []).find((p) => p.slug === slug);
          bump(slug, meta?.name, 'manual');
        }
      }
    }

    const solutions = [...tally.values()].map((item) => ({
      ...item,
      adoptionRate: item.recommended ? Number((item.adopted / item.recommended).toFixed(2)) : null
    }));

    res.json({
      deals: rows.length,
      withRecommendation,
      withAdoption,
      bundle: {
        ...bundleStats,
        rate: bundleStats.offered ? Number((bundleStats.adopted / bundleStats.offered).toFixed(2)) : null
      },
      // 추천했는데 채택률이 낮은 것 — 판정 데이터가 현실과 어긋난다는 신호
      misses: solutions.filter((s) => s.recommended >= 2 && (s.adoptionRate ?? 1) < 0.3)
        .sort((a, b) => b.recommended - a.recommended),
      // 추천에 없었는데 영업이 고른 것 — 엔진이 놓친 것
      manualPicks: solutions.filter((s) => s.manual > 0).sort((a, b) => b.manual - a.manual),
      // 판정 데이터가 없어 후보에서 빠진 횟수 — 보강 우선순위
      needsData: [...nodata.values()].sort((a, b) => b.count - a.count),
      solutions: solutions.sort((a, b) => b.recommended - a.recommended)
    });
  } catch (err) {
    console.error('Recommendation report failed:', err.message);
    res.status(500).json({ error: '추천 리포트를 만들지 못했습니다.' });
  }
});

// 슬롯 분류표. 편집기의 드롭다운과 커버리지 표시에 쓴다.
app.get('/api/admin/slots', authenticateToken, catalogEditorOnly, async (_req, res) => {
  try {
    const result = await pool.query(
      `select s.id, s.name, s.layer, s.is_competitive, s.note,
              s.domain, d.name as domain_name, d.sort_order as domain_order,
              count(sol.id) filter (where sol.is_archived = false) as candidates
         from solution_slots s
         left join solution_domains d on d.id = s.domain
         left join solutions sol on sol.slot = s.id
        group by s.id, s.name, s.layer, s.is_competitive, s.note, s.sort_order,
                 s.domain, d.name, d.sort_order
        order by d.sort_order nulls last, s.sort_order`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Slot list failed:', err.message);
    res.status(500).json({ error: '슬롯 목록을 불러오지 못했습니다. 010 마이그레이션을 적용했는지 확인하세요.' });
  }
});

// 발행 전에 무엇이 막히는지 미리 본다. 저장할 때마다 폼에서 호출한다.
app.get('/api/admin/solutions/:id/completeness', authenticateToken, catalogEditorOnly, async (req, res) => {
  try {
    const columns = await solutionColumnsFor('admin');
    const result = await pool.query(
      `SELECT ${columns.join(', ')} FROM solutions WHERE id = $1`, [req.params.id]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: '솔루션을 찾을 수 없습니다.' });

    const context = await loadCompletenessContext(req.params.id);
    res.json(evaluateCompleteness(row, context));
  } catch (err) {
    console.error('Completeness check failed:', err.message);
    res.status(500).json({ error: '완성도 검사에 실패했습니다.' });
  }
});

app.get('/api/admin/solutions/:id/versions', authenticateToken, catalogEditorOnly, async (req, res) => {
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

  let client;
  try {
    client = await pool.connect();
    await client.query('begin');
    const verRes = await client.query('SELECT * FROM solution_versions WHERE id = $1 AND solution_id = $2', [versionId, solId]);
    const version = verRes.rows[0];

    if (!version) {
      await client.query('rollback');
      return res.status(404).json({ error: '롤백 스냅샷 버전을 찾을 수 없습니다.' });
    }

    const snapshot = typeof version.snapshot === 'string' ? JSON.parse(version.snapshot) : (version.snapshot || {});
    const curRes = await client.query('SELECT version FROM solutions WHERE id = $1 FOR UPDATE', [solId]);
    const curSol = curRes.rows[0];

    if (!curSol) {
      await client.query('rollback');
      return res.status(404).json({ error: '현재 솔루션 조회 실패' });
    }

    const nextVersion = curSol.version + 1;
    const now = new Date().toISOString();
    const sectionsJson = JSON.stringify(snapshot.sections || {});
    const simMappingsJson = JSON.stringify(snapshot.simulator_mappings || []);
    const indJson = JSON.stringify(snapshot.industries || []);

    const updateQuery = `
      UPDATE solutions
      SET slug = $1, name = $2, delivery = $3, layer = $4, synergy = $5, category = $6,
          jtbd = $7, value_chain = $8, sections = $9, opinion = $10, status = 'published',
          version = $11, updated_by = $12, updated_at = $13, simulator_mappings = $14,
          industries = $15, grade = $16, scale = $17, focal_id = $18, tech_note = $19,
          status_op = $20, note = $21, price_type = $22, unit_price = $23,
          currency = $24, price_tiers = $25
      WHERE id = $26
    `;

    await client.query(updateQuery, [
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
      snapshot.grade ?? null,
      snapshot.scale || null,
      snapshot.focal_id || null,
      snapshot.tech_note || null,
      snapshot.status_op || 'active',
      snapshot.note || null,
      ['seat', 'once', 'mrr'].includes(snapshot.price_type) ? snapshot.price_type : null,
      Math.max(0, Math.round(Number(snapshot.unit_price) || 0)),
      ['KRW', 'USD'].includes(snapshot.currency) ? snapshot.currency : 'KRW',
      JSON.stringify(Array.isArray(snapshot.price_tiers) ? snapshot.price_tiers : []),
      solId
    ]);

    // 스냅샷에 내부 본문이 없으면(009 이전에 찍힌 버전) 현재 값을 건드리지 않는다.
    await persistSectionsInternal(client, solId, snapshot.sections_internal);

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
      sections_internal: snapshot.sections_internal ?? {},
      opinion: snapshot.opinion,
      status: 'published',
      version: nextVersion,
      simulator_mappings: snapshot.simulator_mappings,
      industries: snapshot.industries,
      grade: snapshot.grade,
      scale: snapshot.scale,
      focal_id: snapshot.focal_id,
      tech_note: snapshot.tech_note,
      status_op: snapshot.status_op,
      note: snapshot.note,
      price_type: snapshot.price_type,
      unit_price: snapshot.unit_price,
      currency: snapshot.currency,
      price_tiers: snapshot.price_tiers
    });

    await client.query(`
      INSERT INTO solution_versions (solution_id, snapshot, editor, created_at)
      VALUES ($1, $2, $3, $4)
    `, [solId, newSnapshot, req.user.id, now]);

    await client.query('commit');
    auditLog(req.user.id, 'publish', snapshot.slug, `Rollback to version v${snapshot.version} (Created v${nextVersion})`);
    res.json({ message: `버전 v${snapshot.version}으로 롤백이 승인 및 발행되었습니다 (신규 버전: v${nextVersion})` });
  } catch (err) {
    if (client) await client.query('rollback').catch(() => {});
    console.error(err);
    res.status(500).json({ error: '롤백을 적용하는 데 실패했습니다.' });
  } finally {
    if (client) client.release();
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

app.post('/api/admin/suggest-edit', authenticateToken, catalogEditorOnly, async (req, res) => {
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
      suggestionMessage = `[규칙 기반 자동 삽입 · AI 아님] ${sol.name}의 7번 체크리스트에 새로운 항목을 추가할 것을 제안합니다.`;
    } else if (targetSection === '1') {
      const cleanPrompt = prompt.replace(/(1번|개요|에|을|를|추가|제안|수정)/g, '').trim();
      const addText = cleanPrompt ? `\n- **추가 정보**: ${cleanPrompt}` : '\n- **추가 비즈니스 가치**: 2026년 하반기 업그레이드 지원 포함';
      newContent = oldContent + addText;
      suggestionMessage = `[규칙 기반 자동 삽입 · AI 아님] ${sol.name}의 1번 개요 및 차별점에 새로운 비즈니스 가치를 추가할 것을 제안합니다.`;
    } else {
      const cleanPrompt = prompt.replace(new RegExp(`(${targetSection}번|에|을|를|추가|제안|수정)`, 'g'), '').trim();
      const appendText = cleanPrompt ? `\n\n* ${cleanPrompt} (AI 추가 제안)*` : '\n\n* (신규 비즈니스 정합성 피치 추가)*';
      newContent = oldContent + appendText;
      suggestionMessage = `[규칙 기반 자동 삽입 · AI 아님] ${sol.name}의 ${targetSection}번 섹션에 내용을 덧붙일 것을 제안합니다.`;
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
        suggestionMessage = `[규칙 기반 자동 삽입 · AI 아님] ${sol.name}의 적합 업종 도메인을 갱신할 것을 제안합니다.`;
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

const requireCompleteFqaScores = async (req, res, next) => {
  const rawScores = req.body?.fqa_scores;
  if (!rawScores || typeof rawScores !== 'object' || Array.isArray(rawScores)) {
    return res.status(400).json({ error: '모든 준비도 문항의 점수를 입력해주세요.' });
  }

  try {
    const result = await pool.query(
      "select no from fqa_items where status = 'active' order by no"
    );
    if (!result.rows.length) {
      return res.status(503).json({ error: '준비도 진단 문항을 불러올 수 없습니다.' });
    }

    const expected = new Set(result.rows.map((item) => String(item.no)));
    const provided = Object.keys(rawScores);
    const hasUnknownQuestion = provided.some((no) => !expected.has(no));
    const hasMissingOrInvalidScore = result.rows.some((item) => {
      const score = rawScores[item.no] ?? rawScores[String(item.no)];
      return typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5;
    });

    if (hasUnknownQuestion || hasMissingOrInvalidScore) {
      return res.status(400).json({ error: '모든 준비도 문항에 1~5점으로 답해주세요.' });
    }
    return next();
  } catch (error) {
    console.error('FQA validation failed:', error.message);
    return res.status(503).json({ error: '준비도 진단 문항을 확인하지 못했습니다.' });
  }
};

app.post([
  '/api/hub/public/diagnose',
  '/api/hub/public/leads'
], requireCompleteFqaScores);

const hubRouter = createHubRouter({
  pool,
  authenticateToken,
  adminOnly,
  auditLog,
  hasColumn
});
app.use('/api/hub', hubRouter);

const sendFrontendFile = (filename, cacheControl = 'no-store') => (_req, res) => {
  res.set('Cache-Control', cacheControl);
  res.sendFile(path.join(__dirname, filename), { dotfiles: 'deny' });
};

// 대외 공개 자산. 로그인 페이지와 offering 랜딩이 쓰는 것만 둔다.
// report.js 는 문서 조립만 한다. 내부 영업 로직이 없어 offering(공개)과 hub(로그인)
// 양쪽에서 같은 파일을 쓴다.
const publicFrontendAssets = Object.freeze({
  '/style.css': 'style.css',
  '/offering.css': 'offering.css',
  '/offering.js': 'offering.js',
  '/report.js': 'report.js'
});

// 사내 자산. app.js/hub.js 에는 내부 영업 로직(딜사이즈 계산, 벤더 추천 매핑,
// "더미 단가" 배너 문구, 전체 API 맵)이 들어 있어 비로그인에 내보내지 않는다.
// 각각 index.html(/radar) · hub.html(/hub) 에서만 로드되므로 같은 게이트를 건다.
const authedFrontendAssets = Object.freeze({
  '/app.js': { file: 'app.js', canonicalPath: '/radar' },
  '/hub.css': { file: 'hub.css', canonicalPath: '/hub' },
  '/hub.js': { file: 'hub.js', canonicalPath: '/hub' }
});

for (const [route, filename] of Object.entries(publicFrontendAssets)) {
  app.get(route, sendFrontendFile(filename, 'public, max-age=300'));
}

for (const [route, asset] of Object.entries(authedFrontendAssets)) {
  app.get(
    route,
    requireAssetAuth(asset.canonicalPath),
    sendFrontendFile(asset.file, 'private, max-age=300')
  );
}

app.get('/', requireSurfaceRootAuth, (_req, res) => {
  const entrypoints = {
    all: 'offering.html',
    offering: 'offering.html',
    hub: 'hub.html',
    admin: 'admin.html'
  };
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, entrypoints[APP_SURFACE]));
});

app.get(['/radar', '/radar/'], requirePageAuth('/radar'), sendFrontendFile('index.html'));
app.get('/index.html', requirePageAuth('/radar'), sendFrontendFile('index.html'));
app.get(['/login', '/login.html'], sendFrontendFile('login.html'));
app.get(['/admin', '/admin.html'], requirePageAuth('/admin', CATALOG_EDITOR_ROLES), sendFrontendFile('admin.html'));
app.get(['/admin/usage', '/admin-usage.html'], requirePageAuth('/admin/usage', 'admin'), sendFrontendFile('admin-usage.html'));
app.get(['/hub', '/hub.html'], requirePageAuth('/hub'), sendFrontendFile('hub.html'));
app.get(['/offering', '/offering.html'], sendFrontendFile('offering.html'));
app.get(['/about', '/about.html'], requirePageAuth('/about'), sendFrontendFile('about.html'));

// 크롤러 정책. 사내 경로는 로그인 게이트 뒤에 있지만 URL 자체가 색인되는 것도 막는다.
// offering 서페이스가 아니면(=사내 전용 배포) 전면 차단한다.
const PUBLIC_SURFACES = ['all', 'offering'];
app.get('/robots.txt', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').type('text/plain');
  if (!PUBLIC_SURFACES.includes(APP_SURFACE)) {
    return res.send('User-agent: *\nDisallow: /\n');
  }
  res.send([
    'User-agent: *',
    'Allow: /$',
    'Allow: /offering',
    'Disallow: /hub',
    'Disallow: /radar',
    'Disallow: /admin',
    'Disallow: /about',
    'Disallow: /docs/',
    'Disallow: /api/',
    'Disallow: /login',
    '',
    `Sitemap: ${PUBLIC_BASE_URL}/sitemap.xml`,
    ''
  ].join('\n'));
});

app.get('/sitemap.xml', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').type('application/xml');
  if (!PUBLIC_SURFACES.includes(APP_SURFACE)) {
    return res.status(404).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
  // 대외 공개 페이지는 랜딩뿐이다. 사내 경로는 절대 넣지 않는다.
  const urls = ['/', '/offering'];
  res.send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${PUBLIC_BASE_URL}${url}</loc><changefreq>weekly</changefreq></url>`),
    '</urlset>',
    ''
  ].join('\n'));
});

const downloadableDocs = new Set([
  'MZC_AI_솔루션_가이드.docx',
  'MZC_AI_솔루션_가이드_Anaconda.docx',
  'MZC_AI_솔루션_가이드_Anthropic_Claude.docx',
  'MZC_AI_솔루션_가이드_Articul8.docx',
  'MZC_AI_솔루션_가이드_CNVRG.docx',
  'MZC_AI_솔루션_가이드_DataRobot.docx',
  'MZC_AI_솔루션_가이드_Dataiku.docx',
  'MZC_AI_솔루션_가이드_Eleven_Labs.docx',
  'MZC_AI_솔루션_가이드_FollowerRabbit.docx',
  'MZC_AI_솔루션_가이드_H2O.docx',
  'MZC_AI_솔루션_가이드_IBM.docx',
  'MZC_AI_솔루션_가이드_LiteLLM.docx',
  'MZC_AI_솔루션_가이드_MeshyAI.docx',
  'MZC_AI_솔루션_가이드_OpenAI_Enterprise.docx',
  'MZC_AI_솔루션_가이드_Replit.docx',
  'MZC_AI_솔루션_가이드_Tigergraph.docx',
  'MZC_AI_솔루션_가이드_Twelve_Labs.docx',
  'MZC_AI_솔루션_가이드_Unique.docx',
  'MZC_AI_솔루션_가이드_Wandai.docx',
  '[공통] AI도입_요구사항_질의서.docx'
]);

app.get('/docs/:filename', authenticateToken, (req, res) => {
  const filename = String(req.params.filename || '');
  if (filename !== path.basename(filename) || !downloadableDocs.has(filename)) {
    return res.status(404).send('Not found');
  }
  res.set('Cache-Control', 'private, no-store');
  res.attachment(filename);
  return res.sendFile(filename, {
    root: path.join(__dirname, 'docs'),
    dotfiles: 'deny'
  }, (error) => {
    if (!error) return;
    if (!res.headersSent) {
      res.status(error.statusCode === 404 ? 404 : 500).send('Document unavailable');
    } else {
      res.end();
    }
  });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' });
  }
  return res.status(404).send('Not found');
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` ISSU AI Radar Server running on http://localhost:${PORT}`);
  console.log(` APP_SURFACE: ${APP_SURFACE}`);
  console.log(` OPINION_EXPOSE_POLICY: ${OPINION_EXPOSE_POLICY}`);
  console.log(` BUILD: ${BUILD_VERSION}  (started ${STARTED_AT})`);
  console.log(`====================================================`);
});

const shutdown = (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received. Closing HTTP and database connections.`);

  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  const closeActiveConnections = setTimeout(() => {
    server.closeAllConnections?.();
  }, 5000);
  closeActiveConnections.unref();

  void hubRouter.dispose().catch((error) => {
    console.error('Failed to close hub event listener:', error.message);
  }).finally(() => {
    server.close(async (serverError) => {
      try {
        await pool.end();
      } catch (poolError) {
        console.error('Failed to close PostgreSQL pool:', poolError.message);
      } finally {
        clearTimeout(closeActiveConnections);
        clearTimeout(forceExit);
        process.exit(serverError ? 1 : 0);
      }
    });
    server.closeIdleConnections?.();
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
