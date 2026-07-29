-- 기획안 "6. ISV 확장 패키지 (Optional)" 정합.
-- Run after 018. Apply in the Supabase SQL Editor (dfbx).
--
-- 문제: 기획안이 지목한 ISV 9종 중 영업에게 지금 보이는 건 Articul8 하나뿐이다.
--
--   판정 데이터 있음         Articul8
--   카탈로그에 있으나 미판정  Zscaler · Portal26 · Check Point · New Relic
--                            → f0fc05a 로 영업 화면에서 숨겨진 상태
--   솔루션으로 없음          Slack · Notion · GitHub · GitLab
--
-- 반대로 지금 발행된 9종 중 8종은 기획안 ISV 패키지에 안 나온다. 추천 엔진이 내놓는
-- 조합과 기획안이 말하는 조합이 서로 다른 이야기를 하는 상태다.
--
-- 이 파일이 하는 일
--   A. 미판정 4종에 판정 데이터를 넣어 영업 화면에 되살린다
--   B. Slack·Notion·GitHub·GitLab 4종을 신규 등록한다 (빈 슬롯 business-app-agent 활용)
--   C. ISV 확장 패키지 5종을 DB 개념으로 세운다
--
-- ⚠ A·B 의 판정 값은 기획안 6장과 각 제품의 카탈로그 설명에서 뽑은 **초안**이다.
--   012 와 같은 성격이며 ISSU 가 /admin 에서 검토·수정하는 것을 전제로 한다.
--   1회성 시드다 — apply-migrations.js 에 넣지 않는다.
--
-- FQA 카테고리 (012 와 동일)
--   A 보안·거버넌스(6) : 데이터 분류와 민감도 기준 / 접근권한과 계정 체계 / 보안 게이트웨이 준비도
--                        / 감사 로그와 추적성 / 규제·컴플라이언스 검토 / 데이터 보존·삭제 정책
--   B 기술·연동(5)     : 업무 시스템 연동성 / 지식 소스 품질 / 개발·테스트 환경 / 확장성·성능 기준 / 모델·벤더 전환성
--   C 운영(5)          : 운영 책임자 지정 / 품질 평가 체계 / 장애 대응 체계 / 비용 모니터링 / 변경·배포 관리
--   D 비즈니스(5)      : 명확한 업무 문제 / 성과 KPI / 현업 오너십 / 변화관리·교육 / 예산·구매 준비도

begin;

-- ═══ A. 카탈로그에 있으나 판정 데이터가 없던 4종 ═══════════════

