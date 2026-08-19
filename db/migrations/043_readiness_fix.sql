-- 043. 42문항 개선 처방문 — 「그래서 무엇을 하면 되는가」
--
-- 진단 결과의 「우선 개선 영역」이 축 이름·점수·근거 문항까지만 내고 다음 행동이
-- 0건이었다. 고객은 자기가 낮다는 것만 알고 돌아간다.
--
-- ⚠ 이건 **없던 것이 아니라 사라진 것이다.** 21문항 시절 fqa_items.fix 에 문항별
--   처방문이 있었다("SSO·RBAC 설계와 승인 흐름을 정리합니다"). 040 이 표째로 지우면서
--   함께 없어졌고 42문항(readiness_items)에는 이식되지 않았다. 그 자리를 되살린다.
--
-- ⚠ **이 문장은 고객이 받는 문서에 그대로 들어간다.** 그래서 세 가지를 지킨다.
--   ① 제품·오퍼링 이름을 쓰지 않는다. 처방이 광고가 되면 리포트가 신뢰를 잃는다.
--      "우리가 무엇을 파는가" 는 packages.readiness_coverage 로 **따로** 붙인다.
--   ② 완성형이 아니라 **첫 걸음**을 적는다. "전사 체계를 구축하십시오" 는 아무도
--      못 하고, 못 할 말을 적으면 나머지도 안 읽는다.
--   ③ 한 문장. 루브릭(고객이 고른 현재 상태) 바로 아래에 붙으므로 길면 안 읽힌다.
--
-- ⚠ 지금 값은 **초안**이다. ISV BU 기준이 나오면 검토 후 교체한다(사용자 결정
--   2026-08-13). /admin 에서 고칠 수 있게 열어 둔다.
--
-- 시드가 사람이 고친 값을 덮으므로 apply-migrations.js 에 넣지 않는다.

begin;

alter table readiness_items add column if not exists fix text;

comment on column readiness_items.fix is
  '이 문항이 낮을 때 고객이 할 일. **고객 문서에 그대로 들어간다** — 제품·오퍼링 이름을 쓰지 않고 첫 걸음만 적는다. 21문항 시절 fqa_items.fix 가 있던 자리';

-- ── S 전략·리더십 ───────────────────────────────────────────────
update readiness_items set fix = '연도별 목표·예산·담당 부서를 한 장으로 적어 경영진 승인부터 받습니다.' where code = 'S1';
update readiness_items set fix = '진행 중인 AI 과제를 한 표에 모으고 과제마다 성과 지표를 하나씩만 먼저 정합니다.' where code = 'S2';
update readiness_items set fix = '분기 1회 부서별 AI 과제를 접수하는 창구를 만들고 접수 양식을 통일합니다.' where code = 'S3';
update readiness_items set fix = '기존 매출에서 AI가 바꿀 수 있는 지점 한 곳을 골라 손익 가설을 세워 봅니다.' where code = 'S4';
update readiness_items set fix = '같은 업종 3개사의 AI 도입 사례를 분기마다 정리해 경영 회의 안건으로 올립니다.' where code = 'S5';
update readiness_items set fix = '보안 사고·규제 위반·프로젝트 중단 세 가지에 대해 누가 무엇을 하는지 한 장으로 정합니다.' where code = 'S6';
update readiness_items set fix = 'IT·현업·경영진이 함께 보는 AI 과제 현황판을 하나 두고 월 1회 같은 자리에서 검토합니다.' where code = 'S7';

-- ── P 인재·조직문화 ─────────────────────────────────────────────
update readiness_items set fix = '겸직이라도 좋으니 AI 과제의 의사결정자를 한 명 지정하고 권한 범위를 문서로 남깁니다.' where code = 'P1';
update readiness_items set fix = '가장 인원이 많은 직무 하나를 골라 실제 업무 사례로 만든 짧은 교육부터 돌립니다.' where code = 'P2';
update readiness_items set fix = '현업이 스스로 만든 활용 사례를 모으는 자리를 만들고 잘 된 것을 사내에 공유합니다.' where code = 'P3';
update readiness_items set fix = 'AI로 무엇이 바뀌고 무엇이 안 바뀌는지 직무별로 설명하는 자리를 먼저 만듭니다.' where code = 'P4';
update readiness_items set fix = '실패해도 책임을 묻지 않는 시범 과제를 분기 1건 공식으로 지정합니다.' where code = 'P5';
update readiness_items set fix = '필요한 역할을 채용·재교육·외부 협력 중 무엇으로 채울지 역할별로 먼저 정합니다.' where code = 'P6';
update readiness_items set fix = '지금 막혀 있는 과제 하나를 골라 외부 전문 조직과 짧은 공동 검증부터 해 봅니다.' where code = 'P7';

