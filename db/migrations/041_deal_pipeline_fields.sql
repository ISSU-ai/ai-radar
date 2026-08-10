-- 041. 딜 확장 필드 8종 + 단계 정체 시계 + 딜 삭제
--
-- CXM 유입 말고 코어세일즈가 문의해서 들어오는 계약이 늘었는데 허브가 그 흐름을
-- 못 담고 있었다. 필드가 없어서 세 가지 판단을 못 한다.
--   · 누가 MSP 고객인지 몰라 "MSP 부터 친다" 는 우선순위를 못 세운다
--   · 유입은 오래됐는데 단계가 안 넘어가는 딜(= F/U 대상)을 셀 수가 없다
--   · 고객 담당자가 어느 부서 어떤 레벨인지 몰라 Top-down 딜인지 판단이 안 되고
--     코어세일즈와 싱크업할 상대도 모른다
-- 그리고 잘못 만든 딜·스팸 리드를 치울 방법이 아예 없었다.
--
-- ⚠ 040 은 미적용 보류 상태다. 040 은 fqa 컬럼을 **drop** 하고 041 은 새 컬럼을
--   **add** 한다 — 겹치는 대상이 0 이라 순서에 무관하다. 040 을 기다리지 말고
--   적용해도 되고, 040 을 영원히 안 돌려도 041 은 정상이다.
--
-- ⚠ 개인정보 4종(customer_contact_*)은 leads 의 담당자 정보와 **다른 출처**다.
--   leads 것은 고객이 동의와 함께 남긴 원본이고, 이건 영업이 미팅에서 확인한 값이다.
--   리드 행이 없는 manual·sheet 딜에도 붙어야 해서 leads 에 둘 수 없다.
--   027 의 금지는 「자유형 jsonb 금지」였다 — 명명 컬럼은 information_schema 로
--   열거되고 주석이 붙고 한 줄로 일괄 삭제된다. customer_meta 로는 그 셋 다 못 한다.
--   결정적으로 GET /api/hub/deals 는 컬럼을 **명시적으로 적어야만** 내보내므로
--   기본값이 「안 나감」이다. jsonb 는 반대다.
--   이번 판은 고객 대면 진단 폼(readiness.html)과 개인정보 고지 문구를 건드리지
--   않는다. 딜의 4종은 영업 입력분이고, 고지 개정은 별도 검토다.
--
-- ⚠ 삭제는 soft 다. leads.promoted_deal 이 on delete 절 없이 NO ACTION 이라
--   포탈 딜 hard delete 는 23503 으로 실패한다. 리드를 고아로 만들거나 같이 지우면
--   동의 이력이 깨진다. 다만 삭제 시 customer_contact_* 4종은 null 로 지운다 —
--   아무 화면에도 안 보이는 행에 개인정보를 영구 보관하는 쪽이 더 나쁘다.
--
-- ⚠ stage_changed_at 은 default 를 **나중에** 건다. 한 줄로 default now() 를 주면
--   PG11+ 의 missing-value 최적화가 기존 행까지 채워 「전 딜이 방금 단계 이동」이
--   된다. 그러면 정체 기능이 첫날부터 거짓말을 한다.
--
-- 스키마 + 빈 값 백필이라 apply-migrations.js 에 넣어도 안전하다(032 와 같은 근거).

begin;

-- ── ① 딜 관리 (MZC) ──────────────────────────────────────────────
alter table deals add column if not exists mzc_sales  text;
alter table deals add column if not exists msp_status text not null default 'unknown';

-- boolean 이 아닌 이유: null/false 를 「MSP 아님」으로 읽으면 조용히 틀린다.
-- if (deal.msp) 한 줄에서 「확인 필요」가 「아님」이 되면 MSP 고객을 우선순위에서
-- 놓치는데, 그게 이 요청이 잡으려던 실패 그 자체다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_msp_status_check') then
    alter table deals add constraint deals_msp_status_check
      check (msp_status in ('yes', 'no', 'unknown'));
  end if;
end $$;

alter table deals add column if not exists inquiry_date date;

-- ── ② 고객 담당자 (개인정보 · 영업 입력분) ───────────────────────
alter table deals add column if not exists customer_contact_name  text;
alter table deals add column if not exists customer_contact_dept  text;
alter table deals add column if not exists customer_contact_title text;
alter table deals add column if not exists customer_contact_email text;

-- ── ③ 문의 제품 ──────────────────────────────────────────────────
alter table deals add column if not exists inquiry_products jsonb not null default '[]'::jsonb;

-- ── ④ 단계 정체 시계 ─────────────────────────────────────────────
-- updated_at 으로는 못 잰다. trg_deals_updated 가 모든 UPDATE 에 붙어 있고 화면이
-- 타이핑 700ms 마다 PATCH 를 쏜다 — 메모만 고쳐도 오늘이 되어 모든 딜이 늘 신선해
-- 보인다. 단계가 실제로 바뀔 때만 PATCH 라우트가 이 값을 넣는다.
alter table deals add column if not exists stage_changed_at timestamptz;
alter table deals alter column stage_changed_at set default now();

-- ── ⑤ 삭제 ───────────────────────────────────────────────────────
alter table deals add column if not exists deleted_at timestamptz;
alter table deals add column if not exists deleted_by uuid references profiles(id);

