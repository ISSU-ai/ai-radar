-- ===================================================================
-- 통합 적용 스크립트 (자동 생성 — scripts/build-pending-sql.js)
--
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번에 실행합니다.
-- 파일을 직접 수정하지 마세요. 원본은 db/migrations/ 의 개별 파일입니다.
--
-- 포함: 017_offering_v01.sql → 018_fqa_pain_map.sql → 019_isv_offering_alignment.sql → 020_solution_visibility.sql → 022_portal26_content.sql → 023_cohere.sql → 021_seed_visible_catalog.sql
--
-- 실행 후 각 파일 끝의 검증 쿼리 결과를 눈으로 확인하세요.
--   011: 슬롯 미배정 0건 / 슬롯별 후보 수 / 레이어 정정 4건
--   012: 판정 데이터 9건 · 미보강 13건 · 깨진 slug 0건
--   013: enum 에 curator 포함 · 역할별 인원
-- ===================================================================

-- ═══════════════════════════════════════════════════════════════
-- ▼ 017_offering_v01.sql
-- ═══════════════════════════════════════════════════════════════

-- OpenAI 통합 오퍼링 기획안 반영 — 5대 코어 오퍼링.
-- Run after 016. Apply in the Supabase SQL Editor (dfbx).
--
-- ⚠ 기준 문서: **제출본 2026-08-02**
--   처음엔 v0.1(2026-07-28)로 썼는데 제출본에서 오퍼링 구성이 바뀌었다.
--   미적용 상태라 이 파일을 직접 고쳤다. v0.1 기준으로 적용된 DB 는 없다.
--
--   | | v0.1 (폐기) | 제출본 (현행) |
--   |01| AI Consulting **& PoC**   | AI Consulting            |
--   |02| **AI Trust & Guardrails** | **OpenAI Ready** (DS&PS) |
--   |03| AI-Ready Service          | AIR Service (AI-Ready)   |
--   |04| AI Adoption & Change Mgmt | (동일)                   |
--   |05| Billing & Managed Service | (동일)                   |
--
--   02 는 이름이 아니라 상품이 바뀌었다. 제출본 02 는 "기업용 OpenAI 제품을 공급하고
--   안전하게 사용할 수 있는 기본 환경 구성"이고 유형이 DS&PS(제품 공급 포함)다.
--   `Trust & Guardrails` 는 오퍼링에서 빠지고 도입 3단계 중 Step 1(통제)의 제공
--   내용으로 흡수됐다.
--
--   PoC 는 01 → 03 으로 옮겨졌다 ("OpenAI API 기반 맞춤형 AI 애플리케이션 개발 및 PoC").
--
-- 무엇이 바뀌나: 지금까지 패키지 6종은 각자 독립된 상품이었다. 기획안은 이것을
-- 5개 상위 오퍼링으로 묶는다. 영업이 보는 단위는 오퍼링이고 딜사이징 단위는 패키지다.
--
--   01 AI Consulting                  PS      DISCOVERY
--   02 OpenAI Ready                   DS·PS   SECURITY
--   03 AIR Service (AI-Ready)         PS      POC + INTEGRATION
--   04 AI Adoption & Change Mgmt      PS      ADOPTION
--   05 Billing & Managed Service      MS      OPERATE
--
-- **패키지 이름은 원래대로 둔다.** 03 에 패키지가 둘(POC·INTEGRATION) 붙으므로
-- 패키지 이름을 오퍼링 이름으로 바꾸면 둘 다 'AIR Service' 가 되어 구분이 사라진다.
-- 오퍼링과 패키지는 1:N 이다 — 이름을 같게 만들 이유가 없다.
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
  ('01', 'AI Consulting', 'PS',
   '고객의 AI 준비 수준과 업무 목표를 진단하고 최적의 OpenAI 도입안 설계',
   'AI Readiness Assessment 6대 영역 진단, Gap 분석 및 솔루션 제시, 라이선스·Credit·비용 설계',
   '라이선스 도입 고객에게 초기 진단은 표준 범위 내 무상. 심화 컨설팅은 별도 산정', 10),
  ('02', 'OpenAI Ready', 'DS·PS',
   '기업용 OpenAI 제품을 공급하고 안전하게 사용할 수 있는 기본 환경 구성',
   'Business·Enterprise·Codex·API, Workspace·관리자·사용자·권한·보안 설정, 기본 사용정책 및 온보딩, 기초 교육',
   '라이선스 도입 고객에게 초기 구축은 표준 범위 내 무상. 심화 교육·맞춤 연계·PoC·추가 구축은 별도 산정', 20),
  ('03', 'AIR Service (AI-Ready)', 'PS',
   '고객 데이터와 업무시스템을 연결하여 기업용 AI 서비스와 Agent 를 구축하는 전문서비스',
   '데이터 정제, RAG, Agent, MCP·Workflow 연계, 데이터 권한 및 Governance Architecture',
   'AIR Unit 전문인력의 M/D 또는 M/M 기반으로 프로젝트 규모에 따라 별도 산정', 30),
  ('04', 'AI Adoption & Change Management', 'PS',
   '사용자 정착과 조직 변화·전사 확산',
   '교육, Champion, Change Plan, 성과측정', null, 40),
  ('05', 'Billing & Managed Service', 'MS',
   'OpenAI 라이선스·사용량·비용·운영 관리',
   'Billing, Credit·Token, Monitoring, Support',
   '마진 구조·원화 Billing 제공 가능 여부·관리자 권한 위임 범위 확인 후 세부 Scope 확정', 50)
on conflict (id) do update set
  name = excluded.name, kind = excluded.kind, purpose = excluded.purpose,
  composition = excluded.composition, note = excluded.note,
  sort_order = excluded.sort_order;

alter table packages add column if not exists offering_id text references offerings(id);
comment on column packages.offering_id is '소속 오퍼링. 화면은 오퍼링 단위로 묶고 견적은 패키지 단위로 낸다';

-- ── 패키지 6행: 소속 오퍼링 ─────────────────────────────────────
-- 이름은 001 시드 그대로 둔다. 오퍼링과 1:N 이라 이름을 겹치면 03 아래 두 패키지가
-- 구분되지 않는다. 바뀌는 것은 소속(offering_id)과 대상 문구(target)뿐이다.
update packages set offering_id = '01',
  target = 'AI 준비도 진단·Gap 분석과 우선 과제 도출' where id = 'DISCOVERY';
update packages set offering_id = '02',
  target = 'OpenAI 관리·보안 설정과 기본 사용정책 수립' where id = 'SECURITY';
-- PoC 는 제출본에서 03 AIR Service 소속이다 (v0.1 의 01 이 아니다).
update packages set offering_id = '03',
  target = '핵심 유즈케이스 기술·업무 검증' where id = 'POC';
update packages set offering_id = '03',
  target = '데이터·업무시스템 연결과 거버넌스 기반 구축' where id = 'INTEGRATION';
update packages set offering_id = '04',
  target = '사용자 정착·Champion 육성·전사 확산' where id = 'ADOPTION';
update packages set offering_id = '05',
  target = '비용·사용량·품질·장애의 지속 운영' where id = 'OPERATE';

-- ── 산출물 (기획안 "핵심 산출물" 문구) ──────────────────────────
update package_items set label = 'AI 도입 로드맵, 제품·라이선스 구성안, TCO'
  where package_id = 'DISCOVERY' and type = 'deliverable';
update package_items set label = 'PoC 평가 리포트 및 확장 권고안'
  where package_id = 'POC' and type = 'deliverable';
