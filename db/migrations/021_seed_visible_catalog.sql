-- 021. 노출 솔루션 정리 (1회성 시드)
--
-- 요청: claude / openai / portal26 / checkpoint / zscaler / new relic / articul8 / cohere
--       만 남기고 나머지는 hidden. 데이터는 지우지 않는다.
--
-- ⚠️ 이 파일은 apply-migrations.js 에서 제외한다. 어드민에서 켜고 끈 상태를 덮어쓰는
--    1회성 시드이기 때문이다 (012·014·016~019 와 같은 성격). Supabase SQL Editor 에서
--    한 번만 실행한다.
--
-- ⚠️ 실행 순서
--   1. **023 뒤에 돌린다.** cohere 는 023 이 만드는 행이다. 023 없이 실행하면 그
--      슬러그가 아무 행에도 안 걸려 노출이 8종이 아니라 7종이 된다.
--      020(is_hidden 컬럼)도 당연히 먼저 있어야 한다.
--      → db/migrations/_combined_apply.sql 이 순서를 지켜 만들어져 있다.
--   2. slack · notion · github · gitlab 은 019 로 등록해 비어 있던 슬롯
--      (business-app-agent · ai-coding-env)을 채운 것들이다. 목록에 없으므로 숨겨진다.
--      → 그 슬롯의 추천 후보가 0 이 된다.
--
--      **의도한 결과다.** 요청이 "8종만 남긴다" 였고, 019 는 데이터를 만들어 두는 것이
--      목적이었지 지금 당장 영업에게 보이라는 것이 아니었다. 행은 그대로 남아 있고
--      어드민에서 눈 아이콘 한 번으로 되돌릴 수 있다 — 이것이 is_hidden 을 판 이유다.
--
--      나중에 오퍼링 맵의 ISV 확장 패키지(AI Productivity·AI Developer)를 실제로
--      팔기 시작하면 그때 켜면 된다. 켜는 방법 둘 중 하나:
--        · /admin 솔루션 목록에서 눈 아이콘 클릭 (권장 — 감사로그가 남는다)
--        · 아래 keep 목록에 네 슬러그를 추가하고 이 파일을 다시 실행

begin;

with keep(slug) as (
  values
    ('anthropic-claude'),
    ('openai-enterprise'),
    ('articul8'),
    ('portal26'),
    ('check-point'),
    ('zscaler'),
    ('new-relic'),
    ('cohere')          -- 023 이 등록한다. 그래서 021 을 023 뒤에 돌려야 한다.
)
update solutions s
   set is_hidden = not exists (select 1 from keep k where k.slug = s.slug)
 where s.is_archived = false;

commit;

-- 확인 1) 노출로 남은 것
--   select slug, name, status,
--          jsonb_array_length(coalesce(fqa_coverage, '[]'::jsonb)) as 판정데이터
--     from solutions
--    where is_archived = false and is_hidden = false
--    order by slug;
--
-- 확인 2) 숨긴 것 (데이터는 그대로 있다)
--   select count(*) from solutions where is_archived = false and is_hidden = true;
--
-- 확인 3) 빈 슬롯이 생겼는지 — 019 를 적용했다면 여기서 후보 0 인 슬롯이 늘어난다
--   select sl.id, sl.name, count(s.id) as 노출후보
--     from solution_slots sl
--     left join solutions s
--       on s.slot = sl.id and s.is_archived = false and s.is_hidden = false
--    group by sl.id, sl.name
--   having count(s.id) = 0
--    order by sl.id;
