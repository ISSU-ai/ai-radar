-- 036. 도입 판정 기준을 기획안 Appendix A 로 (1회성 시드)
--
-- 출처: OpenAI_통합_오퍼링_기획안.docx (2026-08-04) Appendix A 「Enterprise AI 도입 평가기준」
--       분류 근거: ISO/IEC 42001 · OECD AI Principles · McKinsey Responsible AI·AI Value Framework
--
-- ── 왜 바꾸나 ───────────────────────────────────────────────────
-- 지금 판정 기준인 21문항(fqa_items)은 **우리가 만든 것**이다. 근거를 물으면 답할 곳이
-- 없었다. 기획안은 같은 자리를 5개 대분류 10개 평가영역으로 표준화했고 국제 표준을
-- 근거로 든다. *"Discovery·PoC 및 Trust 설계 시 체크리스트로 활용"* — 정확히 우리가
-- 21문항으로 하던 일이다.
--
-- 층은 그대로다.
--   42문항(029)   회사가 AI 를 얼마나 하고 있나  — 고객이 답한다
--   10평가영역     이 제품을 지금 넣을 수 있나    — 진단에서 8개가 차고 2개는 확인한다
--
-- ⚠ 이 파일은 **표와 컬럼만 만든다.** bridge 는 037, 판정 데이터 재작성과 21문항
--   삭제는 038 이다. 한 번에 하면 회귀 원인을 못 찾는다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

create table if not exists assessment_domains (
  id         text primary key,          -- D1~D5
  name       text not null,
  sort_order int  not null default 0
);

create table if not exists assessment_areas (
  id          text primary key,         -- A01~A10
  domain_id   text not null references assessment_domains(id) on delete cascade,
  name        text not null,
  checkpoints text not null,            -- Appendix A 「핵심 확인사항」 원문
  concerns    text not null,            -- Appendix A 「주요 우려사항」 원문
  weight      int  not null default 4,
  threshold   numeric(3,1) not null default 3.0,
  status      text not null default 'active' check (status in ('active','retired')),
  sort_order  int  not null default 0
);

comment on table assessment_domains is
  '기획안 Appendix A 5개 대분류. 21문항의 A/B/C/D 를 대체한다';
comment on table assessment_areas is
  '기획안 Appendix A 10개 평가영역. checkpoints·concerns 는 원문 그대로 — 영업이 고객 앞에서 읽는 문장이다';
comment on column assessment_areas.weight is
  '가중치. 데이터 유출·계정 통제처럼 사고 시 되돌릴 수 없는 것을 높게 둔다';
comment on column assessment_areas.threshold is
  '이 미만이면 미달. 21문항은 3.0~3.5 를 썼고 같은 폭을 유지한다';

insert into assessment_domains (id, name, sort_order) values
  ('D1', '데이터·보안',  10),
  ('D2', '운영·통제',    20),
  ('D3', '신뢰·책임',    30),
  ('D4', '법률·규제',    40),
  ('D5', '비용·사업성',  50)
on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order;

-- 가중치·임계값은 기획안에 없다. 21문항이 쓰던 폭(weight 3~5, threshold 3.0~3.5)을
-- 유지하고, **사고가 나면 되돌릴 수 없는 것**을 높게 뒀다. 근거를 각 행에 적는다.
insert into assessment_areas (id, domain_id, name, checkpoints, concerns, weight, threshold, sort_order) values
  ('A01', 'D1', '데이터 보호',
   '학습 사용 여부, 암호화, 고객사 간 분리',
   '기밀정보·고객정보·소스코드 유출',
   5, 3.5, 10),                          -- 유출은 되돌릴 수 없다
  ('A02', 'D1', '저장·보존',
   '저장 위치, 보존기간, 삭제 및 종료 후 처리',
   '해외 저장·백업 잔존·국외 이전',
   4, 3.5, 20),                          -- 국외 이전은 규제 위반으로 직결된다
  ('A03', 'D1', '계정·접근통제',
   'SSO, MFA, SCIM, RBAC, 퇴사자 권한 회수',
   '개인·공용·퇴사자 계정 통제 실패',
   5, 3.5, 30),                          -- 21문항 A-02 가 전제조건에 가장 많이 걸렸다
  ('A04', 'D1', '데이터 권한 연계',
   '기존 문서·메일·시스템 ACL 유지',
   '비인가 내부 데이터 접근',
   5, 3.5, 40),                          -- RAG 를 붙이는 순간 여기서 사고가 난다
  ('A05', 'D2', '감사·모니터링',
   '질문, 파일, 답변, 관리자·실행 로그',
   '사고 원인·사용자 추적 불가',
   4, 3.0, 50),
  ('A06', 'D2', 'AI 행동 통제',
   'Agent Tool Call, 파일·메일·외부전송 승인',
   '위험한 작업의 임의 실행',
   4, 3.0, 60),                          -- Agent 를 파는 이상 빠질 수 없다
  ('A07', 'D3', '정확성·신뢰성',
   '출처, 평가, 결과검증, Human-in-the-loop',
   '오답의 고객응대·의사결정 활용',
   4, 3.0, 70),
  ('A08', 'D4', '개인정보·규제',
   '개인정보, 국외이전, 산업별 요구사항',
   '법적 분쟁·자동화 의사결정 문제',
   5, 3.5, 80),                          -- 금융·공공은 여기서 막히면 딜이 끝난다
  ('A09', 'D4', '저작권·계약',
   '입력·산출물 권리, 벤더 책임',
   '저작권·라이선스·계약 위반',
   3, 3.0, 90),
  ('A10', 'D5', '비용·확장성',
   '시트·Credit·API, 확장성과 종속성',
   '비용 증가·ROI 부족·벤더 종속',
   4, 3.0, 100)
on conflict (id) do update set
  domain_id = excluded.domain_id, name = excluded.name,
  checkpoints = excluded.checkpoints, concerns = excluded.concerns,
  weight = excluded.weight, threshold = excluded.threshold, sort_order = excluded.sort_order;

-- ── 딜 컬럼 ─────────────────────────────────────────────────────
alter table deals add column if not exists assessment_scores jsonb not null default '{}'::jsonb;
alter table deals add column if not exists assessment_totals jsonb not null default '{}'::jsonb;

comment on column deals.assessment_scores is
  '평가영역별 1~5점 {"A01":3,...}. 037 bridge 로 8개가 자동으로 차고 나머지는 STEP03 에서 확인한다';
comment on column deals.assessment_totals is
  '대분류별 집계 {"D1":{"score":2.8,"threshold":3.5,"answered":4,"ready":false},...}';

alter table assessment_domains enable row level security;
alter table assessment_areas   enable row level security;
revoke all on assessment_domains, assessment_areas from anon, authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 대분류 5 · 평가영역 10 이어야 한다.
select d.id, d.name, count(a.id) as "평가영역",
       string_agg(a.name, ', ' order by a.sort_order) as "구성"
  from assessment_domains d left join assessment_areas a on a.domain_id = d.id
 group by d.id, d.name, d.sort_order order by d.sort_order;
--
-- 2) 원문이 그대로 들어갔는가. 영업이 고객 앞에서 읽는 문장이다.
select id, name, checkpoints as "핵심 확인사항", concerns as "주요 우려사항",
       weight as "가중치", threshold as "기준"
  from assessment_areas order by sort_order;
--
-- 3) 딜 컬럼이 생겼는가.
select column_name from information_schema.columns
 where table_schema = current_schema() and table_name = 'deals'
   and column_name like 'assessment%';
