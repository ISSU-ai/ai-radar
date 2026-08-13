# 마이그레이션

`db/migrations/NNN_이름.sql`. **수동 적용이다** — 사람이 Supabase SQL 편집기에 붙여넣는다.
그래서 **코드가 항상 먼저 배포된다.**

## 파일 골격

```sql
-- NNN. 한 줄 제목
--
-- 왜 이걸 하는가. 지금 무엇이 안 되는가.
--
-- ⚠ 판단이 갈릴 수 있는 지점을 여기 적는다. 왜 A 가 아니라 B 인지.
--
-- 컬럼만 추가한다. apply-migrations.js 에 넣어도 안전하다.

begin;

alter table X add column if not exists Y ...;

comment on column X.Y is '이 값이 무엇이고 왜 여기 있는가';

commit;

-- 확인
-- 1) 컬럼이 생겼는가.
select ...;
-- 2) 기존 행은 어떤 상태인가.
select ...;
```

**하단 확인 쿼리는 생략하지 않는다.** 적용한 사람이 결과를 붙여넣으면 그것만으로
상태를 알 수 있어야 한다.

## `apply-migrations.js` 에 넣나

| | |
|---|---|
| 스키마만 (`alter table … add column`) | **넣는다.** 멱등이라 여러 번 돌려도 같다 |
| 컬럼 + 빈 값에만 채우는 백필 | 넣는다 (032·041 선례) |
| **시드** (`insert`/`update` 로 값을 넣음) | **넣지 않는다.** `/admin` 에서 고친 값을 덮는다 |

033~040·043 이 시드라 제외돼 있다. 043(처방문 42개)을 넣었으면 ISSU 가 고친 문안이
다음 적용 때 초안으로 되돌아갔을 것이다.

## 되돌릴 수 없는 것

파일 상단에 **「적용 전 확인」** 절을 만든다. 040 이 선례 — 세 쿼리가 전부 0 이어야
실행한다. 그리고 **지우는 것을 다 적는다.**

```sql
-- 딸려 있는 뷰를 먼저, 명시로 지운다.
drop view if exists offering_fqa_items;
drop table if exists fqa_items;
```

⚠ **`cascade` 를 쓰지 않는다.** 뭐가 딸려 지워지는지 모르는 채 지우는 것이라, 「지우는
것을 다 적는다」는 원칙과 정면으로 어긋난다. 040 이 `2BP01`(뷰 의존성)로 실패했을 때
`cascade` 대신 `drop view` 를 명시로 넣어 고쳤다.

## 함수의 휘발성

| | |
|---|---|
| `gen_random_uuid()` | **행마다 다른 값.** 044 의 `result_token` — 원하는 동작 |
| `now()` | **전 행이 같은 값.** 041 의 `stage_changed_at` 백필에서 전부 같은 시각이 됐다 |

기본값으로 백필할 때 어느 쪽인지 의식하고 쓴다.

## 컬럼을 못 고치게 하려면

`lib/hub-domain.js` 의 `EDITABLE_DEAL_FIELDS` 는 **허용목록**이다. 거기 없으면 PATCH 로
못 고친다. `readiness_customer_scores`·`customer_meta_original` 처럼 「원본」인 컬럼은
반드시 목록 밖에 둔다 — 고칠 수 있으면 「원본」이라는 말이 거짓이 된다.

## 소급해서 채우지 않는다

기존 행에 없는 기록을 지금 값으로 채우면 **틀린 것을 「확인됨」으로 만든다.**
`null` 로 두고 화면이 「구분할 수 없음」이라고 말하게 한다 (046 스팸 신호 · 048 열람 ·
049 맥락 원본이 전부 그렇게 했다).

## FK 가 있으면 순서가 있다

새 행 삽입 → 데이터 이관 → 옛 행 삭제. 그리고 **이름 문자열로 조인하는 시드**
(bridge·coverage)는 실재 여부를 검사로 건다 — 한 글자만 달라도 런타임 오류가 아니라
**조용한 매칭 0건**이다.

## 콤마 조인과 명시적 join 을 섞지 않는다

```sql
from solutions s,
     jsonb_array_elements(...) e,
     jsonb_array_elements_text(...) it
join mapping m on m.category = e.value ->> 'category'   -- e 를 못 본다 → 42P01
```

Postgres 는 `join` 을 **바로 앞 FROM 항목에만** 묶는다. `cross join lateral` 로 올린다.
콤마가 둘일 때는 안 걸려서 더 헷갈린다.

## 적용 현황은 여기 적지 않는다

어디까지 돌아갔는지는 **DB 에 묻는다.** 파일에 적으면 즉시 낡는다.