update package_items set label = 'Workspace·권한·보안 설정 내역, 기본 AI 사용정책, 관리자 가이드 및 온보딩 자료'
  where package_id = 'SECURITY' and type = 'deliverable';
update package_items set label = 'Governance Framework, Reference Architecture, RAG·API·Workflow 연동환경 및 운영 이관 문서'
  where package_id = 'INTEGRATION' and type = 'deliverable';
update package_items set label = '역할별 교육과정, Champion 운영안, Change Plan, 확산 키트 및 성과측정 리포트'
  where package_id = 'ADOPTION' and type = 'deliverable';
update package_items set label = 'Billing·Chargeback 대시보드, SLO 대시보드, 월간 비용·운영·최적화 리포트'
  where package_id = 'OPERATE' and type = 'deliverable';

-- ── 판정 데이터 ─────────────────────────────────────────────────
-- 01 AI Consulting · DISCOVERY. 기획안이 "시트·Workspace Credit·API 사용량을 반영한 TCO 및 예산
--   시뮬레이션"을 제공 범위에, TCO 를 핵심 산출물에 넣었다. 그래서 이번에 D
--   "예산·구매 준비도"를 덮는다 — 6종 중 아무도 이 문항을 못 덮던 구멍이 메워진다.
--   (그 전까지 이 문항이 막힌 ISV 는 선행 패키지를 찾지 못해 전부 탈락했다.)
update packages set
  fqa_coverage = '[
    {"category":"D","items":["명확한 업무 문제","성과 KPI","예산·구매 준비도"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"D": 1.2}'::jsonb
  where id = 'DISCOVERY';

-- 03 AIR Service · POC. 4~6주 기술·업무 검증. 개발·테스트 환경을 실제로 세우고 성공 KPI 를 확정한다.
update packages set
  fqa_coverage = '[
    {"category":"B","items":["개발·테스트 환경"],"strength":2},
    {"category":"D","items":["명확한 업무 문제","성과 KPI"],"strength":2}
  ]'::jsonb,
  readiness_lift = '{"B": 0.8, "D": 0.8}'::jsonb
  where id = 'POC';

-- 02 OpenAI Ready · SECURITY. A 6문항을 정면으로 다룬다.
--   제출본 02 의 제공 범위가 Workspace·관리자·사용자·권한·보안 설정, SSO·도메인·
--   보존정책 등 OpenAI Native 관리·보안 기능, 기본 AI 사용정책이다. 전부 A 안이다.
--   ※ 02 의 표준 범위는 라이선스 도입 고객에게 무상이다. 이 패키지는 그 위의
--     심화 범위(정책 설계·통제 체크리스트)를 유상으로 다루는 자리다.
update packages set
  fqa_coverage = '[
    {"category":"A","items":["데이터 분류와 민감도 기준","접근권한과 계정 체계","보안 게이트웨이 준비도",
                             "감사 로그와 추적성","규제·컴플라이언스 검토","데이터 보존·삭제 정책"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"A": 1.5}'::jsonb
  where id = 'SECURITY';

-- 03 AIR Service · INTEGRATION. 여기가 이번에 가장 많이 넓어졌다.
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


-- ═══════════════════════════════════════════════════════════════
-- ▼ 018_fqa_pain_map.sql
-- ═══════════════════════════════════════════════════════════════

-- Appendix G "Enterprise AI 도입 평가기준" 5 대분류 / 10 평가영역 매핑.
-- Run after 017. Apply in the Supabase SQL Editor (dfbx).
--
-- 왜 매핑만 하고 축은 안 바꾸나: 두 체계는 목적이 다르다.
--
--   FQA A/B/C/D 21문항   "이 고객이 도입할 준비가 됐는가"   진단·전제 판정용
--   Appendix G 5분류     "이 고객이 무엇을 걱정하는가"       제안·Trust 설계 체크리스트용
--
-- 기획안도 Appendix G 를 "Discovery·PoC 및 Trust 설계 시 체크리스트로 활용"이라고
-- 규정한다. 진단 문항을 대체하라는 뜻이 아니다. 게다가 진단 문항·fqa_coverage·
-- prerequisites·추천 엔진이 전부 4축에 묶여 있어, 축을 갈면 STEP03 을 다시 만들어야 한다.
--
-- 그래서 4축은 그대로 두고 대응표만 심는다. 영업이 "고객이 ①데이터·보안을 걱정한다"고
-- 말할 때 어느 진단 문항을 봐야 하는지 기계가 답할 수 있으면 목적은 달성된다.
--
-- ⚠ 알아둘 것 두 가지 (아래 검증 쿼리 3·4 가 그대로 드러낸다)
--   1. G4 "저작권·계약"(입력·산출물 권리, 벤더 책임)에 대응하는 진단 문항이 없다.
--      현재 A "규제·컴플라이언스 검토" 한 문항이 개인정보·규제까지만 담당한다.
--      문항을 늘릴지는 ISSU 판단이므로 여기서는 빈 채로 드러내기만 한다.
--   2. FQA 문항 21개 중 7개는 대응되는 평가영역이 없다. B "개발·테스트 환경",
--      C "운영 책임자 지정"·"장애 대응 체계", D 4문항 전부. 우려가 아니라 추진
--      준비도라서 그렇다 — 누락이 아니라 두 체계의 성격 차이다.

begin;

create table if not exists fqa_pain_categories (
  id         text primary key,          -- G1..G5
  marker     text not null,             -- ①..⑤
  label      text not null,
  sort_order int  not null default 0
);

create table if not exists fqa_pain_areas (
  id            text primary key,
  pain_category text not null references fqa_pain_categories(id),
  label         text not null,
  checkpoints   text,                   -- 핵심 확인사항
  concerns      text,                   -- 주요 우려사항
  sort_order    int  not null default 0
);

-- 한 문항이 여러 평가영역에 걸리고, 한 평가영역도 여러 문항에 걸린다(다대다).
create table if not exists fqa_item_pain_map (
  fqa_category text not null,           -- A/B/C/D
  fqa_item     text not null,
  pain_area    text not null references fqa_pain_areas(id),
  primary key (fqa_category, fqa_item, pain_area)
);

comment on table fqa_pain_categories is 'Appendix G 5 대분류. 고객 우려(Pain Point) 기준';
comment on table fqa_pain_areas      is 'Appendix G 10 평가영역';
comment on table fqa_item_pain_map   is 'FQA 진단 문항 ↔ 평가영역 대응. 축을 대체하지 않고 잇기만 한다';

insert into fqa_pain_categories (id, marker, label, sort_order) values
  ('G1', '①', '데이터·보안',  10),
  ('G2', '②', '운영·통제',    20),
  ('G3', '③', '신뢰·책임',    30),
  ('G4', '④', '법률·규제',    40),
  ('G5', '⑤', '비용·사업성',  50)
on conflict (id) do update set
  marker = excluded.marker, label = excluded.label, sort_order = excluded.sort_order;

insert into fqa_pain_areas (id, pain_category, label, checkpoints, concerns, sort_order) values
  ('data-protection',  'G1', '데이터 보호',
   '학습 사용 여부, 암호화, 고객사 간 분리', '기밀정보·고객정보·소스코드 유출', 10),
  ('retention',        'G1', '저장·보존',
   '저장 위치, 보존기간, 삭제 및 종료 후 처리', '해외 저장·백업 잔존·국외 이전', 20),
  ('access-control',   'G1', '계정·접근통제',
   'SSO, MFA, SCIM, RBAC, 퇴사자 권한 회수', '개인·공용·퇴사자 계정 통제 실패', 30),
  ('acl-inheritance',  'G1', '데이터 권한 연계',
   '기존 문서·메일·시스템 ACL 유지', '비인가 내부 데이터 접근', 40),
  ('audit-monitoring', 'G2', '감사·모니터링',
   '질문, 파일, 답변, 관리자·실행 로그', '사고 원인·사용자 추적 불가', 50),
  ('agent-control',    'G2', 'AI 행동 통제',
   'Agent Tool Call, 파일·메일·외부전송 승인', '위험한 작업의 임의 실행', 60),
  ('accuracy',         'G3', '정확성·신뢰성',
   '출처, 평가, 결과검증, Human-in-the-loop', '오답의 고객응대·의사결정 활용', 70),
  ('privacy-reg',      'G4', '개인정보·규제',
   '개인정보, 국외이전, 산업별 요구사항', '법적 분쟁·자동화 의사결정 문제', 80),
  ('ip-contract',      'G4', '저작권·계약',
   '입력·산출물 권리, 벤더 책임', '저작권·라이선스·계약 위반', 90),
  ('cost-scalability', 'G5', '비용·확장성',
   '시트·Credit·API, 확장성과 종속성', '비용 증가·ROI 부족·벤더 종속', 100)
on conflict (id) do update set
  pain_category = excluded.pain_category, label = excluded.label,
  checkpoints = excluded.checkpoints, concerns = excluded.concerns,
  sort_order = excluded.sort_order;

insert into fqa_item_pain_map (fqa_category, fqa_item, pain_area) values
  -- ① 데이터·보안
  ('A', '데이터 분류와 민감도 기준', 'data-protection'),
  ('A', '데이터 보존·삭제 정책',     'retention'),
  ('A', '접근권한과 계정 체계',      'access-control'),
  ('A', '접근권한과 계정 체계',      'acl-inheritance'),
  ('B', '업무 시스템 연동성',        'acl-inheritance'),
  ('B', '지식 소스 품질',            'acl-inheritance'),
  -- ② 운영·통제
  ('A', '감사 로그와 추적성',        'audit-monitoring'),
  ('A', '보안 게이트웨이 준비도',    'agent-control'),
  ('C', '변경·배포 관리',            'agent-control'),
  -- ③ 신뢰·책임
  ('B', '지식 소스 품질',            'accuracy'),
  ('C', '품질 평가 체계',            'accuracy'),
  -- ④ 법률·규제
  ('A', '규제·컴플라이언스 검토',    'privacy-reg'),
  -- ip-contract 는 대응 문항 없음. 위 주석 ⚠1 참조.
  -- ⑤ 비용·사업성
  ('C', '비용 모니터링',             'cost-scalability'),
  ('D', '예산·구매 준비도',          'cost-scalability'),
  ('B', '확장성·성능 기준',          'cost-scalability'),
  ('B', '모델·벤더 전환성',          'cost-scalability')
on conflict do nothing;

alter table fqa_pain_categories enable row level security;
alter table fqa_pain_areas      enable row level security;
alter table fqa_item_pain_map   enable row level security;
revoke all on fqa_pain_categories, fqa_pain_areas, fqa_item_pain_map from anon, authenticated;

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
-- 1) 5 대분류 / 10 평가영역이 다 들어갔는가.
select c.marker || ' ' || c.label as "대분류", count(a.id) as "평가영역",
       string_agg(a.label, ', ' order by a.sort_order) as "구성"
  from fqa_pain_categories c left join fqa_pain_areas a on a.pain_category = c.id
 group by c.id, c.marker, c.label, c.sort_order order by c.sort_order;

