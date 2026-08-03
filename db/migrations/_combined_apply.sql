-- ===================================================================
-- 통합 적용 스크립트 (자동 생성 — scripts/build-pending-sql.js)
--
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번에 실행합니다.
-- 파일을 직접 수정하지 마세요. 원본은 db/migrations/ 의 개별 파일입니다.
--
-- 포함: 024_starter_package.sql → 025_isv_bundle_triggers.sql → 026_bundle_products.sql
--
-- 실행 후 각 파일 끝의 검증 쿼리 결과를 눈으로 확인하세요.
--   011: 슬롯 미배정 0건 / 슬롯별 후보 수 / 레이어 정정 4건
--   012: 판정 데이터 9건 · 미보강 13건 · 깨진 slug 0건
--   013: enum 에 curator 포함 · 역할별 인원
-- ===================================================================

-- ═══════════════════════════════════════════════════════════════
-- ▼ 024_starter_package.sql
-- ═══════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════
-- ▼ 025_isv_bundle_triggers.sql
-- ═══════════════════════════════════════════════════════════════

-- 025. ISV 확장 패키지에 「적용 기준」 붙이기 (1회성 시드)
--
-- 019 가 번들 5종을 만들었지만 **언제 붙이는지 기준이 없었다.** 영업 화면에 이름과
-- 가치제안만 뜨고 "이 고객에게 이걸 왜 제안하나" 에 답할 수 없었다.
--
-- 진단기준 엑셀(OpenAI_AI_Offering_Diagnostic_20Q.xlsx) 「오퍼링 맵」 시트에
-- 「적용 기준」 열이 있고, 「진단 문항」 시트의 추천 트리거가 문항 단위로 지목한다.
-- 그걸 옮긴다.
--
-- ⚠ 트리거를 두 갈래로 나눈 이유
--   엑셀의 트리거는 **채원님 20문항** 번호다. 우리 fqa_items 는 다른 21문항이라
--   외래키로 걸 수 없다. 그래서
--     applies_when   영업이 읽는 적용 기준 (엑셀 원문) — 항상 쓸 수 있다
--     trigger_note   근거가 된 20문항 번호와 내용 — 추적용
--     fqa_signal     우리 21문항 중 실제로 대응되는 것만 (jsonb) — 엔진이 쓸 수 있다
--   대응되는 문항이 없으면 fqa_signal 을 비운다. 억지로 갖다 붙이면 엉뚱한 고객에게
--   번들이 붙는다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

alter table isv_bundles add column if not exists applies_when text;
alter table isv_bundles add column if not exists trigger_note text;
alter table isv_bundles add column if not exists fqa_signal   jsonb not null default '[]'::jsonb;

comment on column isv_bundles.applies_when is
  '적용 기준. 오퍼링 맵 원문 — 영업이 "왜 이 고객에게" 를 답하는 문장';
comment on column isv_bundles.trigger_note is
  '근거가 된 진단기준 20문항의 번호와 내용. 우리 21문항과 번호 체계가 다르다';
comment on column isv_bundles.fqa_signal is
  '우리 21문항 중 대응되는 신호. [{category,item,when}] · when 은 low(낮으면 제안) 또는 high(높으면 제안)';

-- AI Workspace ← 오퍼링 맵의 AI Productivity
update isv_bundles set
  applies_when = '기존 업무도구(협업·지식관리)와 OpenAI 연계가 필요한 고객',
  trigger_note = '진단기준 7번 — 구성원이 AI 기반 협업·지식관리 도구를 일상 업무에 활용하고 있다 '
              || '(활용 중이면 ISV 연계, 미활용이면 기본 도입)',
  -- 우리 21문항에 "협업도구 일상 활용" 을 묻는 문항이 없다. 가장 가까운 것은
  -- B "업무 시스템 연동성" 이지만 뜻이 다르다(연동 가능성 vs 실제 사용).
  -- 억지로 걸지 않고 비워 둔다 — 신규 문항이 들어오면 그때 채운다.
  fqa_signal = '[]'::jsonb
  where id = 'AI_WORKSPACE';

-- AI Developer
update isv_bundles set
  applies_when = '내부 개발조직을 보유한 고객 (Codex 적용 가능성)',
  trigger_note = '진단기준 16번 — 내부 개발조직이 소프트웨어 또는 AI 서비스를 직접 개발·운영하고 있다 '
              || '(높은 점수 → Codex·개발 Workflow 제안)',
  -- B "개발·테스트 환경" 이 있다는 것은 개발조직이 있다는 뜻이다. 다만 이 문항은
  -- 영업이 답하는 항목이라(§1 의 ✕ 7문항) 신뢰도는 영업 입력에 달려 있다.
  fqa_signal = '[{"category":"B","item":"개발·테스트 환경","when":"high"}]'::jsonb
  where id = 'AI_DEVELOPER';

