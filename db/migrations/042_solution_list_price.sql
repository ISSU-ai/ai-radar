-- 042. 솔루션 리스트 프라이스 (벤더 공시가)
--
-- 영업이 협상 기준선을 몰라 매번 벤더에 물어야 했다. 기존 가격 컬럼과 **다른 것**이다.
--   unit_price·price_tiers  우리가 견적을 계산하는 단가 (딜 시뮬레이터 입력)
--   list_price              벤더가 공개한 정가. 참고·협상 기준선이며 계산에 안 쓴다
--
-- ⚠ 과금 모양이 제품마다 다르다 — 좌석/월, 1M 토큰, GB, 시간당. 숫자 한 칸으로는
--   못 담아서 items 배열로 받는다.
--
-- ⚠ **공시가가 없으면 숫자를 넣지 않는다.** Zscaler·Check Point·Portal26·Articul8 은
--   정가를 공개하지 않는다. 3자 사이트가 "$72~325" 같은 범위를 적어 두지만 그건
--   보고된 견적이지 정가가 아니다. 화면에 숫자가 보이면 영업이 고객 앞에서 인용한다.
--   status='quote' 로 두고 「견적 문의」로만 띄운다 (사용자 결정 2026-08-12).
--
-- ⚠ 3자 사이트와 공식이 실제로 어긋났다. GitLab Ultimate 을 여러 곳이 $99 로 적지만
--   공식 페이지는 맞춤 견적이고, Claude Team 은 $25 가 아니라 $20(연간)/$25(월납)다.
--   그래서 source 와 checked_at 을 같이 저장한다 — 출처 없는 가격은 확인이 불가능하다.
--
-- 스키마 + 시드다. 시드가 사람이 고친 값을 덮으므로 apply-migrations.js 에 넣지 않는다.
--
-- 모양:
--   { "status": "published" | "quote",
--     "source": "확인한 URL", "checked_at": "YYYY-MM-DD",
--     "needs_review": true,            -- 공식 페이지를 자동으로 못 읽어 사람 확인이 필요
--     "note": "화면에 그대로 뜨는 한 줄",
--     "items": [ {"plan","amount","currency","unit","terms"} ] }
--   amount 가 null 이면 그 항목은 「견적」으로 표시된다.

begin;

alter table solutions add column if not exists list_price jsonb not null default '{}'::jsonb;

comment on column solutions.list_price is
  '벤더 공시가(참고). unit_price(견적 계산용)와 다르다. status=quote 면 숫자를 넣지 않는다. source·checked_at 없이는 못 믿는다';

-- ── 공시가가 있는 것 ─────────────────────────────────────────────
update solutions set list_price = '{
  "status": "published",
  "source": "https://about.gitlab.com/pricing/",
  "checked_at": "2026-08-12",
  "note": "Ultimate 은 공식 페이지에서 맞춤 견적으로 바뀌었다. 3자 사이트의 $99 는 옛 값이다.",
  "items": [
    {"plan": "Free", "amount": 0, "currency": "USD", "unit": "user/월", "terms": "무료"},
    {"plan": "Premium", "amount": 29, "currency": "USD", "unit": "user/월", "terms": "연간 약정"},
    {"plan": "Ultimate", "amount": null, "currency": "USD", "unit": "user/월", "terms": "맞춤 견적"}
  ]
}'::jsonb where slug = 'gitlab';

update solutions set list_price = '{
  "status": "published",
  "source": "https://claude.com/pricing",
  "checked_at": "2026-08-12",
  "note": "Enterprise 는 좌석료 + API 사용량이다. 사용량이 좌석료를 훌쩍 넘길 수 있어 좌석료만 제시하면 안 된다.",
  "items": [
    {"plan": "Team (표준 좌석)", "amount": 20, "currency": "USD", "unit": "seat/월", "terms": "연간 약정 · 2~150석"},
    {"plan": "Team (표준 좌석)", "amount": 25, "currency": "USD", "unit": "seat/월", "terms": "월납"},
    {"plan": "Team (프리미엄 좌석)", "amount": 100, "currency": "USD", "unit": "seat/월", "terms": "연간 약정"},
    {"plan": "Enterprise", "amount": 20, "currency": "USD", "unit": "seat/월", "terms": "+ API 사용량 별도 · 영업 협의"}
  ]
}'::jsonb where slug = 'anthropic-claude';

update solutions set list_price = '{
  "status": "published",
  "source": "https://cohere.com/pricing",
  "checked_at": "2026-08-12",
  "note": "토큰 과금이라 좌석 견적에 그대로 못 쓴다. 전용 배포(Model Vault)는 시간당 과금이다.",
  "items": [
    {"plan": "Command R+ (08-2024)", "amount": 2.5, "currency": "USD", "unit": "1M 입력토큰", "terms": "출력 $10"},
    {"plan": "Command R (03-2024)", "amount": 0.5, "currency": "USD", "unit": "1M 입력토큰", "terms": "출력 $1.50"},
    {"plan": "Command", "amount": 1, "currency": "USD", "unit": "1M 입력토큰", "terms": "출력 $2"},
    {"plan": "Embed 4 (전용 배포)", "amount": 4, "currency": "USD", "unit": "시간", "terms": "$4~5/hr · 월 $2,500~3,250"},
    {"plan": "Rerank (전용 배포)", "amount": 5, "currency": "USD", "unit": "시간", "terms": "$5~10/hr"},
    {"plan": "North · Compass", "amount": null, "currency": "USD", "unit": "-", "terms": "맞춤 견적"}
  ]
}'::jsonb where slug = 'cohere';

