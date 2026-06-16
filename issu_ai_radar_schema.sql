-- =====================================================================
-- ISSU AI Radar — Supabase schema (DDL)
-- 실행: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행
-- 순서: 1) 이 schema.sql  →  2) seed.sql (솔루션 데이터)
-- =====================================================================

-- ---- Extensions -----------------------------------------------------
create extension if not exists vector;        -- pgvector (RAG, 추후 사용)
-- gen_random_uuid() 는 pgcrypto/내장 제공 (Supabase 기본 활성)

-- ---- Enums ----------------------------------------------------------
do $$ begin
  create type app_role as enum ('admin','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type solution_status as enum ('draft','published');
exception when duplicate_object then null; end $$;

-- ---- profiles : auth.users 와 1:1, 역할/승인 관리 -------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  team        text,                         -- Sales / Tech / Pre-Sales / Data&AI
  role        app_role not null default 'viewer',
  approved    boolean  not null default false,
  created_at  timestamptz default now()
);

-- ---- solutions : SSOT 본체 (한 행 = 한 솔루션) ----------------------
create table if not exists solutions (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    int,                          -- 기존 isv_data.js id 보존
  slug         text unique not null,         -- URL 식별자 (예: openai-enterprise)
  name         text not null,
  delivery     text,                         -- SaaS/API, API(Bedrock), SW(On-prem/Airgap) ...
  layer        text,                         -- L1 / L2 / L3 / L4
  synergy      text,                         -- 매우 높음 / 높음 / 보통 ...
  category     text,
  jtbd         text,
  value_chain  text,
  sections     jsonb not null default '{}'::jsonb,  -- {"1":"...", ... "8":"..."}
  opinion      text,                         -- MZC 내부 의견 (노출정책: 하단 NOTE 참조)
  status       solution_status not null default 'published',
  version      int not null default 1,
  updated_by   uuid references profiles(id),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_solutions_layer  on solutions(layer);
create index if not exists idx_solutions_status on solutions(status);

-- ---- solution_versions : 편집 이력 / 롤백 --------------------------
create table if not exists solution_versions (
  id          bigint generated always as identity primary key,
  solution_id uuid references solutions(id) on delete cascade,
  snapshot    jsonb not null,               -- 변경 직전 solutions 행 스냅샷
  editor      uuid references profiles(id),
  created_at  timestamptz default now()
);

-- ---- audit_log : 조회/검색/편집 기록 (관리 agent 소스) -------------
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references profiles(id),
  action     text not null,                 -- view | search | edit | publish
  target     text,                          -- 솔루션 slug 등
  query      text,                          -- 검색/질의 텍스트
  created_at timestamptz default now()
);

-- ---- solution_chunks : RAG 인덱스 (추후 임베딩 적재) ---------------
-- embedding 차원은 임베딩 모델에 맞춤: text-embedding-3-small=1536, -large=3072
create table if not exists solution_chunks (
  id          bigint generated always as identity primary key,
  solution_id uuid references solutions(id) on delete cascade,
  section_no  text,                          -- '1'..'8'
  content     text not null,
  embedding   vector(1536),
  created_at  timestamptz default now()
);
-- 임베딩 적재 후 인덱스 생성 권장 (HNSW)
-- create index on solution_chunks using hnsw (embedding vector_cosine_ops);

-- =====================================================================
-- updated_at 자동 갱신 트리거
-- =====================================================================
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_solutions_updated on solutions;
create trigger trg_solutions_updated
  before update on solutions
  for each row execute function set_updated_at();

-- =====================================================================
-- RLS (Row Level Security) — 역할 강제
-- =====================================================================
create or replace function is_approved() returns boolean as $$
  select exists(select 1 from profiles p where p.id = auth.uid() and p.approved);
$$ language sql security definer stable;

create or replace function is_admin() returns boolean as $$
  select exists(select 1 from profiles p
                where p.id = auth.uid() and p.approved and p.role = 'admin');
$$ language sql security definer stable;

-- solutions: 승인 사용자만 published 열람, admin은 전체 + 쓰기
alter table solutions enable row level security;

drop policy if exists sol_select on solutions;
create policy sol_select on solutions for select
  using ( is_approved() and (status = 'published' or is_admin()) );

drop policy if exists sol_insert on solutions;
create policy sol_insert on solutions for insert with check ( is_admin() );

drop policy if exists sol_update on solutions;
create policy sol_update on solutions for update using ( is_admin() );

drop policy if exists sol_delete on solutions;
create policy sol_delete on solutions for delete using ( is_admin() );

-- profiles: 본인 행 읽기, admin 전체 읽기
alter table profiles enable row level security;
drop policy if exists prof_self on profiles;
create policy prof_self on profiles for select using ( id = auth.uid() or is_admin() );

-- versions / audit / chunks: admin 읽기 (필요 시 정책 확장)
alter table solution_versions enable row level security;
drop policy if exists ver_admin on solution_versions;
create policy ver_admin on solution_versions for all using ( is_admin() ) with check ( is_admin() );

alter table audit_log enable row level security;
drop policy if exists audit_admin on audit_log;
create policy audit_admin on audit_log for select using ( is_admin() );
-- audit insert 는 서버/서비스 롤로 적재 (RLS 우회) 권장

alter table solution_chunks enable row level security;
drop policy if exists chunk_read on solution_chunks;
create policy chunk_read on solution_chunks for select using ( is_approved() );

-- =====================================================================
-- NOTE — opinion 필드 노출 정책 (이전 논의의 결정 포인트)
--  (A) Viewer 전원 공개  : 추가 작업 없음 (현재 스키마)
--  (B) Admin 전용        : 아래 뷰를 만들어 앱은 viewer에게 이 뷰만 노출
--
--  create view solutions_public as
--    select id, legacy_id, slug, name, delivery, layer, synergy, category,
--           jtbd, value_chain, sections, status, version, updated_at,
--           case when is_admin() then opinion else null end as opinion
--    from solutions;
-- =====================================================================
