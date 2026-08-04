-- ===================================================================
-- 통합 적용 스크립트 (자동 생성 — scripts/build-pending-sql.js)
--
-- Supabase SQL Editor 에 전체를 붙여넣고 한 번에 실행합니다.
-- 파일을 직접 수정하지 마세요. 원본은 db/migrations/ 의 개별 파일입니다.
--
-- 포함: 030_readiness_fqa_bridge.sql → 031_deal_readiness.sql
--
-- 실행 후 각 파일 끝의 검증 쿼리 결과를 눈으로 확인하세요.
--   011: 슬롯 미배정 0건 / 슬롯별 후보 수 / 레이어 정정 4건
--   012: 판정 데이터 9건 · 미보강 13건 · 깨진 slug 0건
--   013: enum 에 curator 포함 · 역할별 인원
-- ===================================================================

-- ═══════════════════════════════════════════════════════════════
-- ▼ 030_readiness_fqa_bridge.sql
-- ═══════════════════════════════════════════════════════════════

-- 030. 42문항 → 21문항 대응 (1회성 시드)
--
-- 42문항 응답이 들어오면 대응되는 21문항 점수를 자동으로 채운다. 그래야 영업이
-- 허브에서 처음부터 다시 묻지 않는다.
--
-- ⚠ **◎(정확)·○(좋음) 만 넣는다.** △(부분)·✕(없음)은 넣지 않는다.
--   뜻이 어긋나는 문항을 억지로 이으면 ISV 전제조건 판정이 조용히 틀어진다.
--   틀린 자동 채움은 빈칸보다 나쁘다 — 빈칸은 영업이 보고 채우지만, 틀린 값은
--   그냥 통과한다.
--
-- 대조표 전문: docs/planning/42q-offering-scoring-plan.md §3
--
-- 이어지지 않는 8개 (영업이 허브에서 채운다)
--   ✕ 없음  A-2 접근권한과 계정 체계   ← ISV 전제조건에 가장 많이 걸리는 문항
--           A-6 데이터 보존·삭제 정책
--           B-9 개발·테스트 환경
--           D-21 예산·구매 준비도      ← 017 의 핵심 변경이 이 문항이다
--   △ 부분  A-1 데이터 분류(D7 은 자동화 여부지 기준 정의가 아니다)
--           A-4 감사 로그(G1·D6 이 걸치지만 정확하지 않다)
--           B-11 모델·벤더 전환성(T2 는 중앙 관리라 뜻이 다르다)
--           D-19 현업 오너십(S7 은 목표 공유이지 오너십이 아니다)
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

create table if not exists readiness_fqa_bridge (
  item_code    text not null references readiness_items(code) on delete cascade,
  fqa_category text not null,
  fqa_item     text not null,
  fidelity     text not null check (fidelity in ('exact', 'good')),
  note         text,
  primary key (item_code, fqa_category, fqa_item)
);

comment on table readiness_fqa_bridge is
  '42문항 → 21문항 자동 채움. 뜻이 정확히 겹치는 것만 넣는다 — 틀린 자동 채움은 빈칸보다 나쁘다';
comment on column readiness_fqa_bridge.fidelity is
  'exact 뜻이 같다 / good 실용상 같다. 그보다 약하면 아예 넣지 않는다';

insert into readiness_fqa_bridge (item_code, fqa_category, fqa_item, fidelity, note) values
  -- ◎ 정확 — 뜻이 같다
  ('T4', 'B', '업무 시스템 연동성', 'exact',
   'ERP·CRM·인사 시스템 연동. 문항 표현까지 거의 같다'),
  ('D4', 'B', '지식 소스 품질',     'exact',
   '사내 문서를 AI 가 읽고 답할 수 있는 형태인가 = 지식 소스가 준비됐는가'),
  ('G6', 'C', '장애 대응 체계',     'exact',
   'AI 오작동·중단 시 복구. 대상이 AI 로 좁을 뿐 같은 것을 묻는다'),
  ('T7', 'C', '비용 모니터링',      'exact',
   '프로젝트·부서별 비용 파악. 21 쪽 fix 문구(부서별 태깅)와 일치한다'),
  ('P2', 'D', '변화관리·교육',      'exact',
   '직급·직무별 정기 교육. 21 쪽 fix 문구(역할별 교육)와 일치한다'),

  -- ○ 좋음 — 실용상 같다
  ('G3', 'A', '보안 게이트웨이 준비도', 'good',
   '망분리를 지키며 외부 AI 를 안전하게 쓰는 체계 = AI 트래픽 통제 경로'),
  ('G4', 'A', '규제·컴플라이언스 검토', 'good',
   '법무·규제 팀의 사전 검토 프로세스. 21 은 검토 완료 여부, 42 는 프로세스 존재 —'
   ' 프로세스가 있으면 검토는 따라온다'),
  ('T5', 'B', '확장성·성능 기준',   'good',
   '연산 수요 급증 대응 인프라. 21 은 기준 수립, 42 는 대응 능력'),
  ('P1', 'C', '운영 책임자 지정',   'good',
   '전담 AI 조직이 공식 권한을 갖는가. 개인 지정보다 넓지만 같은 축이다'),
  ('G2', 'C', '품질 평가 체계',     'good',
   '환각 검증 체계 = 정확도·안전성 평가 기준의 실행형'),
  ('T1', 'C', '변경·배포 관리',     'good',
   '개발→배포→운영 자동화. 21 의 승인·버전·롤백을 포함한다'),
  ('S3', 'D', '명확한 업무 문제',   'good',
   '부서별 과제를 수집하고 우선순위를 정하는 프로세스 = 해결할 업무가 구체적인가'),
  ('B6', 'D', '성과 KPI',           'good',
   '도입 전후를 수치로 측정하고 개선하는가 = KPI 가 있는가')
