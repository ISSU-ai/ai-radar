-- Package pricing for STEP 04 preliminary estimate (가견적).
-- Run after 001_enablement_hub.sql. Apply in the Supabase SQL Editor (dfbx).
-- Estimate per package = (base_md + deal adjustment md) * unit_price.

begin;

alter table packages add column if not exists base_md    integer not null default 0;
alter table packages add column if not exists unit_price integer not null default 0;

comment on column packages.base_md    is '기준 공수(MD). 딜별 조정 MD와 합산해 가견적 계산';
comment on column packages.unit_price is 'MD당 단가(원). 가견적 = (base_md + 조정MD) * unit_price';

-- Placeholder pricing — INTERNAL, adjust to real numbers in admin / here.
update packages as p set base_md = v.base_md, unit_price = v.unit_price
from (values
  ('DISCOVERY',   10, 800000),
  ('POC',         25, 800000),
  ('SECURITY',    20, 850000),
  ('INTEGRATION', 45, 850000),
  ('ADOPTION',    20, 750000),
  ('OPERATE',     10, 900000)
) as v(id, base_md, unit_price)
where p.id = v.id;

commit;
