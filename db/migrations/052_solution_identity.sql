-- 052. 솔루션 식별 정보 — 한글명과 웹사이트
--
-- ISV 마스터를 임포트하려는데 **세 컬럼 중 둘을 담을 자리가 없다.**
--
--   Company Name (EN)  →  solutions.name   ✅
--   회사명 (KR)         →  없다
--   Website            →  없다
--
-- 벤더 목록에 이 둘이 없는 카탈로그는 없다. 8/28 체계를 추측하는 것이 아니라
-- **이미 손에 있는 데이터를 버리지 않기 위한** 최소 두 칸이다.
--
-- ⚠ **관계 정보(모회사·구명·별칭)는 여기서 만들지 않는다.** 마스터에 25건이 이름
--   문자열에 섞여 있지만(`AppDynamics (Cisco)` · `Tenable(구 .Ermetic)`),
--   「행의 단위가 회사인가 제품인가」가 8/28 에 정해진다. 그 전에 컬럼을 만들면
--   두 번 만든다. isv-master-cleanup.md §0 참고.
--
-- ⚠ **name_kr 은 표시용이다.** 검색 키가 아니다 — slug 가 키다. 한글 사명만 있는
--   곳(KCC정보통신·KS고용정보)은 slug 를 사람이 지정한다(kccinfo·ksinfo).
--
-- 컬럼 둘. 백필 없음. apply-migrations.js 에 넣어도 안전하다.

begin;

alter table solutions add column if not exists name_kr text;
alter table solutions add column if not exists website text;

comment on column solutions.name_kr is
  '한글 회사·제품명. **표시용이고 키가 아니다** — 키는 slug 다. 영문명이 없는 국내 벤더는 slug 를 사람이 지정한다';
comment on column solutions.website is
  '공식 웹사이트. ⚠ 마스터에서 **다른 회사 도메인이 들어온 사례**가 확인됐다(Couchbase→contentsquare.com 등). 임포트가 값을 그대로 받되 검토는 사람이 한다';

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select column_name, data_type from information_schema.columns
 where table_schema = current_schema() and table_name = 'solutions'
   and column_name in ('name_kr', 'website') order by column_name;
--
-- 2) 기존 솔루션은 전부 비어 있다. 소급해서 못 채운다 —
--    웹에서 찾아 넣는 것은 임포트가 아니라 조사다.
select count(*) as "솔루션", count(name_kr) as "한글명", count(website) as "웹사이트"
  from solutions where is_archived = false;
--
-- 3) ⚠ 도메인이 겹치는 행. 서로 다른 회사가 같은 주소를 쓰면 한쪽이 틀린 것이다.
select regexp_replace(website, '^https?://(www\.)?([^/]+).*$', '\2') as "도메인",
       count(*) as "건수", string_agg(name, ' / ') as "회사"
  from solutions where coalesce(website, '') <> '' and is_archived = false
 group by 1 having count(*) > 1 order by 2 desc;