update solutions set list_price = '{
  "status": "published",
  "source": "https://newrelic.com/pricing",
  "checked_at": "2026-08-12",
  "note": "인제스트 + 좌석 두 축으로 동시에 과금된다. 좌석만 계산하면 실제 청구가 크게 어긋난다.",
  "items": [
    {"plan": "데이터 인제스트", "amount": 0.4, "currency": "USD", "unit": "GB", "terms": "월 100GB 무료 · Data Plus $0.60"},
    {"plan": "Core User", "amount": 49, "currency": "USD", "unit": "user/월", "terms": "전 유료 등급 공통"},
    {"plan": "Full Platform (Standard)", "amount": 99, "currency": "USD", "unit": "user/월", "terms": "첫 사용자 $10 · 최대 5명"},
    {"plan": "Full Platform (Pro)", "amount": 349, "currency": "USD", "unit": "user/월", "terms": "연간 약정 · 월납 $418.80"},
    {"plan": "Enterprise", "amount": null, "currency": "USD", "unit": "user/월", "terms": "영업 협의"}
  ]
}'::jsonb where slug = 'new-relic';

update solutions set list_price = '{
  "status": "published",
  "source": "https://openai.com/chatgpt/pricing/",
  "checked_at": "2026-08-12",
  "needs_review": true,
  "note": "⚠ Enterprise 가격·최소 시트는 OpenAI 영업 협의사항이다. 확정 금액으로 제시하지 않는다. Business 값은 공식 페이지 자동 확인이 막혀(403) 사람이 한 번 대조해야 한다.",
  "items": [
    {"plan": "Business", "amount": 20, "currency": "USD", "unit": "user/월", "terms": "연간 약정 · 2석 최소"},
    {"plan": "Business", "amount": 25, "currency": "USD", "unit": "user/월", "terms": "월납"},
    {"plan": "Enterprise", "amount": null, "currency": "USD", "unit": "user/월", "terms": "영업 협의 · 최소 시트 있음"},
    {"plan": "Codex", "amount": null, "currency": "USD", "unit": "-", "terms": "요금제별 포함 범위가 다르다 · 영업 확인"}
  ]
}'::jsonb where slug = 'openai-enterprise';

-- ── 공시가가 없는 것 — 숫자를 넣지 않는다 ────────────────────────
update solutions set list_price = '{
  "status": "quote",
  "checked_at": "2026-08-12",
  "note": "공시가를 공개하지 않는다. 3자 사이트의 ZIA $72~325 · ZPA $140~375/user/yr 는 보고된 견적이지 정가가 아니다.",
  "items": []
}'::jsonb where slug = 'zscaler';

update solutions set list_price = '{
  "status": "quote",
  "checked_at": "2026-08-12",
  "note": "공시가를 공개하지 않는다. 3자 사이트의 Harmony Endpoint $25~45 · Infinity 번들 $65~85/user/yr 는 보고된 견적이다.",
  "items": []
}'::jsonb where slug = 'check-point';

update solutions set list_price = '{
  "status": "quote",
  "checked_at": "2026-08-12",
  "note": "공시가 없음. Claude 전용 거버넌스는 무료 티어가 있다고 안내하나 조건은 벤더 확인이 필요하다.",
  "items": []
}'::jsonb where slug = 'portal26';

update solutions set list_price = '{
  "status": "quote",
  "checked_at": "2026-08-12",
  "note": "공시가 없음. 계약 단위로만 가격이 정해진다.",
  "items": []
}'::jsonb where slug = 'articul8';

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name from information_schema.columns
 where table_schema = current_schema() and table_name = 'solutions' and column_name = 'list_price';
--
-- 2) 9종이 다 채워졌는가. 0건이면 slug 가 다른 것이다.
select slug,
       list_price ->> 'status'                              as "구분",
       jsonb_array_length(coalesce(list_price -> 'items', '[]'::jsonb)) as "항목",
       list_price ->> 'checked_at'                          as "확인일",
       coalesce(list_price ->> 'needs_review', 'false')     as "사람확인필요"
  from solutions
 where list_price <> '{}'::jsonb
 order by list_price ->> 'status', slug;
--
-- 3) ⚠ quote 인데 숫자가 들어간 행이 있으면 안 된다. 0건이어야 한다.
select slug from solutions
 where list_price ->> 'status' = 'quote'
   and jsonb_array_length(coalesce(list_price -> 'items', '[]'::jsonb)) > 0;
