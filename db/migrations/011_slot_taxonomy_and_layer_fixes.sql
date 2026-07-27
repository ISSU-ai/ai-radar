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
