-- ===================================================================
-- 통합 적용 스크립트 (자동 생성 — scripts/build-pending-sql.js)
--
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번에 실행합니다.
-- 파일을 직접 수정하지 마세요. 원본은 db/migrations/ 의 개별 파일입니다.
--
-- 포함: 010_recommendation_engine.sql → 011_slot_taxonomy_and_layer_fixes.sql → 012_seed_recommendation_rules.sql → 013_curator_role.sql
--
-- 실행 후 각 파일 끝의 검증 쿼리 결과를 눈으로 확인하세요.
--   011: 슬롯 미배정 0건 / 슬롯별 후보 수 / 레이어 정정 4건
--   012: 판정 데이터 9건 · 미보강 13건 · 깨진 slug 0건
--   013: enum 에 curator 포함 · 역할별 인원
-- ===================================================================

-- ═══════════════════════════════════════════════════════════════
-- ▼ 010_recommendation_engine.sql
-- ═══════════════════════════════════════════════════════════════

-- 추천 엔진 스키마 (STEP 03 ISV·패키지 추천).
-- Run after 009_internal_sections_and_price_flags.sql. Apply in the Supabase SQL Editor (dfbx).
--
-- 설계 근거: docs/planning/recommendation-engine-design.md
--
-- 핵심 구조는 "평면 순위"가 아니라 "슬롯 채우기"다.
--   22종(→44종)은 서로 비교 가능한 집합이 아니다. Eleven Labs 와 Zscaler 를 한 줄로
--   세우는 것은 의미가 없다. 그래서 solution_slots 로 "같은 자리를 놓고 경쟁하는가"를
--   먼저 나누고, 슬롯 안에서만 순위를 매긴다. 슬롯 22개 중 경쟁 슬롯은 9개뿐이고
--   나머지는 필요/불필요 이진 판정이다.
--
-- 판정은 3상태다: eligible(단독 추천) / bundle(전제를 다른 후보가 메움) / excluded.
--   전제 미충족을 그냥 탈락시키면 Portal26 은 SWG 미보유 고객에게 영원히 안 나온다.
--   실제 영업에서 그건 Zscaler+Portal26 을 함께 파는 기회다 — bundle 상태가 그걸 표현한다.

begin;

-- ── 슬롯(역할) 분류 ──────────────────────────────────────────────
-- 기존 category 컬럼은 22종에 20개 값을 가져 분류가 아니라 설명이다.
-- 슬롯은 별도로 둔다. 미등록 22종(Databricks/Snowflake/ServiceNow 등)까지
-- 수용하도록 44종 기준으로 설계했다 — 나중에 추가해도 재작업이 없다.
create table if not exists solution_slots (
  id             text primary key,
  name           text    not null,
  layer          text    not null,
  is_competitive boolean not null default false,
  note           text,
  sort_order     int     not null default 0
);

comment on table  solution_slots            is '솔루션 역할 분류. 같은 슬롯끼리만 순위 비교가 성립한다';
comment on column solution_slots.is_competitive is 'true=후보 2종 이상(가중치 정렬 필요). false=단독(필요/불필요 판정만)';

alter table solutions add column if not exists slot text references solution_slots(id);
comment on column solutions.slot is '역할 슬롯. null 이면 추천 후보에서 제외된다';

-- ── 추천 판정 근거 ───────────────────────────────────────────────
-- fqa_coverage  : 이 솔루션이 "메우는" 준비도 갭
-- prerequisites : 이 솔루션이 "요구하는" 조건. 메움과 요구가 같은 카테고리 안에
--                 공존할 수 있다(Portal26 은 A 를 메우면서 A 의 보안게이트웨이를 요구).
--                 이 구분이 없으면 "A 미달 → A 를 메우는 Portal26 추천" 이라는 틀린
--                 추천이 나간다. 실제로는 SWG 가 없어 설치 자체가 불가능하다.
-- red_flags     : 부적합 신호 + 대안 슬러그. §7.3 에 이미 손으로 적혀 있는 내용이다.
alter table solutions add column if not exists fqa_coverage     jsonb    not null default '[]'::jsonb;
alter table solutions add column if not exists prerequisites    jsonb    not null default '[]'::jsonb;
alter table solutions add column if not exists red_flags        jsonb    not null default '[]'::jsonb;
alter table solutions add column if not exists bundle_potential smallint check (bundle_potential between 1 and 3);

alter table packages  add column if not exists fqa_coverage  jsonb not null default '[]'::jsonb;
alter table packages  add column if not exists prerequisites jsonb not null default '[]'::jsonb;