-- 2) 대분류별로 어느 진단 문항을 보면 되는가 (영업 화면이 쓸 질의).
select c.marker || ' ' || c.label as "대분류", a.label as "평가영역",
       coalesce(string_agg(m.fqa_category || '/' || m.fqa_item, ', '), '(대응 문항 없음)') as "진단 문항"
  from fqa_pain_areas a
  join fqa_pain_categories c on c.id = a.pain_category
  left join fqa_item_pain_map m on m.pain_area = a.id
 group by c.marker, c.label, c.sort_order, a.label, a.sort_order
 order by c.sort_order, a.sort_order;

-- 3) ⚠1 — 대응 문항이 없는 평가영역. "저작권·계약" 1건이 나오는 것이 현재 상태다.
select a.id, a.label as "평가영역", a.checkpoints as "핵심 확인사항"
  from fqa_pain_areas a
 where not exists (select 1 from fqa_item_pain_map m where m.pain_area = a.id)
 order by a.sort_order;

-- 4) ⚠2 — 대응 평가영역이 없는 진단 문항. 7건이 나오는 것이 정상이다(추진 준비도 축).
with items(c, item) as (values
  ('A','데이터 분류와 민감도 기준'),('A','접근권한과 계정 체계'),('A','보안 게이트웨이 준비도'),
  ('A','감사 로그와 추적성'),('A','규제·컴플라이언스 검토'),('A','데이터 보존·삭제 정책'),
  ('B','업무 시스템 연동성'),('B','지식 소스 품질'),('B','개발·테스트 환경'),
  ('B','확장성·성능 기준'),('B','모델·벤더 전환성'),
  ('C','운영 책임자 지정'),('C','품질 평가 체계'),('C','장애 대응 체계'),
  ('C','비용 모니터링'),('C','변경·배포 관리'),
  ('D','명확한 업무 문제'),('D','성과 KPI'),('D','현업 오너십'),
  ('D','변화관리·교육'),('D','예산·구매 준비도'))
select i.c as "카테고리", i.item as "문항"
  from items i
 where not exists (
   select 1 from fqa_item_pain_map m where m.fqa_category = i.c and m.fqa_item = i.item)
 order by i.c, i.item;


-- ═══════════════════════════════════════════════════════════════
-- ▼ 019_isv_offering_alignment.sql
-- ═══════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════
-- ▼ 020_solution_visibility.sql
-- ═══════════════════════════════════════════════════════════════

-- 020. 솔루션 노출 토글
--
-- 왜 is_archived 를 재활용하지 않는가:
--   is_archived 는 "치웠다"는 뜻이고 DELETE 라우트가 세운다. 그런데 관리자 목록
--   조회(/api/solutions)도 is_archived = false 로 거르기 때문에, 한 번 아카이브하면
--   어드민 화면에서도 사라져 되돌릴 버튼이 없다 — 사실상 편도다.
--   status(draft/published)는 "작성 중"이라는 뜻이고 curator 발행 워크플로와 엮여 있어
--   전용할 수 없다.
--   그래서 "데이터는 두되 영업 화면에서만 감춘다"는 뜻의 컬럼을 따로 판다.
--
-- 초기 노출 목록은 021 에 따로 둔다. 이 파일은 스키마만 바꾸므로 몇 번을 돌려도
-- 관리자가 어드민에서 켜고 끈 상태를 덮어쓰지 않는다.

begin;

alter table solutions
  add column if not exists is_hidden boolean not null default false;

comment on column solutions.is_hidden is
  '영업 화면(카탈로그·추천·탐색기)에서 감춘다. 데이터는 그대로 남고 어드민에서 되돌릴 수 있다.';

-- 목록·추천 후보 조회가 항상 is_hidden = false 로 거르므로 부분 인덱스로 충분하다.
create index if not exists idx_solutions_visible
  on solutions (is_hidden)
  where is_hidden = false;

commit;

-- 확인용
--   select count(*) filter (where is_hidden) as 숨김,
--          count(*) filter (where not is_hidden) as 노출
--     from solutions where is_archived = false;


