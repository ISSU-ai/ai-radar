-- 패키지 전략 — 역할(role) · 선행(depends_on) · 준비도 상승폭(readiness_lift).
-- Run after 015. Apply in the Supabase SQL Editor (dfbx).
--
-- 왜 필요한가: 패키지와 ISV 를 한 줄로 세워 점수를 매기던 것이 잘못이었다.
-- 둘은 다른 질문에 답한다.
--   ISV    "무엇을 도입할 것인가"
--   패키지  "도입 가능한 상태로 만들려면 무엇을 해야 하는가" + "도입 후 어떻게 운영하는가"
-- 게다가 패키지에는 synergy·grade·bundle_potential 이 없어 가중치 0.45 를 구조적으로
-- 못 받는다. 아무리 잘 맞아도 ISV 보다 낮게 나온다 — 사과와 오렌지를 한 자로 잰 셈이다.
--
-- 해결: 패키지에 딜 내 역할을 부여하고, 역할이 다르면 같은 줄에 세우지 않는다.
--
--   entry    진입·설계   DISCOVERY · POC        딜 초입. 작은 금액, 후속 유도
--   enabler  전제 해소   SECURITY · INTEGRATION ISV 앞. 동반 판매
--   adopt    정착·확산   ADOPTION               ISV 뒤. 애드온
--   operate  지속 운영   OPERATE                반복 매출(LTV)
--
-- readiness_lift 는 "이 패키지를 하면 해당 준비도가 얼마나 오르는가"다. 지금 엔진은
-- "SECURITY 로 준비도를 올린 뒤 Anthropic 도입 가능"이라고 말하면서 얼마나 오르는지
-- 모른다. 값이 들어가면 "A 1.8 → 3.3 예상 → Anthropic 전제(3.0) 충족"까지 계산된다.
--
-- ⚠ readiness_lift 값은 패키지 산출물과 FQA 문항을 대조한 **추정치**다. 실제 수주
--   사례가 쌓이면 피드백 리포트로 역산해 교정할 것. ISSU 검토 대상이다.

begin;

alter table packages add column if not exists role text
  check (role in ('entry', 'enabler', 'adopt', 'operate'));
alter table packages add column if not exists depends_on text[] not null default '{}';
alter table packages add column if not exists readiness_lift jsonb not null default '{}'::jsonb;

comment on column packages.role is 'entry=진입·설계 / enabler=ISV 전제 해소 / adopt=정착·확산 / operate=지속 운영';
comment on column packages.depends_on is '선행 권고 패키지. 강제하지 않고 화면에 안내만 한다';
comment on column packages.readiness_lift is '{FQA카테고리: 상승폭} 추정치. 실사례로 교정 대상';

-- DISCOVERY · 2주 · "유즈케이스 우선순위와 실행 로드맵"
--   D 의 "명확한 업무 문제"·"성과 KPI" 를 직접 정리하는 것이 산출물이다.
update packages set role = 'entry', depends_on = '{}',
  readiness_lift = '{"D": 1.0}'::jsonb where id = 'DISCOVERY';

-- POC · 4~6주 · "PoC 환경·평가 리포트·확장 권고안"
--   개발·테스트 환경을 실제로 세우고 업무 문제를 검증한다. 두 축을 조금씩 올린다.
update packages set role = 'entry', depends_on = '{DISCOVERY}',
  readiness_lift = '{"B": 0.8, "D": 0.8}'::jsonb where id = 'POC';

-- SECURITY · 3~4주 · "보안 아키텍처와 통제 체크리스트"
--   A 6문항 대부분(분류·권한·게이트웨이·감사로그·규제·보존)을 정면으로 다룬다.
update packages set role = 'enabler', depends_on = '{}',
  readiness_lift = '{"A": 1.5}'::jsonb where id = 'SECURITY';

-- INTEGRATION · 6~10주 · "RAG·API 연동과 운영 이관 문서"
--   B 의 "업무 시스템 연동성"·"지식 소스 품질"을 구축으로 해결한다.
update packages set role = 'enabler', depends_on = '{POC}',
  readiness_lift = '{"B": 1.5}'::jsonb where id = 'INTEGRATION';

-- ADOPTION · 4주 · "역할별 교육과 도입 확산 키트"
--   D 의 "현업 오너십"·"변화관리·교육"을 다룬다.
update packages set role = 'adopt', depends_on = '{}',
  readiness_lift = '{"D": 1.2}'::jsonb where id = 'ADOPTION';

-- OPERATE · 상시 · "SLO 대시보드와 월간 운영 리포트"
--   C 전체(책임자·품질평가·장애대응·비용·변경배포)를 운영 체계로 세운다.
update packages set role = 'operate', depends_on = '{}',
  readiness_lift = '{"C": 1.5}'::jsonb where id = 'OPERATE';

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
-- 1) 6종 전부 역할이 붙어야 한다.
select id, name, role, period, depends_on, readiness_lift
  from packages order by sort_order;

-- 2) 역할별 분포
select coalesce(role, '(미지정)') as "역할", count(*) as "패키지",
       string_agg(id, ', ' order by sort_order) as "구성"
  from packages group by role order by min(sort_order);

-- 3) 어느 FQA 카테고리를 아무 패키지도 못 올리는지
select c as "카테고리",
       coalesce(string_agg(p.id, ', ' order by p.sort_order), '(없음)') as "올려주는 패키지"
  from (values ('A'),('B'),('C'),('D')) as t(c)
  left join packages p on p.readiness_lift ? c
 group by c order by c;