-- Zscaler — AI 트래픽 보안 경로·프록시·DLP. 기획안 04 AI Trust 의 한 축.
update solutions set
  fqa_coverage = '[
    {"category":"A","items":["보안 게이트웨이 준비도"],"strength":3},
    {"category":"A","items":["데이터 분류와 민감도 기준"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":2,"blocking":true,
     "label":"사용자 식별을 위한 IdP(SSO) 연동"},
    {"kind":"manual","label":"기존 SWG·프록시를 교체하거나 병행 운영하는 데 합의","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"타사 SWG 를 이미 운영 중이고 교체 계획 없음(T-D 트랙)",
     "alternatives":[{"slug":"portal26","label":"게이트웨이 교체 없이 사용 가시성만"}]},
    {"signal":"전 직원 인터넷 트래픽 프록시 경유에 노조·현업 반발",
     "alternatives":[{"label":"부서 단위 파일럿 선행"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 3, synergy = '높음'
  where slug = 'zscaler';

-- Check Point — AI 트래픽 보안 게이트웨이와 위협 방어. Zscaler 와 같은 슬롯이라
--   둘 다 추천되지 않는다(슬롯 경쟁). 기존 CP 자산이 있는 고객에게 붙는 자리다.
update solutions set
  fqa_coverage = '[
    {"category":"A","items":["보안 게이트웨이 준비도"],"strength":3},
    {"category":"A","items":["규제·컴플라이언스 검토"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":2,"blocking":true,
     "label":"사용자 식별을 위한 IdP(SSO) 연동"},
    {"kind":"manual","label":"기존 네트워크 보안 장비와의 정책 이중화 검토","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"네트워크 보안 자산이 전무하고 SaaS 만 쓰는 소규모",
     "alternatives":[{"slug":"portal26","label":"SaaS 기반 사용 가시성"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 2, synergy = '높음'
  where slug = 'check-point';

-- Portal26 — 누가 어떤 AI를 얼마나 쓰는지 가시화. Shadow AI 와 프롬프트 위험을 잡는다.
--   기획안 02 AI Trust & Guardrails 가 "Shadow AI 및 비인가 서비스 통제"를 명시한다.
update solutions set
  fqa_coverage = '[
    {"category":"A","items":["감사 로그와 추적성"],"strength":3},
    {"category":"A","items":["데이터 분류와 민감도 기준"],"strength":2},
    {"category":"C","items":["비용 모니터링"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"사용자·부서 식별이 가능한 계정 체계"},
    {"kind":"manual","label":"임직원 AI 사용 로그 수집에 대한 노무·개인정보 검토","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"AI 사용 인원이 수십 명 규모라 가시화 투자 대비 효과가 낮음",
     "alternatives":[{"label":"Enterprise 관리자 콘솔 기본 리포트"}]},
    {"signal":"직원 활동 로깅에 대한 사내 합의 불가",
     "alternatives":[{"label":"정책·교육 선행"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 2, synergy = '매우 높음'
  where slug = 'portal26';

-- New Relic — AI·애플리케이션 성능·비용·에러 관측. 기획안 03 AI Monitoring 패키지.
update solutions set
  fqa_coverage = '[
    {"category":"C","items":["품질 평가 체계","장애 대응 체계","비용 모니터링"],"strength":3}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"B","item":"개발·테스트 환경","min":3,"blocking":true,
     "label":"계측(instrumentation)을 넣을 수 있는 개발·배포 환경"},
    {"kind":"fqa","category":"C","item":"운영 책임자 지정","min":2,"blocking":true,
     "label":"대시보드를 보고 대응할 운영 담당"}
  ]'::jsonb,
  red_flags = '[
    {"signal":"자체 개발 없이 SaaS 만 구독해 계측할 대상이 없음",
     "alternatives":[{"label":"벤더 제공 사용량 리포트"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 2, synergy = '높음'
  where slug = 'new-relic';

-- ═══ B. 기획안이 지목했으나 카탈로그에 없던 4종 ═════════════════
-- business-app-agent 슬롯은 지금까지 비어 있었다(011 이 "ServiceNow/AgentForce/SAP
-- Joule 미등록"으로 표시). Slack·Notion 이 그 자리에 들어간다.

insert into solutions (slug, name, layer, category, jtbd, status, status_op, is_archived) values
  ('slack',  'Slack',  'L2', '협업·업무 에이전트',
   '대화 요약·Action Item 생성·업무 질의와 AI Agent 호출로 협업 생산성을 높인다',
   'published', 'active', false),
  ('notion', 'Notion', 'L2', '지식관리·문서 AI',
   '사내 지식 검색과 문서 기반 답변, 보고서·기획안 초안 작성을 지원한다',
   'published', 'active', false),
  ('github', 'GitHub', 'L3', '개발 워크플로 AI',
   'Codex 연계로 코드 리뷰·변경사항 요약·테스트·문서화·오류 분석을 지원한다',
   'published', 'active', false),
  ('gitlab', 'GitLab', 'L3', '개발 워크플로 AI',
   'Codex 연계로 코드 리뷰·변경사항 요약·테스트·문서화·오류 분석을 지원한다',
   'published', 'active', false)
on conflict (slug) do update set
  status = 'published', status_op = 'active', is_archived = false;

update solutions set slot = v.slot from (values
  ('slack',  'business-app-agent'),
  ('notion', 'business-app-agent'),
  ('github', 'ai-coding-env'),
  ('gitlab', 'ai-coding-env')
) as v(slug, slot) where solutions.slug = v.slug;

-- Slack — 업무 시스템 연동의 진입점. 사람이 이미 거기 있어서 도입 저항이 가장 낮다.
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["업무 시스템 연동성"],"strength":3},
    {"category":"D","items":["명확한 업무 문제","변화관리·교육"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":2,"blocking":true,
     "label":"워크스페이스 관리자 권한과 SSO"},
    {"kind":"manual","label":"사내 표준 협업도구가 Slack (Teams 주 사용 시 부적합)","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"Microsoft Teams 를 전사 표준으로 쓰고 있음",
     "alternatives":[{"label":"Teams 기반 코파일럿 검토"}]},
    {"signal":"대화 데이터의 외부 AI 전송에 보안 승인 불가",
     "alternatives":[{"slug":"portal26","label":"사용 통제 선행"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 3, synergy = '매우 높음'
  where slug = 'slack';

-- Notion — 지식 소스 품질을 직접 올린다. RAG 앞단의 사내 문서 정리 자리다.
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["지식 소스 품질"],"strength":3},
    {"category":"D","items":["명확한 업무 문제"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":2,"blocking":true,
     "label":"문서 권한(ACL)을 유지할 수 있는 계정 체계"}
  ]'::jsonb,
  red_flags = '[
    {"signal":"사내 문서가 전부 온프레미스 파일서버·그룹웨어에 있고 이관 계획 없음",
     "alternatives":[{"label":"기존 지식시스템 기반 RAG(AI-Ready Service)"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 2, synergy = '높음'
  where slug = 'notion';

-- GitHub / GitLab — Codex 효과를 측정 가능하게 만드는 자리. 기획안 "② 개발 생산성형"
--   진입 시나리오가 "개발조직의 정량 KPI 를 기준으로 Codex 효과 검증"이라고 못박는다.
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["개발·테스트 환경"],"strength":3},
    {"category":"C","items":["변경·배포 관리"],"strength":2},
    {"category":"D","items":["성과 KPI"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"B","item":"개발·테스트 환경","min":2,"blocking":true,
     "label":"형상관리와 CI 가 돌고 있는 개발 조직"},
    {"kind":"manual","label":"소스코드의 외부 AI 전송에 보안·법무 승인","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"소스코드 외부 반출 절대 불가(방산·금융 일부)",
     "alternatives":[{"slug":"articul8","label":"온프레미스 코드 어시스턴트"}]},
    {"signal":"형상관리가 사내 SVN·파일 공유 수준",
     "alternatives":[{"label":"개발 환경 현대화 선행"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 2, synergy = '높음'
  where slug in ('github', 'gitlab');

-- ═══ C. ISV 확장 패키지 5종 ════════════════════════════════════
-- packages(MZC 서비스)와 성격이 다르다. 저쪽은 사람이 하는 일이고 이쪽은 제품 묶음이다.
-- 같은 표에 넣으면 016 이 지적한 "사과와 오렌지" 문제가 되풀이되므로 별도로 둔다.

create table if not exists isv_bundles (
  id          text primary key,
  name        text not null,
  value_prop  text not null,
  is_priority boolean not null default false,   -- 기획안 "초기 우선 추진 패키지"
  entry_combo text,                             -- 우선 추진 시 제안 조합
  sort_order  int  not null default 0
);

create table if not exists isv_bundle_members (
  bundle_id     text not null references isv_bundles(id) on delete cascade,
  solution_slug text not null,
  sort_order    int  not null default 0,
  primary key (bundle_id, solution_slug)
);

comment on table isv_bundles is '기획안 6장 ISV 확장 패키지(Optional). MZC 서비스 packages 와 성격이 다르다';
comment on column isv_bundles.is_priority is '기획안 "초기 우선 추진 패키지" 4종 여부';

insert into isv_bundles (id, name, value_prop, is_priority, entry_combo, sort_order) values
  ('AI_WORKSPACE', 'AI Workspace',
   '대화 요약·문서 기반 답변·업무 질의로 협업 생산성을 높인다',
   true,  'OpenAI + Slack — 전사 협업과 업무 Agent 활용', 10),
  ('AI_DEVELOPER', 'AI Developer',
   'Codex 와 개발 Workflow 를 이어 코드 리뷰·변경 요약·테스트·문서화를 지원한다',
   true,  'OpenAI Codex + GitHub·GitLab — 개발 생산성 및 개발 Workflow 고도화', 20),
  ('AI_MONITORING', 'AI Monitoring',
   'OpenAI API 와 AI 애플리케이션의 응답시간·오류·사용량·Token 비용을 관측한다',
   true,  'OpenAI API + New Relic — AI 서비스의 품질·비용·오류 운영', 30),
  ('AI_TRUST', 'AI Trust',
   'Shadow AI·개인 계정·민감정보·AI 트래픽·Agent 실행을 가시화하고 통제한다',
   true,  'OpenAI + Check Point·Portal26 — 기업 AI 보안·거버넌스 및 사용 통제', 40),
  ('PRIVATE_AI', 'Private AI',
   '데이터 반출이 어려운 제조·금융·공공을 위한 에어갭·온프레미스 고보안 AI 환경',
   false, null, 50)
on conflict (id) do update set
  name = excluded.name, value_prop = excluded.value_prop,
  is_priority = excluded.is_priority, entry_combo = excluded.entry_combo,
  sort_order = excluded.sort_order;

insert into isv_bundle_members (bundle_id, solution_slug, sort_order) values
  ('AI_WORKSPACE',  'slack',       10),
  ('AI_WORKSPACE',  'notion',      20),
  ('AI_DEVELOPER',  'github',      10),
  ('AI_DEVELOPER',  'gitlab',      20),
  ('AI_MONITORING', 'new-relic',   10),
  ('AI_TRUST',      'check-point', 10),
  ('AI_TRUST',      'portal26',    20),
  ('AI_TRUST',      'zscaler',     30),
  ('PRIVATE_AI',    'articul8',    10)
on conflict (bundle_id, solution_slug) do update set sort_order = excluded.sort_order;

alter table isv_bundles        enable row level security;
alter table isv_bundle_members enable row level security;
revoke all on isv_bundles, isv_bundle_members from anon, authenticated;

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
-- 1) 기획안 ISV 9종이 전부 발행·판정 완료여야 한다. "판정없음"이 나오면 안 된다.
select s.slug, s.name, s.status, s.status_op,
       case when jsonb_array_length(s.fqa_coverage) > 0 then '있음' else '판정없음' end as "판정 데이터",
       coalesce(sl.name, '(슬롯 미배정)') as "슬롯"
  from solutions s left join solution_slots sl on sl.id = s.slot
 where s.slug in ('slack','notion','github','gitlab','new-relic',
                  'check-point','portal26','zscaler','articul8')
 order by s.slug;

-- 2) 번들 구성. 멤버가 실제 솔루션을 가리키는지 함께 본다.
select b.name as "패키지", case when b.is_priority then '우선' else '' end as "우선추진",
       string_agg(coalesce(s.name, m.solution_slug || ' ⚠없는 슬러그'), ', ' order by m.sort_order) as "구성"
  from isv_bundles b
  left join isv_bundle_members m on m.bundle_id = b.id
  left join solutions s on s.slug = m.solution_slug
 group by b.id, b.name, b.is_priority, b.sort_order order by b.sort_order;

-- 3) 영업에게 보이는 솔루션 수. 019 로 9종 → 17종이 되어야 한다.
select count(*) filter (where jsonb_array_length(fqa_coverage) > 0) as "판정 완료(영업에게 보임)",
       count(*) filter (where jsonb_array_length(fqa_coverage) = 0) as "판정 없음(숨김)",
       count(*) as "전체"
  from solutions where is_archived = false and status = 'published';

-- 4) 빈 슬롯이 얼마나 줄었는지. business-app-agent 가 채워져야 한다.
select sl.id, sl.name, count(s.id) as "후보"
  from solution_slots sl
  left join solutions s on s.slot = sl.id and s.is_archived = false
 group by sl.id, sl.name, sl.sort_order having count(s.id) = 0 order by sl.sort_order;
