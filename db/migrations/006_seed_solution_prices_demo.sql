-- DEMO placeholder pricing for the STEP 04 deal-size simulator.
-- Arbitrary numbers just to exercise the simulator; set real prices in admin.
-- Idempotent + non-destructive: only fills solutions that have NO price yet
-- (price_type is null), so it never overwrites prices set in admin.
-- One-time seed — NOT part of scripts/apply-migrations.js.

begin;

with ranked as (
  select id,
         row_number() over (order by coalesce(grade, 0) desc, name) as rn
  from solutions
  where status = 'published' and price_type is null
)
update solutions s
set price_type = t.pt,
    unit_price = t.up
from (
  select r.id,
         (array['seat','once','mrr','once']::text[])[(r.rn % 4) + 1]        as pt,
         (array[90000, 30000000, 8000000, 15000000]::int[])[(r.rn % 4) + 1] as up
  from ranked r
) t
where s.id = t.id;

commit;
