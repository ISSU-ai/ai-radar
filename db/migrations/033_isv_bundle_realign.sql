-- 033. ISV 확장 패키지를 기획안 §6 구조로 + 환율 1,500 (1회성 시드)
--
-- 출처: OpenAI_통합_오퍼링_기획안.docx (2026-08-04)
--       §6 ISV 확장 패키지(Optional) · Appendix D 표준 고객당 매출 산정 기준
--
-- ── 무엇이 바뀌었나 ────────────────────────────────────────────
--   현재 (019·025·026)              기획안 §6
--   AI Workspace                →  01 AI Productivity
--   AI Developer                →  02 AI Developer          그대로
--   AI Monitoring               →  03 AI Monitoring         그대로
--   AI Trust                    →  04 AI Governance  (Portal26)
--     check-point, portal26,    ↘  05 AI Security    (Trend Micro, Check Point
--     zscaler, trend-micro                            환경별 옵션 Zscaler, Palo Alto)
--   Private AI                  →  기획안에 없다. 국내 폐쇄망 수요로 유지한다
--
-- ⚠ AI_WORKSPACE 는 **id 를 바꾸지 않는다.** isv_bundle_members 가 FK 로 물려 있고
--   025 의 트리거 시드도 id 로 걸려 있다. 이름만 바꾼다.
--
-- ⚠ 진단 신호를 42문항으로 옮긴다(readiness_signal). 기존 fqa_signal(21문항)은
--   건드리지 않는다 — 21문항은 판정 기준이 Appendix A 로 교체될 때 함께 지운다.
--   죽을 컬럼 위에 새 기능을 얹으면 임시 다리가 영구 구조로 굳는다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

-- ── 스키마 ──────────────────────────────────────────────────────
alter table isv_bundles        add column if not exists readiness_signal jsonb not null default '[]'::jsonb;
alter table isv_bundle_members add column if not exists is_option boolean not null default false;

comment on column isv_bundles.readiness_signal is
  '42문항 진단 신호. [{code,when}] · when 은 low(3점 미만이면 제안) 또는 high. 비어 있으면 진단으로 판정하지 않는다는 뜻';
comment on column isv_bundle_members.is_option is
  '환경별 옵션 여부. 기획안 §6 이 "환경별 옵션: Zscaler · Palo Alto" 로 구분한다';

-- ── Palo Alto 등록 ──────────────────────────────────────────────
-- 026 이 Databricks·Trend Micro 를 넣은 방식 그대로. 노출 목록에 없으므로 숨긴 채로
-- 만든다. 데이터가 먼저 있어야 번들 멤버 참조가 깨지지 않는다.
insert into solutions (slug, name, delivery, layer, synergy, category, jtbd, value_chain,
                       status, status_op, is_archived)
values
  ('palo-alto', 'Palo Alto Networks', 'SaaS / SW', 'L1', '중',
   'AI 접근 통제·네트워크 보안',
   'AI 서비스 접근 경로와 프롬프트·파일의 민감정보를 네트워크 계층에서 통제한다',
   'AI Security', 'published', 'active', false)
on conflict (slug) do update set
  delivery = excluded.delivery, layer = excluded.layer, synergy = excluded.synergy,
  category = excluded.category, jtbd = excluded.jtbd, value_chain = excluded.value_chain,
  status = 'published', status_op = 'active', is_archived = false;

update solutions set slot = 'security-gateway' where slug = 'palo-alto';
update solutions set is_hidden = true where slug = 'palo-alto';

update solutions set sections = jsonb_build_object(
'1', E'Palo Alto Networks 는 기획안 §6 의 **05 AI Security** 번들에서 Check Point 와 나란히 놓인 **환경별 옵션**입니다. Zscaler 와 같은 자리(SWG·네트워크 경로 통제)이며, 고객이 이미 어느 쪽을 쓰고 있느냐로 갈립니다.\n\n- **AI Radar 에서의 위치**: 슬롯은 security-gateway 입니다. Zscaler·Check Point 와 **경쟁 관계**이므로 셋을 함께 제안하지 않습니다.\n- **Trend Micro 와의 차이**: 저쪽은 AI 애플리케이션 자체의 입출력을 검사하고, 이쪽은 네트워크 경로를 통제합니다. 겹치기보다 층이 다릅니다.\n\n⚠ **본문 미완성.** 8탭 중 개요만 채워져 있습니다. 국내 공급·가격·레퍼런스와 AI 전용 기능(AI Access Security 등)의 실제 범위를 확인하지 않았습니다. 지금 지어내면 PoC 에서 깨집니다.')
  where slug = 'palo-alto';