comment on column solutions.fqa_coverage  is '메우는 갭 [{category,items[],strength 1-3}]';
-- prerequisites 는 3종이다. 실제 §7.1 을 뽑아보니 정량 임계값이 박혀 있었다
--   (OpenAI "최소 150명", Articul8 "연 1억 미만 부적합", Dataiku "5천만 이하 부적합").
--   kind=fqa     : FQA 항목 점수로 자동 판정. 실패 시 enabled_by 로 번들 생성
--   kind=numeric : seats / annual_budget_krw 등 수치 비교로 자동 판정
--   kind=manual  : 법무 검토·계약 의사 등 자동 판정 불가 → 영업이 STEP03 에서 확인
comment on column solutions.prerequisites is
  '요구 조건 [{kind:fqa|numeric|manual, category,item,min, field,min,max, label, enabled_by[], blocking}]';
-- 대안이 늘 카탈로그 안을 가리키지는 않는다. §7.3 실제 값에 "Azure OpenAI 국내 리전",
-- "ChatGPT Team", "Gemini API", "도입 보류", "OCR 구축 선행" 같은 카탈로그 밖 대안이 많다.
-- slug 는 있으면 링크, 없으면 label 만 표시한다.
comment on column solutions.red_flags     is
  '부적합 신호 [{signal, alternatives:[{slug?, label}]}]';
comment on column solutions.bundle_potential is '번들 확장성 1-3. 정렬 가중치. 실적 데이터가 쌓이면 multiplier 로 대체 예정';

-- ── 딜 쪽 ────────────────────────────────────────────────────────
-- FQA 는 랜딩 자가진단에서 먼저 들어오고(deals.fqa_scores, 원본은 leads.fqa_scores)
-- STEP02 에서 영업이 취합·수정한다. 그 검토가 실제로 있었는지 구분이 없으면
-- "고객 자가응답 그대로"와 "실사 반영"을 같은 신뢰도로 다루게 된다.
alter table deals add column if not exists fqa_reviewed_at      timestamptz;
alter table deals add column if not exists fqa_reviewed_by      uuid references profiles(id);
-- kind='manual' 전제(법무 검토, 계약 의사 등)는 자동 판정이 불가해 영업이 확인한다.
alter table deals add column if not exists prereq_confirmations jsonb not null default '{}'::jsonb;
-- 추천 시점의 입력·산출을 통째로 남긴다. 나중에 실제 채택(isv_combo)과 대조해
-- 기준을 튜닝하는 근거가 된다. 이게 없으면 2단계(유사 딜 성사율)로 못 넘어간다.
alter table deals add column if not exists recommendation_snapshot jsonb;

comment on column deals.fqa_reviewed_at      is 'STEP02 진단 확정 시각. 없으면 추천에 "고객 자가응답 기준 잠정" 라벨';
comment on column deals.prereq_confirmations is 'manual 전제 확인 결과 {solution_slug: {label: bool}}';
comment on column deals.recommendation_snapshot is '추천 실행 기록 {at, inputs, results[]}. 채택률 분석용';

-- ── 필터/정렬 설정 (admin 이 배포 없이 튜닝) ──────────────────────
create table if not exists recommendation_config (
  key     text primary key,
  kind    text    not null check (kind in ('filter', 'rank')),
  weight  numeric not null default 0,
  enabled boolean not null default true,
  note    text
);

comment on table recommendation_config is '필터 on/off 와 정렬 가중치. 코드 배포 없이 조정한다';

-- 초기값. budget 필터는 기본 OFF — 009 시점 모든 단가가 price_is_placeholder=true 라
-- 켜면 전 후보가 탈락한다. 실단가 확정 후 admin 이 켠다.
insert into recommendation_config (key, kind, weight, enabled, note) values
  ('status',       'filter', 0, true,  'status_op=paused / status<>published 제외'),
  ('gap_relevance','filter', 0, true,  'fqa_coverage 가 미달 카테고리를 하나도 안 건드리면 제외'),
  ('scale',        'filter', 0, true,  'scale 범위 밖 제외. 값 없으면 통과'),
  ('security_stack','filter',0, true,  'T-D(타사 SWG) 충돌 제외'),
  ('budget',       'filter', 0, false, '연 예상금액 > investment 상한 제외. 실단가 확정 후 ON'),
  ('industry',     'filter', 0, false, 'industries fit=low 제외. 데이터 희소로 기본 OFF'),
  ('gap_fit',      'rank',   0.40, true, '미달폭 × coverage.strength × 응답 신뢰도'),
  ('bundle',       'rank',   0.25, true, 'bundle_potential 1-3'),
  ('industry_fit', 'rank',   0.15, true, 'industries fit high=1.0 / mid=0.5 / 미지정=0.2'),
  ('synergy',      'rank',   0.10, true, '매우높음=1.0 / 높음=0.7 / 중=0.4'),
  ('grade',        'rank',   0.10, true, 'grade/3')
