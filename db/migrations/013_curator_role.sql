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
create or replace function is_catalog_editor() returns boolean as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.approved and p.role in ('admin', 'curator')
  );
$$ language sql stable security definer;

comment on function is_catalog_editor() is 'admin 또는 curator (카탈로그 편집 권한)';

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
select unnest(enum_range(null::app_role)) as roles;
select role, count(*) from profiles group by role order by role;
