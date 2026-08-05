-- 037. 42문항 → 10평가영역 bridge (1회성 시드)
--
-- 030 이 42→21 을 잇던 것과 같은 구조다. 21문항은 13/21(62%)이 찼는데 10평가영역은
-- **8/10(80%)** 이 찬다 — 두 문항집이 더 잘 맞물린다.
--
-- 못 채우는 둘(저장·보존 / 계정·접근통제)은 **순수 제품 통제 게이트**다. 42문항은
-- 조직이 AI 를 얼마나 하는지 묻지, SSO·SCIM 이 있는지·보존기간이 며칠인지 묻지 않는다.
-- 원래 영업이 확인해야 하는 것이라 STEP03 에서 후보별로 묻는다.
--
-- ⚠ 강도(fidelity)를 남기는 이유는 030 과 같다. ○ 는 뜻이 겹치되 각도가 조금 다르다 —
--   나중에 값이 이상할 때 어느 대응을 의심할지 알 수 있어야 한다.
--
-- ⚠ 여러 문항이 한 평가영역을 채우면 **평균**을 쓴다. 최댓값을 쓰면 하나만 잘해도
--   통과하고, 최솟값을 쓰면 하나만 못해도 막힌다. 둘 다 판정을 왜곡한다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

create table if not exists readiness_assessment_bridge (
  item_code text not null references readiness_items(code) on delete cascade,
  area_id   text not null references assessment_areas(id)  on delete cascade,
  fidelity  text not null check (fidelity in ('exact', 'good')),
  note      text not null,
  primary key (item_code, area_id)
);

comment on table readiness_assessment_bridge is
  '42문항 응답으로 10평가영역을 채우는 대응. 여러 문항이 한 영역을 채우면 평균을 쓴다';
comment on column readiness_assessment_bridge.fidelity is
  'exact=뜻이 같다 / good=실용상 같다. 값이 이상할 때 어느 대응을 의심할지 알려준다';

delete from readiness_assessment_bridge;
insert into readiness_assessment_bridge (item_code, area_id, fidelity, note) values
  -- ◎ 정확 — 뜻이 같다
  ('D7', 'A01', 'exact',
   'AI 학습 데이터에서 개인정보·민감정보를 자동 제거·처리하는 보안 체계 = 데이터 보호. '
   || '기획안의 "학습 사용 여부" 를 정면으로 묻는다'),
  ('G2', 'A07', 'exact',
   'AI 가 잘못된 정보를 사실처럼 말하는 문제를 막는 검증 체계 = 정확성·신뢰성. '
   || '기획안의 "결과검증" 과 같은 것을 묻는다'),
  ('G4', 'A08', 'exact',
   '새 AI 서비스를 만들 때부터 법무·규제 팀이 참여해 법적 위험을 사전 검토 = 개인정보·규제'),
  ('T7', 'A10', 'exact',
   'AI 운영 비용을 프로젝트·부서별로 투명하게 파악하고 낭비를 줄인다 = 비용·확장성의 비용 쪽'),

  -- ○ 좋음 — 실용상 같다
  ('D1', 'A04', 'good',
   '부서별 데이터를 전사 통합하고 필요한 부서가 접근 = 데이터 권한 연계. '
   || '기획안은 ACL 유지를, 42문항은 접근 가능성을 본다 — 통합이 안 돼 있으면 ACL 연계도 없다'),
  ('D3', 'A04', 'good',
   '현업이 필요한 데이터를 스스로 찾을 수 있는 검색 체계. D1 과 함께 평균을 낸다'),
  ('G7', 'A05', 'good',
   'AI 서비스 성능·오류율·비용 실시간 모니터링 = 감사·모니터링의 운영 쪽. '
   || '기획안의 질의·응답 로그까지는 안 묻는다'),
  ('D6', 'A05', 'good',
   '데이터 출처와 변경 이력 추적 = 감사·모니터링의 추적성 쪽. G7 과 함께 평균을 낸다'),
  ('T2', 'A06', 'good',
   '부서별 무분별 AI 도입을 막고 전사 통일 방식으로 사용·관리 = AI 행동 통제. '
   || '기획안은 Agent Tool Call 승인을, 42문항은 도구 사용 통제를 본다 — 통제 주체가 같다'),
  ('G1', 'A09', 'good',
   '허위정보·개인정보 유출·저작권 침해 위험을 체계적으로 관리 = 저작권·계약. '
   || '저작권이 세 위험 중 하나로 명시돼 있다'),
  ('T5', 'A10', 'good',
   'AI 연산 수요 급증에 유연히 대응하는 클라우드 인프라 = 비용·확장성의 확장성 쪽. '
   || 'T7 과 함께 평균을 낸다');

  -- ✕ 대응 없음 — 넣지 않는다
  --   A02 저장·보존      저장 위치·보존기간·삭제. 42문항은 제품 설정을 묻지 않는다
  --   A03 계정·접근통제  SSO·MFA·SCIM·RBAC. 위와 같다
  --   둘 다 STEP03 에서 후보별로 확인한다. 억지로 채우면 판정이 조용히 틀린다.

alter table readiness_assessment_bridge enable row level security;
revoke all on readiness_assessment_bridge from anon, authenticated;

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 11건(◎4 ○7)이어야 하고 10영역 중 8개가 채워져야 한다.
select count(*) as "대응", count(distinct area_id) as "채워지는 영역",
       count(*) filter (where fidelity = 'exact') as "정확",
       count(*) filter (where fidelity = 'good')  as "좋음"
  from readiness_assessment_bridge;
--
-- 2) 어느 영역이 어떤 문항으로 차는가. 안 차는 둘이 A02·A03 이어야 한다.
select a.id, a.name,
       coalesce(string_agg(b.item_code, ', ' order by b.item_code), '— 영업 확인') as "42문항"
  from assessment_areas a
  left join readiness_assessment_bridge b on b.area_id = a.id
 group by a.id, a.name, a.sort_order order by a.sort_order;
--
-- 3) 실재하지 않는 문항·영역을 가리키는가. FK 가 잡지만 눈으로도 본다. **0건**
select b.item_code, b.area_id
  from readiness_assessment_bridge b
  left join readiness_items i on i.code = b.item_code and i.status = 'active'
  left join assessment_areas a on a.id = b.area_id and a.status = 'active'
 where i.code is null or a.id is null;
