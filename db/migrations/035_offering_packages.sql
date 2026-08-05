-- 035. 딜사이징 패키지를 기획안 5대 코어 오퍼링으로 (1회성 시드)
--
-- 출처: OpenAI_통합_오퍼링_기획안.docx (2026-08-04) §5 「5대 코어 오퍼링 상세」
--
-- ── 왜 바꾸나 ───────────────────────────────────────────────────
-- 기존 6종(DISCOVERY·POC·SECURITY·INTEGRATION·ADOPTION·OPERATE)은 우리가 만든
-- 딜사이징 단위다. 017 이 그것들을 오퍼링 01~05 에 억지로 붙여 뒀는데, 03 AIR Service
-- 하나에 POC 와 INTEGRATION 둘이 매달려 영업이 "이 둘을 다 파는 건가" 를 매번 물었다.
--
-- 기획안은 오퍼링 자체가 판매 단위다. 딜사이징 단위를 거기에 맞춘다.
--
--   DISCOVERY   → P01 AI Consulting
--   SECURITY    → P02 OpenAI Ready
--   POC ┐
--   INTEGRATION ┴→ P03 AIR Service          ← 둘을 합친다
--   ADOPTION    → P04 AI Adoption & Change Management
--   OPERATE     → P05 Billing & Managed Service
--   STARTER     → 유지 (024 가 기획안 ※ 항목과 이미 같다)
--
-- ── 단가 ────────────────────────────────────────────────────────
-- ⚠ **기획안에 M/D 단가가 없다.** AIR Unit 단가는 ISV BU 미정이고, 05 는 원화 Billing
--   가능 여부 확인 후 확정 사항이다. 없는 단가를 지어내지 않는다 —
--   base_md 는 기존 값을 옮기고(P03 은 합산) price_is_placeholder 를 true 로 둔다.
--   화면은 이미 「별도협의」로 그린다.
--
-- ⚠ deals.packages 는 jsonb 라 FK 가 없다. **딜을 먼저 옮기고 옛 행을 지운다.**
--   순서가 바뀌면 매핑 근거가 사라져 딜의 패키지가 통째로 유실된다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

-- ── ① 새 패키지 ────────────────────────────────────────────────
insert into packages (id, offering_id, name, scale, period, target, status, sort_order,
                      role, depends_on, base_md, unit_price, price_is_placeholder) values
  ('P01', '01', 'AI Consulting', 'S', '2주',
   '고객의 AI 준비 수준과 업무 목표를 진단하고 최적의 OpenAI 도입안 설계',
   'active', 10, 'entry', '{}', 10, 800000, true),

  ('P02', '02', 'OpenAI Ready', 'M', '3~4주',
   '기업용 OpenAI 제품을 공급하고 안전하게 사용할 수 있는 기본 환경 구성',
   'active', 20, 'enabler', '{}', 20, 850000, true),

  -- POC(25MD) + INTEGRATION(45MD). 단가는 공수 가중평균 (25×800k + 45×850k) / 70.
  ('P03', '03', 'AIR Service', 'L', '규모별 산정 (4~10주 기준)',
   '고객 데이터와 업무시스템을 연결하여 기업용 AI 서비스와 Agent 를 구축하는 전문서비스',
   'active', 30, 'enabler', '{P01}', 70, 832143, true),

  ('P04', '04', 'AI Adoption & Change Management', 'M', '4주',
   '사용자 정착과 조직 변화·전사 확산',
   'active', 40, 'adopt', '{}', 20, 750000, true),

  ('P05', '05', 'Billing & Managed Service', 'O', '상시',
   'OpenAI 라이선스·사용량·비용·운영 관리',
   'active', 50, 'operate', '{}', 10, 900000, true)
on conflict (id) do update set
  offering_id = excluded.offering_id, name = excluded.name, scale = excluded.scale,
  period = excluded.period, target = excluded.target, status = excluded.status,
  sort_order = excluded.sort_order, role = excluded.role, depends_on = excluded.depends_on,
  base_md = excluded.base_md, unit_price = excluded.unit_price,
  price_is_placeholder = excluded.price_is_placeholder;

-- STARTER 는 진입 상품이라 맨 앞에 둔다. 나머지 값은 024 그대로.
update packages set sort_order = 5 where id = 'STARTER';

