-- ===================================================================
-- 통합 적용 스크립트 (자동 생성 — scripts/build-pending-sql.js)
--
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번에 실행합니다.
-- 파일을 직접 수정하지 마세요. 원본은 db/migrations/ 의 개별 파일입니다.
--
-- 포함: 014_seed_package_coverage.sql
--
-- 실행 후 각 파일 끝의 검증 쿼리 결과를 눈으로 확인하세요.
--   011: 슬롯 미배정 0건 / 슬롯별 후보 수 / 레이어 정정 4건
--   012: 판정 데이터 9건 · 미보강 13건 · 깨진 slug 0건
--   013: enum 에 curator 포함 · 역할별 인원
-- ===================================================================

-- ═══════════════════════════════════════════════════════════════
-- ▼ 014_seed_package_coverage.sql
-- ═══════════════════════════════════════════════════════════════

-- MZC 서비스 패키지 6종의 준비도 갭 매핑.
-- Run after 013. Apply in the Supabase SQL Editor (dfbx).
--
-- 추천 산출물은 ISV + 패키지 둘 다다(사용자 확정). 010 이 packages.fqa_coverage 컬럼을
-- 만들었지만 값을 넣지 않아 패키지가 추천 후보로 잡히지 않는 상태였다.
--
-- 패키지가 FQA 4축을 거의 1:1 로 덮는다. 설계 당시 같은 프레임을 썼기 때문으로 보이며,
-- 그래서 매핑 근거가 명확하고 논쟁 여지가 적다.
--
--   SECURITY     → A 보안·거버넌스 전체
--   INTEGRATION  → B 기술·연동 (연동성·지식소스)
--   OPERATE      → C 운영 전체
--   DISCOVERY    → D 비즈니스 (업무문제·KPI)
--   ADOPTION     → D 비즈니스 (현업오너십·변화관리)
--   POC          → B 개발환경 + D 업무문제 (검증 성격이라 강도 2)
--
-- ISV 와 달리 패키지에는 prerequisites 를 넣지 않는다. MZC 가 직접 수행하는 서비스라
-- 고객 환경 전제 조건이 ISV 만큼 강하지 않다. 필요해지면 ISSU 가 /admin 에서 추가한다.
-- 012 와 마찬가지로 1회성 시드다 — apply-migrations.js 에 넣지 않는다.

begin;

update packages set fqa_coverage = '[
  {"category":"A","items":["데이터 분류와 민감도 기준","접근권한과 계정 체계","보안 게이트웨이 준비도",
                           "감사 로그와 추적성","규제·컴플라이언스 검토","데이터 보존·삭제 정책"],"strength":3}
]'::jsonb where id = 'SECURITY';

update packages set fqa_coverage = '[
  {"category":"B","items":["업무 시스템 연동성","지식 소스 품질"],"strength":3}
]'::jsonb where id = 'INTEGRATION';

update packages set fqa_coverage = '[
  {"category":"C","items":["운영 책임자 지정","품질 평가 체계","장애 대응 체계",
                           "비용 모니터링","변경·배포 관리"],"strength":3}
]'::jsonb where id = 'OPERATE';

update packages set fqa_coverage = '[
  {"category":"D","items":["명확한 업무 문제","성과 KPI"],"strength":3}
]'::jsonb where id = 'DISCOVERY';

update packages set fqa_coverage = '[
  {"category":"D","items":["현업 오너십","변화관리·교육"],"strength":3}
]'::jsonb where id = 'ADOPTION';

update packages set fqa_coverage = '[
  {"category":"B","items":["개발·테스트 환경"],"strength":2},
  {"category":"D","items":["명확한 업무 문제"],"strength":2}
]'::jsonb where id = 'POC';

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
-- 6건 모두 채워져야 한다. 0건이면 패키지 id 가 다른 것이다.
select id, name, jsonb_array_length(fqa_coverage) as coverage_entries,
       (select string_agg(e->>'category', ',' order by e->>'category')
          from jsonb_array_elements(fqa_coverage) e) as categories
  from packages
 order by sort_order;

-- 어느 FQA 카테고리를 아무 패키지도 덮지 않는지 확인
select c as category,
       count(*) filter (where p.id is not null) as packages_covering
  from (values ('A'),('B'),('C'),('D')) as t(c)
  left join packages p
    on p.fqa_coverage @> jsonb_build_array(jsonb_build_object('category', c))
 group by c order by c;

