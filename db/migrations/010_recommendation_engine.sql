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
