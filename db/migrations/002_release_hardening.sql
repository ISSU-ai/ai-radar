-- Production release hardening for the ISSU AI Radar / Enablement Hub.
-- Run after 001_enablement_hub.sql.

begin;

-- The browser talks to the Express API, not PostgREST. Keep the Supabase anon
-- role for Auth only and remove direct table/view mutations and lead inserts.
revoke all on table
  offering_fqa_items,
  offering_tracks,
  offering_packages,
  fqa_items,
  tracks,
  packages,
  package_items,
  deals,
  focal_contacts,
  leads,
  solutions,
  profiles,
  solution_versions,
  solution_chunks,
  audit_log
from public, anon;

-- Authenticated browser sessions also use the Express API. Least privilege on
-- the exposed PostgREST schema prevents bypassing server-side validation.
revoke all on table
  offering_fqa_items,
  offering_tracks,
  offering_packages,
  fqa_items,
  tracks,
  packages,
  package_items,
  deals,
  focal_contacts,
  leads,
  solutions,
  profiles,
  solution_versions,
  solution_chunks,
  audit_log
from authenticated;

revoke all on all sequences in schema public from public, anon, authenticated;

-- Trigger and policy helper functions must not be callable as PostgREST RPCs.
-- Their database triggers continue to execute under the owning database role.
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function is_admin() from public, anon, authenticated;
revoke execute on function is_approved() from public, anon, authenticated;
revoke execute on function notify_deal_change() from public, anon, authenticated;
revoke execute on function set_updated_at() from public, anon, authenticated;

-- Supabase commonly grants browser roles on future public objects through
-- owner defaults. Keep new application tables, sequences, and functions closed
-- unless a later migration grants an explicit, reviewed capability.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Make the remaining views obey the querying role if a privileged role is
-- granted access explicitly in the future.
alter view offering_fqa_items set (security_invoker = true);
alter view offering_tracks set (security_invoker = true);
alter view offering_packages set (security_invoker = true);

-- Public submissions are accepted only through the rate-limited server route.
drop policy if exists leads_insert on leads;

-- Record the exact consent attached to a public consultation request.
alter table leads add column if not exists consent_at timestamptz;
alter table leads add column if not exists consent_version text;
alter table leads add column if not exists consent_purpose text;
alter table leads add column if not exists consent_retention text;

comment on column leads.consent_at is 'Timestamp at which the requester accepted the privacy notice';
comment on column leads.consent_version is 'Version identifier of the accepted privacy notice';

commit;
