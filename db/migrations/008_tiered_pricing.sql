-- Tiered (volume) pricing + currency for solutions, and a global USD->KRW rate.
-- Run after 005_solution_pricing.sql. Apply in the Supabase SQL Editor (dfbx).
--
-- price_tiers: ordered array of {up_to, per_user, flat} in the solution's currency.
--   A tier applies when seats <= up_to (up_to null = top/unbounded tier).
--   annual cost = flat (if set) else seats * per_user.  per_user/flat are ANNUAL.
--   Used only for price_type='seat'; empty [] falls back to the flat unit_price.
-- currency: 'KRW' | 'USD'. USD amounts are converted with hub_settings.usd_krw.

begin;

alter table solutions add column if not exists currency text not null default 'KRW'
  check (currency in ('KRW', 'USD'));
alter table solutions add column if not exists price_tiers jsonb not null default '[]'::jsonb;

comment on column solutions.currency    is 'KRW|USD. USD는 hub_settings.usd_krw로 환산';
comment on column solutions.price_tiers is '구간 단가 [{up_to,per_user,flat}] (연·currency 기준). seat에서 flat unit_price 대신 사용';

create table if not exists hub_settings (
  id      boolean primary key default true check (id = true),
  usd_krw integer not null default 1400
);
insert into hub_settings (id, usd_krw) values (true, 1400) on conflict (id) do nothing;

-- Same hardening as the other hub tables: the app reads this via the postgres
-- pool (which bypasses RLS as the owner); anon/authenticated get no access.
alter table hub_settings enable row level security;
revoke all on hub_settings from anon, authenticated;

commit;