-- ═══════════════════════════════════════════════════════════════
-- ▼ 022_portal26_content.sql
-- ═══════════════════════════════════════════════════════════════

-- 022. Portal26 콘텐츠 채우기 (1회성 시드)
--
-- Portal26 은 007 로 등록만 되어 있고 8탭 본문이 비어 있었다. 노출 목록 8종 중
-- 하나인데 상세를 열면 빈 화면이라 영업이 쓸 수가 없다.
--
-- 출처: portal26.ai 공식 사이트 (2026-08-03 확인) · PR Newswire 보도자료 ·
--       portal26.ai/shadow-ai-discovery-engine/
--
-- ⚠️ 표기 원칙
--   1. 벤더가 스스로 낸 수치는 "벤더 주장"으로 명시했다. 고객 앞에서 우리 검증치처럼
--      말하면 안 된다.
--   2. 배포·연동 방식(로그 수집 경로, 지원 데이터 소스, 사전 조건)은 공개 자료에
--      없다. §7 에 "확인 필요"로 남겼다. 모르는 것을 아는 척 쓰면 PoC 에서 깨진다.
--   3. 가격은 공개 정보가 없다. 넣지 않았다.
--
-- ⚠️ apply-migrations.js 에서 제외한다. ISSU 가 /admin 에서 고친 본문을 덮어쓰는
--    1회성 시드다 (012·021 과 같은 성격).

begin;

