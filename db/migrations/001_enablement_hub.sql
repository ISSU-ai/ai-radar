-- ISSU Enablement Hub / AI Radar extension
-- Target: Supabase PostgreSQL (run after issu_ai_radar_schema.sql)

begin;

create table if not exists focal_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org text,
  vendor_scope text,
  assigned_at timestamptz default now()
);

alter table solutions add column if not exists grade int;
alter table solutions add column if not exists scale text;
alter table solutions add column if not exists focal_id uuid references focal_contacts(id);
alter table solutions add column if not exists tech_note text;
alter table solutions add column if not exists status_op text default 'active';
alter table solutions add column if not exists note text;
alter table solutions add column if not exists is_archived boolean not null default false;
alter table solutions add column if not exists simulator_mappings jsonb not null default '[]'::jsonb;
alter table solutions add column if not exists industries jsonb not null default '[]'::jsonb;

do $$ begin
  alter table solutions add constraint solutions_grade_check check (grade between 0 and 3);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table solutions add constraint solutions_scale_check check (scale is null or scale in ('S','M','L','O'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table solutions add constraint solutions_status_op_check check (status_op in ('active','paused','draft'));
exception when duplicate_object then null; end $$;

create table if not exists fqa_items (
  id serial primary key,
  category text not null,
  no int not null unique,
  name text not null,
  weight int not null default 1 check (weight between 1 and 5),
  detail text,
  fix text,
  threshold numeric(3,2) not null default 3.0,
  status text not null default 'active' check (status in ('active','paused','draft'))
);

create table if not exists tracks (
  id text primary key,
  name text not null,
  why text,
  warn text,
  ask jsonb not null default '[]'::jsonb
);

create table if not exists packages (
  id text primary key,
  name text not null,
  scale text,
  period text,
  target text,
  status text not null default 'active' check (status in ('active','paused','draft')),
  sort_order int not null default 0
);

create table if not exists package_items (
  id serial primary key,
  package_id text not null references packages(id) on delete cascade,
  type text not null default 'deliverable',
  label text not null,
  sort_order int not null default 0
);

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  customer text not null,
  customer_meta jsonb not null default '{}'::jsonb,
  fqa_scores jsonb not null default '{}'::jsonb,
  fqa_totals jsonb not null default '{}'::jsonb,
  track text references tracks(id),
  isv_combo jsonb not null default '[]'::jsonb,
  packages jsonb not null default '[]'::jsonb,
  stage int not null default 0 check (stage between 0 and 4),
  source text not null default 'manual' check (source in ('portal','manual','sheet')),
  owner_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deals_owner on deals(owner_id);
create index if not exists idx_deals_stage on deals(stage);
create index if not exists idx_deals_updated on deals(updated_at desc);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  customer text not null,
  contact text not null,
  fqa_scores jsonb not null default '{}'::jsonb,
  message text,
  promoted_deal uuid references deals(id),
  created_at timestamptz not null default now()
);

drop trigger if exists trg_deals_updated on deals;
create trigger trg_deals_updated before update on deals
  for each row execute function set_updated_at();

create or replace function notify_deal_change() returns trigger as $$
begin
  perform pg_notify(
    'deal_changes',
    json_build_object(
      'operation', tg_op,
      'id', coalesce(new.id, old.id),
      'stage', case when tg_op = 'DELETE' then old.stage else new.stage end,
      'updated_at', case when tg_op = 'DELETE' then old.updated_at else new.updated_at end
    )::text
  );
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists trg_deals_notify on deals;
create trigger trg_deals_notify after insert or update or delete on deals
  for each row execute function notify_deal_change();

-- Initial reference data. Replace copy with the approved FQA sheet before production.
insert into tracks (id, name, why, warn, ask) values
  ('T-A', '인프라 동반형', '보안·AI 기반을 함께 설계하는 확장형 딜입니다.', '인프라 선행 범위와 책임 경계를 먼저 고정하세요.', '["보안 인프라 신규 구축 범위는?","투자 의사결정자는 누구인가?"]'),
  ('T-B', '경량 도입형', '기존 환경을 활용해 빠르게 가치를 확인하는 딜입니다.', 'PoC 성공 기준과 확장 조건을 수치로 남기세요.', '["첫 적용 부서는?","90일 안에 확인할 KPI는?"]'),
  ('T-C', 'Zscaler 보유형', '기존 Zscaler 환경과의 연결을 전제로 분기하는 딜입니다.', '테넌트 정책과 프록시 제한을 기술 검증에 포함하세요.', '["현재 Zscaler 정책 소유자는?","예외 승인 절차는?"]'),
  ('T-D', '타사 SWG 검토형', '기존 타사 SWG와의 충돌을 먼저 검토해야 하는 딜입니다.', '중복 기능·우회 경로·로그 책임을 확인하기 전 견적을 잠그지 마세요.', '["현재 SWG 제품과 계약 기간은?","트래픽 우회가 가능한가?"]')
on conflict (id) do update set name = excluded.name, why = excluded.why, warn = excluded.warn, ask = excluded.ask;

insert into fqa_items (category, no, name, weight, detail, fix, threshold) values
  ('A', 1, '데이터 분류와 민감도 기준', 5, 'AI에 투입 가능한 데이터 범위가 정의되어 있나요?', '데이터 등급과 반출 기준을 먼저 합의합니다.', 3.5),
  ('A', 2, '접근권한과 계정 체계', 5, '사용자·관리자 권한이 분리되어 있나요?', 'SSO·RBAC 설계와 승인 흐름을 정리합니다.', 3.5),
  ('A', 3, '보안 게이트웨이 준비도', 4, 'AI 트래픽을 통제할 보안 경로가 있나요?', 'SWG·프록시·DLP 연계 방안을 검토합니다.', 3.5),
  ('A', 4, '감사 로그와 추적성', 4, '질의·응답·관리 변경 이력을 남길 수 있나요?', '중앙 로그와 보존 기간을 설계합니다.', 3.5),
  ('A', 5, '규제·컴플라이언스 검토', 5, '업종 규제와 내부 정책 검토가 완료됐나요?', '법무·보안 검토 체크리스트를 확정합니다.', 3.5),
  ('A', 6, '데이터 보존·삭제 정책', 3, '보존 기간과 삭제 책임이 정해져 있나요?', '데이터 수명주기 정책을 문서화합니다.', 3.5),
  ('B', 7, '업무 시스템 연동성', 4, '핵심 업무 시스템에 API로 연결할 수 있나요?', '우선 연동 대상과 인증 방식을 정합니다.', 3.0),
  ('B', 8, '지식 소스 품질', 4, '정확하고 최신인 사내 지식이 준비되어 있나요?', '문서 소유자와 갱신 주기를 지정합니다.', 3.0),
  ('B', 9, '개발·테스트 환경', 3, '격리된 개발·검증 환경이 있나요?', '샌드박스와 테스트 데이터를 준비합니다.', 3.0),
  ('B', 10, '확장성·성능 기준', 3, '예상 사용자와 응답시간 기준이 있나요?', '용량 산정과 부하 테스트 계획을 세웁니다.', 3.0),
  ('B', 11, '모델·벤더 전환성', 2, '특정 모델 종속을 통제할 수 있나요?', '모델 라우팅과 추상화 계층을 검토합니다.', 3.0),
  ('C', 12, '운영 책임자 지정', 5, '서비스 운영 책임자가 지정되어 있나요?', '운영 R&R과 에스컬레이션 체계를 확정합니다.', 3.0),
  ('C', 13, '품질 평가 체계', 4, '정확도·안전성 평가 기준이 있나요?', '평가셋과 합격 기준을 만듭니다.', 3.0),
  ('C', 14, '장애 대응 체계', 4, '장애 감지와 복구 절차가 있나요?', 'SLO·알림·복구 플레이북을 정의합니다.', 3.0),
  ('C', 15, '비용 모니터링', 3, '사용량과 비용을 추적할 수 있나요?', '예산 한도와 부서별 태깅을 적용합니다.', 3.0),
  ('C', 16, '변경·배포 관리', 3, '프롬프트·모델 변경을 통제하나요?', '승인·버전·롤백 절차를 만듭니다.', 3.0),
  ('D', 17, '명확한 업무 문제', 5, '해결할 업무와 현재 비용이 구체적인가요?', '사용자 여정과 기준선을 측정합니다.', 3.5),
  ('D', 18, '성과 KPI', 5, 'PoC 성공을 판정할 KPI가 있나요?', '정량 KPI와 측정 시점을 합의합니다.', 3.5),
  ('D', 19, '현업 오너십', 4, '현업 책임자와 핵심 사용자가 참여하나요?', '업무 오너와 챔피언을 지정합니다.', 3.5),
  ('D', 20, '변화관리·교육', 3, '사용자 교육과 도입 확산 계획이 있나요?', '역할별 교육과 커뮤니케이션을 준비합니다.', 3.5),
  ('D', 21, '예산·구매 준비도', 5, '예산 범위와 구매 일정이 정해져 있나요?', '의사결정 구조와 조달 일정을 확인합니다.', 3.5)
on conflict (no) do update set
  category = excluded.category, name = excluded.name, weight = excluded.weight,
  detail = excluded.detail, fix = excluded.fix, threshold = excluded.threshold;

insert into packages (id, name, scale, period, target, sort_order) values
  ('DISCOVERY', 'AI Opportunity Discovery', 'S', '2주', '우선 과제와 PoC 성공 기준 확정', 10),
  ('POC', 'Enterprise AI PoC', 'M', '4~6주', '핵심 유즈케이스 기술·업무 검증', 20),
  ('SECURITY', 'AI Security Readiness', 'M', '3~4주', '보안·컴플라이언스 통제 설계', 30),
  ('INTEGRATION', 'Knowledge & Workflow Integration', 'L', '6~10주', '사내 지식·업무 시스템 연결', 40),
  ('ADOPTION', 'Adoption & Change Enablement', 'M', '4주', '교육·확산·성과 측정 체계 구축', 50),
  ('OPERATE', 'Managed AI Operations', 'O', '상시', '품질·비용·장애 운영 체계 제공', 60)
on conflict (id) do update set
  name = excluded.name, scale = excluded.scale, period = excluded.period,
  target = excluded.target, sort_order = excluded.sort_order;

insert into package_items (package_id, type, label, sort_order)
select seed.package_id, seed.type, seed.label, seed.sort_order
from (values
  ('DISCOVERY','deliverable','유즈케이스 우선순위와 실행 로드맵',10),
  ('POC','deliverable','PoC 환경·평가 리포트·확장 권고안',10),
  ('SECURITY','deliverable','보안 아키텍처와 통제 체크리스트',10),
  ('INTEGRATION','deliverable','RAG·API 연동과 운영 이관 문서',10),
  ('ADOPTION','deliverable','역할별 교육과 도입 확산 키트',10),
  ('OPERATE','deliverable','SLO 대시보드와 월간 운영 리포트',10)
) as seed(package_id, type, label, sort_order)
where not exists (
  select 1 from package_items pi
  where pi.package_id = seed.package_id and pi.label = seed.label
);

-- RLS: public callers only write leads. Public read models are exposed as narrow views below.
alter table focal_contacts enable row level security;
alter table fqa_items enable row level security;
alter table tracks enable row level security;
alter table packages enable row level security;
alter table package_items enable row level security;
alter table deals enable row level security;
alter table leads enable row level security;

drop policy if exists focal_read on focal_contacts;
create policy focal_read on focal_contacts for select using (is_approved());
drop policy if exists focal_admin on focal_contacts;
create policy focal_admin on focal_contacts for all using (is_admin()) with check (is_admin());

drop policy if exists fqa_read on fqa_items;
create policy fqa_read on fqa_items for select using (is_approved());
drop policy if exists fqa_admin on fqa_items;
create policy fqa_admin on fqa_items for all using (is_admin()) with check (is_admin());

drop policy if exists track_read on tracks;
create policy track_read on tracks for select using (is_approved());
drop policy if exists track_admin on tracks;
create policy track_admin on tracks for all using (is_admin()) with check (is_admin());

drop policy if exists package_read on packages;
create policy package_read on packages for select using (is_approved());
drop policy if exists package_admin on packages;
create policy package_admin on packages for all using (is_admin()) with check (is_admin());
drop policy if exists package_item_read on package_items;
create policy package_item_read on package_items for select using (is_approved());
drop policy if exists package_item_admin on package_items;
create policy package_item_admin on package_items for all using (is_admin()) with check (is_admin());

drop policy if exists deals_select on deals;
create policy deals_select on deals for select using (is_approved());
drop policy if exists deals_insert on deals;
create policy deals_insert on deals for insert with check (is_approved() and (owner_id = auth.uid() or is_admin()));
drop policy if exists deals_update on deals;
create policy deals_update on deals for update
  using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());
drop policy if exists deals_delete on deals;
create policy deals_delete on deals for delete using (is_admin());

drop policy if exists leads_insert on leads;
create policy leads_insert on leads for insert with check (true);
drop policy if exists leads_read on leads;
create policy leads_read on leads for select using (is_approved());
drop policy if exists leads_admin_update on leads;
create policy leads_admin_update on leads for update using (is_admin()) with check (is_admin());

create or replace view offering_fqa_items as
  select id, category, no, name, detail from fqa_items where status = 'active';
create or replace view offering_tracks as
  select id, name, why from tracks;
create or replace view offering_packages as
  select id, name, period, target, sort_order from packages where status = 'active';

revoke all on fqa_items, tracks, packages, package_items, deals, focal_contacts from anon;
revoke all on leads from anon;
grant insert on leads to anon;
grant select on offering_fqa_items, offering_tracks, offering_packages to anon;

drop policy if exists prof_admin_update on profiles;
create policy prof_admin_update on profiles for update
  using (is_admin()) with check (is_admin());

-- Supabase Realtime publication (safe to re-run).
do $$ begin
  alter publication supabase_realtime add table deals;
exception when duplicate_object then null; end $$;

commit;
