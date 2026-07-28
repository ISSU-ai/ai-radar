-- 슬롯 대분류(domain). 3단 계층의 맨 위 한 단.
-- Run after 014. Apply in the Supabase SQL Editor (dfbx).
--
--   대분류 domain   6개    ← 이 파일
--     중분류 slot   23개   ← 011
--       소분류      개별 솔루션
--
-- 솔루션에는 아무것도 추가하지 않는다. 슬롯이 정해지면 대분류가 자동으로 따라오므로
-- 입력 부담이 없고 드리프트도 없다. category 가 22종에 20값으로 망가진 전철을
-- 밟지 않기 위한 선택이다.
--
-- layer 와는 다른 축이다. 서로 대체할 수 없다.
--   layer  = 누구의 어떤 일을 돕는가 (전사범용 / 도메인 / 개발 / 인프라 / 데이터기반)
--   domain = 무엇에 관한 기술인가   (데이터 / AI / 보안 / 운영)
-- L4 한 레이어가 ai-infra·security·ops 셋으로 갈린다. Zscaler(보안)와
-- New Relic(관측)이 같은 L4 지만 영업 대화에서는 전혀 다른 주제다. 반대로 security 는
-- 앞으로 데이터 보안 제품이 들어오면 L0 에도 생긴다.

begin;

create table if not exists solution_domains (
  id         text primary key,
  name       text not null,
  sort_order int  not null default 0,
  note       text
);

comment on table solution_domains is '슬롯 대분류. 탐색·필터·커버리지 요약의 상위 단위';

insert into solution_domains (id, name, sort_order, note) values
  ('data',     '데이터 기반',       10, 'AI 성능의 전제가 되는 수집·저장·가상화 계층'),
  ('ai-app',   'AI 애플리케이션',   20, '업무에 직접 쓰이는 AI 제품'),
  ('ai-dev',   'AI 개발·분석',      30, '개발자·데이터과학자·시민DS 도구'),
  ('ai-infra', 'AI 인프라·연결',    40, '모델 호출·에이전트 오케스트레이션'),
  ('security', '보안·거버넌스',     50, 'AI 트래픽 통제와 사용 가시성'),
  ('ops',      '운영·관측',         60, '성능·비용·파이프라인 운영')
on conflict (id) do update set
  name = excluded.name, sort_order = excluded.sort_order, note = excluded.note;

alter table solution_slots add column if not exists domain text references solution_domains(id);
comment on column solution_slots.domain is '대분류. 슬롯을 통해 솔루션의 대분류가 결정된다';

-- 23개 슬롯 전부 배정한다. 일부만 채우면 그룹핑에 구멍이 생기고, 전부 채워도
-- 슬롯당 한 줄이라 비용 차이가 없다.
update solution_slots set domain = v.domain from (values
  -- 데이터 기반 (L0)
  ('data-platform',           'data'),
  ('data-integration',        'data'),
  ('data-virtualization',     'data'),
  ('vector-store',            'data'),
  ('graph-db',                'data'),
  -- AI 애플리케이션 (L1·L2)
  ('llm-platform',            'ai-app'),
  ('private-domain-platform', 'ai-app'),
  ('business-app-agent',      'ai-app'),
  ('vertical-agent',          'ai-app'),
  ('media-intelligence',      'ai-app'),
  ('voice-ai',                'ai-app'),
  ('3d-generation',           'ai-app'),
  -- AI 개발·분석 (L3)
  ('ds-ml-platform',          'ai-dev'),
  ('ai-coding-env',           'ai-dev'),
  ('nocode-agent-builder',    'ai-dev'),
  ('python-governance',       'ai-dev'),
  -- AI 인프라·연결 (L4)
  ('llm-gateway',             'ai-infra'),
  ('agent-orchestration',     'ai-infra'),
  -- 보안·거버넌스 (L4)
  ('security-gateway',        'security'),
  ('ai-usage-governance',     'security'),
  -- 운영·관측 (L4)
  ('observability',           'ops'),
  ('mlops',                   'ops'),
  ('finops',                  'ops')
) as v(slot, domain) where solution_slots.id = v.slot;

-- solutions.category 는 분류 기능을 못 한다(22종에 고유값 20개). 분류는 slot·domain 이
-- 맡고, category 는 "그 제품이 뭔지" 한 줄 설명으로 남긴다. 컬럼은 그대로 둔다 —
-- /radar 표와 필터가 쓰고 있고, 지금 값들이 실제로 설명 역할을 하고 있다.
comment on column solutions.category is '제품 한 줄 설명(자유서술). 분류는 slot·domain 을 쓸 것';

alter table solution_domains enable row level security;
revoke all on solution_domains from anon, authenticated;

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
-- 1) 대분류가 안 붙은 슬롯. 0건이어야 한다.
select id, name, layer from solution_slots where domain is null order by sort_order;

-- 2) 대분류별 슬롯 수와 실제 후보 수. 어디가 비었는지 한눈에 본다.
select d.name as "대분류",
       count(distinct s.id)                                as "슬롯",
       count(sol.id) filter (where sol.is_archived = false) as "후보",
       count(sol.id) filter (where sol.is_archived = false
             and jsonb_array_length(sol.fqa_coverage) > 0)  as "판정데이터"
  from solution_domains d
  left join solution_slots s on s.domain = d.id
  left join solutions sol    on sol.slot = s.id
 group by d.id, d.name, d.sort_order
 order by d.sort_order;

-- 3) 주요 솔루션의 3단 계층 확인
select sol.name as "솔루션", d.name as "대분류", s.name as "중분류(슬롯)", sol.layer
  from solutions sol
  join solution_slots s   on s.id = sol.slot
  join solution_domains d on d.id = s.domain
 where sol.slug in ('openai-enterprise','articul8','portal26','check-point',
                    'zscaler','new-relic','anthropic-claude','litellm')
 order by d.sort_order, sol.name;