update solutions set
  delivery    = 'SaaS',
  synergy     = '높음',
  category    = 'AI 거버넌스·가시성 (AI TRiSM)',
  jtbd        = '누가 어떤 AI를 얼마나 쓰는지 가시화하고, Shadow AI·프롬프트 위험·토큰 비용을 통제',
  value_chain = 'AI Governance',
  sections = jsonb_build_object(
'1', E'Portal26 은 스스로를 **AI Adoption Management Platform (AiTrism Platform)** 으로 규정합니다. "From AI Visibility to Value in 3 simple steps" 라는 구호대로 **가시성(Visibility) → 보안(Security) → 가치 실현(Value Realization)** 세 단계를 하나의 플랫폼에서 다룹니다. 기존 보안 제품이 "막는 것"에 머무는 데 비해, 얼마나 쓰이고 있고 그 사용이 성과로 이어지는지까지 본다는 점이 다릅니다.\n\n- **제품 라인업(모듈)**\n  - *가시성*: Shadow AI Discovery (Zero-Day), Agentic AI Management\n  - *보안*: AI Risk Management & Security(리스크 탐지기 35종 이상), AI Prompt Protection(실시간 인라인 제어), AI Audit & Forensics, AI Policy Management, AI Data Security\n  - *가치 실현*: AI Adoption Analytics, AI User Intent & Use Case Discovery, AI License Intelligence, AI Strategy & ROI, Agentic Token Control\n- **차별적 비즈니스 가치**\n  - ① **Shadow AI 를 네트워크 목적지 단위로 본다.** 임직원이 방문한 외부 목적지를 분석해 직접 사용(direct)뿐 아니라 다른 SaaS 에 **내장된(embedded) AI** 까지 실시간으로 잡아냅니다. 벤더 주장 기준 "legacy SWG·DLP 대비 200% 더 많은 Shadow AI 발견".\n  - ② **감사 증적이 인증을 받았다.** 프롬프트·응답을 담는 포렌식 저장소가 **NIST FIPS 인증**이며, 회사 차원으로 **SOC 2 Type II** 를 보유합니다. 스스로를 "the only NIST, SOC2-Certified AiTrism Platform" 이라 표현합니다.\n  - ③ **비용·라이선스까지 본다.** License Intelligence 와 Agentic Token Control 로 미사용 시트와 에이전트 토큰 낭비를 잡습니다. 벤더 주장 기준 "AI 지출 낭비 최대 40% 절감".\n- **규모(벤더 공개 수치)**: 월 10억 건 이상 트랜잭션, 사용자 50만 명 이상, 활성화 30분, ROI 72시간.\n- **배포 형태**: SaaS.\n- **주목할 점**: **Portal26 for Claude** — Claude 기업 배포용 보안·거버넌스를 **무상**으로 제공하는 별도 프로그램이 있습니다. 우리 카탈로그의 Anthropic Claude 와 직접 엮이는 자리입니다.',

'2', E'- **Primary Layer: Q4. AI Infrastructure**\n  - 판단 근거: 모델을 제공하지 않고, 이미 쓰이고 있는 AI 트래픽·프롬프트·비용을 관측하고 통제하는 층에 있습니다. 어떤 LLM 을 고르든 그 위에 얹힙니다.\n- **Secondary Layer: Q1. Enterprise General Build AI**\n  - 판단 근거: 전사 임직원의 AI 사용을 대상으로 하므로 범용 AI 확산 단계에서 같이 검토됩니다.\n### 2.1 타 솔루션과의 아키텍처 정합성 (궁합)\n- **Zscaler / Check Point 와의 관계**: 겹치지 않습니다. SWG 는 **경로를 통제**하고 Portal26 은 **사용을 해석**합니다. 게이트웨이를 이미 운영 중이라 교체가 어려운 고객에게 "장비 교체 없이 가시성만" 얹는 조합이 자연스럽습니다.\n- **OpenAI Enterprise / Anthropic Claude 와의 관계**: 보완재입니다. 벤더 관리자 콘솔은 자사 서비스 안만 보지만, Portal26 은 **승인되지 않은 AI 까지** 함께 봅니다.\n- **New Relic 과의 관계**: 대상이 다릅니다. New Relic 은 우리가 만든 AI 서비스의 성능·오류를, Portal26 은 임직원이 쓰는 AI 의 사용·위험을 봅니다.',

'3', E'### 3.1 산업 적합도\n- **○ 매우 적합**: 금융·보험, 공공, 제조 대기업 — 규제 대응과 감사 증적 요구가 크고, 임직원 수가 많아 Shadow AI 노출면이 넓습니다.\n- **△ 보통**: 유통·서비스 — 필요성은 있으나 감사 증적 요구가 낮아 도입 명분을 별도로 만들어야 합니다.\n- **✕ 부적합**: AI 사용 인원이 수십 명 수준인 조직 — 벤더 관리자 콘솔 기본 리포트로 충분합니다.\n### 3.2 핵심 의사결정 페르소나\n- **CISO / CIO (의사결정자)**: Shadow AI 로 인한 데이터 유출과 감사 대응이 관심사입니다. 사고 시 "누가 무엇을 입력했는가" 를 답할 수 있는지가 핵심 질문입니다.\n- **CDO / Chief AI Officer (활용 책임자)**: 도입한 AI 가 실제로 쓰이는지, 어느 부서가 어떤 목적으로 쓰는지를 봅니다.\n- **CFO / 재무 (예산 책임자)**: 시트·토큰 비용 대비 효과. License Intelligence 가 직접 겨냥하는 대상입니다.\n- **정보보호·개인정보 담당 (게이트키퍼)**: 임직원 활동 로깅이라 노무·개인정보 검토를 통과해야 합니다. **이 사람이 반대하면 딜이 멈춥니다.**',

'4', E'Portal26 도입 시 메가존클라우드가 설계하는 연결 구조입니다.\n- **1) 사용 수집 레이어**: 사내에서 나가는 외부 목적지 트래픽을 분석해 AI 서비스 사용을 식별합니다. 직접 사용(ChatGPT·Claude 등)과 다른 SaaS 에 내장된 AI 를 함께 봅니다.\n- **2) 프롬프트 검사·통제 레이어**: 인라인으로 프롬프트를 검사해 민감정보 유출과 위험 요청을 탐지·차단합니다. 리스크 탐지기 35종 이상이 여기서 동작합니다.\n- **3) 포렌식 저장 레이어**: 질의·응답·관리 변경 이력을 NIST FIPS 인증 저장소에 남깁니다. 사고 조사와 규제 대응의 근거가 되는 부분입니다.\n- **4) 분석·연계 레이어 (MZC 핵심 영역)**: 부서별 사용량·라이선스·토큰 비용을 분석하고, 결과를 기존 보안 도구(SIEM·SWG 등)로 넘깁니다. 고객의 계정 체계·조직도와 매핑해 "부서별 리포트" 를 만드는 구간이 우리가 붙는 자리입니다.\n\n**⚠️ 미확인 구간**: 로그 수집 경로(프록시 연동 / 에이전트 설치 / 로그 포워딩 중 무엇인지), 지원 데이터 소스 목록, 사전 요구사항은 **공개 자료에 없습니다.** 위 1) 레이어의 구체적 구현은 벤더 확인 후 확정해야 합니다.',

'5', E'- **UC1. 금융권 Shadow AI 실태 파악 및 통제**\n  - 기대효과: 임직원이 실제로 쓰는 AI 서비스 목록 확보, 미승인 서비스 차단, 감사 대응 증적 확보\n  - MZC 역할: 사용 수집 연동 설계, 고객 조직도·계정 체계 매핑, 부서별 리포트 정의, 정보보호·노무 검토 지원\n- **UC2. 전사 AI 라이선스 최적화**\n  - 기대효과: 미사용 시트 회수와 부서별 재배분으로 라이선스 지출 절감 (벤더 주장 최대 40%)\n  - MZC 역할: 사용량 데이터와 계약 시트 대사, 부서별 Chargeback 기준 수립, 갱신 협상 근거 산출\n- **UC3. Claude 기업 도입 시 거버넌스 동시 확보**\n  - 기대효과: Portal26 for Claude 무상 프로그램으로 도입 초기 비용 없이 사용 가시성 확보\n  - MZC 역할: Claude 라이선스 공급과 함께 거버넌스 초기 구성, 이후 유상 모듈로 확장 설계',

'6', E'- **Portal26**\n  - 강점: Shadow AI 발견 범위(내장 AI 포함), NIST FIPS 인증 포렌식 저장소, 사용 가시성에서 라이선스·ROI 까지 이어지는 범위\n  - 약점: 배포·연동 방식이 공개돼 있지 않아 사전 검증 부담이 있음. 임직원 활동 로깅이라 사내 합의가 선행돼야 함\n  - 적합도: 감사 증적과 규제 대응이 중요한 대기업\n- **Zscaler (SWG/ZTNA)**\n  - 강점: 네트워크 경로 자체를 잡으므로 차단이 확실함. 이미 도입된 고객이 많음\n  - 약점: "무엇을 입력했는가" 수준의 프롬프트 해석과 AI 특화 리스크 탐지는 범위 밖\n  - 적합도: 트래픽 통제가 우선인 고객\n- **벤더 관리자 콘솔 (OpenAI·Claude 기본 제공)**\n  - 강점: 추가 비용 없음, 도입 즉시 사용 가능\n  - 약점: 자사 서비스 안만 보임. **승인되지 않은 AI 는 애초에 안 보인다**는 것이 핵심 한계\n  - 적합도: 단일 벤더만 쓰고 Shadow AI 우려가 낮은 조직',

'7', E'### 7.1 필수 요건 (5가지)\n- [ ] 사용자·부서를 식별할 수 있는 계정 체계(IdP/SSO 또는 조직도 연동)가 있는가?\n- [ ] 임직원 AI 사용 로그 수집에 대해 노무·개인정보 검토를 통과할 수 있는가?\n- [ ] 수집 대상 트래픽에 접근할 수 있는가? (**연동 방식은 벤더 확인 필요 — 아래 7.4**)\n- [ ] AI 사용 정책을 정하고 집행할 주체(정보보호 또는 AI 거버넌스 담당)가 지정돼 있는가?\n- [ ] AI 사용 인원이 가시화 투자에 값하는 규모인가? (수백 명 이상 권장)\n### 7.2 권장 요건 (5가지)\n- [ ] 부서별 비용 배분(Chargeback) 을 적용할 회계 기준이 있는가?\n- [ ] 기존 SIEM·SWG 로 결과를 넘길 계획이 있는가?\n- [ ] AI 라이선스 계약 정보(시트 수·갱신일)를 확보할 수 있는가?\n- [ ] 사고 발생 시 포렌식 증적을 요구하는 규제·내부 규정이 있는가?\n- [ ] Claude 또는 OpenAI 기업용 도입이 이미 진행 중인가? (동시 제안 기회)\n### 7.3 부적합 신호: Red Flag (5가지)\n- [ ] 1. AI 사용 인원이 수십 명 규모 ➔ **벤더 관리자 콘솔 기본 리포트로 유도**\n- [ ] 2. 직원 활동 로깅에 대한 사내 합의 불가 ➔ **도입 보류, 정책 수립 선행**\n- [ ] 3. 사용자 식별 체계가 없고 도입 계획도 없음 ➔ **부서 단위 집계로 범위 축소 또는 보류**\n- [ ] 4. 요구가 "차단" 하나뿐이고 분석은 불필요 ➔ **Zscaler·Check Point 제안**\n- [ ] 5. 우리가 만든 AI 서비스의 성능·오류 관측이 목적 ➔ **New Relic 제안**\n### 7.4 벤더 확인 필요 (공개 자료에 없음)\n- [ ] 로그 수집 방식 — 프록시 연동 / 에이전트 설치 / 로그 포워딩 중 무엇인가?\n- [ ] 지원하는 데이터 소스 목록 (SWG·방화벽·SIEM 등)\n- [ ] 데이터 저장 위치와 국내 리전 제공 여부 — **금융·공공 딜에서 먼저 막히는 항목**\n- [ ] 가격 체계 (공개 정보 없음)\n- [ ] Portal26 for Claude 무상 프로그램의 범위와 유상 전환 조건',

'8', E'### 8.1 세일즈 핏치 및 영업 팁\n- **CISO 설득 화법**: "지금 회사에서 어떤 AI 가 쓰이고 있는지 목록으로 답하실 수 있습니까? 대부분 못 답합니다. 막는 것보다 먼저 보는 것이 순서입니다."\n- **CFO 설득 화법**: 보안 예산이 막히면 비용 축으로 바꿉니다. "산 시트 중 실제로 쓰이는 비율을 아십니까?" — License Intelligence 는 보안이 아니라 재무 언어로 팔립니다.\n- **진입 경로**: **Portal26 for Claude 무상 프로그램**이 가장 낮은 문턱입니다. Claude 도입 딜에 거버넌스를 무상으로 얹어 들어간 뒤 유상 모듈로 확장하는 그림이 자연스럽습니다.\n- **먼저 만나야 할 사람**: 정보보호·개인정보 담당입니다. 임직원 활동 로깅이라 이 사람이 반대하면 CISO 가 사도 못 씁니다. **기술 검증보다 노무·개인정보 검토를 먼저 잡으십시오.**\n- **주의**: 벤더 수치(200%, 40%, 72시간)를 우리 검증치처럼 말하지 마십시오. "벤더 발표 기준" 을 붙여야 PoC 에서 안 깨집니다.\n- **MZC 시너지 번들링**: 단독 라이선스 리셀은 마진이 얇습니다. 고객 조직도·계정 체계 매핑, 부서별 리포트 정의, SIEM 연계를 PS 로 묶어야 딜이 커집니다. AI Governance ISV 패키지(오퍼링 맵)의 지정 제품이므로 02 OpenAI Ready · 05 Billing & Managed Service 와 함께 제안하십시오.\n\n[의견] 이 제품의 진짜 경쟁자는 다른 벤더가 아니라 "그냥 안 하기" 입니다. Shadow AI 는 사고가 나기 전에는 아무도 아프지 않습니다. 그래서 보안 논리만으로는 예산이 안 나오고, **라이선스 낭비라는 재무 논리를 같이 들고 가야** 결재가 납니다.'
  ),
  updated_at = now()
  where slug = 'portal26';