-- ── D 데이터 기반 ───────────────────────────────────────────────
update readiness_items set fix = 'AI에 가장 먼저 쓸 데이터 세 종류를 정해 그것부터 한곳에서 접근할 수 있게 만듭니다.' where code = 'D1';
update readiness_items set fix = '사람이 눈으로 보던 품질 점검 항목부터 자동 검사 규칙으로 옮깁니다.' where code = 'D2';
update readiness_items set fix = '어떤 데이터가 어디에 있는지 적은 목록을 만들고 현업이 직접 검색할 수 있게 엽니다.' where code = 'D3';
update readiness_items set fix = '문의가 가장 많은 문서 묶음 하나를 골라 검색 가능한 형태로 정리합니다.' where code = 'D4';
update readiness_items set fix = '수작업으로 옮기는 데이터 흐름 하나를 골라 정해진 주기로 자동 실행되게 바꿉니다.' where code = 'D5';
update readiness_items set fix = '핵심 지표 하나를 골라 원천 데이터부터 최종 화면까지 경로를 그려 봅니다.' where code = 'D6';
update readiness_items set fix = 'AI에 넣을 데이터에서 걸러야 할 항목을 목록으로 정하고 반출 전 점검을 절차에 넣습니다.' where code = 'D7';

-- ── T 시스템·인프라 ─────────────────────────────────────────────
update readiness_items set fix = '배포와 되돌리기를 사람 손 없이 할 수 있는지 먼저 확인하고 그 두 가지부터 자동화합니다.' where code = 'T1';
update readiness_items set fix = '지금 어느 부서가 어떤 AI 도구를 쓰고 있는지 목록부터 만듭니다.' where code = 'T2';
update readiness_items set fix = 'AI가 답해야 할 질문 서른 개를 뽑고 그 답이 들어 있는 문서부터 연결합니다.' where code = 'T3';
update readiness_items set fix = 'AI가 읽어야 할 시스템과 써야 할 시스템을 가르고 읽기부터 연결합니다.' where code = 'T4';
update readiness_items set fix = 'AI 연산이 몰리는 시점을 파악하고 그때 필요한 용량을 미리 산정해 둡니다.' where code = 'T5';
update readiness_items set fix = '운영 중인 모델의 정상 범위를 숫자로 정하고 벗어나면 알림이 가게 합니다.' where code = 'T6';
update readiness_items set fix = 'AI 비용을 프로젝트·부서 단위로 나눠 볼 수 있도록 태그 규칙부터 정합니다.' where code = 'T7';

-- ── B 업무 적용·성과 ────────────────────────────────────────────
update readiness_items set fix = '부서마다 시간을 가장 많이 쓰는 반복 업무를 하나씩 적어 내게 하고 그중 하나부터 붙입니다.' where code = 'B1';
update readiness_items set fix = '고객 문의 중 반복 비중이 높은 유형부터 AI 초안 작성에 붙여 봅니다.' where code = 'B2';
update readiness_items set fix = 'AI가 조회만 하는 범위와 처리까지 하는 범위를 먼저 가르고 조회부터 엽니다.' where code = 'B3';
update readiness_items set fix = '지금 경험과 감으로 정하는 판단 하나를 골라 데이터로 근거를 만들어 봅니다.' where code = 'B4';
update readiness_items set fix = '시범 과제를 정식 전환할 때 무엇이 충족돼야 하는지 기준을 미리 적어 둡니다.' where code = 'B5';
update readiness_items set fix = 'AI를 붙이기 전 처리 시간과 정확도를 먼저 재 둡니다. 기준선이 없으면 효과를 증명할 수 없습니다.' where code = 'B6';
update readiness_items set fix = 'AI 답변 옆에 도움이 됐는지 한 번에 남길 수 있게 하고 그 기록을 모읍니다.' where code = 'B7';

-- ── G 신뢰·안전 관리 ────────────────────────────────────────────
update readiness_items set fix = 'AI가 만든 결과를 사람이 반드시 확인해야 하는 업무를 목록으로 정합니다.' where code = 'G1';
update readiness_items set fix = 'AI 답변에 근거 문서를 함께 표시하게 하고 근거가 없으면 답하지 않게 합니다.' where code = 'G2';
update readiness_items set fix = '외부 AI로 나가도 되는 정보와 안 되는 정보의 경계를 문서로 먼저 정합니다.' where code = 'G3';
update readiness_items set fix = 'AI 과제 착수 시점에 법무 검토를 거치도록 절차에 한 단계를 넣습니다.' where code = 'G4';
update readiness_items set fix = '배포 전 확인할 윤리 점검 항목을 다섯 개 이내로 정하고 담당자를 지정합니다.' where code = 'G5';
update readiness_items set fix = 'AI 기능이 멈췄을 때 무엇으로 대체할지 업무별로 정해 둡니다.' where code = 'G6';
update readiness_items set fix = '응답 지연·오류율·비용 세 가지부터 대시보드에 띄우고 임계값을 정합니다.' where code = 'G7';

commit;

-- 확인
-- 1) 42문항이 다 채워졌는가. 빈 칸이 0 이어야 한다.
select count(*) as "전체",
       count(fix) as "처방 있음",
       count(*) filter (where fix is null or fix = '') as "빈 칸"
  from readiness_items;
--
-- 2) ⚠ 처방문에 제품·오퍼링 이름이 섞이면 안 된다. 0건이어야 한다.
select code, fix from readiness_items
 where fix ~* '(openai|chatgpt|codex|claude|portal26|zscaler|databricks|AIR Service|OpenAI Ready|AI Consulting)';
--
-- 3) 축별로 눈으로 한 번 읽는다. 루브릭 1점 문장과 짝이 맞는지 본다.
select i.area, i.code, left(i.text, 40) as "문항", i.fix as "처방"
  from readiness_items i order by i.area, i.seq;
