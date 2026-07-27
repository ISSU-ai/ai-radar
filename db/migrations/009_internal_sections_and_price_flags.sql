-- 내부 전용 본문 분리 + 미확정 단가 플래그.
-- Run after 008_tiered_pricing.sql. Apply in the Supabase SQL Editor (dfbx).
--
-- 1) solutions.sections_internal
--    sections(jsonb)에 공개 카피와 내부 전략 코멘트(마진·리셀러·PreSales 의견)가
--    한 blob으로 섞여 있어 role별 마스킹이 구조적으로 불가능했다. 내부 문단을
--    이 컬럼으로 분리하고, API는 admin 에게만 반환한다.
--    본문 이관은 이 파일이 아니라 scripts/split-internal-sections.js 가 수행한다
--    (분류 규칙이 lib/section-privacy.js 한 곳에 있어야 서버와 어긋나지 않는다).
--
-- 2) price_is_placeholder (solutions / packages)
--    003·006 마이그레이션이 심은 값은 데모용 임의 단가다. 실단가와 구분되지 않아
--    가견적·딜사이즈 시뮬레이터에 그대로 흘러들었다. 기존 행은 전부 placeholder(true)로
--    두고, 실단가를 확정할 때만 admin 이 false 로 내린다.
--    true 인 동안 hub 는 금액 대신 "단가 미확정 · 별도협의"를 표시한다.

begin;

alter table solutions add column if not exists sections_internal jsonb not null default '{}'::jsonb;
alter table solutions add column if not exists price_is_placeholder boolean not null default true;
alter table packages  add column if not exists price_is_placeholder boolean not null default true;

comment on column solutions.sections_internal   is '관리자 전용 내부 문단 {섹션키: 본문}. non-admin 응답에서 제외';
comment on column solutions.price_is_placeholder is 'true=데모/미확정 단가. 견적·딜사이즈에서 금액 대신 별도협의 표기';
comment on column packages.price_is_placeholder  is 'true=데모/미확정 MD 단가. 가견적에서 금액 대신 별도협의 표기';

-- 스냅샷도 같은 모양을 갖도록 유지 (publish/rollback 시 풀행 jsonb 저장)
-- solution_versions.snapshot 은 스키마 없는 jsonb 라 별도 DDL 불필요.

commit;