commit;

-- 확인
--   select slug, delivery, category,
--          jsonb_object_keys(sections) as 섹션
--     from solutions where slug = 'portal26';
--
--   select slug, length(sections->>'1') as 개요, length(sections->>'7') as 체크리스트
--     from solutions where slug = 'portal26';


-- ═══════════════════════════════════════════════════════════════
-- ▼ 023_cohere.sql
-- ═══════════════════════════════════════════════════════════════

-- 023. Cohere 신규 등록 (1회성 시드)
--
-- 021 의 노출 목록 8종 중 유일하게 카탈로그에 없던 제품이다. Unique 설명 안에
-- 경쟁제품으로 한 줄 언급될 뿐이었다(isv_data.js).
--
-- 출처: cohere.com (2026-08-03 확인) · Carahsoft 공동 보도자료(2026-07-30) ·
--       AMD-Cohere 협력 발표
--
-- 슬롯을 llm-platform 으로 둔 이유:
--   Cohere 는 자체 모델(Command·Embed·Rerank)과 워크플레이스 플랫폼(North)을 가진
--   범용 LLM 플랫폼이다. 고객이 OpenAI·Claude 와 **하나를 고르는** 자리이지 함께
--   쓰는 자리가 아니다. private-domain-platform(Articul8 자리)에 넣으면
--   "OpenAI Enterprise + Cohere" 같은 조합이 나오는데, SaaS LLM 과 온프레 LLM 을
--   같이 제안하는 꼴이라 말이 안 된다.
--
-- ⚠ 표기 원칙 (022 와 동일)
--   1. 벤더 주장은 "벤더 주장" 으로 명시한다.
--   2. 가격은 공개 정보가 없다. 넣지 않는다.
--   3. 한국 리전·국내 레퍼런스는 확인된 자료가 없다. §7 에 확인 항목으로 남긴다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

insert into solutions (slug, name, delivery, layer, synergy, category, jtbd, value_chain,
                       status, status_op, is_archived)
values (
  'cohere', 'Cohere', 'SaaS / VPC / On-prem', 'L1', '높음',
  'GenAI / 범용 LLM (데이터 주권형)',
  '데이터를 외부로 내보내지 않고 다국어 검색·RAG·에이전트를 기업 내부에 구축',
  'AI Platform', 'published', 'active', false
)
on conflict (slug) do update set
  delivery = excluded.delivery, layer = excluded.layer, synergy = excluded.synergy,
  category = excluded.category, jtbd = excluded.jtbd, value_chain = excluded.value_chain,
  status = 'published', status_op = 'active', is_archived = false;

-- 슬롯 배정 (011 분류표)
update solutions set slot = 'llm-platform' where slug = 'cohere';

