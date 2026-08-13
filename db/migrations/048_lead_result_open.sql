-- 048. 결과 링크 열람 기록
--
-- 044 가 만든 /r/:token 이 이미 링크라 여기서 확장한다.
-- 「보냈는데 안 열었다」와 「열었는데 3주째 안 움직인다」는 다른 상황이고 다음 행동이
-- 다르다 — 041 의 정체 시계(inquiry_date · stage_changed_at)와 물려서 쓴다.
--
-- ⚠ **이벤트 로그를 만들지 않는다.** IP·User-Agent·열람별 행을 남기지 않고 요약 셋만
--   둔다. 딜 하나에 「처음 · 마지막 · 몇 번」이면 영업이 판단하는 데 충분하고, 그 이상은
--   개인 행동 추적이 된다. 고지에 쓸 수 없는 것을 저장하지 않는 편이 안전하다.
--
-- ⚠ **열람은 페이지가 아니라 API 호출로 센다.** 기업 메일 게이트웨이(Defender
--   SafeLinks·Proofpoint 류)가 링크를 미리 열어 보는데, 그건 JS 를 실행하지 않는다.
--   /r/:token(정적 HTML)에서 세면 고객이 열지도 않은 메일이 전부 「열람」이 되고,
--   숫자가 "고객이 봤다" 는 거짓말을 한다. 화면이 결과를 실제로 받아 간 순간만 센다.
--
-- ⚠ 개인정보 고지를 같이 고쳤다 — 수집 항목에 「진단 결과 열람 기록(횟수·시각)」을
--   넣고 PRIVACY_NOTICE.version 을 v3 으로 올린다(routes/hub.js · readiness.html).
--   045 와 같은 규칙이다. 항목만 늘리고 고지를 안 고치면 동의 범위를 벗어난다.
--
-- 컬럼 이름에 result_ 를 붙인 것은 044 의 result_token 과 한 묶음이라서다.
-- opened_at 만 있으면 무엇을 연 것인지 반년 뒤에 알 수 없다.
--
-- 컬럼만 추가한다. apply-migrations.js 에 넣어도 안전하다.

begin;

alter table leads add column if not exists result_opened_at timestamptz;
alter table leads add column if not exists result_last_opened_at timestamptz;
alter table leads add column if not exists result_open_count int not null default 0;

comment on column leads.result_opened_at is
  '결과 링크를 처음 연 시각. null 이면 아직 안 열었다 — **「보내지 않았다」와 구분되지 않는다.** 발송 수단이 붙기 전까지 화면은 「미열람」까지만 말한다';
comment on column leads.result_last_opened_at is
  '마지막으로 연 시각. 다시 열어 본 것은 강한 신호라 처음과 따로 둔다';
comment on column leads.result_open_count is
  '연 횟수. 30분 안의 재조회는 같은 한 번으로 본다(새로고침·뒤로가기). 이벤트 로그는 남기지 않는다 — 요약 셋을 넘어가면 개인 행동 추적이다';

-- 「보냈는데 안 열린」 건을 찾는 쿼리가 주 용도라 부분 인덱스로 충분하다.
create index if not exists idx_leads_result_unopened
  on leads (created_at) where result_opened_at is null;

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name, data_type from information_schema.columns
 where table_schema = current_schema() and table_name = 'leads'
   and column_name like 'result_%' order by column_name;
--
-- 2) 기존 리드는 전부 미열람이다. 소급해서 채울 방법이 없다 —
--    없는 기록을 0 이 아닌 무엇으로도 만들지 않는다.
select count(*) as "리드",
       count(result_opened_at) as "열람",
       count(*) filter (where result_opened_at is null) as "미열람"
  from leads;
--
-- 3) F/U 대상. 링크는 있는데 아직 안 열린 건을 오래된 순으로.
select customer, created_at::date as "접수", result_token is not null as "링크"
  from leads where result_opened_at is null and created_at > now() - interval '1 year'
 order by created_at limit 20;
--
-- 4) 다시 열어 본 건. 재열람은 관심이 살아 있다는 신호라 따로 본다.
select customer, result_open_count as "횟수",
       result_opened_at::date as "처음", result_last_opened_at::date as "마지막"
  from leads where result_open_count > 1 order by result_last_opened_at desc limit 20;
