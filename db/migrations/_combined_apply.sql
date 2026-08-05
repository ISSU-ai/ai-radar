-- ===================================================================
-- 통합 적용 스크립트 (자동 생성 — scripts/build-pending-sql.js)
--
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번에 실행합니다.
-- 파일을 직접 수정하지 마세요. 원본은 db/migrations/ 의 개별 파일입니다.
--
-- 포함: 036_assessment_criteria.sql → 037_readiness_assessment_bridge.sql → 038_assessment_judgement.sql
--
-- 실행 후 각 파일 끝의 검증 쿼리 결과를 눈으로 확인하세요.
--   011: 슬롯 미배정 0건 / 슬롯별 후보 수 / 레이어 정정 4건
--   012: 판정 데이터 9건 · 미보강 13건 · 깨진 slug 0건
--   013: enum 에 curator 포함 · 역할별 인원
-- ===================================================================

-- ═══════════════════════════════════════════════════════════════
-- ▼ 036_assessment_criteria.sql
-- ═══════════════════════════════════════════════════════════════

-- 036. 도입 판정 기준을 기획안 Appendix A 로 (1회성 시드)
--
-- 출처: OpenAI_통합_오퍼링_기획안.docx (2026-08-04) Appendix A 「Enterprise AI 도입 평가기준」
--       분류 근거: ISO/IEC 42001 · OECD AI Principles · McKinsey Responsible AI·AI Value Framework
--
-- ── 왜 바꾸나 ───────────────────────────────────────────────────
-- 지금 판정 기준인 21문항(fqa_items)은 **우리가 만든 것**이다. 근거를 물으면 답할 곳이
-- 없었다. 기획안은 같은 자리를 5개 대분류 10개 평가영역으로 표준화했고 국제 표준을
-- 근거로 든다. *"Discovery·PoC 및 Trust 설계 시 체크리스트로 활용"* — 정확히 우리가
-- 21문항으로 하던 일이다.
--
-- 층은 그대로다.
--   42문항(029)   회사가 AI 를 얼마나 하고 있나  — 고객이 답한다
--   10평가영역     이 제품을 지금 넣을 수 있나    — 진단에서 8개가 차고 2개는 확인한다
--
-- ⚠ 이 파일은 **표와 컬럼만 만든다.** bridge 는 037, 판정 데이터 재작성과 21문항
--   삭제는 038 이다. 한 번에 하면 회귀 원인을 못 찾는다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

create table if not exists assessment_domains (
  id         text primary key,          -- D1~D5
  name       text not null,
  sort_order int  not null default 0
);

create table if not exists assessment_areas (
  id          text primary key,         -- A01~A10
  domain_id   text not null references assessment_domains(id) on delete cascade,
  name        text not null,
  checkpoints text not null,            -- Appendix A 「핵심 확인사항」 원문
  concerns    text not null,            -- Appendix A 「주요 우려사항」 원문
  weight      int  not null default 4,
  threshold   numeric(3,1) not null default 3.0,
  status      text not null default 'active' check (status in ('active','retired')),
  sort_order  int  not null default 0
);

comment on table assessment_domains is
  '기획안 Appendix A 5개 대분류. 21문항의 A/B/C/D 를 대체한다';
comment on table assessment_areas is
  '기획안 Appendix A 10개 평가영역. checkpoints·concerns 는 원문 그대로 — 영업이 고객 앞에서 읽는 문장이다';
comment on column assessment_areas.weight is
  '가중치. 데이터 유출·계정 통제처럼 사고 시 되돌릴 수 없는 것을 높게 둔다';
comment on column assessment_areas.threshold is
  '이 미만이면 미달. 21문항은 3.0~3.5 를 썼고 같은 폭을 유지한다';

insert into assessment_domains (id, name, sort_order) values
  ('D1', '데이터·보안',  10),
  ('D2', '운영·통제',    20),
  ('D3', '신뢰·책임',    30),
  ('D4', '법률·규제',    40),
  ('D5', '비용·사업성',  50)
on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order;