-- ── 8탭 본문 ────────────────────────────────────────────────────
update solutions set sections = jsonb_build_object(
'1', E'Cohere 는 **"Your data. Your infrastructure. Cohere keeps it that way"** 를 내세우는 엔터프라이즈 LLM 벤더입니다. OpenAI·Anthropic 과 같은 범용 LLM 자리에 있지만, **데이터를 자사 클라우드로 가져가지 않는 배포 형태**를 상품의 중심에 둔다는 점이 다릅니다.\n\n- **제품 라인업**\n  - **North** — 에이전트·지능형 검색·업무 자동화를 묶은 엔터프라이즈 AI 워크플레이스 플랫폼. 전사 배포와 데이터 격리를 전제로 설계됐습니다.\n  - **Command** — 멀티모달·다국어 생성 모델. **49개 언어** 지원(벤더 주장).\n  - **Embed / Rerank** — 검색·검색품질 개선 모델. RAG 파이프라인의 정확도를 올리는 자리에 씁니다.\n  - **Compass** — 지능형 검색·발견.\n  - **Transcribe** — 음성 인식(14개 언어). **North Mini Code** — 코딩 모델.\n- **차별적 비즈니스 가치**\n  - ① **배포 형태가 선택지다.** VPC · 온프레미스 · **에어갭(air-gapped)** · 하이브리드를 지원하고, Cohere 가 운영해 주는 전용 추론 환경(**Model Vault**)도 있습니다. 공공 부문에는 **zero data egress** 를 명시합니다.\n  - ② **검색이 강점이다.** Embed·Rerank 는 생성보다 **검색·재순위**에 특화된 별도 모델입니다. 사내 문서가 많고 정확도가 중요한 RAG 에서 붙는 자리입니다.\n  - ③ **다국어.** Command 49개 언어. 국내 기업 중 해외 법인·다국어 문서를 함께 다뤄야 하는 고객에게 의미가 있습니다.\n- **컴플라이언스**: GDPR · SOC 2 준수를 표방합니다. Trust Center 를 운영합니다.\n- **최근 동향**: 2026-07-30 Carahsoft 와 미국 공공부문 소버린 AI 공급 파트너십. AMD 와 소버린 배포용 인프라 협력.\n- **가격**: 공개 정보 없음.',

'2', E'- **Primary Layer: Q1. Enterprise General Build AI**\n  - 판단 근거: 자체 모델과 워크플레이스 플랫폼을 가진 범용 LLM 입니다. 고객이 전사 AI 기반으로 무엇을 쓸지 고르는 자리에 있습니다.\n- **Secondary Layer: Q4. AI Infrastructure**\n  - 판단 근거: VPC·온프레 배포 시 인프라 설계가 딜의 절반을 차지합니다.\n### 2.1 타 솔루션과의 아키텍처 정합성 (궁합)\n- **OpenAI Enterprise / Anthropic Claude 와의 관계**: **대체재입니다.** 같은 슬롯(범용 LLM 플랫폼)에서 하나를 고릅니다. 갈림길은 성능이 아니라 **데이터가 밖으로 나가도 되는가**입니다.\n- **Articul8 과의 관계**: 둘 다 폐쇄망을 말하지만 결이 다릅니다. Articul8 은 **제조 도메인 특화 모델 오케스트레이션**, Cohere 는 **다국어 검색·RAG 와 에이전트 플랫폼**입니다. 제조 현장 데이터가 중심이면 Articul8, 문서·지식 검색이 중심이면 Cohere 입니다.\n- **Vector DB 와의 관계**: 보완재입니다. Embed 로 임베딩을 만들고 벡터 저장소에 넣는 구성이 일반적입니다.\n- **AWS 와의 관계**: Cohere 모델은 Amazon Bedrock 에서 호출할 수 있습니다. AWS 기반 고객에게는 이 경로가 도입 문턱을 크게 낮춥니다 — **MZC 가 가장 잘 하는 자리**입니다.',

'3', E'### 3.1 산업 적합도\n- **○ 매우 적합**: 금융·보험, 공공, 헬스케어 — 데이터 반출이 규제로 막혀 있고 사내 문서 검색 수요가 큰 영역입니다. 벤더도 이 7개 산업(기술·금융·헬스케어·제조·에너지·공공·통신)을 전면에 둡니다.\n- **△ 보통**: 제조 — 가능하나 현장 데이터 중심이면 Articul8 이 더 맞습니다.\n- **✕ 부적합**: 데이터 반출에 제약이 없고 임직원 생산성만 목적인 조직 — SaaS LLM 이 더 싸고 빠릅니다.\n### 3.2 핵심 의사결정 페르소나\n- **CIO / CDO (의사결정자)**: "데이터가 어디에 머무는가" 가 첫 질문이자 사실상 유일한 질문인 고객입니다.\n- **정보보호·컴플라이언스 (게이트키퍼)**: 반출 불가 요건이 도입 근거 자체라 **우호적인 편**입니다. 다른 LLM 딜과 반대 구도입니다.\n- **인프라 운영 리더 (실행 주체)**: VPC·온프레 배포는 이 사람의 일이 됩니다. **여기서 막히면 딜이 멈춥니다.**\n- **현업 지식관리 담당**: 사내 문서 검색 품질이 실제 성과를 좌우합니다.',

'4', E'Cohere 도입 시 메가존클라우드가 설계하는 구조입니다. 배포 형태에 따라 셋으로 갈립니다.\n- **1) Bedrock 경유 (가장 가벼움)**: AWS 를 이미 쓰는 고객은 Amazon Bedrock 에서 Command·Embed 를 호출합니다. 별도 인프라 없이 리전·네트워크 통제를 고객이 유지합니다. **초기 검증은 대부분 이 경로가 맞습니다.**\n- **2) VPC 배포**: 고객 VPC 안에 모델을 올립니다. 인스턴스 타입·GPU 확보·오토스케일링 설계가 MZC 몫입니다.\n- **3) 온프레미스 / 에어갭**: 고객 데이터센터에 구축합니다. 하드웨어 산정, 모델 업데이트 경로, 운영 이관까지 범위가 커집니다. **딜 규모가 가장 크고 리드타임도 가장 깁니다.**\n- **4) 검색 파이프라인 (공통·MZC 핵심 영역)**: 사내 문서 수집·정제 → Embed 로 임베딩 → 벡터 저장소 적재 → 질의 시 Rerank 로 재순위. 정확도를 결정하는 구간이고 우리가 값을 만드는 자리입니다.\n\n**⚠ 미확인**: 국내 리전 제공 여부와 국내 구축 레퍼런스는 확인된 자료가 없습니다. 공공·금융 딜에서 먼저 물어보는 항목이므로 벤더 확인이 필요합니다.',

'5', E'- **UC1. 금융권 사내 규정·계약 문서 검색**\n  - 기대효과: 규정 해석에 걸리던 시간 단축, 데이터 반출 없이 RAG 구축\n  - MZC 역할: 문서 수집·정제 파이프라인, Embed·Rerank 튜닝, 벡터 저장소 설계, VPC 배포\n- **UC2. 공공기관 폐쇄망 지식 검색**\n  - 기대효과: 외부 반출 없이(zero data egress) 내부 문서 검색·요약\n  - MZC 역할: 온프레 구축, 하드웨어 산정, 모델 업데이트 경로 설계, 운영 이관\n- **UC3. 다국어 문서를 함께 다루는 글로벌 사업 조직**\n  - 기대효과: 한국어·영어·현지어 문서를 한 검색 인덱스에서 처리\n  - MZC 역할: 다국어 임베딩 품질 검증, 언어별 평가셋 구성, Bedrock 경유 구성',

'6', E'- **Cohere**\n  - 강점: VPC·온프레·에어갭까지 배포 선택지가 넓음, 검색·재순위 전용 모델 보유, 다국어 49개 언어(벤더 주장)\n  - 약점: 범용 대화 성능·생태계에서 OpenAI·Anthropic 에 밀림. 국내 레퍼런스와 한국어 품질에 대한 공개 근거 부족\n  - 적합도: 데이터 반출이 막혀 있으면서 문서 검색이 핵심인 고객\n- **OpenAI Enterprise**\n  - 강점: 임직원 친숙도와 생태계가 가장 큼, 도입이 가장 빠름\n  - 약점: 데이터가 벤더 클라우드로 나감. 완전 폐쇄망 불가\n  - 적합도: 반출 제약이 없고 전사 생산성이 목적인 고객\n- **Anthropic Claude**\n  - 강점: 긴 문서 추론과 안전성, Bedrock 경유로 리전 통제 가능\n  - 약점: 완전 에어갭은 불가\n  - 적합도: 리전 통제로 충분하고 긴 문서 해석이 중요한 고객\n- **Articul8**\n  - 강점: 제조 도메인 특화 모델 오케스트레이션, 에어갭 실적\n  - 약점: 범용 문서 검색·다국어는 범위 밖\n  - 적합도: 제조 현장 데이터가 중심인 폐쇄망 고객',

'7', E'### 7.1 필수 요건 (5가지)\n- [ ] AI 에 투입할 데이터 범위와 민감도 등급이 정해져 있는가? (검색 인덱스 대상이 정해져야 시작한다)\n- [ ] 배포 형태가 정해졌는가? (Bedrock 경유 / VPC / 온프레·에어갭)\n- [ ] VPC·온프레 선택 시 인프라를 확보하고 운영할 주체가 있는가?\n- [ ] 사용자 식별을 위한 SSO 인프라가 있는가?\n- [ ] 검색 정확도를 판정할 평가 기준과 평가셋을 만들 수 있는가?\n### 7.2 권장 요건 (5가지)\n- [ ] 사내 문서가 검색 가능한 형태로 정제되어 있는가? (PDF·스캔본 비중 확인)\n- [ ] 벡터 저장소 선택과 운영 계획이 있는가?\n- [ ] 다국어 문서 비중이 실제로 유의미한가? (Cohere 강점이 살아나는 조건)\n- [ ] AWS 를 이미 쓰고 있는가? (Bedrock 경유로 문턱이 크게 낮아진다)\n- [ ] 모델 업데이트·재학습 주기에 대한 합의가 있는가? (온프레는 특히)\n### 7.3 부적합 신호: Red Flag (5가지)\n- [ ] 1. 데이터 반출 제약이 없고 임직원 생산성만 목적 ➔ **OpenAI Enterprise·Claude 제안**\n- [ ] 2. 제조 현장 데이터 중심 폐쇄망 ➔ **Articul8 제안**\n- [ ] 3. 인프라를 운영할 조직이 없는데 온프레를 요구 ➔ **Bedrock 경유로 축소 또는 보류**\n- [ ] 4. 검색 대상 문서가 정제돼 있지 않고 정제 예산도 없음 ➔ **데이터 정비 선행(AIR Service)**\n- [ ] 5. 대화형 챗봇 UX 친숙도가 도입 기준 ➔ **ChatGPT 계열 제안**\n### 7.4 벤더 확인 필요 (공개 자료에 없음)\n- [ ] **국내 리전 제공 여부** — 금융·공공에서 가장 먼저 막히는 항목\n- [ ] 국내 구축 레퍼런스와 한국어 품질 근거\n- [ ] 가격 체계 (공개 정보 없음)\n- [ ] 온프레·에어갭 배포의 최소 하드웨어 요건\n- [ ] Bedrock 에서 쓸 수 있는 모델 목록과 리전',

'8', E'### 8.1 세일즈 핏치 및 영업 팁\n- **어디서 이기나**: 성능 비교로는 못 이깁니다. **"이 데이터를 밖으로 내보낼 수 있습니까?"** 하나로 판이 갈립니다. 답이 "아니오" 인 순간 OpenAI·Claude 가 후보에서 빠지고 Cohere 와 Articul8 만 남습니다.\n- **첫 질문**: "지금 검토 중인 문서가 외부 클라우드로 나가도 되는 자료입니까?" — 이 질문 하나로 딜 성격이 정해집니다.\n- **Articul8 과의 갈림길**: 제조 현장 데이터면 Articul8, 문서·지식 검색이면 Cohere 입니다. 둘을 같이 제안하지 마십시오. 고객이 혼란스러워하고 둘 다 놓칩니다.\n- **진입 경로는 Bedrock**: 온프레부터 제안하면 인프라 논의에 빠져 몇 달이 갑니다. **AWS 고객에게는 Bedrock 경유로 먼저 검증**하고, 반출 제약이 확인되면 VPC·온프레로 확장하는 순서가 빠릅니다.\n- **정보보호 담당이 우군입니다**: 다른 LLM 딜에서는 게이트키퍼지만 여기서는 도입 근거를 만들어 주는 사람입니다. 먼저 만나십시오.\n- **주의**: 49개 언어·zero data egress 는 벤더 주장입니다. **국내 리전과 한국어 품질은 확인된 자료가 없습니다.** PoC 없이 약속하지 마십시오.\n- **SI 번들 마진 전략**: 모델 라이선스만으로는 얇습니다. 값은 검색 파이프라인(문서 정제 → Embed → 벡터 저장소 → Rerank)에서 나옵니다. 03 AIR Service 로 묶어야 딜이 커지고, 온프레 배포면 인프라 구축까지 범위가 붙습니다.\n\n[의견] 이 제품을 "더 싼 OpenAI" 로 팔면 진다. 배포 제약이 없는 고객에게는 객관적으로 OpenAI 가 낫다. **반출 불가라는 조건이 확인된 딜에만** 들고 가야 승률이 산다.'
)
where slug = 'cohere';

