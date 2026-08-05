-- 034. 딜 트랙을 고객 진입 시나리오 3유형으로 (1회성 시드)
--
-- 출처: OpenAI_통합_오퍼링_기획안.docx (2026-08-04) §7 「고객 진입 시나리오」
--
-- ── 왜 바꾸나 ───────────────────────────────────────────────────
-- 기존 트랙 T-A~T-D 는 **보안 환경**(Zscaler 유무·타사 SWG)으로 갈렸다. 우리가 만든
-- 축이고, 딜을 가르는 기준으로는 좁다 — 보안 환경이 같아도 사는 이유가 다르다.
--
-- 기획안은 **구매 동기**로 가른다. 무엇을 먼저 팔고 어떤 조합을 제안할지가 여기서
-- 갈리므로 영업이 실제로 쓰는 축이다.
--
--   ① 빠른 도입형     Business 시트 + 환경 설정 + 사용자 교육
--   ② 개발 생산성형   Business/Enterprise + Codex Credit + 사용자 교육
--   ③ 서비스 개발형   OpenAI API + AIR PS + Managed Service
--
-- 보안 환경 정보는 customer_meta.securityStack 에 그대로 남아 있어 잃는 것이 없다.
-- 오히려 추천 필터가 트랙이라는 대리 지표 대신 그 값을 직접 보게 되어 정확해진다.
--
-- ⚠ deals.track 이 tracks(id) 를 참조한다. 새 행을 먼저 넣고 → 딜을 옮기고 →
--   옛 행을 지운다. 순서가 바뀌면 FK 위반으로 통째로 롤백된다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

-- ── ① 새 트랙 ──────────────────────────────────────────────────
insert into tracks (id, name, why, warn, ask) values
  ('E-1', '빠른 도입형',
   '기존 업무환경을 활용해 단기간 내 생산성 효과를 확인하는 딜입니다. '
   || 'Business 시트 + 환경 설정 + 사용자 교육으로 시작합니다.',
   '02 OpenAI Ready 의 표준 구축은 라이선스 도입 고객에게 무상입니다. '
   || '심화 교육·맞춤 연계·PoC 는 별도 산정이므로 범위를 먼저 고정하세요.',
   '["첫 적용 부서와 인원은?","90일 안에 확인할 생산성 지표는?"]'),

  ('E-2', '개발 생산성형',
   '개발조직 KPI 를 기준으로 코드·테스트 자동화의 Codex 효과를 검증하는 딜입니다. '
   || 'Business/Enterprise + Codex Credit + 사용자 교육으로 시작합니다.',
   'Codex 는 Workspace Credit 토큰 종량제입니다. 개발자별 월 Credit 한도와 '
   || '동시 실행·Fast Mode 사용을 먼저 정하지 않으면 비용이 튑니다.',
   '["Codex 적용 개발자 수와 월 Credit 예산은?","코드·테스트 자동화의 성공 KPI는?"]'),

  ('E-3', '서비스 개발형',
   'API 기반 고객·사내 서비스를 PoC 후 상용화하고 유지 관리하는 딜입니다. '
   || 'OpenAI API + AIR PS + Managed Service 로 이어집니다.',
   'API 사용량은 변동성이 커서 기획안의 기본 목표 매출에서도 제외됐습니다. '
   || '상용 전환 전에 사용량·비용 한도와 운영 이관 주체를 확정하세요.',
   '["PoC 대상 서비스와 상용 전환 기준은?","운영 이관 주체는 고객인가 MZC인가?"]')
on conflict (id) do update set
  name = excluded.name, why = excluded.why, warn = excluded.warn, ask = excluded.ask;

-- ── ② 기존 딜 이관 ─────────────────────────────────────────────
-- 두 축이 1:1 로 대응하지 않는다. 보수적으로 옮기고 영업이 다시 고른다.
--   T-A 인프라 동반형   → E-3  AIR PS 가 들어가는 확장형이라 서비스 개발형에 가깝다
--   T-B 경량 도입형     → E-1  기존 환경으로 빠르게 — 뜻이 거의 같다
--   T-C Zscaler 보유형  → E-1  보안 환경은 구매 동기가 아니다. 기본값으로 둔다
--   T-D 타사 SWG 검토형 → E-1  위와 같다. SWG 충돌은 securityStack 이 계속 잡는다
update deals set track = case track
    when 'T-A' then 'E-3'
    else 'E-1'
  end
 where track in ('T-A', 'T-B', 'T-C', 'T-D');

-- ── ③ 옛 트랙 제거 ─────────────────────────────────────────────
delete from tracks where id in ('T-A', 'T-B', 'T-C', 'T-D');

-- ── ④ 판정 데이터의 트랙 참조 정리 ─────────────────────────────
-- 019 의 red_flag 문구가 "T-D 트랙" 을 가리킨다. 트랙이 사라졌으므로 실제 근거인
-- 보안 환경으로 바꿔 적는다. 화면에 그대로 나가는 문장이다.
update solutions set red_flags = replace(red_flags::text,
    '타사 SWG 를 이미 운영 중이고 교체 계획 없음(T-D 트랙)',
    '타사 SWG 를 이미 운영 중이고 교체 계획 없음')::jsonb
 where red_flags::text like '%T-D 트랙%';

commit;

-- ── 확인 ────────────────────────────────────────────────────────
-- 1) 트랙이 3종이어야 한다. T- 로 시작하는 것이 남아 있으면 안 된다.
select id, name, left(why, 40) || '…' as "권고 접근" from tracks order by id;
--
-- 2) 딜이 전부 옮겨졌는가. **옛 트랙 0건이어야 한다.**
select coalesce(track, '(미정)') as "트랙", count(*) as "딜"
  from deals group by track order by track nulls last;
--
-- 3) 참조가 깨진 딜이 없는가. **0건이어야 한다.**
select d.id, d.customer, d.track
  from deals d left join tracks t on t.id = d.track
 where d.track is not null and t.id is null;
--
-- 4) T-D 를 가리키던 판정 문구가 남아 있는가. **0건이어야 한다.**
select slug, name from solutions where red_flags::text like '%T-D%';