-- 가중치·임계값은 기획안에 없다. 21문항이 쓰던 폭(weight 3~5, threshold 3.0~3.5)을
-- 유지하고, **사고가 나면 되돌릴 수 없는 것**을 높게 뒀다. 근거를 각 행에 적는다.
insert into assessment_areas (id, domain_id, name, checkpoints, concerns, weight, threshold, sort_order) values
  ('A01', 'D1', '데이터 보호',
   '학습 사용 여부, 암호화, 고객사 간 분리',
   '기밀정보·고객정보·소스코드 유출',
   5, 3.5, 10),                          -- 유출은 되돌릴 수 없다
  ('A02', 'D1', '저장·보존',
   '저장 위치, 보존기간, 삭제 및 종료 후 처리',
   '해외 저장·백업 잔존·국외 이전',
   4, 3.5, 20),                          -- 국외 이전은 규제 위반으로 직결된다
  ('A03', 'D1', '계정·접근통제',
   'SSO, MFA, SCIM, RBAC, 퇴사자 권한 회수',
   '개인·공용·퇴사자 계정 통제 실패',
   5, 3.5, 30),                          -- 21문항 A-02 가 전제조건에 가장 많이 걸렸다
  ('A04', 'D1', '데이터 권한 연계',
   '기존 문서·메일·시스템 ACL 유지',
   '비인가 내부 데이터 접근',
   5, 3.5, 40),                          -- RAG 를 붙이는 순간 여기서 사고가 난다
  ('A05', 'D2', '감사·모니터링',
   '질문, 파일, 답변, 관리자·실행 로그',
   '사고 원인·사용자 추적 불가',
   4, 3.0, 50),
  ('A06', 'D2', 'AI 행동 통제',
   'Agent Tool Call, 파일·메일·외부전송 승인',
   '위험한 작업의 임의 실행',
   4, 3.0, 60),                          -- Agent 를 파는 이상 빠질 수 없다
  ('A07', 'D3', '정확성·신뢰성',
   '출처, 평가, 결과검증, Human-in-the-loop',
   '오답의 고객응대·의사결정 활용',
   4, 3.0, 70),
  ('A08', 'D4', '개인정보·규제',
   '개인정보, 국외이전, 산업별 요구사항',
   '법적 분쟁·자동화 의사결정 문제',
   5, 3.5, 80),                          -- 금융·공공은 여기서 막히면 딜이 끝난다
  ('A09', 'D4', '저작권·계약',
   '입력·산출물 권리, 벤더 책임',
   '저작권·라이선스·계약 위반',
   3, 3.0, 90),
  ('A10', 'D5', '비용·확장성',
   '시트·Credit·API, 확장성과 종속성',
   '비용 증가·ROI 부족·벤더 종속',
   4, 3.0, 100)
on conflict (id) do update set
  domain_id = excluded.domain_id, name = excluded.name,
  checkpoints = excluded.checkpoints, concerns = excluded.concerns,
  weight = excluded.weight, threshold = excluded.threshold, sort_order = excluded.sort_order;

-- ── 딜 컬럼 ─────────────────────────────────────────────────────
alter table deals add column if not exists assessment_scores jsonb not null default '{}'::jsonb;
alter table deals add column if not exists assessment_totals jsonb not null default '{}'::jsonb;

comment on column deals.assessment_scores is
  '평가영역별 1~5점 {"A01":3,...}. 037 bridge 로 8개가 자동으로 차고 나머지는 STEP03 에서 확인한다';
comment on column deals.assessment_totals is
  '대분류별 집계 {"D1":{"score":2.8,"threshold":3.5,"answered":4,"ready":false},...}';

alter table assessment_domains enable row level security;
alter table assessment_areas   enable row level security;
revoke all on assessment_domains, assessment_areas from anon, authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 대분류 5 · 평가영역 10 이어야 한다.
select d.id, d.name, count(a.id) as "평가영역",
       string_agg(a.name, ', ' order by a.sort_order) as "구성"
  from assessment_domains d left join assessment_areas a on a.domain_id = d.id
 group by d.id, d.name, d.sort_order order by d.sort_order;
--
-- 2) 원문이 그대로 들어갔는가. 영업이 고객 앞에서 읽는 문장이다.
select id, name, checkpoints as "핵심 확인사항", concerns as "주요 우려사항",
       weight as "가중치", threshold as "기준"
  from assessment_areas order by sort_order;