-- ── ② 제공 범위 (기획안 §5 「주요 제공 범위」 원문) ──────────────
delete from package_items where package_id in ('P01', 'P02', 'P03', 'P04', 'P05');
insert into package_items (package_id, type, label, sort_order) values
  ('P01', 'deliverable', 'AI Readiness Assessment 및 주요 Gap 분석', 10),
  ('P01', 'deliverable', 'AI 솔루션 시뮬레이터를 통한 우선 적용 업무와 Use Case 도출', 20),
  ('P01', 'deliverable', 'ChatGPT Business·Enterprise, Codex, OpenAI API 적용 범위 설계', 30),
  ('P01', 'deliverable', 'Seat·Credit·API 사용량 및 TCO·예산 시뮬레이션', 40),
  ('P01', 'deliverable', '단계별 도입 로드맵과 권장 오퍼링 구성', 50),
  ('P01', 'note',        '초기 진단은 라이선스 도입 고객에게 표준 범위 내 무상. 심화 컨설팅은 별도 산정', 60),

  ('P02', 'deliverable', 'ChatGPT Business·Enterprise, Codex, OpenAI API 공급', 10),
  ('P02', 'deliverable', 'Workspace·관리자·사용자·그룹·권한 설정', 20),
  ('P02', 'deliverable', 'SSO, 도메인, 보존정책 등 OpenAI Native 관리·보안 기능 설정', 30),
  ('P02', 'deliverable', '기본 AI 사용정책, 관리자 가이드 및 사용자 온보딩', 40),
  ('P02', 'deliverable', 'OpenAI 가 기본 제공하는 Connector 와 고객 업무도구 연결', 50),
  ('P02', 'deliverable', 'Slack·Notion·Google Workspace·Salesforce 등 연계환경 구성', 60),
  ('P02', 'deliverable', '초기 사용자 교육 및 업무 활용 가이드 제공', 70),
  ('P02', 'note',        '초기 구축은 라이선스 도입 고객에게 표준 범위 내 무상. 심화 교육·맞춤 연계·PoC·추가 구축은 별도 산정', 80),

  ('P03', 'deliverable', 'AI 활용 데이터의 현황 진단, 수집·정제·분류 및 품질 개선', 10),
  ('P03', 'deliverable', '데이터 파운데이션과 접근권한·거버넌스 체계 설계', 20),
  ('P03', 'deliverable', '고객 업무와 데이터에 최적화된 RAG·Vector DB·Search 구축', 30),
  ('P03', 'deliverable', 'OpenAI API 기반 맞춤형 AI 애플리케이션 개발 및 PoC', 40),
  ('P03', 'deliverable', '도메인/업무 목적별 AI Agent·Multi-Agent·Workflow 설계 및 구현', 50),
  ('P03', 'deliverable', 'MCP·API·AI Gateway 와 기존 업무시스템 연계', 60),
  ('P03', 'deliverable', '상용환경 전환, 성능 검증, 운영 가이드 및 운영 이관', 70),
  ('P03', 'note',        'AIR Unit 전문인력의 M/D 또는 M/M 기반 Professional Service. 프로젝트 규모에 따라 별도 산정', 80),

  ('P04', 'deliverable', '경영진·관리자 AI Briefing 및 업무군별 ChatGPT 활용교육', 10),
  ('P04', 'deliverable', '개발자 대상 Codex·API 실습과 부서별 Use Case 워크숍', 20),
  ('P04', 'deliverable', '부서별 템플릿·표준 Prompt·활용 가이드 및 내부 확산 프로그램 설계', 30),
  ('P04', 'deliverable', 'AI Champion 선발·육성, Community 및 내부 지원체계 운영', 40),
  ('P04', 'deliverable', '활용률, 업무시간 절감, 품질 개선 등 성과 KPI 측정과 우수사례 확산', 50),

  ('P05', 'deliverable', 'ChatGPT 시트, Codex Credit, OpenAI API 사용량 통합 관리', 10),
  ('P05', 'deliverable', '달러 사용료의 원화 환산·청구 및 정산 지원', 20),
  ('P05', 'deliverable', '사용자·부서·프로젝트별 사용량과 비용 분석', 30),
  ('P05', 'deliverable', 'Budget·Chargeback 및 비용 한도 관리', 40),
  ('P05', 'deliverable', 'OpenAI 기술지원 연계, 장애 에스컬레이션 및 운영 이슈 관리', 50),
  ('P05', 'deliverable', '월간 사용량·비용·품질 리포트와 추가 최적화·확장 권고', 60),
  ('P05', 'note',        '마진 구조·원화 Billing 가능 여부·관리자 권한 위임 범위 확인 후 세부 Scope 확정', 70);

