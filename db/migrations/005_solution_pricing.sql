-- Per-solution pricing for the STEP 04 deal-size simulator.
-- Run after 001_enablement_hub.sql. Apply in the Supabase SQL Editor (dfbx).
--
-- price_type drives how a selected solution contributes to the 1st-year deal:
--   'seat' -> seats * unit_price * 12   (annual license)
--   'once' -> unit_price                (one-time)
--   'mrr'  -> unit_price * 12           (annualized monthly)
--   null   -> excluded from the simulator
-- seats is a per-deal input (stored on the deal, not here).

begin;

alter table solutions add column if not exists price_type text
  check (price_type is null or price_type in ('seat','once','mrr'));
alter table solutions add column if not exists unit_price integer not null default 0;

comment on column solutions.price_type is 'seat(좌석/월)|once(일회성)|mrr(월). null=시뮬레이터 제외';
comment on column solutions.unit_price is 'price_type 기준 단가(원). seat=1좌석·월, once=일회성, mrr=월';

commit;