-- 판정 데이터는 넣지 않는다. fqa_coverage 가 비면 영업 화면에서 감춰진다 —
-- 근거를 못 대는 솔루션을 추천 후보로 올리지 않기 위한 장치이고 여기서도 맞다.

-- ── 번들 재편 ───────────────────────────────────────────────────
-- 01 AI Productivity ← AI Workspace (id 유지)
update isv_bundles set
  name = 'AI Productivity',
  value_prop = 'OpenAI 를 협업·지식관리·문서작성·영업 업무에 연결해 대화와 문서 요약, '
            || '사내 지식 검색, 콘텐츠 작성, 고객정보 활용 및 업무 실행을 지원한다',
  entry_combo = 'OpenAI + Slack·Notion — 전사 협업과 업무 Agent 활용',
  applies_when = '기존 업무도구(협업·지식관리·영업)와 OpenAI 연계가 필요한 고객',
  -- 현업이 스스로 못 쓰고(P3), 반복업무가 수작업이고(B1), 기존 시스템과 안 붙어
  -- 있으면(T4) 업무도구 연계가 가장 빠른 진입점이다.
  readiness_signal = '[{"code":"P3","when":"low"},
                       {"code":"B1","when":"low"},
                       {"code":"T4","when":"low"}]'::jsonb,
  sort_order = 10
  where id = 'AI_WORKSPACE';

-- 02 AI Developer
update isv_bundles set
  value_prop = 'Codex 를 개발 Workflow 와 연결해 코드 작성·리뷰, 변경사항 분석, '
            || '테스트·문서화 및 오류 해결을 지원하고 개발 생산성을 높인다',
  entry_combo = 'OpenAI Codex + GitHub·GitLab — 개발 생산성 및 개발 Workflow 고도화',
  applies_when = '내부 개발조직을 보유한 고객 (Codex 적용 가능성)',
  -- 42문항에 "개발조직이 있는가" 를 묻는 문항이 없다. T1 은 MLOps 자동화라
  -- 뜻이 다르다. 억지로 걸면 엉뚱한 고객에게 붙는다 — 025 가 AI_WORKSPACE 에
  -- 내린 판단과 같은 이유로 비워 둔다.
  readiness_signal = '[]'::jsonb,
  sort_order = 20
  where id = 'AI_DEVELOPER';

-- 03 AI Monitoring
update isv_bundles set
  value_prop = 'OpenAI API·RAG·Agent 기반 서비스의 응답시간, 오류, Token 사용량과 비용을 '
            || '모니터링하고 AI 응답 품질과 운영 상태를 지속적으로 분석한다',
  entry_combo = 'OpenAI API + New Relic·Databricks — AI 서비스의 품질·비용·오류 운영',
  applies_when = 'OpenAI API·RAG·Agent 로 직접 개발한 AI 서비스를 운영하는 고객',
  readiness_signal = '[{"code":"G7","when":"low"},
                       {"code":"T6","when":"low"},
                       {"code":"T7","when":"low"}]'::jsonb,
  sort_order = 30
  where id = 'AI_MONITORING';

-- 04 AI Governance ← AI Trust (id 유지, 범위를 거버넌스로 좁힌다)
update isv_bundles set
  name = 'AI Governance',
  value_prop = 'OpenAI 를 포함한 승인·비승인 AI 와 Shadow AI 사용을 식별하고, '
            || '사용자·비용·위험·정책 준수 현황을 전사 관점에서 가시화하여 관리한다',
  entry_combo = 'OpenAI + Portal26 — AI 거버넌스 및 사용 통제',
  applies_when = '전사 AI 사용을 통합 관리해야 하는 고객 (Shadow AI·개인 계정·비용 가시성)',
  -- T2 가 곧 Shadow AI 다 — "부서별 무분별 도입을 막고 전사 통일 관리".
  readiness_signal = '[{"code":"T2","when":"low"},
                       {"code":"G1","when":"low"}]'::jsonb,
  sort_order = 40
  where id = 'AI_TRUST';

