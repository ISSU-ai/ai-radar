-- 047. 레퍼런스·사례
--
-- 미팅에서 반드시 나오는 질문인데 지금 저장소 어디에도 없다. 영업이 매번 기억으로
-- 말하거나 못 말한다.
--
-- ⚠ 표 이름이 references 가 아닌 이유: SQL 예약어라(외래키 구문) 모든 쿼리에서
--   따옴표를 써야 하고, 한 번이라도 빼먹으면 그 자리에서 문법 오류가 난다.
--
-- ⚠ **고객사 실명은 승인 없이 못 쓴다.** 그래서 실명(customer_name)과 익명 표기
--   (customer_label)를 **다른 컬럼**에 두고, is_named 가 false 면 API 가 실명을
--   **아예 안 내려보낸다.** 화면에서 숨기는 방식이면 언젠가 어느 화면이 실수한다 —
--   list_price 의 quote 처리, 피치의 내부 불릿 필터와 같은 규칙이다.
--
-- ⚠ 이 내용은 **고객용 키트에 들어간다.** 그래서 「우리가 무엇을 했나」까지만 쓰고
--   마진·단가·내부 판단을 쓰지 않는다. 그런 이야기는 solutions.opinion 자리다.
--
-- 매칭이 0건이면 **아무것도 안 붙인다.** 억지로 붙인 사례가 안 붙인 것보다 나쁘다 —
-- 고객이 "이게 우리랑 무슨 상관이죠" 라고 물으면 그 뒤 문서 전체를 안 믿는다.
--
-- 표만 만든다. 내용은 /admin 에서 넣는다. apply-migrations.js 에 넣어도 안전하다.

begin;

create table if not exists case_studies (
  id            text primary key,
  headline      text not null,                    -- 한 줄. 목록과 문서에 그대로 나간다
  industry      text,                             -- taxonomy.js 의 SFDC 코드
  offering_id   text,                             -- 01~05. 없으면 오퍼링 무관
  package_ids   text[] not null default '{}',     -- P01~P05·STARTER
  isv_slugs     text[] not null default '{}',      -- 매칭에 쓴다
  situation     text,                             -- 고객이 처해 있던 상황
  what_we_did   text,                             -- 우리가 한 것
  outcome       text,                             -- 결과. 숫자가 있으면 숫자로
  is_named      boolean not null default false,   -- 실명 공개 승인 여부
  customer_name text,                             -- 승인받은 실명. is_named=false 면 안 나간다
  customer_label text not null default '',        -- 익명 표기. 예: '금융권 A사'
  status        text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table case_studies is
  '레퍼런스·사례. 고객용 문서에 들어가므로 마진·단가·내부 판단을 쓰지 않는다';
comment on column case_studies.is_named is
  '실명 공개 승인 여부. false 면 API 가 customer_name 을 아예 안 내려보낸다 — 화면에서 숨기는 방식은 언젠가 어느 화면이 실수한다';
comment on column case_studies.customer_label is
  '익명 표기. 예: 금융권 A사. is_named 와 무관하게 항상 채운다 — 승인이 취소돼도 문서가 안 깨진다';
comment on column case_studies.outcome is
  '결과. 지어낸 숫자를 쓰지 않는다. 확인 안 된 것은 비워 두는 편이 낫다';

create index if not exists idx_case_studies_live
  on case_studies (industry, sort_order) where status = 'published';

-- 실명을 쓰겠다고 했으면 이름이 있어야 하고, 익명 표기는 언제나 있어야 한다.
-- 승인이 취소돼 is_named 를 내렸을 때 문서에 빈칸이 뜨는 것을 막는다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'case_studies_naming_check') then
    alter table case_studies add constraint case_studies_naming_check
      check ((not is_named or coalesce(customer_name, '') <> '')
             and (status <> 'published' or customer_label <> ''));
  end if;
end $$;

alter table case_studies enable row level security;

drop policy if exists case_studies_read on case_studies;
create policy case_studies_read on case_studies for select using (is_approved());

drop policy if exists case_studies_write on case_studies;
create policy case_studies_write on case_studies for all
  using (is_catalog_editor()) with check (is_catalog_editor());

commit;

-- 확인
-- 1) 표가 생겼는가.
select column_name, data_type from information_schema.columns
 where table_schema = current_schema() and table_name = 'case_studies'
 order by ordinal_position;
--
-- 2) 아직 비어 있다. /admin 「레퍼런스」 탭에서 넣는다.
--    비어 있어도 화면은 정상이다 — 매칭 0건이면 아무것도 안 붙는다.
select count(*) as "사례", count(*) filter (where status = 'published') as "발행됨" from case_studies;
--
-- 3) ⚠ 실명이 승인 없이 들어간 행이 있으면 안 된다. 0건이어야 한다.
select id, headline from case_studies
 where coalesce(customer_name, '') <> '' and not is_named;