--
-- 3) 딜 컬럼이 생겼는가.
select column_name from information_schema.columns
 where table_schema = current_schema() and table_name = 'deals'
   and column_name like 'assessment%';


-- ═══════════════════════════════════════════════════════════════
-- ▼ 037_readiness_assessment_bridge.sql
-- ═══════════════════════════════════════════════════════════════

-- 037. 42문항 → 10평가영역 bridge (1회성 시드)
--
-- 030 이 42→21 을 잇던 것과 같은 구조다. 21문항은 13/21(62%)이 찼는데 10평가영역은
-- **8/10(80%)** 이 찬다 — 두 문항집이 더 잘 맞물린다.
--
-- 못 채우는 둘(저장·보존 / 계정·접근통제)은 **순수 제품 통제 게이트**다. 42문항은
-- 조직이 AI 를 얼마나 하는지 묻지, SSO·SCIM 이 있는지·보존기간이 며칠인지 묻지 않는다.
-- 원래 영업이 확인해야 하는 것이라 STEP03 에서 후보별로 묻는다.
--
-- ⚠ 강도(fidelity)를 남기는 이유는 030 과 같다. ○ 는 뜻이 겹치되 각도가 조금 다르다 —
--   나중에 값이 이상할 때 어느 대응을 의심할지 알 수 있어야 한다.
--
-- ⚠ 여러 문항이 한 평가영역을 채우면 **평균**을 쓴다. 최댓값을 쓰면 하나만 잘해도
--   통과하고, 최솟값을 쓰면 하나만 못해도 막힌다. 둘 다 판정을 왜곡한다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

create table if not exists readiness_assessment_bridge (
  item_code text not null references readiness_items(code) on delete cascade,
  area_id   text not null references assessment_areas(id)  on delete cascade,
  fidelity  text not null check (fidelity in ('exact', 'good')),
  note      text not null,
  primary key (item_code, area_id)
);

comment on table readiness_assessment_bridge is
  '42문항 응답으로 10평가영역을 채우는 대응. 여러 문항이 한 영역을 채우면 평균을 쓴다';
comment on column readiness_assessment_bridge.fidelity is
  'exact=뜻이 같다 / good=실용상 같다. 값이 이상할 때 어느 대응을 의심할지 알려준다';

delete from readiness_assessment_bridge;
insert into readiness_assessment_bridge (item_code, area_id, fidelity, note) values
  -- ◎ 정확 — 뜻이 같다
  ('D7', 'A01', 'exact',
   'AI 학습 데이터에서 개인정보·민감정보를 자동 제거·처리하는 보안 체계 = 데이터 보호. '
   || '기획안의 "학습 사용 여부" 를 정면으로 묻는다'),
  ('G2', 'A07', 'exact',
   'AI 가 잘못된 정보를 사실처럼 말하는 문제를 막는 검증 체계 = 정확성·신뢰성. '
   || '기획안의 "결과검증" 과 같은 것을 묻는다'),
  ('G4', 'A08', 'exact',
   '새 AI 서비스를 만들 때부터 법무·규제 팀이 참여해 법적 위험을 사전 검토 = 개인정보·규제'),
  ('T7', 'A10', 'exact',
   'AI 운영 비용을 프로젝트·부서별로 투명하게 파악하고 낭비를 줄인다 = 비용·확장성의 비용 쪽'),

  -- ○ 좋음 — 실용상 같다
  ('D1', 'A04', 'good',
   '부서별 데이터를 전사 통합하고 필요한 부서가 접근 = 데이터 권한 연계. '
   || '기획안은 ACL 유지를, 42문항은 접근 가능성을 본다 — 통합이 안 돼 있으면 ACL 연계도 없다'),
  ('D3', 'A04', 'good',
   '현업이 필요한 데이터를 스스로 찾을 수 있는 검색 체계. D1 과 함께 평균을 낸다'),
  ('G7', 'A05', 'good',
   'AI 서비스 성능·오류율·비용 실시간 모니터링 = 감사·모니터링의 운영 쪽. '
   || '기획안의 질의·응답 로그까지는 안 묻는다'),
  ('D6', 'A05', 'good',
   '데이터 출처와 변경 이력 추적 = 감사·모니터링의 추적성 쪽. G7 과 함께 평균을 낸다'),
  ('T2', 'A06', 'good',
   '부서별 무분별 AI 도입을 막고 전사 통일 방식으로 사용·관리 = AI 행동 통제. '
   || '기획안은 Agent Tool Call 승인을, 42문항은 도구 사용 통제를 본다 — 통제 주체가 같다'),
  ('G1', 'A09', 'good',
   '허위정보·개인정보 유출·저작권 침해 위험을 체계적으로 관리 = 저작권·계약. '
   || '저작권이 세 위험 중 하나로 명시돼 있다'),
  ('T5', 'A10', 'good',
   'AI 연산 수요 급증에 유연히 대응하는 클라우드 인프라 = 비용·확장성의 확장성 쪽. '
   || 'T7 과 함께 평균을 낸다');

  -- ✕ 대응 없음 — 넣지 않는다
  --   A02 저장·보존      저장 위치·보존기간·삭제. 42문항은 제품 설정을 묻지 않는다
  --   A03 계정·접근통제  SSO·MFA·SCIM·RBAC. 위와 같다
  --   둘 다 STEP03 에서 후보별로 확인한다. 억지로 채우면 판정이 조용히 틀린다.