-- AI Monitoring
update isv_bundles set
  applies_when = 'OpenAI API·RAG·Agent 로 직접 개발한 AI 서비스를 운영하는 고객',
  trigger_note = '진단기준 12번 — API·RAG·Agent 서비스의 응답시간·오류·사용량·품질을 추적할 수 있다 '
              || '(낮은 점수 → AI Monitoring 제안)',
  fqa_signal = '[{"category":"C","item":"품질 평가 체계","when":"low"},
                 {"category":"C","item":"장애 대응 체계","when":"low"}]'::jsonb
  where id = 'AI_MONITORING';

-- AI Trust ← 오퍼링 맵의 AI Governance + AI Security
update isv_bundles set
  applies_when = '전사 AI 사용을 통합 관리해야 하거나, OpenAI Native 범위를 넘는 보안 통제가 필요한 고객',
  trigger_note = '진단기준 18번(승인·비승인 AI·Agent 사용 현황 가시화) + 19번(프롬프트 유출·'
              || 'Prompt Injection·Agent 위협 탐지·차단). 둘 다 낮으면 강한 신호다',
  fqa_signal = '[{"category":"A","item":"감사 로그와 추적성","when":"low"},
                 {"category":"A","item":"보안 게이트웨이 준비도","when":"low"}]'::jsonb
  where id = 'AI_TRUST';

-- Private AI — 오퍼링 맵에는 없고 019 가 국내 사정으로 더한 번들이다.
update isv_bundles set
  applies_when = '데이터 반출이 규제·정책으로 막혀 에어갭·온프레미스가 전제인 고객 (제조·금융·공공)',
  trigger_note = '오퍼링 맵에는 없는 번들. 019 가 국내 폐쇄망 수요를 보고 더했다. '
              || '진단 문항이 아니라 "데이터를 밖으로 내보낼 수 있는가" 라는 단일 질문으로 갈린다',
  -- A "데이터 분류와 민감도 기준" 이 높다 = 반출 불가 데이터를 이미 식별해 뒀다는 뜻이다.
  fqa_signal = '[{"category":"A","item":"데이터 분류와 민감도 기준","when":"high"}]'::jsonb
  where id = 'PRIVATE_AI';

commit;

-- 확인
-- 1) 5종 전부 적용 기준이 채워져야 한다. (없음) 이 나오면 안 된다.
select id, name, coalesce(applies_when, '(없음)') as "적용 기준",
       jsonb_array_length(fqa_signal) as "진단 신호"
  from isv_bundles order by sort_order;
--
-- 2) fqa_signal 이 가리키는 문항이 실재하는가. 0건이어야 한다.
select b.id, s->>'category' as "카테고리", s->>'item' as "문항"
  from isv_bundles b, jsonb_array_elements(b.fqa_signal) s
 where not exists (
   select 1 from fqa_items i
    where i.category = s->>'category' and i.name = s->>'item');


-- ═══════════════════════════════════════════════════════════════
-- ▼ 026_bundle_products.sql
-- ═══════════════════════════════════════════════════════════════

-- 026. 번들 필수 구성 2종 등록 + 번들 멤버 완성 + 리전 조사 반영 (1회성 시드)
--
-- 오퍼링 맵이 지목한 번들 구성 중 카탈로그에 없던 둘을 채운다.
--   AI Monitoring  New Relic · **Databricks**
--   AI Security    **Trend Micro** · Check Point
-- 019 는 있는 것만 멤버로 넣어 두 번들이 반쪽이었다.
--
-- 출처: databricks.com · trendmicro.com (2026-08-03 확인) ·
--       Trend Micro 보도자료(2025-11-24) · AWS Bedrock Cohere 리전 문서
--
-- ⚠ 두 제품은 021 의 노출 목록에 없으므로 **등록 직후 숨김 상태**다. 의도한 것이다.
--   번들을 실제로 팔기 시작할 때 어드민 눈 아이콘으로 켠다. 데이터가 먼저 있어야
--   번들 멤버 참조가 깨지지 않는다.
--
-- ⚠ 본문은 §1 개요만 채운다. Portal26·Cohere 수준의 8탭은 실제 제안이 잡힐 때 쓴다.
--   지금 지어내면 §7 체크리스트가 근거 없는 문장으로 채워진다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