on conflict (key) do nothing;

-- ── 하드닝 (002 와 동일 원칙: 앱은 postgres 풀로만 접근) ──────────
alter table solution_slots        enable row level security;
alter table recommendation_config enable row level security;
revoke all on solution_slots        from anon, authenticated;
revoke all on recommendation_config from anon, authenticated;

commit;


-- ═══════════════════════════════════════════════════════════════
-- ▼ 011_slot_taxonomy_and_layer_fixes.sql
-- ═══════════════════════════════════════════════════════════════

-- 슬롯 분류표 시드 + 솔루션별 슬롯 배정 + 레이어 정정 4건.
-- Run after 010_recommendation_engine.sql. Apply in the Supabase SQL Editor (dfbx).
--
-- 슬롯은 카탈로그 22종이 아니라 44종 기준으로 정의한다. /radar 시뮬레이터가 추천하는
-- 36종 중 22종(Databricks/Snowflake/Denodo/ServiceNow/MZC AIR Platform 등)이 아직
-- 카탈로그에 없다. 2차 범위는 22종이지만, 슬롯을 22종에만 맞춰 짜면 그 22종을 넣는
-- 순간 재작업이 된다. 지금 비어 있는 슬롯은 후보 0으로 남겨둔다.

begin;

-- ── 슬롯 분류표 (22 슬롯) ────────────────────────────────────────
insert into solution_slots (id, name, layer, is_competitive, note, sort_order) values
  -- L0 Data Foundation : 카탈로그 미등록. 2차에서는 비어 있다.
  ('data-platform',           '통합 데이터·레이크하우스',   'L0', true,  'Databricks/Snowflake/Cloudera 미등록', 10),
  ('data-integration',        'ELT·스트리밍 수집',          'L0', true,  'Fivetran/Trocco/Confluent 미등록',     11),
  ('data-virtualization',     '데이터 가상화·MDM',          'L0', true,  'Denodo/Informatica 미등록',            12),
  ('vector-store',            '벡터·캐시 저장소',           'L0', true,  'Pinecone/Redis/Datastax 등 미등록',    13),
  ('graph-db',                '그래프 DB·GraphRAG',         'L0', false, null,                                   14),
  -- L1 Enterprise General Build AI
  ('llm-platform',            '범용 LLM 플랫폼',            'L1', true,  'Gemini Workspace/NC AI 미등록',        20),
  -- L2 Business Domain Build AI
  ('private-domain-platform', '폐쇄망·온프레미스 도메인 AI','L2', false, null,                                   30),
  ('business-app-agent',      '업무시스템 내장 에이전트',   'L2', true,  'ServiceNow/AgentForce/SAP Joule 미등록',31),
  ('vertical-agent',          '산업 특화 에이전트',         'L2', false, null,                                   32),
  ('media-intelligence',      '영상·미디어 이해',           'L2', false, null,                                   33),
  ('voice-ai',                '음성 합성·보이스 에이전트',  'L2', false, null,                                   34),
  ('3d-generation',           '3D 에셋 생성',               'L2', false, null,                                   35),
  -- L3 AI-native Works
  ('ds-ml-platform',          'DS/ML 통합 플랫폼',          'L3', true,  'Posit/KNIME 미등록',                   40),
  ('ai-coding-env',           'AI 코딩 환경',               'L3', false, null,                                   41),
  ('nocode-agent-builder',    '노코드 에이전트 빌더',       'L3', false, null,                                   42),
  ('python-governance',       'Python 패키지·공급망 거버넌스','L3',false, null,                                   43),
  -- L4 AI Infrastructure
  ('security-gateway',        '네트워크 보안·SWG',          'L4', true,  null,                                   50),
  ('ai-usage-governance',     'AI 사용 가시성·거버넌스',    'L4', false, 'Netskope/Prompt Security 미등록',      51),
  ('llm-gateway',             'LLM 호출 게이트웨이·라우팅', 'L4', false, null,                                   52),
  ('agent-orchestration',     '에이전트 오케스트레이션',    'L4', true,  'Temporal/MZC AIR Platform 미등록',     53),
  ('observability',           '관측성·APM',                 'L4', false, null,                                   54),
  ('mlops',                   'ML 파이프라인 운영',         'L4', false, null,                                   55),
  ('finops',                  '클라우드 비용 최적화',       'L4', false, null,                                   56)
