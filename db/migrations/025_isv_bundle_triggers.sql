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
