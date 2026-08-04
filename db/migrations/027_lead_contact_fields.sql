-- 027. 상담 폼 확장 — 고객사 규모·업종 / 담당자 이름·전화번호
--
-- /offering 하단 상담 폼이 회사명·연락처만 받고 있었다. 영업이 받아 보면 "어느
-- 규모의 어느 업종인지" 를 다시 물어야 했고, 담당자 이름 없이 이메일만 있어 첫
-- 연락이 어색했다.
--
-- ⚠ 담당자 이름·전화번호는 개인정보다. customer_meta(jsonb) 가 아니라 leads 에
--   컬럼으로 둔다. 이유:
--     · leads 는 동의 이력(consent_at·version·purpose·retention)을 갖는 표다.
--       개인정보는 동의와 같은 자리에 있어야 보유기간 만료 시 함께 지운다.
--     · customer_meta 는 deals 로 흘러가 영업이 자유롭게 수정하는 자유형 필드다.
--       개인정보를 거기 두면 어디까지 퍼졌는지 추적할 수 없다.
--   규모·업종은 개인정보가 아니므로 customer_meta 로 간다(영업이 딜에서 쓴다).
--
-- ⚠ 개인정보 고지 문구도 같이 고쳐야 한다 (offering.html). 항목만 늘리고 고지를
--   안 고치면 동의 범위를 벗어난다. 코드 쪽에서 처리했다.
--
-- 이 파일은 스키마만 바꾸므로 apply-migrations.js 에 넣어도 안전하다.

begin;

alter table leads add column if not exists contact_name  text;
alter table leads add column if not exists contact_phone text;

comment on column leads.contact_name  is '담당자 이름. 개인정보 — 동의 이력과 같은 표에 둔다';
comment on column leads.contact_phone is '담당자 전화번호. 개인정보 — 동의 이력과 같은 표에 둔다';

commit;

-- 확인
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = current_schema() and table_name = 'leads'
--    order by ordinal_position;
--
--   -- 최근 유입 리드가 새 항목을 담고 있는지
--   -- ⚠ customer 는 leads·deals 양쪽에 있다. 접두사를 빼면 "column reference
--   --   customer is ambiguous" 로 쿼리가 아예 안 돈다.
--   select l.customer, l.contact_name, l.contact_phone, l.contact,
--          d.customer_meta -> 'industry'    as 업종,
--          d.customer_meta -> 'companySize' as 규모,
--          l.created_at
--     from leads l
--     left join deals d on d.id = l.promoted_deal
--    order by l.created_at desc limit 10;