-- 목록은 살아 있는 딜만 최근순으로 훑는다.
create index if not exists idx_deals_live
  on deals (updated_at desc) where deleted_at is null;

comment on column deals.mzc_sales is
  '담당 코어세일즈(MZC 내부 인원). 딜 라우팅·싱크업용이며 우선순위 신호가 아니다';
comment on column deals.msp_status is
  'MSP 진행 여부 yes|no|unknown. 기본 unknown — 모르는 것을 "아님"으로 읽으면 우선순위에서 놓친다';
comment on column deals.inquiry_date is
  '문의가 들어온 날. 정체(F/U) 판정의 기준값. 비면 화면이 created_at 을 쓰되 라벨을 「등록」으로 바꾼다';
comment on column deals.customer_contact_name is
  '고객 담당자 이름. 개인정보 — 영업이 딜에서 직접 입력한 값이며 leads(동의 이력)와 다른 출처다. 목록 API 에 싣지 않는다. 딜 삭제 시 customer_contact_* 4종을 함께 null 로 지운다';
comment on column deals.customer_contact_dept is
  '고객 담당자 소속 부서. 개인정보 — customer_contact_name 과 같은 규칙';
comment on column deals.customer_contact_title is
  '고객 담당자 직함. Top-down 딜 판단용. 개인정보 — customer_contact_name 과 같은 규칙';
comment on column deals.customer_contact_email is
  '고객 담당자 이메일. 개인정보 — customer_contact_name 과 같은 규칙';
comment on column deals.inquiry_products is
  '고객이 문의한 제품 [solution_id, ...]. isv_combo(우리가 제안한 조합)와 다르다 — 문의 ≠ 제안';
comment on column deals.stage_changed_at is
  '단계가 마지막으로 바뀐 시각. PATCH 라우트가 stage 변경 시에만 넣는다. null 이면 041 이전 딜이라 화면이 단계 시계를 그리지 않는다';
comment on column deals.deleted_at is
  '삭제 시각(soft). leads.promoted_deal FK 때문에 hard delete 를 못 한다. 읽는 쿼리는 전부 deleted_at is null 을 건다';
comment on column deals.deleted_by is
  '삭제한 사람. 되돌리려면 관리자가 deleted_at 을 null 로 되돌린다 — 복구 UI 는 만들지 않았다';

-- ── 백필 (전부 빈 값에만 — 다시 돌려도 안전) ─────────────────────

-- 포탈 딜은 접수 시각이 곧 문의 시점이다. 수동·시트 딜은 영업이 직접 적는다 —
-- 언제 문의가 왔는지 우리가 모르는데 만든 날짜로 때우면 정체 계산이 틀어진다.
update deals
   set inquiry_date = (created_at at time zone 'Asia/Seoul')::date
 where source = 'portal' and inquiry_date is null;

-- customer_meta.contact 를 새 컬럼으로 옮긴다. 그 칸은 리드 이메일이 미리 채워진
-- 편집 가능 입력이라 영업이 한 글자만 건드려도 개인정보가 jsonb 로 복사됐다.
-- ⚠ 이메일 모양인 것만 옮긴다. 전화번호나 "내선 301" 이 들어 있는 행은 어느 칸에
--   가야 하는지 모르므로 추측하지 않고 남긴다. 아래 확인 3) 이 그 행을 뽑는다.
update deals
   set customer_contact_email = customer_meta ->> 'contact'
 where customer_meta ->> 'contact' like '%@%'
   and coalesce(customer_contact_email, '') = '';

update deals
   set customer_meta = customer_meta - 'contact'
 where customer_meta ->> 'contact' like '%@%';

commit;

-- 확인
-- 1) 컬럼 12개가 생겼는가.
select column_name, data_type
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'deals'
   and column_name in ('mzc_sales','msp_status','inquiry_date',
                       'customer_contact_name','customer_contact_dept',
                       'customer_contact_title','customer_contact_email',
                       'inquiry_products','stage_changed_at','deleted_at','deleted_by')
 order by column_name;
--
-- 2) 포탈 딜의 문의 시점이 채워졌는가. portal 은 0 이어야 하고 나머지는 남아 있어도 정상이다.
select source, count(*) as "딜", count(*) filter (where inquiry_date is null) as "문의시점 없음"
  from deals group by source order by source;
--
-- 3) ⚠ 손으로 옮겨야 할 행 — customer_meta.contact 에 이메일이 아닌 값이 남았다.
--    0건이면 화면의 「이전 연락처 (이관 대상)」 줄도 안 뜬다.
select id, customer, customer_meta ->> 'contact' as "남은 값"
  from deals where customer_meta ? 'contact' order by updated_at desc;
--
-- 4) MSP 는 전부 unknown 이어야 정상이다. 영업이 채우기 전이다.
select msp_status, count(*) from deals group by msp_status;
--
-- 5) 단계 시계는 전부 null 이어야 정상이다. 다음 단계 이동부터 채워진다.
--    여기서 값이 있으면 default 가 기존 행에 먹은 것이니 되돌려야 한다.
select count(*) filter (where stage_changed_at is null) as "null (정상)",
       count(*) filter (where stage_changed_at is not null) as "채워짐 (비정상)"
  from deals;