on conflict (id) do update set
  name = excluded.name, layer = excluded.layer,
  is_competitive = excluded.is_competitive, note = excluded.note, sort_order = excluded.sort_order;

-- ── 솔루션별 슬롯 배정 (카탈로그 22종) ───────────────────────────
-- slug 가 다르면 조용히 0건 업데이트된다. 맨 아래 검증 쿼리로 누락을 확인할 것.
update solutions set slot = v.slot from (values
  ('openai-enterprise',  'llm-platform'),
  ('anthropic-claude',   'llm-platform'),
  ('ibm',                'llm-platform'),            -- ⚠ 검토 필요: 아래 주석 참조
  ('articul8',           'private-domain-platform'),
  ('unique',             'vertical-agent'),
  ('twelve-labs',        'media-intelligence'),
  ('eleven-labs',        'voice-ai'),
  ('meshyai',            '3d-generation'),
  ('replit',             'ai-coding-env'),
  ('dataiku',            'ds-ml-platform'),
  ('datarobot',          'ds-ml-platform'),
  ('h2o',                'ds-ml-platform'),
  ('wand-ai',            'nocode-agent-builder'),
  ('anaconda',           'python-governance'),
  ('zscaler',            'security-gateway'),
  ('check-point',        'security-gateway'),
  ('portal26',           'ai-usage-governance'),
  ('litellm',            'llm-gateway'),
  ('new-relic',          'observability'),
  ('cnvrg',              'mlops'),
  ('followerrabbit',     'finops'),
  ('tigergraph',         'graph-db')
) as v(slug, slot) where solutions.slug = v.slug;

-- ⚠ IBM 은 잠정 배정이다. layer=L1 이라 L1 슬롯인 llm-platform 에 넣었으나,
--   jtbd 가 "엔터프라이즈 거버넌스 AI"이고 category 가 "종합 AI/ML(watsonx)"라
--   실질은 ds-ml-platform(L3)에 가깝다. PreSales 판단 후 정정할 것.
--   ds-ml-platform 으로 옮긴다면 layer 도 L3 로 함께 바꿔야 일관된다.

-- ── 레이어 정정 4건 ──────────────────────────────────────────────
-- 007 이 넣은 placeholder 행의 레이어가 실제 역할과 어긋난다. 레이어를 트랙 적합도
-- 계산에 쓸 예정이라 엔진을 만들기 전에 고쳐야 한다.
--   L1 = Enterprise General Build AI (전사 범용 AI 생산성)
--   L4 = AI Infrastructure (에이전트 연결, RAG, 비용/보안 통제)
--   L0 = Data Foundation (수집·이동·저장·가상화)
update solutions set layer = 'L4' where slug = 'zscaler'        and layer <> 'L4'; -- SWG 는 전사 범용 AI 가 아니다
update solutions set layer = 'L4' where slug = 'check-point'    and layer <> 'L4'; -- 동일
update solutions set layer = 'L4' where slug = 'followerrabbit' and layer <> 'L4'; -- GCP 비용 최적화 = FinOps, 도메인 특화 AI 아님
update solutions set layer = 'L0' where slug = 'tigergraph'     and layer <> 'L0'; -- 그래프 DB = 데이터 기반 층

commit;

-- ── 검증 (SQL Editor 에서 결과를 눈으로 확인할 것) ────────────────
-- 1) 슬롯이 안 붙은 솔루션 = slug 불일치. 0건이어야 한다.
select slug, name, layer from solutions
 where is_archived = false and slot is null
 order by name;

-- 2) 슬롯별 후보 수. is_competitive 와 실제 후보 수가 어긋나면 분류를 손볼 것.
select s.id, s.layer, s.name, s.is_competitive, count(sol.id) as candidates
  from solution_slots s
  left join solutions sol on sol.slot = s.id and sol.is_archived = false
 group by s.id, s.layer, s.name, s.is_competitive, s.sort_order
 order by s.sort_order;

-- 3) 레이어 정정 결과
select slug, name, layer, slot from solutions
 where slug in ('zscaler','check-point','followerrabbit','tigergraph')
 order by slug;


-- ═══════════════════════════════════════════════════════════════
-- ▼ 012_seed_recommendation_rules.sql
-- ═══════════════════════════════════════════════════════════════

