-- 017~023 적용 결과를 한 번에 확인한다. Supabase SQL Editor 에 그대로 붙여넣는다.
-- 기대와 다른 행이 있으면 그 항목부터 파고든다. 순서는 _combined_apply.sql 기준
-- (017 → 018 → 019 → 020 → 022 → 023 → 021).

select '01. 오퍼링 5종'          as "검사",
       string_agg(id || ' ' || name, ' / ' order by sort_order) as "결과",
       '01 AI Consulting / 02 OpenAI Ready / 03 AIR Service (AI-Ready) / 04 ... / 05 ...' as "기대"
  from offerings

union all
select '02. 02 가 OpenAI Ready 인가', coalesce((select name from offerings where id = '02'), '(없음)'),
       'OpenAI Ready — AI Trust & Guardrails 면 017 이 옛날 버전이다'

union all
select '03. 패키지 오퍼링 배정', count(*)::text || '/6종 배정',
       '6/6 — 미배정이 있으면 017 이 안 돌았다'
  from packages where offering_id is not null

union all
select '04. PoC 소속', coalesce((select offering_id from packages where id = 'POC'), '(없음)'),
       '03 — 제출본에서 PoC 는 AIR Service 다 (v0.1 의 01 이 아니다)'

union all
select '05. 패키지 이름 보존', string_agg(name, ' / ' order by sort_order),
       '001 시드 이름 그대로 — 03 에 둘이 붙어서 오퍼링 이름으로 덮으면 구분이 사라진다'
  from packages where offering_id = '03'

union all
select '06. 예산·구매 준비도를 덮는 패키지',
       coalesce((select string_agg(p.id, ', ') from packages p
                  where exists (select 1 from jsonb_array_elements(p.fqa_coverage) e
                                 where e->>'category' = 'D'
                                   and (e->'items') ? '예산·구매 준비도')), '(없음)'),
       'DISCOVERY — (없음) 이면 017 의 핵심 변경이 안 들어갔다'

union all
select '07. Pain 대분류 / 평가영역',
       (select count(*)::text from fqa_pain_categories) || ' / ' ||
       (select count(*)::text from fqa_pain_areas), '5 / 10'

union all
select '08. 대응 문항 없는 평가영역',
       coalesce((select string_agg(a.id, ', ') from fqa_pain_areas a
                  where not exists (select 1 from fqa_item_pain_map m where m.pain_area = a.id)), '(없음)'),
       'ip-contract 1건 — 저작권·계약은 진단 문항이 없다(알려진 갭)'

union all
select '09. ISV 번들', (select count(*)::text from isv_bundles) || '종 / 멤버 ' ||
       (select count(*)::text from isv_bundle_members), '5종 / 멤버 8건 이상'

union all
select '10. 번들 멤버 깨진 참조', count(*)::text || '건', '0건'
  from isv_bundle_members m
 where not exists (select 1 from solutions s where s.slug = m.solution_slug)

union all
select '11. is_hidden 컬럼', case when exists (
         select 1 from information_schema.columns
          where table_schema = current_schema() and table_name = 'solutions'
            and column_name = 'is_hidden') then '있음' else '없음' end,
       '있음 — 없으면 020 이 안 돌았다'

union all
select '12. Portal26 본문', (select count(*)::text from jsonb_object_keys(
         (select coalesce(sections, '{}'::jsonb) from solutions where slug = 'portal26')) k) || '탭',
       '8탭 — 0 이면 022 가 안 돌았다'

union all
select '13. Cohere 등록',
       coalesce((select slug || ' / ' || slot || ' / ' || delivery
                   from solutions where slug = 'cohere'), '(없음)'),
       'cohere / llm-platform / SaaS · VPC · On-prem'

union all
select '14. 영업에게 보이는 솔루션', count(*)::text || '종',
       '8종 — 021 적용 후. 7종이면 023 을 021 보다 나중에 돌린 것이다'
  from solutions
 where is_archived = false and coalesce(is_hidden, false) = false

union all
select '15. 노출 목록', string_agg(slug, ', ' order by slug),
       'anthropic-claude, articul8, check-point, cohere, new-relic, openai-enterprise, portal26, zscaler'
  from solutions
 where is_archived = false and coalesce(is_hidden, false) = false

union all
select '16. 노출 중 판정데이터 없음', coalesce(string_agg(slug, ', '), '(없음)'),
       '(없음) — 있으면 영업 화면에서 추천 근거를 못 댄다'
  from solutions
 where is_archived = false and coalesce(is_hidden, false) = false
   and jsonb_array_length(coalesce(fqa_coverage, '[]'::jsonb)) = 0

union all
select '17. 숨긴 솔루션', count(*)::text || '종',
       '데이터는 남아 있다. 어드민 눈 아이콘으로 되돌린다'
  from solutions where is_archived = false and is_hidden = true

union all
select '18. 후보 0 인 슬롯', coalesce(string_agg(sl.id, ', '), '(없음)'),
       'business-app-agent · ai-coding-env 포함이 정상 — 021 이 그 4종을 감췄다'
  from solution_slots sl
 where not exists (
   select 1 from solutions s
    where s.slot = sl.id and s.is_archived = false and coalesce(s.is_hidden, false) = false)

order by 1;
