-- OpenAI 통합 오퍼링 기획안 v0.1 (2026-07-28, ISV BU) 반영 — 5대 코어 오퍼링.
-- Run after 016. Apply in the Supabase SQL Editor (dfbx).
--
-- 무엇이 바뀌나: 지금까지 패키지 6종은 각자 독립된 상품이었다. 기획안은 이것을
-- 5개 상위 오퍼링으로 묶는다. "고객이 이해하기 쉽고 Sales가 반복적으로 제안할 수
-- 있도록" 이 목적이므로, 영업이 보는 단위는 오퍼링이고 딜사이징 단위는 패키지다.
--
--   01 AI Consulting & PoC        DS/PS   DISCOVERY + POC
--   02 AI Trust & Guardrails      DS/PS   SECURITY
--   03 AI-Ready Service           PS      INTEGRATION
--   04 AI Adoption & Change Mgmt  PS      ADOPTION
--   05 Billing & Managed Service  MS      OPERATE
--
-- DISCOVERY 와 POC 는 한 오퍼링으로 보이되 행은 둘로 남긴다. 기간(2주 / 4~6주)과
-- 공수가 다르고 기획안도 "AI Consulting (PoC 비용 별도)"로 분리 과금을 명시한다.
-- 한 행으로 합치면 STEP04 딜사이징에서 PoC 만 떼어 파는 딜을 표현할 수 없다.
--
-- 판정 데이터(fqa_coverage·readiness_lift)도 기획안의 제공 범위에 맞춰 다시 쓴다.
-- 014·016 이 만든 값을 덮어쓰므로 그 두 파일은 이제 이력용이다.
--
-- ⚠ readiness_lift 는 여전히 추정치다. 016 의 경고가 그대로 유효하다.

begin;

-- ── 오퍼링 (영업이 제안하는 단위) ────────────────────────────────
create table if not exists offerings (
  id           text primary key,
  name         text not null,
  kind         text not null,          -- DS / PS / MS / DS·PS
  purpose      text not null,          -- 핵심 목적
  composition  text not null,          -- 대표 구성
  note         text,
  sort_order   int  not null default 0
);

comment on table offerings is '기획안 5대 코어 오퍼링. 영업 제안 단위이며 딜사이징 단위는 packages';

insert into offerings (id, name, kind, purpose, composition, note, sort_order) values
  ('01', 'AI Consulting & PoC', 'DS·PS',
   '도입 방향·우선 유즈케이스·사업성 검증',
   'OpenAI 제품·라이선스, TCO, Discovery, PoC',
   'PoC 비용은 별도 산정한다', 10),
  ('02', 'AI Trust & Guardrails', 'DS·PS',
   '안전하고 통제 가능한 AI 환경 확보',
   '정책, Security Guide, 데이터 보호, Agent 통제',
   'HALO·Check Point·Portal26 등 고객 환경에 필요한 솔루션을 선택 연계', 20),
  ('03', 'AI-Ready Service', 'PS',
   'AI 활용을 위한 데이터·기술·거버넌스 기반 구축',
   'Architecture, Governance, RAG, API Connect',
   'AIR Unit 전문인력의 M/D 또는 M/M 기반으로 별도 산정', 30),
  ('04', 'AI Adoption & Change Management', 'PS',
   '사용자 정착과 조직 변화·전사 확산',
   '교육, Champion, Change Plan, 성과측정', null, 40),
  ('05', 'Billing & Managed Service', 'MS',
   '비용·사용량·품질·장애의 지속 운영',
   'Billing, Credit·Token, Monitoring, Support', null, 50)
on conflict (id) do update set
  name = excluded.name, kind = excluded.kind, purpose = excluded.purpose,
  composition = excluded.composition, note = excluded.note,
  sort_order = excluded.sort_order;

alter table packages add column if not exists offering_id text references offerings(id);
comment on column packages.offering_id is '소속 오퍼링. 화면은 오퍼링 단위로 묶고 견적은 패키지 단위로 낸다';

-- ── 패키지 6행: 이름·소속 오퍼링 ────────────────────────────────
-- DISCOVERY·POC 는 기획안 01 의 본문 문구를 그대로 쓰므로 이름을 바꾸지 않는다.
update packages set offering_id = '01' where id in ('DISCOVERY', 'POC');
update packages set offering_id = '02', name = 'AI Trust & Guardrails',
  target = 'AI 사용정책·데이터 보호·Agent 통제 설계' where id = 'SECURITY';