-- ── 신규 2종 ────────────────────────────────────────────────────
insert into solutions (slug, name, delivery, layer, synergy, category, jtbd, value_chain,
                       status, status_op, is_archived)
values
  ('databricks', 'Databricks', 'SaaS (Multi-cloud)', 'L0', '높음',
   '데이터 레이크하우스·AI 플랫폼',
   '데이터 레이크하우스에서 AI 데이터 파이프라인과 모델 운영을 함께 다룬다',
   'Data Foundation', 'published', 'active', false),
  ('trend-micro', 'Trend Micro', 'SaaS / SW', 'L1', '중',
   'AI 애플리케이션·Agent 보안',
   'AI 애플리케이션과 Agent 의 프롬프트 유출·Prompt Injection·비정상 요청을 탐지·차단한다',
   'AI Security', 'published', 'active', false)
on conflict (slug) do update set
  delivery = excluded.delivery, layer = excluded.layer, synergy = excluded.synergy,
  category = excluded.category, jtbd = excluded.jtbd, value_chain = excluded.value_chain,
  status = 'published', status_op = 'active', is_archived = false;

update solutions set slot = 'data-platform' where slug = 'databricks';
update solutions set slot = 'security-gateway' where slug = 'trend-micro';

-- 노출 목록 8종에 없으므로 숨긴 채로 만든다.
-- 021 을 다시 돌려서 처리하지 않는 이유: 021 은 keep 목록 기준으로 전체를 덮어써서
-- 어드민에서 손으로 켜 둔 것까지 되돌린다. 여기서만 직접 세우는 편이 안전하다.
update solutions set is_hidden = true where slug in ('databricks', 'trend-micro');

-- §1 개요만. 나머지 탭은 제안이 잡힐 때 채운다.
update solutions set sections = jsonb_build_object(
'1', E'Databricks 는 데이터 레이크하우스 플랫폼입니다. AI 맥락에서는 **모델을 파는 것이 아니라 모델이 먹을 데이터를 다루는 자리**에 있습니다.\n\n- **AI Radar 에서의 위치**: 오퍼링 맵의 **AI Monitoring 번들** 구성이며 New Relic 과 함께 묶입니다. New Relic 이 서비스의 응답시간·오류를 본다면 Databricks 는 그 서비스가 쓰는 데이터의 품질·계보를 다룹니다.\n- **붙는 자리**: 03 AIR Service 의 "데이터 정제 · 데이터 파운데이션" 구간입니다. 고객이 이미 Databricks 를 쓰고 있으면 RAG 파이프라인의 상류가 이미 갖춰져 있다는 뜻이라 구축 기간이 줄어듭니다.\n\n⚠ **본문 미완성.** 8탭 중 개요만 채워져 있습니다. 실제 제안이 잡히면 아키텍처·체크리스트·경쟁비교를 조사해 채워야 합니다. 지금 지어내면 PoC 에서 깨집니다.')
  where slug = 'databricks';

update solutions set sections = jsonb_build_object(
'1', E'Trend Micro 는 **Trend Vision One AI Security Package** 로 AI 애플리케이션 스택 보안을 다룹니다. 기존 엔드포인트·네트워크 보안 도구가 모델 동작이나 Prompt Injection·데이터 오염 같은 AI 고유 위험을 이해하도록 만들어지지 않았다는 것이 이 제품의 출발점입니다.\n\n- **주요 구성** (벤더 발표 기준)\n  - **AI Scanner** — 배포 전 취약점 탐지. 실제 공격을 모사해 데이터 유출·Prompt Injection 을 찾습니다.\n  - **AI Guard** — 실시간 위협 방어.\n  - **ZTSA – AI Service Access** — 공개·사설 GenAI 서비스에 대한 제로트러스트 접근 통제. 프롬프트와 응답을 검사해 민감정보 유출을 막습니다.\n- **AI Radar 에서의 위치**: 오퍼링 맵의 **AI Security 번들** 구성이며 Check Point 와 함께 묶입니다. 진단기준 19번(프롬프트 유출·Prompt Injection·Agent 위협 탐지·차단)이 트리거입니다.\n- **Check Point·Zscaler 와의 차이**: 저쪽은 네트워크 경로를 통제하고, 이쪽은 **AI 애플리케이션 자체의 입출력**을 검사합니다. 겹치기보다 층이 다릅니다.\n\n⚠ **본문 미완성.** 8탭 중 개요만 채워져 있습니다. AI Security Package 는 2025-12 출시 발표분이라 국내 공급·가격·레퍼런스가 확인되지 않았습니다.')
  where slug = 'trend-micro';

