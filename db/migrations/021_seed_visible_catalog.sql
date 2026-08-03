-- 021. 노출 솔루션 정리 (1회성 시드)
--
-- 요청: claude / openai / portal26 / checkpoint / zscaler / new relic / articul8 / cohere
--       만 남기고 나머지는 hidden. 데이터는 지우지 않는다.
--
-- ⚠️ 이 파일은 apply-migrations.js 에서 제외한다. 어드민에서 켜고 끈 상태를 덮어쓰는
--    1회성 시드이기 때문이다 (012·014·016~019 와 같은 성격). Supabase SQL Editor 에서
--    한 번만 실행한다.
--
-- ⚠️ 확인 필요 두 가지
--   1. cohere 는 카탈로그에 솔루션으로 없다. Unique 설명 안에 경쟁제품으로 한 줄
--      언급될 뿐이다(isv_data.js). 아래 목록에 넣어 두었으므로 나중에 등록하면
--      자동으로 노출된다. 등록 전에는 아무 행에도 걸리지 않는다.
--   2. slack · notion · github · gitlab 은 019 로 등록해 비어 있던 슬롯
--      (business-app-agent · ai-coding-env)을 채운 것들이다. 목록에 없으므로 숨겨진다.
--      → 그 슬롯의 추천 후보가 다시 0 이 된다. 의도한 것인지 확인할 것.
--      노출하려면 아래 keep 목록에 네 슬러그를 추가하고 다시 실행하면 된다.

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
    ('cohere')          -- 아직 미등록. 등록되면 자동 노출된다.
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