-- 추천 판정 데이터 시드 — 상세 작성된 9종.
-- Run after 011_slot_taxonomy_and_layer_fixes.sql. Apply in the Supabase SQL Editor (dfbx).
--
-- ⚠ 이 파일의 값은 sections §3.1 / §7.1 / §7.3 에서 뽑은 **초안**이다.
--   원문은 PreSales 가 작성한 산문이고, 여기 구조화한 것은 그 해석이다.
--   ISSU(ISV 담당부서)가 /admin 에서 검토·수정하는 것을 전제로 한다.
--   on conflict 없이 직접 update 하므로, ISSU 가 수정한 뒤 이 파일을 재실행하면 덮어쓴다.
--   1회성 시드로만 쓸 것 (apply-migrations.js 에서 제외).
--
-- 대상 9종만 넣는다. 나머지 13종은 sections 가 템플릿 껍데기(7종은 {name} 미치환)이거나
-- 아예 비어 있어(Trust Layer 4종) 뽑을 근거가 없다. 콘텐츠 보강 후 별도 시드한다.
--
-- FQA 카테고리
--   A 보안·거버넌스(6) : 데이터 분류와 민감도 기준 / 접근권한과 계정 체계 / 보안 게이트웨이 준비도
--                        / 감사 로그와 추적성 / 규제·컴플라이언스 검토 / 데이터 보존·삭제 정책
--   B 기술·연동(5)     : 업무 시스템 연동성 / 지식 소스 품질 / 개발·테스트 환경 / 확장성·성능 기준 / 모델·벤더 전환성
--   C 운영(5)          : 운영 책임자 지정 / 품질 평가 체계 / 장애 대응 체계 / 비용 모니터링 / 변경·배포 관리
--   D 비즈니스(5)      : 명확한 업무 문제 / 성과 KPI / 현업 오너십 / 변화관리·교육 / 예산·구매 준비도

begin;

