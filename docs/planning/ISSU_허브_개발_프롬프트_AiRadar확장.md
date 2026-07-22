# ISSU 인에이블먼트 허브 — 개발 프롬프트 (AI Radar 확장판)

> 이 허브는 **처음부터 짓지 않습니다.** 기존 `github.com/ISSU-ai/ai-radar`를 확장합니다.
> 근거: 기획서(`ISSU_허브_웹전환_기획서.html`) · 통합기획(`ISSU_허브_AiRadar_통합기획.md`) · 시안(`ISSU_허브_시안_v1.html`).
> 개발 도구(Claude Code·Cursor)에 이 문서를 넣고 시작하세요.

---

## 0. 무엇을 만드나

AI Radar(ISV 솔루션 카탈로그)에 **딜 파이프라인**을 얹어, ChatGPT Enterprise + Codex 세일즈를 딜 단위로 지원하는 내부 도구로 확장합니다.

**세 접근 레벨 · 세 서브도메인:**

| 서브도메인 | 대상 | 인증 | 역할 |
|---|---|---|---|
| `offering.` | 외부 고객 | 없음(공개) | 오퍼링·진단·리드 — **최소 정보만** |
| `hub.` | 내부 직원 | AI Radar 인증(승인제) | 딜 파이프라인 ①~⑤ + 솔루션 카탈로그 |
| `admin.` | 관리자 | 최고권한 | DB 직접 쓰기 |

- 세 사이트가 **하나의 Supabase** 공유.
- **솔루션 카탈로그는 내부 전용.** 외부엔 오퍼링·진단·리드만.

---

## 0-1. 기술 스택

AI Radar가 기반이므로, 그 스택을 이어받아 확장합니다. **새 프레임워크를 도입하지 않습니다** — 기존 구조를 유지해야 재사용 이점이 살아납니다.

### 백엔드
| 항목 | 기술 | 비고 |
|---|---|---|
| 런타임 | **Node.js** (LTS 18+ 권장) | AI Radar 기존 |
| 웹 서버 | **Express** ^4.19 | API 라우트 (`server.js`) |
| DB 클라이언트 | **@supabase/supabase-js** ^2.43 + **pg** ^8.12 | Supabase JS SDK + Postgres 직접 |
| 인증 | **jsonwebtoken** ^9.0 + **cookie-parser** ^1.4 | JWT를 httpOnly 쿠키로 |
| 비밀번호 | **bcryptjs** ^2.4 | 해시 (평문 저장 절대 금지) |
| 환경변수 | **dotenv** ^16.4 | `.env` — 저장소 커밋 금지 |
| 개발 | **nodemon** ^3.1 | 핫 리로드 |

### 데이터베이스
| 항목 | 기술 | 비고 |
|---|---|---|
| DB | **Supabase (PostgreSQL)** | `https://dfbxqjjdkaflsihikogw.supabase.co` |
| 권한 | **RLS (Row Level Security)** | `is_approved()`·`is_admin()` 함수 재사용 |
| 벡터 | **pgvector** | `solution_chunks` — 추천 3단계용, 지금 비움 |
| 실시간 | **Supabase Realtime** | deals 변경 구독 |

### 프론트엔드
| 항목 | 기술 | 비고 |
|---|---|---|
| 구조 | **순수 HTML/CSS/JS** (번들러 없음) | AI Radar 기존 방식 유지 |
| 아이콘 | **lucide** (CDN) | 기존 사용 중 |
| 스타일 | 시안 디자인 토큰 (10번 참조) | 다크 SaaS·골드 액센트 |
| 폰트 | Pretendard + IBM Plex Mono | |

> **프레임워크(React/Vue) 도입 여부** — AI Radar가 순수 HTML/JS라, 그대로 이어가면 재사용이 쉽습니다. 딜 파이프라인 화면이 복잡해 컴포넌트화가 필요하면 React를 부분 도입할 수 있으나, **관리자·인증·카탈로그는 기존 순수 JS를 유지**하는 게 안전합니다. 새 프레임워크로 전면 재작성하면 재사용 이점이 사라집니다.

### 외부 연동
| 항목 | 기술 | 비고 |
|---|---|---|
| 알림 | **Slack Incoming Webhook** | `＃issu-영업` 채널 (A: 알림만) |
| 진단 내보내기 | 엑셀 (xlsx) | 고객 배포용 시트 회수 경로 |

### 인프라 (배포)
| 항목 | 후보 | 비고 |
|---|---|---|
| 호스팅 | 중일님 **Kubernetes** 스택 재사용 | 별도 인프라 없이 |
| DB | 중일님 **PostgreSQL/pgvector** 또는 Supabase 관리형 | 협의 |
| 서브도메인 | offering. / hub. / admin. | 내부·관리자는 사내망 |

---

## 1. ⚠️ 착수 전 필수 — 보안

AI Radar 저장소에 **`.env`가 커밋돼 있습니다.** Supabase service key·JWT secret이 노출됐을 가능성이 높습니다.