-- 05 AI Security (신규)
insert into isv_bundles (id, name, value_prop, is_priority, entry_combo, sort_order) values
  ('AI_SECURITY', 'AI Security',
   'AI 서비스 접근과 프롬프트·파일의 민감정보를 보호하고, 데이터 유출·Prompt Injection·'
   || '비정상 요청 및 AI Application·Agent 의 보안 위협을 탐지·통제한다',
   true, 'OpenAI + Trend Micro·Check Point — OpenAI Native 범위를 초과한 보안 통제', 50)
on conflict (id) do update set
  name = excluded.name, value_prop = excluded.value_prop,
  is_priority = excluded.is_priority, entry_combo = excluded.entry_combo,
  sort_order = excluded.sort_order;

update isv_bundles set
  applies_when = 'OpenAI Native 범위를 넘는 보안 통제가 필요한 고객',
  -- G3 이 "망분리 등 보안 규제를 지키면서 외부 AI 를 안전하게 활용" 이다.
  -- 기획안의 "Native 범위 초과 통제" 와 정확히 같은 것을 묻는다.
  readiness_signal = '[{"code":"G3","when":"low"},
                       {"code":"G1","when":"low"}]'::jsonb
  where id = 'AI_SECURITY';

-- Private AI — 기획안 §6 에 없지만 국내 폐쇄망 수요로 유지한다
update isv_bundles set
  -- 데이터 반출 가부는 42문항이 묻지 않는다. 단일 질문으로 갈리는 번들이다.
  readiness_signal = '[]'::jsonb,
  sort_order = 60
  where id = 'PRIVATE_AI';

-- ── 멤버 재배치 ─────────────────────────────────────────────────
-- 04 AI Governance 는 Portal26 만 남긴다. 나머지는 05 AI Security 로 간다.
delete from isv_bundle_members
 where bundle_id = 'AI_TRUST' and solution_slug <> 'portal26';

insert into isv_bundle_members (bundle_id, solution_slug, sort_order, is_option) values
  ('AI_SECURITY', 'trend-micro', 10, false),
  ('AI_SECURITY', 'check-point', 20, false),
  -- 기획안 §6 의 "환경별 옵션: Zscaler · Palo Alto"
  ('AI_SECURITY', 'zscaler',     30, true),
  ('AI_SECURITY', 'palo-alto',   40, true)
on conflict (bundle_id, solution_slug) do update set
  sort_order = excluded.sort_order, is_option = excluded.is_option;

-- ── 환율 1,400 → 1,500 ──────────────────────────────────────────
-- Appendix D: 하나은행 최초고시 전신환 매도율 2026년 1~7월 평균 1,500.11, 소수점 절삭.
-- 008 의 default 를 고쳐도 **이미 적용된 DB 는 안 바뀐다.** 여기서 실제 값을 바꾼다.
insert into hub_settings (id, usd_krw) values (true, 1500)
on conflict (id) do update set usd_krw = 1500;

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 번들 6종과 구성. AI Governance 는 Portal26 하나, AI Security 는 4종이어야 한다.
select b.sort_order as "순서", b.name as "패키지",
       string_agg(coalesce(s.name, m.solution_slug || ' ⚠없는 슬러그')
                  || case when m.is_option then ' (옵션)' else '' end,
                  ', ' order by m.sort_order) as "구성",
       jsonb_array_length(b.readiness_signal) as "진단 신호"
  from isv_bundles b
  left join isv_bundle_members m on m.bundle_id = b.id
  left join solutions s on s.slug = m.solution_slug
 group by b.id, b.name, b.sort_order order by b.sort_order;
--
-- 2) readiness_signal 이 실재하는 42문항을 가리키는가. **0건이어야 한다.**
--    문자열 조인이라 한 글자만 달라도 조용히 안 붙는다.
select b.id, sig->>'code' as "없는 문항"
  from isv_bundles b, jsonb_array_elements(b.readiness_signal) sig
  left join readiness_items i on i.code = sig->>'code' and i.status = 'active'
 where i.code is null;
--
-- 3) 환율. 1500 이어야 한다.
select usd_krw from hub_settings where id = true;
--
-- 4) Palo Alto 가 숨김으로 들어갔는가. is_hidden = true 여야 영업 화면에 안 뜬다.
select slug, name, slot, is_hidden,
       jsonb_array_length(coalesce(fqa_coverage, '[]'::jsonb)) as "판정 데이터"
  from solutions where slug = 'palo-alto';
