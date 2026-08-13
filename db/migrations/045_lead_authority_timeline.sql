-- 045. 상담 폼에 직함과 도입 시기
--
-- BANT 로 보면 지금 둘이 비어 있었다.
--   Budget    customer_meta.investment  ✅
--   Authority —                          ❌  ← 직함
--   Need      42문항 + 상담 내용          ✅✅
--   Timeline  —                          ❌  ← 도입 시기
--
-- 「입력 항목이 많으면 이탈한다」는 통념과 달리 **상세히 다 기입하는 고객이 고관여**
-- 라는 판단으로 바뀌었다. 42문항을 끝까지 답한 사람에게 두 칸을 더 받는다.
--
-- ⚠ **직함은 개인정보다.** 027 규약대로 customer_meta 가 아니라 leads 에 컬럼으로
--   둔다 — leads 는 동의 이력을 갖는 표이고, 개인정보는 동의와 같은 자리에 있어야
--   보유기간 만료 시 함께 지운다. customer_meta 에 두면 deals 로 흘러가 어디까지
--   퍼졌는지 추적할 수 없다.
--
-- ⚠ **도입 시기는 개인정보가 아니다.** 영업이 딜에서 쓰는 값이라 customer_meta 로
--   간다(규모·업종과 같은 취급). 컬럼을 만들지 않는다.
--
-- ⚠ **개인정보 고지를 같이 고쳤다.** 수집 항목에 「직함」과 「도입 시기」를 넣고
--   PRIVACY_NOTICE.version 을 올린다(routes/hub.js). 항목만 늘리고 고지를 안 고치면
--   동의 범위를 벗어난다 — 027 이 같은 실수를 한 번 지적해 뒀다.
--   이 마이그레이션 이후 접수분은 새 version 으로 동의 이력이 남는다.
--
-- ⚠ 041 의 deals.customer_contact_title 과 **출처가 다르다.**
--   leads.contact_title        고객이 폼에서 직접 낸 것
--   deals.customer_contact_title  영업이 미팅에서 확인한 것
--   섞으면 "고객이 그렇게 말했다" 와 "영업이 그렇게 안다" 를 구분할 수 없다.
--   화면은 포탈 원본을 읽기 전용으로 보여주고 딜 쪽은 따로 편집한다.
--
-- 컬럼만 추가한다. apply-migrations.js 에 넣어도 안전하다.

begin;

alter table leads add column if not exists contact_title text;

comment on column leads.contact_title is
  '담당자 직함. 개인정보 — 동의 이력과 같은 표에 둔다(027). Top-down 딜인지 판단하는 신호다. 영업이 미팅에서 확인한 값은 deals.customer_contact_title 로 따로 간다';

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name from information_schema.columns
 where table_schema = current_schema() and table_name = 'leads'
   and column_name in ('contact_name', 'contact_phone', 'contact_title')
 order by column_name;
--
-- 2) 고지 버전이 갈리는 지점. 새 버전으로 들어온 건이 생기면 여기서 보인다.
select consent_version, count(*) as "건수",
       count(contact_title) as "직함 있음",
       min(created_at)::date as "처음", max(created_at)::date as "마지막"
  from leads group by consent_version order by min(created_at);
--
-- 3) 도입 시기는 customer_meta 로 들어간다(컬럼 아님). 딜에서 확인한다.
select customer, customer_meta ->> 'timeline' as "도입 시기", created_at::date
  from deals where customer_meta ? 'timeline' order by created_at desc limit 10;
