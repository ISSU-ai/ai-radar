-- 024. OpenAI Starter Package 등록 (1회성 시드)
--
-- 제출본 2026-08-02 의 "※ OpenAI Starter Package" 를 반영한다. 진입 상품인데
-- 패키지 6종(DISCOVERY~OPERATE) 어디에도 대응이 없었다.
--
-- 구성 (제출본 원문)
--   기본 제공  AI Readiness Assessment — 시스템·거버넌스·보안 등 6대 영역 진단
--   ① DS      OpenAI Business / Enterprise 라이선스 (최소 Business 2명)
--   ② PS      OpenAI Ready — **무상**. 구성·Workspace·관리자·보안 설정, 사용 가이드, 교육
--   ③ MS      Managed Service - Light (3 Months) — **유상**
--   선택 PS   Change Management — 심화 교육, Champion Community, 전사 확산
--
-- ⚠ 소속 오퍼링을 02 로 둔 이유
--   Starter 는 01(진단) · 02(환경구성) · 05(MS Light) 에 걸쳐 있다. packages.offering_id
--   는 단일 FK 라 하나만 고를 수 있다. 상품의 중심이 "기업용 OpenAI 를 공급하고 쓸 수
--   있게 만드는 것" 이고 DS 라이선스가 02 에 속하므로 02 로 둔다.
--   화면에서 걸쳐 있는 성격은 target·산출물 문구로 드러낸다.
--
-- ⚠ 판정 데이터를 얕게 잡은 이유
--   Starter 의 PS 는 "표준 범위" 다. 같은 A 문항을 SECURITY 가 strength 3 으로,
--   Starter 가 2 로 덮는다. 추천 엔진은 같은 전제를 여러 후보가 풀 수 있으면 가장
--   깊게 다루는 쪽을 고르므로(090e40a 의 pickBest), 깊이가 필요한 딜에서는 SECURITY 가
--   이긴다. 표준 범위로 충분한 딜에서는 Starter 가 붙어 딜이 작아지는데 — 그게 맞다.
--   무상 범위로 되는 일에 유상 패키지를 붙이면 고객이 나중에 안다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

insert into packages (id, name, scale, period, target, status, sort_order,
                      offering_id, role, base_md, unit_price, price_is_placeholder)
values (
  'STARTER', 'OpenAI Starter Package', 'S', '3개월 (MS Light 기준)',
  '라이선스 도입부터 초기 설정·온보딩·운영관리까지 한 패키지로 시작',
  'active', 5,          -- DISCOVERY(10) 앞에 둔다. 진입 상품이다.
  '02', 'entry', 0, 0, true
)
on conflict (id) do update set
  name = excluded.name, scale = excluded.scale, period = excluded.period,
  target = excluded.target, status = excluded.status, sort_order = excluded.sort_order,
  offering_id = excluded.offering_id, role = excluded.role;

-- 산출물 — 무상/유상 경계를 문구에 드러낸다. 견적에서 0원으로 나와야 할 항목이다.
delete from package_items where package_id = 'STARTER';
insert into package_items (package_id, type, label, sort_order) values
  ('STARTER', 'deliverable', 'AI Readiness Assessment 6대 영역 진단 리포트 (기본 제공)', 10),
  ('STARTER', 'deliverable', 'OpenAI Business·Enterprise 라이선스 구성안 (최소 Business 2석)', 20),
  ('STARTER', 'deliverable', 'Workspace·관리자·보안 설정 내역과 기본 AI 사용 가이드 (OpenAI Ready · 무상)', 30),
  ('STARTER', 'deliverable', '관리자·사용자 온보딩 교육 (무상)', 40),
  ('STARTER', 'deliverable', '3개월 운영 리포트 — 부서별 사용량·활용률·비용 분석 (MS Light · 유상)', 50),
  ('STARTER', 'note',        '심화 교육·AI Champion Community·전사 확산은 04 Change Management 로 별도 산정', 60);

-- ── 판정 데이터 ─────────────────────────────────────────────────
-- 덮는 것: 진단으로 과제·KPI 를 정의하고(D), Workspace·권한·보안을 설정하고(A),
--   MS Light 로 사용량·비용을 본다(C). 전부 "표준 범위" 라 깊이는 2 다.
update packages set
  fqa_coverage = '[
    {"category":"A","items":["접근권한과 계정 체계","데이터 분류와 민감도 기준"],"strength":2},
    {"category":"C","items":["비용 모니터링"],"strength":2},
    {"category":"D","items":["명확한 업무 문제","성과 KPI"],"strength":2}
  ]'::jsonb,
  readiness_lift = '{"A": 0.8, "C": 0.5, "D": 0.6}'::jsonb,
  depends_on = '{}'
  where id = 'STARTER';

commit;

-- 확인
-- 1) 패키지 7종이 되고 STARTER 가 맨 앞이어야 한다.
select p.id, p.name, p.offering_id, o.name as "오퍼링", p.role, p.sort_order
  from packages p left join offerings o on o.id = p.offering_id
 order by p.sort_order;
--
-- 2) 같은 문항을 STARTER 와 다른 패키지가 함께 덮는 지점.
--    A 접근권한 = STARTER(2) · SECURITY(3) · INTEGRATION(2) 이 정상이다.
--    엔진은 strength 가 높은 SECURITY 를 선행으로 고른다.
select e->>'category' as "카테고리", it as "문항",
       string_agg(p.id || '(' || (e->>'strength') || ')', ', ' order by p.sort_order) as "후보"
  from packages p,
       jsonb_array_elements(p.fqa_coverage) e,
       jsonb_array_elements_text(e->'items') it
 where exists (select 1 from jsonb_array_elements(
         (select fqa_coverage from packages where id = 'STARTER')) s
        where s->>'category' = e->>'category' and (s->'items') ? it)
 group by 1, 2 order by 1, 2;
