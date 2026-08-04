-- 031. 딜에 42문항 준비도 응답 담기
--
-- /readiness 진단 결과가 상담 요청과 함께 들어와 딜에 남는다. 영업이 허브에서
-- "이 고객이 6축 어디가 약한지" 를 그대로 본다.
--
-- ⚠ fqa_scores(21문항)와 별도 컬럼이다. 두 문항집은 다른 질문에 답한다 —
--   42 는 "회사가 AI 를 얼마나 하고 있나", 21 은 "이 제품을 지금 살 수 있나".
--   다만 030 의 bridge 로 겹치는 13개는 42 에서 21 로 자동 채워진다. 나머지 8개는
--   영업이 채운다.
--
-- 스키마만 바꾸므로 apply-migrations.js 에 넣어도 안전하다.

begin;

alter table deals add column if not exists readiness_scores jsonb not null default '{}'::jsonb;
alter table deals add column if not exists readiness_totals jsonb not null default '{}'::jsonb;

comment on column deals.readiness_scores is
  '42문항 응답 원본 {"S1":3,...}. 고객이 /readiness 에서 답한 값';
comment on column deals.readiness_totals is
  '축별 집계와 성숙도 {"average":2.93,"maturity":{...},"areas":[...],"fqaFilled":[3,7,...]}. 화면이 다시 계산하지 않도록 서버 계산 결과를 그대로 담는다. fqaFilled 는 bridge 로 자동 채워진 21문항 번호 — 접수 시점 기준으로 굳혀 둔다';

create index if not exists idx_deals_has_readiness
  on deals ((readiness_scores <> '{}'::jsonb)) where readiness_scores <> '{}'::jsonb;

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name, data_type from information_schema.columns
 where table_schema = current_schema() and table_name = 'deals'
   and column_name in ('readiness_scores','readiness_totals');
--
-- 2) 42문항으로 들어온 딜과 그 축 점수.
select customer,
       readiness_totals -> 'average'            as "종합",
       readiness_totals -> 'maturity' ->> 'name' as "성숙도",
       jsonb_array_length(coalesce(readiness_totals -> 'areas', '[]'::jsonb)) as "축",
       (select count(*) from jsonb_object_keys(readiness_scores)) as "응답"
  from deals where readiness_scores <> '{}'::jsonb order by updated_at desc limit 10;
--
-- 3) bridge 로 자동 채워진 21문항이 몇 개인가. 13개여야 한다.
select d.customer,
       jsonb_array_length(coalesce(d.readiness_totals -> 'fqaFilled', '[]'::jsonb)) as "자동 채움",
       21 - jsonb_array_length(coalesce(d.readiness_totals -> 'fqaFilled', '[]'::jsonb)) as "영업 입력 필요"
  from deals d where d.readiness_scores <> '{}'::jsonb order by d.updated_at desc limit 10;
