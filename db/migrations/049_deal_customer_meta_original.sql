-- 049. 고객이 낸 맥락 원본
--
-- 내부 인계 문서를 쓰려다 구멍이 드러났다. 인계의 핵심은 「이 값을 고객이 말한 것이냐,
-- 우리가 적은 것이냐」인데 **지금은 대부분 구분할 수 없다.**
--
--   42문항        readiness_customer_scores  ✅ 032 가 원본을 따로 남겼다
--   업종·규모·대상  customer_meta               ❌ 접수분과 영업 수정분이 같은 칸
--   도입 시기      customer_meta.timeline      ❌ 위와 같다 (045)
--   보안 게이트웨이 customer_meta.securityStack ❌ 애초에 영업이 확인하는 칸
--
-- 구분이 안 되면 인계받은 사람이 **전부 다시 물어봐야 한다.** 그러면 인계 문서가
-- 시간을 아끼는 게 아니라 한 벌 더 만드는 일이 된다.
--
-- 032 가 42문항에 한 것을 고객 맥락에도 한다 — 접수 시점 값을 따로 얼려 둔다.
--
-- ⚠ **접수할 때 한 번 쓰고 다시는 안 쓴다.** normaliseDealPatch 의 허용목록
--   (EDITABLE_DEAL_FIELDS)에 넣지 않으므로 PATCH 로 못 고친다. 고칠 수 있게 되는
--   순간 「원본」이라는 말이 거짓이 된다.
--
-- ⚠ **소급해서 못 채운다.** 이미 있는 딜은 영업이 고친 뒤일 수 있어, 지금 값을
--   원본이라고 적으면 틀린 것을 확인됨으로 만든다. null 로 두고 인계 문서는
--   「구분할 수 없음」이라고 말한다 — 모르면 판정하지 않는다.
--
-- ⚠ 개인정보가 아니다. customer_meta 는 업종·규모·도입대상·시기라 027 규약의 대상이
--   아니다(이름·전화·이메일·직함은 leads 에 있다). 그래서 여기 두는 것이 맞다.
--
-- 컬럼만 추가한다. apply-migrations.js 에 넣어도 안전하다.

begin;

alter table deals add column if not exists customer_meta_original jsonb;

comment on column deals.customer_meta_original is
  '접수 시점의 customer_meta. **접수할 때 한 번만 쓰고 이후 갱신하지 않는다** — 인계 문서가 「고객이 말한 것」과 「영업이 적은 것」을 가르는 근거다. null 이면 049 이전 딜이라 구분할 수 없다는 뜻이고, 그때는 구분되는 척하지 않는다. 032 의 readiness_customer_scores 와 같은 목적이다';

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name, data_type from information_schema.columns
 where table_schema = current_schema() and table_name = 'deals'
   and column_name = 'customer_meta_original';
--
-- 2) 기존 딜은 전부 null 이다. **채우면 안 된다** —
--    지금 값은 영업이 고친 뒤일 수 있어 원본이라고 적으면 거짓말이 된다.
select count(*) as "딜", count(customer_meta_original) as "원본 있음"
  from deals where deleted_at is null;
--
-- 3) 이 마이그레이션 이후 접수분부터 채워진다. 포탈 유입만 해당한다 —
--    영업이 직접 만든 딜(source='manual')은 애초에 고객 원본이 없다.
select source, count(*) as "딜", count(customer_meta_original) as "원본 있음"
  from deals where deleted_at is null group by source order by 1;
--
-- 4) 영업이 접수분에서 무엇을 고쳤는지. 인계 문서가 「추정」으로 표시할 값들이다.
select customer,
       customer_meta_original - array(select jsonb_object_keys(customer_meta)) as "지워진 키",
       (select jsonb_object_agg(k, customer_meta -> k) from jsonb_object_keys(customer_meta) k
         where customer_meta -> k is distinct from customer_meta_original -> k) as "고쳐진 값"
  from deals
 where customer_meta_original is not null and customer_meta is distinct from customer_meta_original
 order by updated_at desc limit 20;
