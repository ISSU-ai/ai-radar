-- 010~013 적용 결과를 한 번에 확인한다. Supabase SQL Editor 에 그대로 붙여넣는다.
-- 기대값과 다른 행이 있으면 그 항목부터 확인할 것.

select '1. enum 역할'            as "검사",
       string_agg(r::text, ', ' order by r::text) as "결과",
       'admin, curator, viewer'  as "기대"
  from unnest(enum_range(null::app_role)) r

union all
select '2. 슬롯 분류표', count(*)::text || '개', '23개'
  from solution_slots

union all
select '3. 슬롯 미배정', count(*)::text || '건', '0건 (있으면 slug 불일치)'
  from solutions where is_archived = false and slot is null

union all
select '4. 판정 데이터 보유', count(*)::text || '종', '9종'
  from solutions where is_archived = false and jsonb_array_length(fqa_coverage) > 0

union all
select '5. 판정 데이터 없음', count(*)::text || '종', '13종 (콘텐츠 보강 대상)'
  from solutions where is_archived = false and jsonb_array_length(fqa_coverage) = 0

union all
select '6. 깨진 red_flag slug', count(*)::text || '건', '0건'
  from solutions s,
       jsonb_array_elements(s.red_flags) rf,
       jsonb_array_elements(rf->'alternatives') alt
 where alt->>'slug' is not null
   and not exists (select 1 from solutions t where t.slug = alt->>'slug')

union all
select '7. 레이어 정정',
       string_agg(slug || '=' || layer, ', ' order by slug),
       'check-point=L4, followerrabbit=L4, tigergraph=L0, zscaler=L4'
  from solutions where slug in ('zscaler', 'check-point', 'followerrabbit', 'tigergraph')

union all
select '8. 추천 설정', count(*)::text || '행', '11행 (필터 6 + 정렬 5)'
  from recommendation_config

union all
select '9. 카탈로그 총계', count(*)::text || '종', '22종 (18 + Trust Layer 4)'
  from solutions where is_archived = false

union all
select '10. 미확정 단가',
       count(*) filter (where price_is_placeholder)::text || ' / ' || count(*)::text,
       '전부 미확정 (실단가 입력 전)'
  from solutions where is_archived = false

order by 1;
