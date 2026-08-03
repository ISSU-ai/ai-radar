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
