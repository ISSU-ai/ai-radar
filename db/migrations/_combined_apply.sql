-- ===================================================================
-- 통합 적용 스크립트 (자동 생성 — scripts/build-pending-sql.js)
--
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번에 실행합니다.
-- 파일을 직접 수정하지 마세요. 원본은 db/migrations/ 의 개별 파일입니다.
--
-- 포함: 040_drop_fqa.sql
--
-- 실행 후 각 파일 끝의 검증 쿼리 결과를 눈으로 확인하세요.
--   011: 슬롯 미배정 0건 / 슬롯별 후보 수 / 레이어 정정 4건
--   012: 판정 데이터 9건 · 미보강 13건 · 깨진 slug 0건
--   013: enum 에 curator 포함 · 역할별 인원
-- ===================================================================

-- ═══════════════════════════════════════════════════════════════
-- ▼ 040_drop_fqa.sql
-- ═══════════════════════════════════════════════════════════════

-- 040. 21문항(FQA)을 통째로 지운다 (1회성)
--
-- ── 왜 지우나 ───────────────────────────────────────────────────
-- 사용자 결정이었다. *"42개가 넘어가면 21개는 필요가 없잖아"*, *"이건 마지막에
-- 지워야 해"*. 화면에서는 이미 사라졌고(032·이후), 남아 있던 이유는 추천 엔진의
-- 판정 데이터가 21문항 어휘로 쓰여 있었기 때문뿐이다.
--
-- 036~039 로 그 어휘가 옮겨졌다.
--   ISV 솔루션  → 기획안 Appendix A 10평가영역
--   서비스 패키지 → 42문항 6축
-- 이제 21문항을 읽는 코드가 없다.
--
-- ⚠ **되돌릴 수 없다.** 실행 전에 039 가 배포돼 있고 추천이 도는지 확인한다.
--   확인 방법은 아래 「적용 전 확인」 쿼리다. 0건이 아니면 실행하지 말 것.
--
-- ⚠ 지우는 것을 다 적는다. 나중에 "이건 왜 없지" 를 여기서 찾을 수 있어야 한다.
--   · fqa_items                     21문항 정의 (001)
--   · deals.fqa_scores/fqa_totals   딜의 21문항 응답·집계
--   · deals.fqa_reviewed_at         21문항 실사 표시
--   · readiness_fqa_bridge          42→21 다리 (030)
--   · solutions.fqa_coverage        038 이 assessment_coverage 로 옮겼다
--   · solutions.prerequisites       038 이 assessment_prerequisites 로 옮겼다
--   · packages.fqa_coverage         038 이 readiness_coverage·assessment_* 로 옮겼다
--   · packages.readiness_lift       038 이 assessment_lift 로 옮겼다
--   · isv_bundles.fqa_signal        033 이 readiness_signal 로 옮겼다
--   · offering_fqa_items (뷰)       001 이 만든 anon 공개 창구. 21문항과 함께 없어진다
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성).

-- ── 적용 전 확인 ────────────────────────────────────────────────
-- **전부 0 이어야 실행한다.** 하나라도 0 이 아니면 038 이 덜 옮겨진 것이다.
--
-- select
--   (select count(*) from solutions
--     where jsonb_array_length(fqa_coverage) > 0
--       and jsonb_array_length(assessment_coverage) = 0
--       and slug <> 'replit')                                as "안 옮겨진 솔루션",
--   (select count(*) from packages
--     where status = 'active' and jsonb_array_length(readiness_coverage) = 0) as "축 없는 패키지",
--   (select count(*) from solutions s, jsonb_array_elements(s.assessment_prerequisites) e
--     where e ->> 'kind' = 'fqa')                            as "안 옮겨진 전제";
--
-- replit 은 「개발·테스트 환경」 하나만 덮었고 10평가영역에 대응이 없다. 알려진
-- 누락이라 제외한다 — 개발 생산성은 033 의 AI Developer 번들이 따로 보여준다.

begin;

-- ── 딜 ──────────────────────────────────────────────────────────
alter table deals drop column if exists fqa_scores;
alter table deals drop column if exists fqa_totals;
alter table deals drop column if exists fqa_reviewed_at;

-- ── 판정 데이터 ─────────────────────────────────────────────────
alter table solutions drop column if exists fqa_coverage;
alter table solutions drop column if exists prerequisites;
alter table packages  drop column if exists fqa_coverage;
alter table packages  drop column if exists prerequisites;
alter table packages  drop column if exists readiness_lift;
alter table isv_bundles drop column if exists fqa_signal;

-- ── 문항과 다리 ─────────────────────────────────────────────────
-- readiness_fqa_bridge 가 fqa_items 를 참조하지 않지만(문항명 문자열 조인) 순서를
-- 지켜 지운다. leads.fqa_scores 는 **남긴다** — 접수 당시 무엇이 들어왔는지는
-- 동의 이력과 같은 자리의 기록이라 판정 데이터가 아니다.
drop table if exists readiness_fqa_bridge;

-- ⚠ fqa_items 에 뷰가 하나 매달려 있다 (2BP01). 001 이 만든 offering_fqa_items 로,
--   랜딩이 21문항을 anon 권한으로 읽던 공개 창구였다. 21문항이 사라졌으니 이 뷰도
--   존재 이유가 없고, 코드에서 읽는 곳도 0건이다.
--
--   **cascade 를 쓰지 않는다.** cascade 는 무엇이 같이 지워지는지 모른 채 지운다 —
--   이 파일의 「지우는 것을 다 적는다」 원칙과 정면으로 어긋난다. 이름으로 지운다.
--   형제 뷰(offering_tracks · offering_packages)는 fqa_items 와 무관하므로 남긴다.
drop view if exists offering_fqa_items;

drop table if exists fqa_items;

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 남은 fqa 컬럼이 있는가. **leads.fqa_scores 하나만 나와야 한다.**
select table_name, column_name
  from information_schema.columns
 where table_schema = current_schema() and column_name like '%fqa%'
 order by table_name, column_name;
--
-- 2) 남은 fqa 표가 있는가. **0건이어야 한다.**
select table_name from information_schema.tables
 where table_schema = current_schema() and table_name like '%fqa%';
--
-- 3) 새 판정 데이터가 살아 있는가.
select
  (select count(*) from solutions where jsonb_array_length(assessment_coverage) > 0) as "판정 있는 솔루션",
  (select count(*) from packages where jsonb_array_length(readiness_coverage) > 0)   as "축 있는 패키지",
  (select count(*) from assessment_areas)                                            as "평가영역",
  (select count(*) from readiness_assessment_bridge)                                 as "42→10 대응";

