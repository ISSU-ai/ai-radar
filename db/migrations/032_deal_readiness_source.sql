-- 032. 고객이 답한 원본을 따로 보존한다
--
-- 031 에서 deals.readiness_scores 는 고객 응답 전용이었다. 이제 허브 STEP02 가
-- 42문항으로 바뀌면서 영업도 같은 칸을 고친다 — 수동·시트로 만든 딜에는 응답이
-- 아예 없어 영업이 채워야 진단이 성립하기 때문이다.
--
-- 그래서 두 칸으로 가른다.
--   readiness_customer_scores  고객이 포탈에서 답한 원본. 접수 때 한 번 쓰고 안 바꾼다
--   readiness_scores           현재 유효한 값. 영업이 고칠 수 있다
--
-- 가르지 않으면 영업이 한 번 고친 순간 "고객이 뭐라고 답했는지" 를 되찾을 방법이
-- 없다. 제안 근거가 고객 응답인지 영업 추정인지 구분이 안 되면 고객 앞에서 못 쓴다.
--
-- 스키마만 바꾸므로 apply-migrations.js 에 넣어도 안전하다.

begin;

alter table deals add column if not exists readiness_customer_scores jsonb not null default '{}'::jsonb;

comment on column deals.readiness_customer_scores is
  '고객이 /readiness 에서 답한 원본 42문항. 접수 시점에 굳으며 영업이 고칠 수 없다. 현재 값은 readiness_scores 를 본다';

-- 031 로 이미 들어온 딜은 그때 값이 곧 고객 원본이다.
update deals
   set readiness_customer_scores = readiness_scores
 where readiness_scores <> '{}'::jsonb
   and readiness_customer_scores = '{}'::jsonb;

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name from information_schema.columns
 where table_schema = current_schema() and table_name = 'deals'
   and column_name like 'readiness%';
--
-- 2) 영업이 고친 문항이 몇 개인가. 고객 원본과 현재 값의 차이다.
select customer,
       (select count(*) from jsonb_object_keys(readiness_customer_scores)) as "고객 응답",
       (select count(*) from jsonb_object_keys(readiness_scores))          as "현재 응답",
       (select count(*)
          from jsonb_each_text(readiness_scores) cur
         where readiness_customer_scores ? cur.key
           and readiness_customer_scores ->> cur.key <> cur.value)         as "영업 수정"
  from deals
 where readiness_scores <> '{}'::jsonb or readiness_customer_scores <> '{}'::jsonb
 order by updated_at desc limit 10;