-- 판정 데이터는 넣지 않는다. fqa_coverage 가 비어 있으면 f0fc05a 가 영업에게 감춘다 —
-- 근거를 못 대는 솔루션을 추천 후보로 올리지 않기 위한 장치이고, 여기서도 맞다.

-- ── 번들 멤버 완성 ──────────────────────────────────────────────
insert into isv_bundle_members (bundle_id, solution_slug, sort_order) values
  ('AI_MONITORING', 'databricks',  20),   -- New Relic(10) 과 함께
  ('AI_TRUST',      'trend-micro', 40),   -- Check Point·Portal26·Zscaler 와 함께
  -- Cohere 는 슬롯이 llm-platform 이지만 번들 성격으로는 Private AI 다.
  -- 슬롯(고객이 하나를 고르는 자리)과 번들(같이 파는 묶음)은 다른 축이다.
  ('PRIVATE_AI',    'cohere',      20)
on conflict (bundle_id, solution_slug) do update set sort_order = excluded.sort_order;

-- ── 리전 조사 반영 ──────────────────────────────────────────────
-- §7.4 에 "국내 리전 확인 필요" 로 남겨 둔 항목의 조사 결과다.
-- Cohere: Bedrock 경유가 가장 현실적인 진입 경로인데, 서울 리전에 온디맨드가 없다.
update solutions set sections = jsonb_set(sections, '{7}',
  to_jsonb(replace(sections->>'7',
    E'- [ ] **국내 리전 제공 여부** — 금융·공공에서 가장 먼저 막히는 항목',
    E'- [x] **국내 리전 — 확인됨 (2026-08-03). 주의가 필요하다.**\\n'
 || E'      AWS Bedrock 기준 Cohere Embed v4 의 **온디맨드는 버지니아·아일랜드·도쿄**\\n'
 || E'      뿐이고, **서울(ap-northeast-2)은 교차 리전 추론(cross-region inference)**\\n'
 || E'      으로만 접근한다. 즉 요청이 국외로 나간다. **금융·공공에서는 이것만으로\\n'
 || E'      막힐 수 있다.** 반출 불가가 요건인 고객에게는 Bedrock 경유가 아니라\\n'
 || E'      처음부터 VPC·온프레 배포로 가야 한다 — §4 의 1) 경로를 건너뛴다.\\n'
 || E'- [ ] VPC·온프레 배포 시 국내 구축 레퍼런스')))
  where slug = 'cohere' and sections->>'7' like '%국내 리전 제공 여부%';

-- Portal26: 데이터 저장 위치가 공개 자료에 없다. 다만 AWS Marketplace 공급이 확인됐다.
update solutions set sections = jsonb_set(sections, '{7}',
  to_jsonb(replace(sections->>'7',
    E'- [ ] 데이터 저장 위치와 국내 리전 제공 여부 — **금융·공공 딜에서 먼저 막히는 항목**',
    E'- [ ] 데이터 저장 위치와 국내 리전 제공 여부 — **금융·공공 딜에서 먼저 막히는 항목**\\n'
 || E'      (2026-08-03 조사: 공개 자료에 없다. 다만 **AWS Marketplace 공급**이\\n'
 || E'       확인되므로 조달 경로로 쓸 수 있고, 리전 문의도 그 경로로 가능하다)')))
  where slug = 'portal26' and sections->>'7' like '%데이터 저장 위치%';

commit;

-- 확인
-- 1) 번들 구성이 오퍼링 맵과 맞는가. ⚠없는 슬러그 가 나오면 안 된다.
select b.name as "패키지", coalesce(b.applies_when, '(적용기준 없음)') as "적용 기준",
       string_agg(coalesce(s.name, m.solution_slug || ' ⚠없는 슬러그'), ', ' order by m.sort_order) as "구성"
  from isv_bundles b
  left join isv_bundle_members m on m.bundle_id = b.id
  left join solutions s on s.slug = m.solution_slug
 group by b.id, b.name, b.applies_when, b.sort_order order by b.sort_order;
--
-- 2) 신규 2종은 숨김 상태여야 한다 (021 노출 목록에 없다).
select slug, name, slot, is_hidden,
       jsonb_array_length(coalesce(fqa_coverage,'[]'::jsonb)) as "판정데이터"
  from solutions where slug in ('databricks','trend-micro');
--
-- 3) 리전 조사가 §7 에 들어갔는가.
select slug, case when sections->>'7' like '%2026-08-03%' then '반영됨' else '⚠ 미반영' end as "리전 조사"
  from solutions where slug in ('cohere','portal26');

