-- Ensure Portal26 / Check Point / New Relic / Zscaler appear in the STEP 03 ISV
-- catalog. reference-data only shows solutions that are published, not archived,
-- and status_op <> 'draft'. Upsert by slug: create if missing, otherwise just
-- make visible (does NOT overwrite existing name/category/jtbd, so admin edits
-- are preserved). Placeholder content — enrich + price in admin.
-- One-time seed; run in the Supabase SQL Editor. Not part of apply-migrations.js.

begin;

insert into solutions (slug, name, layer, category, jtbd, status, status_op, is_archived) values
  ('portal26',    'Portal26',    'L4', 'AI 거버넌스·가시성', '누가 어떤 AI를 얼마나 쓰는지 가시화하고 프롬프트 위험·토큰 비용을 통제', 'published', 'active', false),
  ('check-point', 'Check Point', 'L1', '보안·네트워크',     'AI 트래픽 보안 게이트웨이와 위협 방어 (Harmony/CloudGuard)',        'published', 'active', false),
  ('new-relic',   'New Relic',   'L4', '관측성·APM',        'AI·애플리케이션 성능·비용·에러를 실시간 관측',                       'published', 'active', false),
  ('zscaler',     'Zscaler',     'L1', '보안·SWG/ZTNA',     'AI 트래픽 보안 경로·프록시·DLP 통제',                              'published', 'active', false)
on conflict (slug) do update set
  status = 'published',
  status_op = 'active',
  is_archived = false;

commit;