-- ── 판정 데이터 ─────────────────────────────────────────────────
-- 덮는 것: 사내 지식 검색(Embed·Rerank·Compass)과 업무 연동(North 에이전트).
--   데이터 분류 기준은 "덮는" 것이 아니라 "전제" 다 — 무엇을 인덱싱할지 고객이
--   정해 줘야 시작한다. 그래서 coverage 가 아니라 prerequisites 에 넣었다.
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["지식 소스 품질"],"strength":3},
    {"category":"B","items":["업무 시스템 연동성"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"데이터 분류와 민감도 기준","min":3,"blocking":true,
     "label":"검색 인덱스에 넣을 데이터 범위와 민감도 등급 확정"},
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"사용자 식별을 위한 SSO 인프라"},
    {"kind":"fqa","category":"B","item":"개발·테스트 환경","min":3,"blocking":false,
     "label":"VPC·온프레 배포 시 검증 환경 (Bedrock 경유면 불필요)"},
    {"kind":"manual","label":"배포 형태 확정 — Bedrock 경유 / VPC / 온프레·에어갭","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"데이터 반출 제약이 없고 임직원 생산성만 목적",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"},
                     {"slug":"anthropic-claude","label":"Anthropic Claude"}]},
    {"signal":"제조 현장 데이터 중심 폐쇄망",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"인프라를 운영할 조직이 없는데 온프레미스를 요구",
     "alternatives":[{"label":"Bedrock 경유로 범위 축소"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 2, scale = 'L',
  updated_at = now()
  where slug = 'cohere';

commit;

-- 확인
--   select slug, name, slot, layer, delivery, synergy,
--          jsonb_array_length(fqa_coverage) as 커버리지,
--          jsonb_array_length(prerequisites) as 전제,
--          jsonb_array_length(red_flags) as 레드플래그
--     from solutions where slug = 'cohere';
--
--   -- llm-platform 슬롯 경쟁 현황 (하나만 추천된다)
--   select slug, name, grade from solutions
--    where slot = 'llm-platform' and is_archived = false order by grade desc nulls last;


-- ═══════════════════════════════════════════════════════════════
-- ▼ 021_seed_visible_catalog.sql
-- ═══════════════════════════════════════════════════════════════

-- 021. 노출 솔루션 정리 (1회성 시드)
--
-- 요청: claude / openai / portal26 / checkpoint / zscaler / new relic / articul8 / cohere
--       만 남기고 나머지는 hidden. 데이터는 지우지 않는다.
--
-- ⚠️ 이 파일은 apply-migrations.js 에서 제외한다. 어드민에서 켜고 끈 상태를 덮어쓰는
--    1회성 시드이기 때문이다 (012·014·016~019 와 같은 성격). Supabase SQL Editor 에서
--    한 번만 실행한다.
--
-- ⚠️ 실행 순서
--   1. **023 뒤에 돌린다.** cohere 는 023 이 만드는 행이다. 023 없이 실행하면 그
--      슬러그가 아무 행에도 안 걸려 노출이 8종이 아니라 7종이 된다.
--      020(is_hidden 컬럼)도 당연히 먼저 있어야 한다.
--      → db/migrations/_combined_apply.sql 이 순서를 지켜 만들어져 있다.
--   2. slack · notion · github · gitlab 은 019 로 등록해 비어 있던 슬롯
--      (business-app-agent · ai-coding-env)을 채운 것들이다. 목록에 없으므로 숨겨진다.
--      → 그 슬롯의 추천 후보가 0 이 된다.
--
--      **의도한 결과다.** 요청이 "8종만 남긴다" 였고, 019 는 데이터를 만들어 두는 것이
--      목적이었지 지금 당장 영업에게 보이라는 것이 아니었다. 행은 그대로 남아 있고
--      어드민에서 눈 아이콘 한 번으로 되돌릴 수 있다 — 이것이 is_hidden 을 판 이유다.
--
--      나중에 오퍼링 맵의 ISV 확장 패키지(AI Productivity·AI Developer)를 실제로
--      팔기 시작하면 그때 켜면 된다. 켜는 방법 둘 중 하나:
--        · /admin 솔루션 목록에서 눈 아이콘 클릭 (권장 — 감사로그가 남는다)
--        · 아래 keep 목록에 네 슬러그를 추가하고 이 파일을 다시 실행

begin;

with keep(slug) as (
  values
    ('anthropic-claude'),
    ('openai-enterprise'),
    ('articul8'),
    ('portal26'),
    ('check-point'),
    ('zscaler'),
    ('new-relic'),
    ('cohere')          -- 023 이 등록한다. 그래서 021 을 023 뒤에 돌려야 한다.
)
update solutions s
   set is_hidden = not exists (select 1 from keep k where k.slug = s.slug)
 where s.is_archived = false;

commit;

-- 확인 1) 노출로 남은 것
--   select slug, name, status,
--          jsonb_array_length(coalesce(fqa_coverage, '[]'::jsonb)) as 판정데이터
--     from solutions
--    where is_archived = false and is_hidden = false
--    order by slug;
--
-- 확인 2) 숨긴 것 (데이터는 그대로 있다)
--   select count(*) from solutions where is_archived = false and is_hidden = true;
--
-- 확인 3) 빈 슬롯이 생겼는지 — 019 를 적용했다면 여기서 후보 0 인 슬롯이 늘어난다
--   select sl.id, sl.name, count(s.id) as 노출후보
--     from solution_slots sl
--     left join solutions s
--       on s.slot = sl.id and s.is_archived = false and s.is_hidden = false
--    group by sl.id, sl.name
--   having count(s.id) = 0
--    order by sl.id;