-- ── OpenAI Enterprise ────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"D","items":["명확한 업무 문제"],"strength":2},
    {"category":"B","items":["지식 소스 품질"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"seats","min":150,"blocking":true,
     "label":"최소 도입 인원 150명 (ChatGPT Enterprise 기준)"},
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"SSO(Okta/Azure AD) 인프라"},
    {"kind":"fqa","category":"D","item":"현업 오너십","min":3,"blocking":false,
     "label":"AI 도입 총괄 챔피언 지정"},
    {"kind":"manual","label":"사내 데이터의 OpenAI 클라우드 전송에 법무·보안 승인","blocking":true},
    {"kind":"manual","label":"글로벌 DPA 표준안 수용 가능","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"외부 인터넷 100% 차단 에어갭 환경",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"의료 규정상 해외 서버 전송 절대 불가",
     "alternatives":[{"label":"Azure OpenAI 국내 리전"}]},
    {"signal":"50명 이하 소규모인데 Enterprise 등급 요구",
     "alternatives":[{"label":"ChatGPT Team"}]},
    {"signal":"연간 AI 예산 3천만원 이하 · 연동 개발비 없음",
     "alternatives":[{"label":"단순 SaaS 라이선스 구매"}]},
    {"signal":"사내 IdP(SSO) 없고 도입 계획도 없음",
     "alternatives":[{"label":"도입 보류 또는 정책 컨설팅 선행"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'openai-enterprise';

-- ── Articul8 ─────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"A","items":["데이터 분류와 민감도 기준","보안 게이트웨이 준비도"],"strength":3},
    {"category":"B","items":["지식 소스 품질"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"annual_budget_krw","min":100000000,"blocking":true,
     "label":"연간 예산 1억원 이상 (GPU 서버 구축비 포함)"},
    {"kind":"fqa","category":"D","item":"예산·구매 준비도","min":3,"blocking":true,
     "label":"GPU 서버 인프라(L40S/H100) 예산 확보"},
    {"kind":"fqa","category":"C","item":"운영 책임자 지정","min":3,"blocking":true,
     "label":"Kubernetes 관리 인프라 엔지니어"},
    {"kind":"manual","label":"도메인 학습용 사내 기밀 텍스트 데이터셋 최소 수만 건","blocking":true},
    {"kind":"manual","label":"외부망 차단 상태에서 보안 인증 라이선스 갱신 방안","blocking":true},
    {"kind":"manual","label":"MZC 프라이빗 인프라 SI 구축 계약 의사","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"연간 예산 1억원 미만 · GPU 서버 구축비 지출 불가",
     "alternatives":[{"label":"퍼블릭 Cloud RAG"}]},
    {"signal":"10명 이하 부서에서 경량 문서 작성·검색만 요구",
     "alternatives":[{"slug":"openai-enterprise","label":"퍼블릭 ChatGPT"}]},
    {"signal":"사내 문서 보안 등급 관리가 미비해 전 직원 노출 위험",
     "alternatives":[{"label":"보안 등급·권한 정리 선행"}]},
    {"signal":"온프레미스 실사·물리 서버 접속 일절 불허",
     "alternatives":[{"label":"도입 보류"}]},
    {"signal":"도메인 데이터가 전부 스캔 이미지·파편화 포맷",
     "alternatives":[{"label":"데이터 가공 프로젝트 선행"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'articul8';

-- ── Anthropic Claude ─────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"A","items":["규제·컴플라이언스 검토"],"strength":2},
    {"category":"B","items":["지식 소스 품질"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"AWS IAM 보안 정책 관리 엔지니어"},
    {"kind":"fqa","category":"A","item":"규제·컴플라이언스 검토","min":2,"blocking":true,
     "label":"입력 데이터 컴플라이언스 가이드라인 수립"},
    {"kind":"manual","label":"AWS Bedrock 활성화 가능한 엔터프라이즈 계정","blocking":true},
    {"kind":"manual","label":"RAG용 임베딩 모델 활성화 완료","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"퍼블릭 클라우드 인프라 활용 전면 금지 보안망",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"이미지·영상 생성이 주목적",
     "alternatives":[{"label":"OpenAI DALL·E 또는 Midjourney"}]},
    {"signal":"개발 리소스 전무 · 노코드 완제품 앱스토어만 요구",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"}]},
    {"signal":"최소 약정 거부 · 최저 TCO 만 요구",
     "alternatives":[{"label":"Gemini API 검토"}]},
    {"signal":"사내 문서가 전부 종이·스캔 이미지",
     "alternatives":[{"label":"OCR 구축 선행 컨설팅"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'anthropic-claude';

-- ── Twelve Labs ──────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["지식 소스 품질"],"strength":3},
    {"category":"D","items":["명확한 업무 문제"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"annual_budget_krw","min":10000000,"blocking":true,
     "label":"연간 예산 1천만원 이상"},
    {"kind":"fqa","category":"B","item":"개발·테스트 환경","min":3,"blocking":true,
     "label":"API 결과를 화면에 연동할 프론트엔드 개발 리소스"},
    {"kind":"manual","label":"동영상이 디지털 포맷(MP4/AVI)으로 스토리지에 확보","blocking":true},
    {"kind":"manual","label":"동영상 데이터의 외부 API 전송에 법무·보안 승인","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"비디오 데이터의 외부 퍼블릭 클라우드 반출 전면 불가",
     "alternatives":[{"label":"온프레미스 GPU 구축형 SI"}]},
    {"signal":"동영상 없이 콜센터 녹음(오디오)만 분석",
     "alternatives":[{"slug":"eleven-labs","label":"Eleven Labs"}]},
    {"signal":"연 예산 1천만원 미만 · 사내 동영상 10개 미만",
     "alternatives":[{"label":"도입 비추천 (Gemini 무료 테스트)"}]},
    {"signal":"카메라 화질 240p 수준으로 형체 식별 불가",
     "alternatives":[{"label":"카메라 하드웨어 업그레이드 선행"}]},
    {"signal":"사내 개발팀 부재 · 커스텀 화면 개발비 불가",
     "alternatives":[{"label":"MZC 자체 UI 패키지 동반 구축"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'twelve-labs';

-- ── Eleven Labs ──────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"D","items":["명확한 업무 문제"],"strength":2},
    {"category":"B","items":["업무 시스템 연동성"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"B","item":"개발·테스트 환경","min":3,"blocking":true,
     "label":"API 연동 백엔드 개발·서버 구축 리소스"},
    {"kind":"fqa","category":"D","item":"예산·구매 준비도","min":3,"blocking":true,
     "label":"연간 음성 합성 통화량에 맞는 정기 구독 예산"},
    {"kind":"manual","label":"상담 시나리오·지식베이스(Text) 구축 완료","blocking":true},
    {"kind":"manual","label":"AICC 연동을 위한 SIP 또는 WebRTC 표준 지원","blocking":true},
    {"kind":"manual","label":"목소리 복제 대상 화자의 사용·학습 동의서 확보","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"동의 없는 유명인 목소리 복제·상업 배포 의도",
     "alternatives":[{"label":"원천 도입 거절 (라이선스 위반)"}]},
    {"signal":"인터넷 연결 불허 폐쇄망 콜센터 환경",
     "alternatives":[{"label":"온프레미스 TTS 솔루션"}]},
    {"signal":"텍스트 상담만 필요하고 음성 불필요",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"}]},
    {"signal":"음성 지연 0.1초 이하 실시간 중계 요건",
     "alternatives":[{"label":"지연 시간 한계로 부적합"}]},
    {"signal":"사내 지식 데이터 부재로 환각 위험 큼",
     "alternatives":[{"label":"지식베이스 RAG 구축 프로젝트 선행"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'eleven-labs';

-- ── Replit ───────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["개발·테스트 환경"],"strength":3}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"manual","label":"사내 소스코드의 외부 SaaS 저장·실행에 법무·보안 제약 없음","blocking":true},
    {"kind":"manual","label":"Replit Agent 가 사내 API·DB 에 접근할 퍼블릭/하이브리드 엔드포인트","blocking":true},
    {"kind":"manual","label":"동시 편집·Git 버전관리 연계 워크플로우 준비","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"100% 온프레미스 에어갭 내에서만 코드 작성·저장 가능",
     "alternatives":[{"slug":"articul8","label":"Articul8 기반 프라이빗 인프라"}]},
    {"signal":"하드웨어 리소스(GPU 분산 학습)를 직접 통제하며 딥러닝 코드 작성",
     "alternatives":[{"slug":"dataiku","label":"Dataiku"},{"slug":"datarobot","label":"DataRobot"}]}
  ]'::jsonb,
  bundle_potential = 2
where slug = 'replit';

-- ── Dataiku ──────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"C","items":["품질 평가 체계","변경·배포 관리"],"strength":2},
    {"category":"B","items":["지식 소스 품질","개발·테스트 환경"],"strength":2},
    {"category":"D","items":["현업 오너십"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"annual_budget_krw","min":50000000,"blocking":true,
     "label":"연간 AI·데이터 도구 예산 5천만원 초과"},
    {"kind":"fqa","category":"B","item":"지식 소스 품질","min":3,"blocking":true,
     "label":"학습에 연결할 사내 정형 데이터(DB/DW) 준비"},
    {"kind":"fqa","category":"C","item":"운영 책임자 지정","min":3,"blocking":true,
     "label":"플랫폼을 리드할 데이터 분석가·기획자 3명 이상"},
    {"kind":"fqa","category":"D","item":"예산·구매 준비도","min":3,"blocking":true,
     "label":"설치용 클라우드 VM 인프라 예산·DW 크레딧"},
    {"kind":"manual","label":"데이터 소스 연결을 위한 네트워크·클라우드 권한 승인","blocking":true},
    {"kind":"manual","label":"가드레일을 씌울 외부 LLM 라이선스 보유","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"분석할 정형 데이터가 전무하고 텍스트 RAG 챗봇만 요구",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"},{"label":"MZC AIR Platform"}]},
    {"signal":"연간 AI·데이터 예산 5천만원 이하 소기업",
     "alternatives":[{"label":"도입 보류 (오픈소스 Python 도구)"}]},
    {"signal":"데이터 연동 API 포트 오픈을 보안 규정상 전면 불허",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"결측치 90% 이상으로 예측 모델 학습 불가",
     "alternatives":[{"label":"데이터 가공 프로젝트 선행"}]},
    {"signal":"데이터 담당자 전무 · 100% 외주 영구 운영 대행 요구",
     "alternatives":[{"label":"도입 비추천"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'dataiku';

-- ── LiteLLM ──────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"C","items":["비용 모니터링"],"strength":3},
    {"category":"B","items":["모델·벤더 전환성"],"strength":3},
    {"category":"A","items":["접근권한과 계정 체계","데이터 분류와 민감도 기준"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"seats","min":10,"blocking":false,
     "label":"AI 사용 직원 10명 이상 (미만이면 실익 없음)"},
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"API 호출 권한을 통제할 IT 전산 관리자"},
    {"kind":"fqa","category":"D","item":"예산·구매 준비도","min":2,"blocking":true,
     "label":"프록시 서버 호스팅 클라우드 VM 예산"},
    {"kind":"manual","label":"연동 조율할 LLM 모델 API 2개 이상 존재","blocking":true},
    {"kind":"manual","label":"사내 AI 개발 표준을 OpenAI SDK 규격으로 통일할 의지","blocking":true},
    {"kind":"manual","label":"MZC AI 인프라·비용 통제 컨설팅 파트너십 동의","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"LLM 이 하나뿐이고 확대 계획 없음 · 사용 직원 10명 미만",
     "alternatives":[{"label":"도입 비추천 (원천 불필요)"}]},
    {"signal":"프록시 서버 설치 거부 · 노코드 완제품만 요구",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"},{"label":"MZC AIR Platform"}]},
    {"signal":"외부 인터넷 AI 호출 전면 금지 국방·망분리 환경",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"프록시 경유 1ms 지연조차 허용 불가한 초고속 연산",
     "alternatives":[{"label":"다이렉트 API 호출"}]},
    {"signal":"개발진이 표준 API 규격 사용을 거부",
     "alternatives":[{"label":"개발 거버넌스 선행"}]}
  ]'::jsonb,
  bundle_potential = 2
where slug = 'litellm';

-- ── Anaconda ─────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["개발·테스트 환경"],"strength":3},
    {"category":"A","items":["데이터 분류와 민감도 기준"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"C","item":"운영 책임자 지정","min":3,"blocking":true,
     "label":"패키지·레포지토리 정책을 관리할 시스템 관리자 지정"},
    {"kind":"manual","label":"사내 Python/R 사용량과 패키지 다운로드 규모가 상당","blocking":true},
    {"kind":"manual","label":"망분리 규정이 있어 외부 패키지 직접 호출을 통제해야 함","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"단독 AI 에이전트·LLM 빌드만 요구하고 거버넌스 니즈 없음",
     "alternatives":[{"slug":"dataiku","label":"Dataiku"}]},
    {"signal":"Python 기반 분석·ML 을 하지 않고 순수 Java/C# 레거시만 보유",
     "alternatives":[{"label":"도입 비추천"}]}
  ]'::jsonb,
  bundle_potential = 2
where slug = 'anaconda';

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
-- 1) 판정 데이터가 들어간 솔루션 (9건이어야 한다)
select slug, name, slot,
       jsonb_array_length(fqa_coverage)  as coverage,
       jsonb_array_length(prerequisites) as prereqs,
       jsonb_array_length(red_flags)     as flags,
       bundle_potential
  from solutions
 where is_archived = false and jsonb_array_length(fqa_coverage) > 0
 order by name;

-- 2) 아직 비어 있는 솔루션 = 콘텐츠 보강 대상 (13건이어야 한다)
select slug, name, slot from solutions
 where is_archived = false and jsonb_array_length(fqa_coverage) = 0
 order by name;

-- 3) red_flags 가 가리키는 slug 가 실재하는지 (0건이어야 한다)
select s.slug as from_slug, alt->>'slug' as missing_target
  from solutions s,
       jsonb_array_elements(s.red_flags) rf,
       jsonb_array_elements(rf->'alternatives') alt
 where alt->>'slug' is not null
   and not exists (select 1 from solutions t where t.slug = alt->>'slug');


-- ═══════════════════════════════════════════════════════════════
-- ▼ 013_curator_role.sql
-- ═══════════════════════════════════════════════════════════════

-- curator 역할 추가 — ISSU(ISV 담당부서)가 카탈로그를 직접 관리하기 위한 역할.
-- Run after 012. Apply in the Supabase SQL Editor (dfbx).
--
-- 지금까지 역할은 admin|viewer 둘뿐이라, ISSU 담당자에게 카탈로그 편집을 주려면
-- admin 을 줘야 했다. admin 은 회원 승인·실단가 확정·롤백까지 가능해 과하다.
--
--   viewer   영업 전원. hub 딜 작업 + 추천 소비 + 카탈로그 읽기
--   curator  ISSU. 솔루션 등록·수정·발행, 판정 데이터 입력, 내부 본문(opinion/
--            sections_internal) 열람·편집. 회원 승인·실단가 확정·롤백은 불가
--   admin    시스템 관리. 전부
--
-- ⚠ ALTER TYPE ... ADD VALUE 는 같은 트랜잭션 안에서 그 값을 사용할 수 없다.
--   그래서 enum 추가만 단독으로 먼저 실행하고, 값을 쓰는 구문은 뒤에 둔다.

alter type app_role add value if not exists 'curator';

-- ── 여기부터는 enum 추가가 커밋된 뒤에 실행된다 ────────────────────

begin;

comment on type app_role is 'viewer=영업(hub 사용자) / curator=ISSU 카탈로그 관리 / admin=시스템 관리';

-- RLS 정책 중 role='admin' 을 직접 보는 것이 있으면 curator 도 통과시켜야 한다.
-- 앱은 postgres 풀(owner)로 접근해 RLS 를 우회하므로 런타임 영향은 없지만,
-- PostgREST 등으로 직접 붙는 경로가 생길 때를 대비해 정의를 맞춰둔다.
-- role 을 text 로 캐스팅해 비교한다. enum 리터럴로 쓰면 함수 생성 시점에 'curator' 가
-- 이미 커밋돼 있어야 해서, 이 파일을 다른 마이그레이션과 한 배치로 붙여 실행할 때
-- "unsafe use of new value of enum type" 으로 실패할 수 있다.
create or replace function is_catalog_editor() returns boolean as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.approved and p.role::text in ('admin', 'curator')
  );
$$ language sql stable security definer;

comment on function is_catalog_editor() is 'admin 또는 curator (카탈로그 편집 권한)';

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
select unnest(enum_range(null::app_role)) as roles;
select role, count(*) from profiles group by role order by role;

