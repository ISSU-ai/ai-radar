-- 038. 판정 데이터를 Appendix A 평가영역과 42문항 6축으로 (1회성 시드)
--
-- ── 층을 가른다 ─────────────────────────────────────────────────
--   ISV 솔루션 17종  → **10평가영역** (도입 리스크·통제 게이트)
--                      "이 제품을 지금 넣을 수 있나"
--   서비스 패키지 6종 → **42문항 6축** (고객 준비도)
--                      "이 고객에게 어떤 서비스가 필요한가"
--
-- 왜 갈랐나: Appendix A 는 위험·통제 체크리스트다. 「명확한 업무 문제·성과 KPI·
-- 예산 준비도·현업 오너십·변화관리」를 묻지 않는데, **그게 정확히 01 AI Consulting 과
-- 04 Adoption & Change 가 파는 것**이다. 패키지까지 10평가영역으로 옮기면 두 오퍼링이
-- 추천에서 통째로 사라진다. 실제로 대조해 확인했다.
--
-- 패키지는 그래서 **둘 다** 갖는다.
--   readiness_coverage  6축 — 어느 고객에게 필요한가 (후보 선정)
--   assessment_lift     평가영역 — 어떤 ISV 전제를 풀어주는가 (번들 선행)
-- 둘은 다른 질문이라 값도 다르다. 하나로 합치면 "고객에게 필요한 것" 과 "제품을 푸는
-- 것" 이 섞인다.
--
-- ── 21→10 대응표 ───────────────────────────────────────────────
--   A 데이터 분류·민감도    → A01 데이터 보호
--   A 보안 게이트웨이       → A01 데이터 보호
--   A 데이터 보존·삭제      → A02 저장·보존
--   A 접근권한·계정 체계    → A03 계정·접근통제
--   A 감사 로그·추적성      → A05 감사·모니터링
--   A 규제·컴플라이언스     → A08 개인정보·규제
--   B 업무 시스템 연동성    → A04 데이터 권한 연계
--   B 지식 소스 품질        → A07 정확성·신뢰성
--   B 확장성·성능 / 벤더전환 → A10 비용·확장성
--   C 품질 평가 체계        → A07 정확성·신뢰성
--   C 장애 대응 체계        → A05 감사·모니터링
--   C 비용 모니터링         → A10 비용·확장성
--   C 변경·배포 관리        → A06 AI 행동 통제
--   B 개발·테스트 환경 · C 운영 책임자 · D 5문항 → **대응 없음**
--
-- ⚠ 대응 없는 문항이 전제조건이던 것은 **버리지 않고 kind:'manual' 로 바꾼다.**
--   그냥 지우면 막혔어야 할 후보가 조용히 통과한다. manual 은 STEP03 에서 후보별로
--   확인하는 경로가 이미 있다.
--
-- ⚠ 이 파일은 데이터만 바꾼다. 엔진과 화면, 21문항 삭제는 039 다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

alter table solutions add column if not exists assessment_coverage      jsonb not null default '[]'::jsonb;
alter table solutions add column if not exists assessment_prerequisites jsonb not null default '[]'::jsonb;
alter table packages  add column if not exists readiness_coverage       jsonb not null default '[]'::jsonb;
alter table packages  add column if not exists assessment_coverage      jsonb not null default '[]'::jsonb;
alter table packages  add column if not exists assessment_lift          jsonb not null default '{}'::jsonb;

comment on column solutions.assessment_coverage is
  '이 솔루션이 덮는 평가영역 [{area,strength}]. strength 1~3 — 21문항 fqa_coverage 를 대체';
comment on column solutions.assessment_prerequisites is
  '도입 전제 [{kind:assessment|numeric|manual, area, min, blocking, label, enabled_by}]';
comment on column packages.readiness_coverage is
  '이 패키지가 올려 주는 42문항 축 [{axis,strength}]. **후보 선정용** — 어느 고객에게 필요한가';
comment on column packages.assessment_coverage is
  '이 패키지가 덮는 평가영역 [{area,strength}]. **번들 선행 판정용** — 막힌 전제를 실제로 다루는지 본다';
comment on column packages.assessment_lift is
  '이 패키지가 올려 주는 평가영역 상승폭 {"A03":1.5}. **번들 선행용** — 어떤 ISV 전제를 푸는가';