update packages set offering_id = '03', name = 'AI-Ready Service',
  target = '데이터·업무시스템 연결과 거버넌스 기반 구축' where id = 'INTEGRATION';
update packages set offering_id = '04', name = 'AI Adoption & Change Management',
  target = '사용자 정착·Champion 육성·전사 확산' where id = 'ADOPTION';
update packages set offering_id = '05', name = 'Billing & Managed Service',
  target = '비용·사용량·품질·장애의 지속 운영' where id = 'OPERATE';

-- ── 산출물 (기획안 "핵심 산출물" 문구) ──────────────────────────
update package_items set label = 'AI 도입 로드맵, 제품·라이선스 구성안, TCO'
  where package_id = 'DISCOVERY' and type = 'deliverable';
update package_items set label = 'PoC 평가 리포트 및 확장 권고안'
  where package_id = 'POC' and type = 'deliverable';
update package_items set label = 'AI Trust Framework, Security Architecture, 정책·통제 체크리스트 및 솔루션 적용안'
  where package_id = 'SECURITY' and type = 'deliverable';
update package_items set label = 'Governance Framework, Reference Architecture, RAG·API·Workflow 연동환경 및 운영 이관 문서'
  where package_id = 'INTEGRATION' and type = 'deliverable';
update package_items set label = '역할별 교육과정, Champion 운영안, Change Plan, 확산 키트 및 성과측정 리포트'
  where package_id = 'ADOPTION' and type = 'deliverable';
update package_items set label = 'Billing·Chargeback 대시보드, SLO 대시보드, 월간 비용·운영·최적화 리포트'
  where package_id = 'OPERATE' and type = 'deliverable';

-- ── 판정 데이터 ─────────────────────────────────────────────────
-- 01 DISCOVERY. 기획안이 "시트·Workspace Credit·API 사용량을 반영한 TCO 및 예산
--   시뮬레이션"을 제공 범위에, TCO 를 핵심 산출물에 넣었다. 그래서 이번에 D
--   "예산·구매 준비도"를 덮는다 — 6종 중 아무도 이 문항을 못 덮던 구멍이 메워진다.
--   (그 전까지 이 문항이 막힌 ISV 는 선행 패키지를 찾지 못해 전부 탈락했다.)
update packages set
  fqa_coverage = '[
    {"category":"D","items":["명확한 업무 문제","성과 KPI","예산·구매 준비도"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"D": 1.2}'::jsonb
  where id = 'DISCOVERY';

-- 01 POC. 4~6주 기술·업무 검증. 개발·테스트 환경을 실제로 세우고 성공 KPI 를 확정한다.
update packages set
  fqa_coverage = '[
    {"category":"B","items":["개발·테스트 환경"],"strength":2},
    {"category":"D","items":["명확한 업무 문제","성과 KPI"],"strength":2}
  ]'::jsonb,
  readiness_lift = '{"B": 0.8, "D": 0.8}'::jsonb
  where id = 'POC';

-- 02 AI Trust & Guardrails. A 6문항을 정면으로 다룬다(범위는 넓어졌지만 축은 그대로).
--   기획안이 더한 것: Agent Tool Call·외부전송 승인체계, 프롬프트·파일 DLP,
--   Shadow AI 통제. 전부 A 안에 있는 이야기다.
update packages set
  fqa_coverage = '[
    {"category":"A","items":["데이터 분류와 민감도 기준","접근권한과 계정 체계","보안 게이트웨이 준비도",
                             "감사 로그와 추적성","규제·컴플라이언스 검토","데이터 보존·삭제 정책"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"A": 1.5}'::jsonb
  where id = 'SECURITY';

-- 03 AI-Ready Service. 여기가 이번에 가장 많이 넓어졌다.
--   기획안 제공 범위 첫 줄이 "AI·데이터 Governance 정책, 데이터 분류 및 사용자별
--   접근권한 설계"다. 즉 A 를 일부 덮는다. 다만 설계 수준이라 02(strength 3)보다
--   얕게 2 로 두고, lift 도 02 의 1.5 가 아니라 0.8 로 둔다.
--   Reference Architecture 가 확장성·성능 기준을, 운영 이관 체계가 변경·배포 관리를 다룬다.
update packages set
  fqa_coverage = '[
    {"category":"B","items":["업무 시스템 연동성","지식 소스 품질","확장성·성능 기준"],"strength":3},
    {"category":"A","items":["데이터 분류와 민감도 기준","접근권한과 계정 체계"],"strength":2},
    {"category":"C","items":["변경·배포 관리"],"strength":2}
  ]'::jsonb,
  readiness_lift = '{"B": 1.5, "A": 0.8}'::jsonb
  where id = 'INTEGRATION';