**개발 시작 전 반드시:**
1. `.env`를 저장소에서 제거 + `.gitignore`에 추가
2. **노출된 키·시크릿 전부 재발급** (파일을 지워도 git 히스토리엔 남음)
3. Supabase service key 롤백, JWT secret 교체
4. (권장) git 히스토리에서 완전 제거 — BFG 또는 `git filter-repo`
5. 이후 모든 키는 **환경변수로만** 주입. 프론트는 anon key만.

---

## 2. AI Radar에 이미 있는 것 (재사용)

새로 만들지 말 것 — 그대로 쓰거나 확장:

| 자산 | 설명 | 우리 계획 |
|---|---|---|
| `solutions` 테이블 | ISV 카탈로그 35개 × 8섹션 × L1~L4 | **services 대신 이걸 사용** + 컬럼 추가 |
| `profiles` 테이블 | 사용자·role(admin/viewer)·approved | **users 대신 이걸 사용** |
| 인증 | JWT + httpOnly cookie + bcrypt + 승인제 | **그대로 재사용** |
| `admin.html` | 솔루션 CRUD·발행 | 확장 (서비스 필드·회원) |
| `solution_versions` | 편집 이력·롤백 | 그대로 |
| `audit_log` | 조회·검색·편집 기록 | 그대로 |
| `solution_chunks` | pgvector (임베딩) | 추천 3단계용, 지금은 비움 |
| `server.js` | Express API | 딜 라우트 추가 |

---

## 3. 확장 — solutions에 컬럼 추가

```sql
alter table solutions add column if not exists grade int;        -- 급 0~3
alter table solutions add column if not exists scale text;       -- 규모급 S/M/L/O
alter table solutions add column if not exists focal_id uuid references focal_contacts(id);
alter table solutions add column if not exists tech_note text;   -- 기술 제약 (HALO 2-1·2-2)
alter table solutions add column if not exists status_op text default 'active'; -- active/paused/draft
alter table solutions add column if not exists note text;        -- 벤더 담당자·이력 메모 (HALO 1-1)
```

---

## 4. 신규 테이블 (허브 딜 파이프라인)

### deals ★ — 딜 하나 = 한 행
```sql
create table deals (
  id            uuid primary key default gen_random_uuid(),
  customer      text not null,
  customer_meta jsonb,                       -- 업종·규모·도입대상
  fqa_scores    jsonb,                       -- 21항목 점수 {no: score}
  fqa_totals    jsonb,                       -- 카테고리 가중평균
  track         text references tracks(id),
  isv_combo     jsonb,                       -- 선택 solution id 배열
  packages      jsonb,                       -- 선택 패키지 + 조정 공수
  stage         int default 0,               -- 0~4 (①~⑤)
  source        text,                        -- 'portal'|'manual'|'sheet'
  owner_id      uuid references profiles(id),-- 담당자 (쓰기 판정)
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
```

### fqa_items — 진단 21항목
```sql
create table fqa_items (
  id serial primary key, category text, no int, name text,
  weight int, detail text, fix text, threshold numeric,
  status text default 'active'
);
```

### tracks — 트랙 판정 문구
```sql
create table tracks (
  id text primary key, name text, why text, warn text, ask jsonb
);
```

### focal_contacts / packages / package_items / leads
```sql
create table focal_contacts (id uuid primary key default gen_random_uuid(),
  name text, org text, vendor_scope text, assigned_at timestamptz);

create table packages (id text primary key, name text, scale text,
  period text, target text, status text default 'active', sort_order int);

create table package_items (id serial primary key,
  package_id text references packages(id), type text, label text, sort_order int);

create table leads (id uuid primary key default gen_random_uuid(),
  customer text, contact text, fqa_scores jsonb, message text,
  promoted_deal uuid references deals(id), created_at timestamptz default now());
```

---

## 5. 권한 (RLS) — AI Radar 패턴 확장

AI Radar의 `is_approved()`·`is_admin()` 함수를 그대로 활용.

| 테이블 | 외부(anon) | 내부(approved) | 관리자(admin) |
|---|---|---|---|
| solutions | ✗ (카탈로그 내부전용) | 읽기 (published) | 읽기·쓰기 |
| **deals** | ✗ | 읽기 · **쓰기는 owner_id=본인** | 읽기·쓰기 |
| fqa_items / tracks / packages | 읽기(외부는 진단용만) | 읽기 | 읽기·쓰기 |
| focal_contacts | ✗ | 읽기 | 읽기·쓰기 |
| leads | **insert만** | 읽기 | 읽기 |
| profiles / audit / versions | ✗ | 본인 | 읽기·쓰기 |

**핵심 — deals 쓰기 (담당자만):**
```sql
create policy deals_update on deals for update
using ( owner_id = auth.uid() or is_admin() );
```

**외부 노출 — 카탈로그 차단:** offering.은 solutions에 접근 불가. anon 권한은 fqa_items(진단)·leads(insert)·오퍼링 소개 정도만.

---

## 6. 화면별 구현

### hub. — 로그인 (AI Radar 재사용)
- AI Radar의 `login.html` + `/api/auth/login` 그대로. 승인(approved)된 사용자만 진입.
- 회원가입 없음 — admin이 profiles에 발급·승인.

