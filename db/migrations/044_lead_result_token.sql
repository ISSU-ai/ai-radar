-- 044. 진단 결과를 다시 열 수 있는 링크
--
-- 접수하면 Slack 이 영업에게만 가고 고객 쪽으로는 아무것도 안 갔다. 42문항을 다 답하고
-- 연락처까지 남긴 가장 뜨거운 순간에 우리가 먼저 보내는 것이 없다.
--
-- 결과를 다시 볼 수 있는 주소를 준다. 메일 본문에 넣을 링크이고, 발송 수단이 붙기
-- 전까지는 접수 성공 화면에서 바로 보여 준다.
--
-- ⚠ **인증 없이 열리는 주소다.** 그래서 셋을 지킨다.
--   ① 토큰은 uuid v4(122비트). 리드 id 를 재사용하지 않는다 — 그건 접수 응답의
--      reference 로 이미 나가 있어 용도가 섞인다.
--   ② 유효기간은 개인정보 보유기간(1년)과 맞춘다. 지난 링크는 열리지 않는다.
--   ③ 응답에 담당자 이름·전화·이메일을 싣지 않는다. 회사명과 진단 결과까지다.
--
-- ⚠ 결과는 저장된 집계가 아니라 **고객 원본 응답(deals.readiness_customer_scores)**
--   으로 그때그때 다시 채점한다. 032 가 그 칸을 만든 이유가 여기서 살아난다 —
--   영업이 허브에서 점수를 고쳐도 고객이 받은 링크의 숫자는 안 바뀐다.
--
-- 컬럼만 추가한다. 값은 기본값이 채우므로 apply-migrations.js 에 넣어도 안전하다.

begin;

-- ⚠ gen_random_uuid() 는 volatile 이라 기존 행마다 **다른 값**이 들어간다.
--   041 의 stage_changed_at 과 반대로 여기서는 그게 맞다 — 이미 들어온 리드도
--   각자 자기 링크를 갖는다.
alter table leads add column if not exists result_token uuid not null default gen_random_uuid();

create unique index if not exists idx_leads_result_token on leads (result_token);

comment on column leads.result_token is
  '진단 결과를 다시 여는 공개 링크의 토큰(/r/:token). 인증 없이 열리므로 추측 불가능해야 한다. 유효기간은 created_at + 1년 — 개인정보 보유기간과 같다';

commit;

-- 확인
-- 1) 컬럼과 인덱스가 생겼는가.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'leads' and column_name = 'result_token';
--
-- 2) 모든 리드가 서로 다른 토큰을 갖는가. 두 숫자가 같아야 한다.
select count(*) as "리드", count(distinct result_token) as "서로 다른 토큰" from leads;
--
-- 3) 아직 유효한 링크가 몇 개인가. 만료된 것은 열리지 않는다.
select count(*) filter (where created_at > now() - interval '1 year') as "유효",
       count(*) filter (where created_at <= now() - interval '1 year') as "만료"
  from leads;
--
-- 4) 링크를 눈으로 확인하려면 (운영자용 — 고객에게 목록을 보여주지 않는다)
-- select customer, '/r/' || result_token as "결과 링크", created_at from leads order by created_at desc limit 5;