-- 04 AI Adoption & Change Management. 성과측정 리포트가 산출물이라 성과 KPI 를 더한다.
update packages set
  fqa_coverage = '[
    {"category":"D","items":["현업 오너십","변화관리·교육","성과 KPI"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"D": 1.2}'::jsonb
  where id = 'ADOPTION';

-- 05 Billing & Managed Service. C 전체. Billing·Chargeback 이 붙어 비용 모니터링이 깊어졌다.
--   D "예산·구매 준비도"는 일부러 넣지 않는다 — 도입 후 비용 관리이지 도입 전 예산
--   확보가 아니다. 순서가 뒤집힌 선행 제안이 나오면 영업이 곤란해진다.
update packages set
  fqa_coverage = '[
    {"category":"C","items":["운영 책임자 지정","품질 평가 체계","장애 대응 체계",
                             "비용 모니터링","변경·배포 관리"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"C": 1.5}'::jsonb
  where id = 'OPERATE';

alter table offerings enable row level security;
revoke all on offerings from anon, authenticated;

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
-- 1) 6종 전부 오퍼링에 붙어야 한다. (미배정) 이 나오면 안 된다.
select coalesce(p.offering_id, '(미배정)') as "오퍼링", o.name as "오퍼링명",
       string_agg(p.id, ', ' order by p.sort_order) as "패키지"
  from packages p left join offerings o on o.id = p.offering_id
 group by p.offering_id, o.name, o.sort_order order by o.sort_order;

-- 2) 어느 FQA 문항을 아무 패키지도 못 올리는지. 017 이후 "예산·구매 준비도"가
--    목록에서 빠져야 한다 — 그게 이 파일의 핵심 변경이다.
with items(c, item) as (values
  ('A','데이터 분류와 민감도 기준'),('A','접근권한과 계정 체계'),('A','보안 게이트웨이 준비도'),
  ('A','감사 로그와 추적성'),('A','규제·컴플라이언스 검토'),('A','데이터 보존·삭제 정책'),
  ('B','업무 시스템 연동성'),('B','지식 소스 품질'),('B','개발·테스트 환경'),
  ('B','확장성·성능 기준'),('B','모델·벤더 전환성'),
  ('C','운영 책임자 지정'),('C','품질 평가 체계'),('C','장애 대응 체계'),
  ('C','비용 모니터링'),('C','변경·배포 관리'),
  ('D','명확한 업무 문제'),('D','성과 KPI'),('D','현업 오너십'),
  ('D','변화관리·교육'),('D','예산·구매 준비도'))
select i.c as "카테고리", i.item as "문항",
       coalesce(string_agg(p.id, ', ' order by p.sort_order), '(없음)') as "덮는 패키지"
  from items i
  left join packages p on exists (
    select 1 from jsonb_array_elements(p.fqa_coverage) e
     where e->>'category' = i.c and (e->'items') ? i.item)
 group by i.c, i.item order by i.c, i.item;

-- 3) 같은 문항을 둘 이상이 덮는 곳(= 선행 후보가 경합하는 지점). A 접근권한이
--    SECURITY·INTEGRATION 둘 다에 잡히는 것이 정상이다. 엔진은 strength 가 높은
--    쪽을 고른다.
select e->>'category' as "카테고리", it as "문항",
       string_agg(p.id || '(' || (e->>'strength') || ')', ', ' order by p.sort_order) as "후보"
  from packages p,
       jsonb_array_elements(p.fqa_coverage) e,
       jsonb_array_elements_text(e->'items') it
 group by 1, 2 having count(*) > 1 order by 1, 2;
