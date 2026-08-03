-- 020. 솔루션 노출 토글
--
-- 왜 is_archived 를 재활용하지 않는가:
--   is_archived 는 "치웠다"는 뜻이고 DELETE 라우트가 세운다. 그런데 관리자 목록
--   조회(/api/solutions)도 is_archived = false 로 거르기 때문에, 한 번 아카이브하면
--   어드민 화면에서도 사라져 되돌릴 버튼이 없다 — 사실상 편도다.
--   status(draft/published)는 "작성 중"이라는 뜻이고 curator 발행 워크플로와 엮여 있어
--   전용할 수 없다.
--   그래서 "데이터는 두되 영업 화면에서만 감춘다"는 뜻의 컬럼을 따로 판다.
--
-- 초기 노출 목록은 021 에 따로 둔다. 이 파일은 스키마만 바꾸므로 몇 번을 돌려도
-- 관리자가 어드민에서 켜고 끈 상태를 덮어쓰지 않는다.

begin;

alter table solutions
  add column if not exists is_hidden boolean not null default false;

comment on column solutions.is_hidden is
  '영업 화면(카탈로그·추천·탐색기)에서 감춘다. 데이터는 그대로 남고 어드민에서 되돌릴 수 있다.';

-- 목록·추천 후보 조회가 항상 is_hidden = false 로 거르므로 부분 인덱스로 충분하다.
create index if not exists idx_solutions_visible
  on solutions (is_hidden)
  where is_hidden = false;

commit;

-- 확인용
--   select count(*) filter (where is_hidden) as 숨김,
--          count(*) filter (where not is_hidden) as 노출
--     from solutions where is_archived = false;
