-- 028. 고객사 규모 어휘 통일 (1회성 시드)
--
-- customer_meta.companySize 에 두 어휘가 섞여 들어가고 있었다.
--   허브 인테이크   1~99명 / 100~499명 / 500~1,999명 / 2,000명 이상   (001 이후)
--   상담 폼         200명 미만 / 200~500명 / 501~1,000명 / 1,000명 초과 (027)
-- 같은 필드에 다른 구간이 들어가면 규모로 묶어 보는 일이 전부 어긋난다. 업종을
-- 자유입력에서 셀렉트로 바꾼 이유와 같은 문제를 규모에서 반복한 셈이었다.
--
-- 진단기준 엑셀「고객 기본정보」시트 값으로 통일한다. 오퍼링 문서가 기준이다.
-- 화면 쪽은 taxonomy.js 한 곳에서 목록을 읽도록 바꿨다.
--
-- ⚠ 경계가 딱 맞지 않는다. 정확한 인원을 모르므로 구간 중앙값으로 옮긴다.
--     1~99명       → 200명 미만       (명확)
--     100~499명    → 200~500명        (중앙 300 → 200~500)
--     500~1,999명  → 501~1,000명      (1,000 을 걸친다. 보수적으로 아래쪽)
--     2,000명 이상 → 1,000명 초과     (명확)
--   500~1,999 는 절반이 1,000 을 넘는다. 옮긴 뒤 해당 딜은 영업이 확인하는 것이 좋다.
--   아래 확인 쿼리 2) 가 그 대상을 뽑아 준다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

update deals d
   set customer_meta = jsonb_set(d.customer_meta, '{companySize}', to_jsonb(m.new_value))
  from (values
    ('1~99명',       '200명 미만'),
    ('100~499명',    '200~500명'),
    ('500~1,999명',  '501~1,000명'),
    ('2,000명 이상', '1,000명 초과')
  ) as m(old_value, new_value)
 where d.customer_meta ->> 'companySize' = m.old_value;

commit;

-- 확인
-- 1) 남아 있는 값이 새 어휘뿐이어야 한다. 옛 값이 보이면 안 된다.
select customer_meta ->> 'companySize' as "규모", count(*) as "딜"
  from deals
 where customer_meta ? 'companySize' and customer_meta ->> 'companySize' <> ''
 group by 1 order by 1;
--
-- 2) 500~1,999 에서 옮겨진 딜. 1,000 을 걸치는 구간이라 영업 확인이 필요하다.
select id, customer, customer_meta ->> 'companySize' as "규모", customer_meta ->> 'targetUsers' as "도입 대상"
  from deals
 where customer_meta ->> 'companySize' = '501~1,000명'
 order by updated_at desc;
