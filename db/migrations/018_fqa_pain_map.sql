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