-- ── ③ 판정 데이터 이관 ─────────────────────────────────────────
-- 어휘는 바꾸지 않는다. **옮기기만 한다.** 판정 기준을 Appendix A 로 바꾸는 것은
-- 다음 단계다 — 둘을 한 번에 하면 회귀 원인을 못 찾는다.
update packages set
  fqa_coverage = '[
    {"category":"D","items":["명확한 업무 문제","성과 KPI","예산·구매 준비도"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"D": 1.2}'::jsonb
  where id = 'P01';

update packages set
  fqa_coverage = '[
    {"category":"A","items":["데이터 분류와 민감도 기준","접근권한과 계정 체계","보안 게이트웨이 준비도",
                             "감사 로그와 추적성","규제·컴플라이언스 검토","데이터 보존·삭제 정책"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"A": 1.5}'::jsonb
  where id = 'P02';

-- POC + INTEGRATION 합본. 같은 카테고리라도 다루는 깊이가 다르면 항목을 나눠 둔다 —
-- 하나로 합치면 얕게 다루는 문항이 깊은 strength 를 얻어 선행 판정이 틀어진다.
-- lift 는 **합산하지 않고 큰 값을 쓴다.** 두 패키지를 합쳤다고 상승폭이 더해지지 않는다.
update packages set
  fqa_coverage = '[
    {"category":"B","items":["업무 시스템 연동성","지식 소스 품질","확장성·성능 기준"],"strength":3},
    {"category":"B","items":["개발·테스트 환경"],"strength":2},
    {"category":"A","items":["데이터 분류와 민감도 기준","접근권한과 계정 체계"],"strength":2},
    {"category":"C","items":["변경·배포 관리"],"strength":2},
    {"category":"D","items":["명확한 업무 문제","성과 KPI"],"strength":2}
  ]'::jsonb,
  readiness_lift = '{"B": 1.5, "A": 0.8, "D": 0.8}'::jsonb
  where id = 'P03';

update packages set
  fqa_coverage = '[
    {"category":"D","items":["현업 오너십","변화관리·교육","성과 KPI"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"D": 1.2}'::jsonb
  where id = 'P04';

update packages set
  fqa_coverage = '[
    {"category":"C","items":["운영 책임자 지정","품질 평가 체계","장애 대응 체계",
                             "비용 모니터링","변경·배포 관리"],"strength":3}
  ]'::jsonb,
  readiness_lift = '{"C": 1.5}'::jsonb
  where id = 'P05';

-- ── ④ 기존 딜의 패키지 선택 이관 ───────────────────────────────
-- deals.packages 는 [{"id":"POC","md":4}] 또는 ["POC"] 형태다. 둘 다 받는다.
-- POC 와 INTEGRATION 이 함께 선택돼 있으면 P03 하나로 합치고 조정 MD 를 더한다.
update deals d set packages = (
  select coalesce(jsonb_agg(jsonb_build_object('id', g.pid, 'md', g.md) order by g.pid), '[]'::jsonb)
    from (
      select case x.id
               when 'DISCOVERY'   then 'P01'
               when 'SECURITY'    then 'P02'
               when 'POC'         then 'P03'
               when 'INTEGRATION' then 'P03'
               when 'ADOPTION'    then 'P04'
               when 'OPERATE'     then 'P05'
               else x.id
             end as pid,
             sum(x.md) as md
        from (
          select coalesce(e ->> 'id', e #>> '{}')          as id,
                 coalesce((e ->> 'md')::numeric, 0)        as md
            from jsonb_array_elements(d.packages) e
        ) x
       group by 1
    ) g
)
 where d.packages is not null and d.packages <> '[]'::jsonb;

-- ── ⑤ 옛 패키지 제거 ───────────────────────────────────────────
-- package_items 는 on delete cascade 라 같이 지워진다.
delete from packages where id in ('DISCOVERY', 'POC', 'SECURITY', 'INTEGRATION', 'ADOPTION', 'OPERATE');

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 패키지가 STARTER + P01~P05 = 6종이어야 한다. 옛 id 가 남으면 안 된다.
select p.sort_order as "순서", p.id, p.offering_id as "오퍼링", p.name, p.role as "역할",
       p.base_md as "기준MD", p.price_is_placeholder as "단가미정",
       count(pi.id) as "제공범위"
  from packages p left join package_items pi on pi.package_id = p.id
 where p.status = 'active'
 group by p.id order by p.sort_order;
--
-- 2) 딜의 패키지가 전부 옮겨졌는가. **옛 id 0건이어야 한다.**
select d.customer, e ->> 'id' as "패키지", e ->> 'md' as "조정MD"
  from deals d, jsonb_array_elements(d.packages) e
 where d.packages <> '[]'::jsonb
 order by d.customer;
--
-- 3) 존재하지 않는 패키지를 가리키는 딜이 있는가. **0건이어야 한다.**
select d.customer, e ->> 'id' as "없는 패키지"
  from deals d, jsonb_array_elements(d.packages) e
  left join packages p on p.id = e ->> 'id'
 where d.packages <> '[]'::jsonb and p.id is null;
--
-- 4) 오퍼링 5종에 패키지가 하나씩 붙었는가.
select o.id, o.name, count(p.id) as "패키지"
  from offerings o left join packages p on p.offering_id = o.id and p.status = 'active'
 group by o.id, o.name, o.sort_order order by o.sort_order;