-- ── ① 솔루션 판정 데이터 ───────────────────────────────────────
-- 21문항 coverage/prerequisites 를 대응표로 옮긴다. 같은 영역이 여러 문항에서 오면
-- 깊은 strength 를 쓴다 — 얕은 쪽에 맞추면 선행 판정에서 밀린다.
with mapping(category, item, area) as (values
  ('A', '데이터 분류와 민감도 기준', 'A01'),
  ('A', '보안 게이트웨이 준비도',    'A01'),
  ('A', '데이터 보존·삭제 정책',     'A02'),
  ('A', '접근권한과 계정 체계',      'A03'),
  ('A', '감사 로그와 추적성',        'A05'),
  ('A', '규제·컴플라이언스 검토',    'A08'),
  ('B', '업무 시스템 연동성',        'A04'),
  ('B', '지식 소스 품질',            'A07'),
  ('B', '확장성·성능 기준',          'A10'),
  ('B', '모델·벤더 전환성',          'A10'),
  ('C', '품질 평가 체계',            'A07'),
  ('C', '장애 대응 체계',            'A05'),
  ('C', '비용 모니터링',             'A10'),
  ('C', '변경·배포 관리',            'A06')
),
exploded as (
  -- ⚠ 콤마 조인과 명시적 join 을 섞으면 join 이 **바로 앞 항목에만** 묶여
  --   e 를 ON 절에서 못 본다. cross join lateral 로 조인 트리에 제대로 올린다.
  select s.id as sid, m.area, max((e.value ->> 'strength')::int) as strength
    from solutions s
    cross join lateral jsonb_array_elements(s.fqa_coverage) e
    cross join lateral jsonb_array_elements_text(coalesce(e.value -> 'items', '[]'::jsonb)) it
    join mapping m on m.category = e.value ->> 'category' and m.item = it.value
   group by s.id, m.area
)
update solutions s set assessment_coverage = coalesce(x.cov, '[]'::jsonb)
  from (
    select sid, jsonb_agg(jsonb_build_object('area', area, 'strength', strength) order by area) as cov
      from exploded group by sid
  ) x
 where x.sid = s.id;

-- 전제조건. 대응이 있으면 kind:'assessment', 없으면 kind:'manual' 로 바꾼다.
with mapping(category, item, area) as (values
  ('A', '규제·컴플라이언스 검토', 'A08'),
  ('A', '접근권한과 계정 체계',   'A03'),
  ('B', '지식 소스 품질',         'A07')
)
update solutions s set assessment_prerequisites = (
  select coalesce(jsonb_agg(
    case
      when p.value ->> 'kind' <> 'fqa' then p.value          -- numeric·manual 은 그대로
      when m.area is not null then
        jsonb_build_object(
          'kind', 'assessment', 'area', m.area,
          'min', p.value -> 'min', 'blocking', coalesce(p.value -> 'blocking', 'true'::jsonb),
          'label', p.value -> 'label',
          'enabled_by', coalesce(p.value -> 'enabled_by', '[]'::jsonb))
      else
        -- 10평가영역에 대응이 없다. 버리지 않고 영업 확인으로 돌린다.
        jsonb_build_object(
          'kind', 'manual', 'blocking', coalesce(p.value -> 'blocking', 'true'::jsonb),
          'label', coalesce(p.value -> 'label',
                            to_jsonb((p.value ->> 'item') || ' ' || (p.value ->> 'min') || ' 이상')))
    end order by ordinality), '[]'::jsonb)
    from jsonb_array_elements(s.prerequisites) with ordinality p(value, ordinality)
    left join mapping m on m.category = p.value ->> 'category' and m.item = p.value ->> 'item'
)
 where jsonb_array_length(s.prerequisites) > 0;

-- ── ② 패키지 — 후보 선정용 6축 ─────────────────────────────────
-- 42문항 축과 각 오퍼링이 파는 것을 잇는다. strength 3 = 이 축이 이 패키지의 본업.
update packages set readiness_coverage = '[
    {"axis":"S","strength":3},
    {"axis":"B","strength":2}
  ]'::jsonb where id = 'P01';   -- 01 AI Consulting — 전략·로드맵과 업무 과제 도출

update packages set readiness_coverage = '[
    {"axis":"G","strength":3},
    {"axis":"T","strength":2}
  ]'::jsonb where id = 'P02';   -- 02 OpenAI Ready — 보안·거버넌스 설정과 기본 인프라

update packages set readiness_coverage = '[
    {"axis":"D","strength":3},
    {"axis":"T","strength":3}
  ]'::jsonb where id = 'P03';   -- 03 AIR Service — 데이터 파운데이션과 시스템 연계

update packages set readiness_coverage = '[
    {"axis":"P","strength":3},
    {"axis":"B","strength":3}
  ]'::jsonb where id = 'P04';   -- 04 Adoption & Change — 인재·조직문화와 업무 정착

update packages set readiness_coverage = '[
    {"axis":"T","strength":2},
    {"axis":"G","strength":2}
  ]'::jsonb where id = 'P05';   -- 05 Billing & MS — 비용(T7)·운영 모니터링(G7)