alter table readiness_assessment_bridge enable row level security;
revoke all on readiness_assessment_bridge from anon, authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 11건(◎4 ○7)이어야 하고 10영역 중 8개가 채워져야 한다.
select count(*) as "대응", count(distinct area_id) as "채워지는 영역",
       count(*) filter (where fidelity = 'exact') as "정확",
       count(*) filter (where fidelity = 'good')  as "좋음"
  from readiness_assessment_bridge;
--
-- 2) 어느 영역이 어떤 문항으로 차는가. 안 차는 둘이 A02·A03 이어야 한다.
select a.id, a.name,
       coalesce(string_agg(b.item_code, ', ' order by b.item_code), '— 영업 확인') as "42문항"
  from assessment_areas a
  left join readiness_assessment_bridge b on b.area_id = a.id
 group by a.id, a.name, a.sort_order order by a.sort_order;
--
-- 3) 실재하지 않는 문항·영역을 가리키는가. FK 가 잡지만 눈으로도 본다. **0건**
select b.item_code, b.area_id
  from readiness_assessment_bridge b
  left join readiness_items i on i.code = b.item_code and i.status = 'active'
  left join assessment_areas a on a.id = b.area_id and a.status = 'active'
 where i.code is null or a.id is null;


-- ═══════════════════════════════════════════════════════════════
-- ▼ 038_assessment_judgement.sql
-- ═══════════════════════════════════════════════════════════════

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
alter table packages  add column if not exists assessment_lift          jsonb not null default '{}'::jsonb;

comment on column solutions.assessment_coverage is
  '이 솔루션이 덮는 평가영역 [{area,strength}]. strength 1~3 — 21문항 fqa_coverage 를 대체';
comment on column solutions.assessment_prerequisites is
  '도입 전제 [{kind:assessment|numeric|manual, area, min, blocking, label, enabled_by}]';
comment on column packages.readiness_coverage is
  '이 패키지가 올려 주는 42문항 축 [{axis,strength}]. **후보 선정용** — 어느 고객에게 필요한가';
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
  select s.id as sid, m.area, max((e.value ->> 'strength')::int) as strength
    from solutions s,
         jsonb_array_elements(s.fqa_coverage) e,
         jsonb_array_elements_text(coalesce(e.value -> 'items', '[]'::jsonb)) it
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
select 'solution' as 종류, s.slug as id, e ->> 'area' as "없는 영역"
  from solutions s, jsonb_array_elements(s.assessment_coverage) e
  left join assessment_areas a on a.id = e ->> 'area' where a.id is null
union all
select 'package', p.id, k
  from packages p, jsonb_object_keys(p.assessment_lift) k
  left join assessment_areas a on a.id = k where a.id is null;

