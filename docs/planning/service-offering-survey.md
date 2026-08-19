# Service 오퍼링 조사 — 무엇을 물어야 하나

> 2026-08-19 · [오퍼링 기준](offering-criteria.md) 축 A 의 **Service** 쪽.
> Product 는 방금 255종을 임포트했다. Service 는 **다섯 개뿐이고 전부 AI 전용**이다.

---

## 지금 시스템이 아는 Service — 다섯

```
P01  AI Consulting                     S · 2주
P02  OpenAI Ready                      M · 3~4주
P03  AIR Service                       L · 규모별 산정 (4~10주)
P04  AI Adoption & Change Management   M · 4주
P05  Billing & Managed Service         O · 상시
```

`packages` 표가 가진 칸은 이것이 전부다.

```
id · name · scale · period · target · status · sort_order
offering_id · role · depends_on · base_md · unit_price · readiness_lift
```

## 그런데 조직은 이만큼 크다

조직도상 **딜리버리 인력이 90명을 넘는다.**

| Unit | PS 조직 |
|---|---|
| Salesforce | Professional Service **34명** (4개 팀) |
| ServiceNow | AX Consulting 7명 + AX Solution **19명** |
| Integrated Solution CoE | Platform Engineering 10 · Data & AI 7 · Hybrid Cloud 9 · ESA 1 |

**90명이 하는 일을 시스템은 다섯 줄로 알고 있다.** 그리고 그 다섯 줄은 전부
AI(OpenAI) 도입 문맥이라, Salesforce 구축도 ServiceNow AX 도 담기지 않는다.

> 2027 BP 가 Supply-centric 이고 「공급 조직이 판매 가능한 포트폴리오를 먼저 정의한다」
> 인데, **공급 조직의 90%가 카탈로그에 없다.**

---

## 무엇을 물을 것인가 — 오퍼링 기준을 그대로 쓴다

새 질문지를 만들지 않는다. [오퍼링 기준](offering-criteria.md)의 **필수 4 + 권장 3**
이 곧 조사 항목이다. 그래야 조사 결과가 바로 판정으로 이어진다.

### 필수 — 하나라도 비면 Sellable 이 아니다

| # | 묻는 것 | 시스템의 자리 |
|---|---|---|
| 1 | **주 딜리버리 Unit** (+ 참여 Unit) | **없다** ← 새로 필요 |
| 2 | **유형** — PS(프로젝트) / MS(운영) | **없다** ← `packages` 에 구분이 없다 |
| 3 | **어떤 고객 문제를 해결하나** (한 문장) | `packages.target` |
| 4 | **가격 모델** — MD 산정식 / 월정액 / 규모별 | `base_md` · `unit_price` (AI 5종만 채워짐) |

### 권장 — 없으면 조건부

| # | 묻는 것 | 시스템의 자리 |
|---|---|---|
| 5 | **왜 MZC 인가** — 방법론·경험이 어디에 | 없다 |
| 6 | **언제 팔면 안 되나** | 없다 (`solutions.red_flags` 는 제품 쪽만) |
| 7 | **고객 쪽 전제** | 없다 (`solutions.prerequisites` 는 제품 쪽만) |

### Service 에만 필요한 것 넷

제품 조사 서식에는 없고 서비스에는 반드시 필요한 항목이다.

| 묻는 것 | 왜 |
|---|---|
| **기간** (주 단위) | `packages.period` 는 있다. 딜 사이즈 산정의 기본 |
| **투입 공수** (MD, 역할별) | `base_md` 는 총량만이다. **누가 몇 MD** 인지가 원가다 |
| **선행 조건** — 어떤 제품·서비스가 먼저 | `depends_on` 이 있다. AI 5종만 채워짐 |
| **산출물** | `package_items` 표가 있다. 고객에게 무엇이 남는지 |

---

## 조사를 어떻게 돌릴 것인가

### ⚠ Unit 별로 따로 받는다

한 장으로 90명 분을 못 받는다. **Unit 이 곧 축 B(공급)**이므로 Unit 별로 받으면
1번 항목이 저절로 채워진다.

```
Salesforce Unit           CRM 구축·운영
ServiceNow Unit           ITSM · AX
Platform Engineering      플랫폼
Data & AI                 데이터 · AI   ← 기존 5종이 여기 속한다
Hybrid Cloud              하이브리드 클라우드
CaaS                      컨테이너
```

### 서식은 이미 있는 것을 본뜬다

`docs/solution-survey-template.xlsx`(제품 조사, 6시트 52컬럼)와 같은 방식으로 만든다.
그 서식이 지킨 규칙을 그대로 가져간다.

- **선택지를 서식에 다시 적지 않는다** — 화면·마이그레이션에서 읽어 생성한다
- **조사자가 못 채우는 칸은 `[ISV BU 분류]` 로 표시한다** — 빈 칸인지 모르는 칸인지 갈린다
- **JSON 을 쓰게 하지 않는다** — 평문으로 받고 우리가 구조화한다

### 처음부터 다 받지 않는다

**Unit 하나로 시작한다.** 서식이 맞는지 한 번 돌려 보고 고친 뒤 나머지에 돌린다.
90명 분을 잘못된 서식으로 받으면 두 번 받아야 하고, 두 번째는 아무도 안 채운다.

---

## 그러면 시스템에 필요한 것

조사 결과를 받을 자리가 없다. **다만 지금 만들지 않는다.**

| | |
|---|---|
| `packages.delivery_unit` | 주 딜리버리 + 참여 Unit (축 B) |
| `packages.service_type` | PS / MS 구분 |
| `packages.prerequisites` · `red_flags` | 지금은 `solutions` 에만 있다 |
| 역할별 MD | `base_md` 총량만으로는 원가가 안 나온다 |

⚠ **8/28 에 Offering Catalog 가 확정된다.** 거기서 Service 의 실제 모양이 나오므로
지금 컬럼을 만들면 두 번 만든다. **조사 서식을 먼저 만들고, 스키마는 조사 결과와
8/28 카탈로그를 둘 다 본 뒤에** 정한다.

임포트(052)는 이미 **컬럼 이름을 코드에 안 박는** 구조라, Service 용 필드가
늘어도 `IMPORT_FIELDS` 에 줄만 추가하면 된다.

---

## 확인이 필요한 것

제가 웹이나 저장소에서 알 수 없는 것들입니다.

1. **각 Unit 이 실제로 파는 PS/MS 목록** — 이게 조사의 대상이자 출발점
2. **기존 5종(P01~P05)의 주인** — Data & AI Unit 인가, 다른 곳인가
3. **8/28 Offering Catalog 가 Service 를 포함하나** — 포함한다면 이 조사와 겹친다.
   **먼저 확인해야 두 번 일하지 않는다**
4. **조사 대상 Unit 의 우선순위** — 어디부터 시작할지