on conflict (item_code, fqa_category, fqa_item) do update set
  fidelity = excluded.fidelity, note = excluded.note;

alter table readiness_fqa_bridge enable row level security;
drop policy if exists readiness_bridge_read on readiness_fqa_bridge;
create policy readiness_bridge_read on readiness_fqa_bridge for select using (is_approved());

commit;

-- 확인
-- 1) 13건이어야 한다 (◎5 + ○8).
select fidelity, count(*) from readiness_fqa_bridge group by fidelity order by 1;
--
-- 2) 가리키는 21문항이 실재하는가. 0건이어야 한다.
select b.item_code, b.fqa_category, b.fqa_item
  from readiness_fqa_bridge b
 where not exists (
   select 1 from fqa_items i where i.category = b.fqa_category and i.name = b.fqa_item);
--
-- 3) 자동 채움이 안 되는 21문항. 8개가 나오는 것이 정상이며, 영업이 허브에서 채운다.
--    A-2 접근권한 · A-6 보존정책 · B-9 개발환경 · D-21 예산 이 포함돼야 한다.
select i.category, i.name as "문항"
  from fqa_items i
 where i.status = 'active'
   and not exists (
     select 1 from readiness_fqa_bridge b
      where b.fqa_category = i.category and b.fqa_item = i.name)
 order by i.no;
--
-- 4) 한 42문항이 여러 21문항을 채우거나 그 반대인 곳. 지금은 전부 1:1 이어야 한다.
select item_code, count(*) from readiness_fqa_bridge group by item_code having count(*) > 1;


-- ═══════════════════════════════════════════════════════════════
-- ▼ 031_deal_readiness.sql
-- ═══════════════════════════════════════════════════════════════

-- 031. 딜에 42문항 준비도 응답 담기
--
-- /readiness 진단 결과가 상담 요청과 함께 들어와 딜에 남는다. 영업이 허브에서
-- "이 고객이 6축 어디가 약한지" 를 그대로 본다.
--
-- ⚠ fqa_scores(21문항)와 별도 컬럼이다. 두 문항집은 다른 질문에 답한다 —
--   42 는 "회사가 AI 를 얼마나 하고 있나", 21 은 "이 제품을 지금 살 수 있나".
--   다만 030 의 bridge 로 겹치는 13개는 42 에서 21 로 자동 채워진다. 나머지 8개는
--   영업이 채운다.
--
-- 스키마만 바꾸므로 apply-migrations.js 에 넣어도 안전하다.

begin;

alter table deals add column if not exists readiness_scores jsonb not null default '{}'::jsonb;
alter table deals add column if not exists readiness_totals jsonb not null default '{}'::jsonb;

comment on column deals.readiness_scores is
  '42문항 응답 원본 {"S1":3,...}. 고객이 /readiness 에서 답한 값';
comment on column deals.readiness_totals is
  '축별 집계와 성숙도 {"average":2.93,"maturity":{...},"areas":[...],"fqaFilled":[3,7,...]}. 화면이 다시 계산하지 않도록 서버 계산 결과를 그대로 담는다. fqaFilled 는 bridge 로 자동 채워진 21문항 번호 — 접수 시점 기준으로 굳혀 둔다';

create index if not exists idx_deals_has_readiness
  on deals ((readiness_scores <> '{}'::jsonb)) where readiness_scores <> '{}'::jsonb;

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name, data_type from information_schema.columns
 where table_schema = current_schema() and table_name = 'deals'
   and column_name in ('readiness_scores','readiness_totals');
--
-- 2) 42문항으로 들어온 딜과 그 축 점수.
select customer,
       readiness_totals -> 'average'            as "종합",
       readiness_totals -> 'maturity' ->> 'name' as "성숙도",
       jsonb_array_length(coalesce(readiness_totals -> 'areas', '[]'::jsonb)) as "축",
       (select count(*) from jsonb_object_keys(readiness_scores)) as "응답"
  from deals where readiness_scores <> '{}'::jsonb order by updated_at desc limit 10;
--
-- 3) bridge 로 자동 채워진 21문항이 몇 개인가. 13개여야 한다.
select d.customer,
       jsonb_array_length(coalesce(d.readiness_totals -> 'fqaFilled', '[]'::jsonb)) as "자동 채움",
       21 - jsonb_array_length(coalesce(d.readiness_totals -> 'fqaFilled', '[]'::jsonb)) as "영업 입력 필요"
  from deals d where d.readiness_scores <> '{}'::jsonb order by d.updated_at desc limit 10;