### hub. — 딜 목록 (신규, 진입 첫 화면)
- 컬럼: 고객사 / 단계(①~⑤ 점) / 유형(트랙) / 담당 / 수정일. 필터·검색.
- 포탈 유입 딜은 "신규" 뱃지. 행 클릭 → 작업 공간.
- **실시간**: deals 구독 → 목록 자동 갱신.
- 시안 `ISSU_허브_시안_v1.html`의 딜 목록 UI 사용.

### hub. — 딜 작업 공간 (신규, 파이프라인 ①~⑤)
- ① 들어온 데이터(리드·customer_meta 읽기) → ② PoC 검증(fqa_scores·보완벽·ISV 지목) → ③ ISV 조합(**solutions 카탈로그 연결** — 급·focal) → ④ 딜 사이즈(packages·규모급·HALO 귀속) → ⑤ 피치(조합·급 기반 스크립트).
- 각 단계는 deals의 jsonb에서 앞 결과를 읽어 이어감.
- **자동 저장**: 변경 즉시 deals UPDATE(담당자만). **단계 이동 시 슬랙 알림.**

### admin. — 확장 (AI Radar admin.html 기반)
- 기존 솔루션 CRUD + **서비스 필드(급·포컬·tech_note·status_op·note)** 추가.
- 서비스 추가 모달: HALO 확인요청서 회신값 1:1 매핑 (급←1-2, 포컬←1-3, tech_note←2-1·2-2, note←1-1).
- 회원 승인(approved 토글), 상태 관리(active/paused/draft), 버전·롤백은 AI Radar 것 재사용.

### offering. — 외부 (신규, 최소 정보)
- 기존 `Offering_portal.html` 흐름 활용. 오퍼링 소개·자가진단·리드 폼만.
- **solutions 카탈로그 접근 불가.** 딜 급·매출·포컬·MD 노출 금지.
- 진단·리드 → leads insert → hub 딜 목록 "신규".

---

## 7. 협업 · 슬랙 (A: 알림만)

- **실시간 저장**: deals 변경 → Supabase Realtime → 팀원 화면 갱신(읽기).
- **슬랙 Webhook** — `＃issu-영업`:
  - 🔵 신규 딜: `"{고객사} 신규 · 포탈 유입 · 담당 미배정"`
  - 🟡 단계 이동: `"{고객사} → {단계} · {담당}"`
  - 👤 담당 배정
- 슬랙 조회·입력(B·C)은 후순위.

---

## 8. 개발 순서

1. **보안 조치** (1번) — `.env` 정리·키 재발급. **최우선.**
2. AI Radar 로컬 구동 + 스키마 확인
3. solutions 컬럼 추가 (3번)
4. 신규 테이블 생성 + RLS (4·5번)
5. 인증 범위 조정 — 승인제를 hub·admin에만, offering. 공개 분리
6. 딜 목록·파이프라인 프론트 (③에 카탈로그 연결)
7. 실시간·슬랙
8. 외부 offering. (최소 정보)
9. pgvector 추천은 데이터 쌓인 뒤 (아래 8-1)

### 8-1. 향후 — ISV 추천 (지금 구현 안 함)
- 현재: 규칙 기반(FQA 미달 → ISV 지목).
- 1단계(지금 가능): 가중 점수화 — 미달 가중치로 ISV 순위. 속은 규칙, 설명 가능.
- 2단계(deals 쌓이면): 유사 딜 성사율 집계.
- 3단계(딜 수백 건 + 인력): solution_chunks pgvector 유사도. 규칙을 대체 말고 보조로.
- 원칙: 매출로 이어지는 추천이라 "왜 추천했나" 설명 가능성이 우선. 학습형은 모수 충분할 때만.

---

## 9. 반드시 지킬 것

- **`.env`·키는 환경변수.** 저장소 커밋 금지. 노출됐으면 재발급.
- **비밀번호 평문 금지.** bcrypt 해시만 (AI Radar가 이미 준수).
- **카탈로그·딜 정보 외부 노출 차단.** offering.은 solutions 접근 불가.
- **딜 쓰기는 담당자만.** owner_id=본인. 재배정은 명시적.
- **status로 노출 제어.** 삭제 대신 paused/draft.
- **판정 로직은 프론트, 데이터만 DB.** FQA 계산·트랙 분기는 검증된 프론트 로직.
- **서브도메인별 CORS·Redirect** Supabase 허용목록 등록.

---

## 10. 디자인

- 시안 `ISSU_허브_시안_v1.html` 토큰: 다크 SaaS(#0F141A·#161D26), 골드 #D4A438, 트랙색(T-A레드·T-B그린·T-C골드·신규블루), Pretendard + IBM Plex Mono.
- **PPT 느낌 금지.** 목록→파이프라인 동선이 중심.
- 인라인 onclick 대신 이벤트 리스너/핸들러 (프레임워크면 자연히 해결).
- 반응형: 모바일 파이프라인 세로 스택.

---

*근거 — AI Radar(github.com/ISSU-ai/ai-radar) · 기획서 · 통합기획 · 시안 · 매뉴얼(사용자·관리자) · HALO 확인요청(ISSU_HALO_확인요청_v2.xlsx)*
