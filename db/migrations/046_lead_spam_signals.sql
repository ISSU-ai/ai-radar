-- 046. 리드 스팸 신호
--
-- 포탈로 들어오는 리드에 「Test」·「Korea」 같은 일반명사 회사명이나 가짜 이름이
-- 섞인다. 지금은 그런 것도 딜이 되어 목록에 쌓이고, 영업이 하나씩 열어 봐야 안다.
--
-- ⚠ **막지 않는다. 표시한다.** 자동으로 버리면 진짜 고객을 잃는다 — 「모르면
--   판정하지 않는다」를 여기에도 적용한다. 삭제는 사람이 041 의 딜 삭제로 한다.
--
-- ⚠ **점수 하나로 뭉치지 않는다.** 신호 목록을 그대로 남긴다. "스팸 점수 0.7" 만
--   보면 왜 걸렸는지 알 수 없고, 모르면 기준을 못 고친다. 나중에 규칙을 손볼 때
--   어떤 신호가 헛돌았는지 이 컬럼으로 되짚는다.
--
-- ⚠ 이 시스템은 **42문항 게이트가 이미 가장 강한 필터**다(requireReadinessScores).
--   42문항을 끝까지 답한 사람은 구조적으로 고관여라, 이 신호는 그 앞단의 노이즈만
--   걷어낸다. 그래서 기준을 느슨하게 잡는다 — 걸러내는 것보다 놓치는 게 낫다.
--
-- 신호는 접수 시점의 판정이라 **leads 에 둔다.** deals 는 영업이 자유롭게 고치는
-- 표라 판정을 거기 두면 누가 고칠 수 있고, 보유기간 만료 때 같이 지워지지도 않는다.
--
-- 모양: [{"code":"generic_customer","label":"회사명이 일반명사입니다","hit":"test"}]
--
-- 컬럼만 추가한다. apply-migrations.js 에 넣어도 안전하다.

begin;

alter table leads add column if not exists spam_signals jsonb not null default '[]'::jsonb;

comment on column leads.spam_signals is
  '접수 시점의 스팸 의심 신호 [{code,label,hit}]. **막지 않고 표시만 한다** — 자동으로 버리면 진짜 고객을 잃는다. 점수가 아니라 목록인 이유는 왜 걸렸는지 못 보면 기준을 못 고치기 때문이다';

create index if not exists idx_leads_spam on leads ((jsonb_array_length(spam_signals)))
  where jsonb_array_length(spam_signals) > 0;

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name, data_type from information_schema.columns
 where table_schema = current_schema() and table_name = 'leads' and column_name = 'spam_signals';
--
-- 2) 기존 리드는 전부 빈 배열이다. 소급 판정하지 않는다 —
--    접수 시점의 판정이라 그때 규칙으로 다시 매기면 뜻이 달라진다.
select count(*) as "리드",
       count(*) filter (where jsonb_array_length(spam_signals) = 0) as "신호 없음"
  from leads;
--
-- 3) 규칙이 헛도는지 보는 쿼리. 신호별 건수와 실제로 딜이 진행됐는지를 같이 본다.
--    「신호가 걸렸는데 단계가 올라간」 건이 많으면 그 규칙을 빼야 한다.
select sig ->> 'code' as "신호",
       count(*) as "건수",
       count(*) filter (where d.stage > 0) as "그래도 진행된 딜"
  from leads l
  cross join lateral jsonb_array_elements(l.spam_signals) sig
  left join deals d on d.id = l.promoted_deal
 group by 1 order by 2 desc;