-- STARTER 는 진입 상품이라 얕게 여러 축을 건드린다. 깊이 2 를 넘기지 않는다.
update packages set readiness_coverage = '[
    {"axis":"S","strength":2},
    {"axis":"G","strength":2},
    {"axis":"B","strength":1}
  ]'::jsonb where id = 'STARTER';

-- ── ③ 패키지 — 번들 선행용 평가영역 ────────────────────────────
-- 기존 fqa_coverage/readiness_lift 를 대응표로 옮긴다. ISV 전제를 실제로 푸는 값이다.
update packages set
  assessment_coverage = '[{"area":"A01","strength":3},{"area":"A02","strength":3},
                          {"area":"A03","strength":3},{"area":"A05","strength":3},
                          {"area":"A08","strength":3}]'::jsonb,
  assessment_lift = '{"A01":1.5,"A02":1.5,"A03":1.5,"A05":1.5,"A08":1.5}'::jsonb
  where id = 'P02';             -- A 전체를 정면으로 다루던 것이 그대로 온다

update packages set
  assessment_coverage = '[{"area":"A01","strength":2},{"area":"A03","strength":2},
                          {"area":"A04","strength":3},{"area":"A06","strength":2},
                          {"area":"A07","strength":3},{"area":"A10","strength":3}]'::jsonb,
  assessment_lift = '{"A04":1.5,"A07":1.5,"A10":1.5,"A01":0.8,"A03":0.8,"A06":0.8}'::jsonb
  where id = 'P03';

update packages set
  assessment_coverage = '[{"area":"A05","strength":3},{"area":"A06","strength":3},
                          {"area":"A07","strength":3},{"area":"A10","strength":3}]'::jsonb,
  assessment_lift = '{"A05":1.5,"A06":1.5,"A07":1.5,"A10":1.5}'::jsonb
  where id = 'P05';

update packages set
  assessment_coverage = '[{"area":"A01","strength":2},{"area":"A03","strength":2},
                          {"area":"A10","strength":2}]'::jsonb,
  assessment_lift = '{"A01":0.8,"A03":0.8,"A10":0.5}'::jsonb
  where id = 'STARTER';

-- 01·04 는 평가영역을 풀지 않는다. 전략·조직 과업이라 제품 통제 게이트와 층이 다르다.
-- 빈 값이 맞다 — 억지로 넣으면 "컨설팅을 하면 SSO 가 생긴다" 는 말이 된다.
update packages set assessment_coverage = '[]'::jsonb, assessment_lift = '{}'::jsonb
  where id in ('P01', 'P04');

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 판정 데이터가 있는 솔루션이 평가영역으로 옮겨졌는가. 빈 것이 있으면 안 된다.
select s.slug, s.name,
       jsonb_array_length(s.fqa_coverage)        as "옛 21문항",
       jsonb_array_length(s.assessment_coverage) as "새 평가영역",
       (select string_agg(e ->> 'area', ',' order by e ->> 'area')
          from jsonb_array_elements(s.assessment_coverage) e) as "영역"
  from solutions s
 where jsonb_array_length(s.fqa_coverage) > 0
 order by jsonb_array_length(s.assessment_coverage), s.slug;
--
-- 2) 전제조건이 어떻게 옮겨졌는가. kind:'fqa' 가 남아 있으면 안 된다.
select e ->> 'kind' as "종류", count(*) as "건수"
  from solutions s, jsonb_array_elements(s.assessment_prerequisites) e
 group by 1 order by 1;
--
-- 3) 대응이 없어 영업 확인으로 넘어간 전제. 문구가 살아 있어야 한다.
select s.slug, e ->> 'label' as "확인 항목"
  from solutions s, jsonb_array_elements(s.assessment_prerequisites) e
 where e ->> 'kind' = 'manual'
   and s.prerequisites::text like '%"kind": "fqa"%'
 order by s.slug;
--
-- 4) 패키지가 6축과 평가영역을 둘 다 갖는가. 01·04 는 평가영역이 비어야 한다.
select p.id, p.name,
       (select string_agg((e ->> 'axis') || (e ->> 'strength'), ' ' order by e ->> 'axis')
          from jsonb_array_elements(p.readiness_coverage) e) as "6축",
       (select string_agg(k, ',' order by k)
          from jsonb_object_keys(p.assessment_lift) k)       as "푸는 평가영역"
  from packages p where p.status = 'active' order by p.sort_order;
--
-- 5) 존재하지 않는 평가영역을 가리키는가. **0건이어야 한다.**
select 'solution' as "종류", s.slug as id, e ->> 'area' as "없는 영역"
  from solutions s
  cross join lateral jsonb_array_elements(s.assessment_coverage) e
  left join assessment_areas a on a.id = e ->> 'area'
 where a.id is null
union all
select 'package', p.id, k
  from packages p
  cross join lateral jsonb_object_keys(p.assessment_lift) k
  left join assessment_areas a on a.id = k
 where a.id is null;
