-- 051. 배포 인계 (STEP06)
--
-- ChatGPT Deployment Brief Template §A 는 14필드를 요구하는데, 이 시스템이 이미 아는
-- 것은 절반뿐이다(진단·구성·문의 제품·전제). 나머지는 **미팅에서만 알 수 있다.**
-- 여기서 그 나머지를 받는다.
--
-- ⚠ **문서1 전체(11 섹션·수십 개 표)를 받지 않는다.** 입력란이 100개를 넘으면 아무도
--   안 채우고, 안 채워진 문서는 없는 것과 같다. 문서2 §A 가 스스로 「최소 근거
--   패키지」라고 부르는 14필드를 목표로 **여섯 칸만** 새로 받는다. 나머지는 이미 아는
--   값에서 끌어오거나 인터뷰 가이드 질문으로 돌린다.
--
-- ⚠ **컬럼을 늘리지 않고 jsonb 한 칸에 둔다.** 문서 규격이 아직 v1.0 이라 필드가
--   바뀔 수 있다. 필드마다 컬럼을 만들면 규격이 한 번 바뀔 때마다 마이그레이션이 는다.
--
-- ⚠ **값과 근거를 같이 담는다.** { value, quote } 모양이다. quote 는 050 의 인용
--   앵커(quote·note_id·met_on)라 「이 값이 어느 미팅에서 나왔나」를 되짚을 수 있다.
--   값만 남기면 인계받은 사람이 전부 다시 물어야 한다.
--
-- ⚠ **stage 제약을 0~5 로 넓힌다.** 배포 인계는 피치 준비 다음 단계다. 단계로 두어야
--   041 의 정체 시계(stage_changed_at)와 목록 필터가 그대로 작동한다. 기존 딜은 전부
--   0~4 라 넓히는 것만으로 안전하다 — 좁히는 게 아니라서 되돌릴 수도 있다.
--
-- 컬럼 하나와 제약 완화. apply-migrations.js 에 넣어도 안전하다.

begin;

alter table deals add column if not exists handoff jsonb not null default '{}'::jsonb;

comment on column deals.handoff is
  '배포 인계(STEP06). Deployment Brief §A 가 요구하는데 시스템이 모르는 여섯 칸 + 사용사례 품질 6기준. 모양은 {필드: {value, quote}} 이고 quote 는 050 의 인용 앵커다 — 값만 남기면 인계받은 사람이 전부 다시 묻는다. 컬럼이 아니라 jsonb 인 이유는 문서 규격이 v1.0 이라 아직 바뀌기 때문이다';

-- stage 제약을 0~5 로. 이름이 환경마다 다를 수 있어(inline check 는 자동 명명)
-- 정의로 찾아 지운다. 못 찾으면 아무것도 안 하고 아래에서 새로 건다.
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
   where conrelid = 'public.deals'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%stage%0 AND 5%' limit 1;
  if cname is not null then return; end if;          -- 이미 넓혀져 있다

  select conname into cname from pg_constraint
   where conrelid = 'public.deals'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%stage%' limit 1;
  if cname is not null then
    execute format('alter table public.deals drop constraint %I', cname);
  end if;
  alter table public.deals add constraint deals_stage_check check (stage between 0 and 5);
end $$;

commit;

-- 확인
-- 1) 컬럼과 제약.
select column_name, data_type from information_schema.columns
 where table_schema = current_schema() and table_name = 'deals' and column_name = 'handoff';
select conname, pg_get_constraintdef(oid) as "제약"
  from pg_constraint where conrelid = 'public.deals'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%stage%';
--
-- 2) 기존 딜은 전부 빈 객체다. 소급해서 채우지 않는다 —
--    미팅에서만 알 수 있는 값이라 시스템이 지어낼 수 없다.
select count(*) as "딜", count(*) filter (where handoff = '{}'::jsonb) as "인계 미입력"
  from deals where deleted_at is null;
--
-- 3) 인계 준비도. 여섯 칸 중 몇 개가 찼는지 — 「진행 가능」 판정의 근거가 된다.
select customer,
       (select count(*) from jsonb_each(handoff) e
         where e.value ->> 'value' is not null and e.value ->> 'value' <> '') as "채워진 칸",
       (select count(*) from jsonb_each(handoff) e where e.value ? 'quote') as "근거 있는 칸"
  from deals where deleted_at is null and handoff <> '{}'::jsonb
 order by 2 desc limit 20;
