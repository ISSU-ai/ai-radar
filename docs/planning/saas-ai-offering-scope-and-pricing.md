# SaaS형 AI 오퍼링 — 범위 · 구성 · 가격 방향

> 작성 2026-08-03 · AI Radar 반영 기준 정리
> 출처: `OpenAI_통합_오퍼링_기획안_제출본_20260802(수정).pdf` (8p) · `OpenAI_AI_Offering_Diagnostic_20Q.xlsx` (5시트)
> 이 문서는 **제품 기획서가 아니라 AI Radar 가 무엇을 담아야 하는지의 기준**이다. 가격·범위의 최종 권한은 ISV BU 에 있다.

---

## 0. 한 장 요약

| | |
|---|---|
| **판매 단위** | OpenAI 라이선스(DS) **+** MZC 전문서비스(PS) **+** 운영관리(MS) **+** 선택형 ISV |
| **코어 오퍼링** | 5종 — Consulting · OpenAI Ready · AIR Service · Adoption & Change · Billing & MS |
| **진입 상품** | **OpenAI Starter Package** — 진단·환경구성 무상, MS Light 유상 |
| **가격 축** | 시트(ChatGPT) · Credit(Codex) · 토큰(API) · M/D·M/M(PS) · 월정액(MS) |
| **환율 기준** | **1 USD = 1,500원** (기획안 Appendix D · 하나은행 전신환 26/1~7월 평균) |
| **확장 경로** | Land(Starter) → Expand(데이터 연결) → Operate(운영 매출) |

> ⚠️ **가격은 전부 "가정"이다.** 제출본이 *"Enterprise 가격·최소 시트는 공개 정가가 아닌 OpenAI 영업 협의사항"* 이라고 못 박았다. 화면·제안서 어디에도 **확정 가격으로 표기하면 안 된다.**

---

## 1. 오퍼링 범위

### 1-1. 도입 3단계 — 무엇을 언제 파는가

제출본이 정의한 고객 여정이다. 오퍼링은 이 단계에 붙는다.

| 단계 | 핵심 방향 | 주요 제공 | 고객 가치 |
|---|---|---|---|
| **Step 1. 통제** | 개인 AI 사용을 기업 관리체계로 전환 | Enterprise 계정, 정책, 권한, Trust & Guardrails | Shadow AI·데이터 유출 위험 최소화 |
| **Step 2. 연결** | 기업 데이터·업무시스템을 AI와 연결 | Governance, RAG, API, Workflow, 권한 기반 검색 | 정보 탐색시간 단축·업무 품질 향상 |
| **Step 3. 자동화** | 반복 업무를 AI 기반 프로세스로 전환 | AI Agent, 승인체계, Monitoring, Managed Service | 생산성 향상·운영비용 절감 |

**Change Management 는 단계가 아니라 전 구간 공통축이다.**

딜리버리 흐름: `Assess & Design → Enablement → Build → Adopt → Operate`

### 1-2. 코어 오퍼링 5종

| No | 오퍼링 | 유형 | 핵심 목적 | 대표 구성 |
|:---:|---|:---:|---|---|
| **01** | **AI Consulting** | PS | 준비 수준·업무 목표 진단, 최적 도입안 설계 | Readiness Assessment 6대 영역, Gap 분석, 라이선스·Credit·비용 설계 |
| **02** | **OpenAI Ready** | **DS & PS** | 기업용 OpenAI 공급 + 안전한 기본 환경 구성 | Business·Enterprise·Codex·API, Workspace·관리자·권한·보안 설정, 온보딩, 기초 교육 |
| **03** | **AIR Service (AI-Ready)** | PS · AIR Unit | 데이터·업무시스템 기반 AI 구축 | 데이터 정제, RAG, Agent, MCP·Workflow, Governance Architecture |
| **04** | **AI Adoption & Change Management** | PS | 사용자 정착과 조직 확산 | 교육, AI Champion, Change Plan, 성과측정 |
| **05** | **Billing & Managed Service** | MS | 라이선스·사용량·비용·운영 관리 | 원화 Billing, Credit·Token, Monitoring, Support |

> ✅ **AI Radar DB 반영 완료 (2026-08-03).**
> `017_offering_v01.sql` 을 제출본 기준으로 고쳤다 — 02 `AI Trust & Guardrails` → `OpenAI Ready`(DS&PS), PoC 01 → 03.
> 패키지 이름은 001 시드 그대로 둔다. 03 에 POC·INTEGRATION 둘이 붙어서 오퍼링 이름으로 바꾸면 화면에 'AIR Service' 가 둘 나온다.
> 오퍼링:패키지는 1:N 이다.

### 1-3. 선택형 ISV 확장 패키지 5종

코어에 얹는 옵션이다. **적용 기준이 곧 추천 트리거다.**

| 패키지 | 연계 제품 | 제공 가치 | 적용 기준 | 진단 트리거 |
|---|---|---|---|:---:|
| **AI Productivity** | Slack · Notion / Google Workspace · Salesforce | 협업·지식관리·문서작성·영업 생산성 | 기존 업무도구와 OpenAI 연계 필요 | 7번 |
| **AI Developer** | GitHub · GitLab | Codex 기반 코드 작성·리뷰·테스트·문서화 | **내부 개발조직 보유** | 16번 |
| **AI Monitoring** | New Relic · Databricks | API·RAG·Agent 성능·오류·사용량·품질 분석 | 직접 개발 AI 서비스 운영 | 12번 |
| **AI Governance** | Portal26 | Shadow AI·멀티 AI 사용·비용·위험 가시성 | 전사 AI 사용 통합 관리 필요 | 18번 |
| **AI Security** | Trend Micro · Check Point | 민감정보 유출·Prompt Injection·Agent 위협 통제 | OpenAI Native 범위 초과 | 19번 |

> **카탈로그 등록 상태** (2026-08-05)
> `Databricks`·`Trend Micro` **026 등록** · `Palo Alto` **033 등록** — 셋 다 숨김 상태이며
> 번들 구성으로만 보인다. 실제 제안이 잡힐 때 어드민에서 켠다.
> `Google Workspace`·`Salesforce` 는 **등록하지 않는다** — OpenAI Connector 로 연결하는
> **대상**이지 우리가 추천할 ISV 가 아니다. 02 OpenAI Ready 의 제공 범위에 이미 들어 있고
> (「Slack·Notion·Google Workspace·Salesforce 등 연계환경 구성」), 카탈로그에 넣으면
> 추천 엔진이 이것들을 슬롯 후보로 잡아 엉뚱한 경쟁 관계를 만든다.
> (`Cohere` 는 023 으로 등록 완료 — 노출 목록 8종이 모두 채워졌다.)

**AI Trust → AI Governance / AI Security 분리 (033)**

기획안 §6 이 둘을 나눴다. *"AI Governance 는 「누가 무엇을 얼마나 안전하게 사용하고
있는지 관리」하고, AI Security 는 「실제 위협과 데이터 유출을 탐지·차단」한다."*
Zscaler·Palo Alto 는 **환경별 옵션**이다 — 고객이 이미 쓰는 쪽으로 갈린다.

---

## 2. 상품 구성

### 2-1. OpenAI Starter Package — 진입 상품

AI 를 처음 도입하는 기업이 **개발이나 복잡한 시스템 구축 없이** 시작하도록 구성한 패키지.

| 구성 | 유형 | 과금 | 내용 |
|---|:---:|:---:|---|
| AI Readiness Assessment | — | **기본 제공** | 시스템·거버넌스·보안 등 **6대 영역** 준비 수준 진단 → Gap, 우선 적용 과제, 권장 솔루션 도출 |
| ① OpenAI Business / Enterprise | DS | 라이선스 | 기업 데이터 보호·중앙 관리 (**최소 Business 2명**, Enterprise 는 확인 필요) |
| ② OpenAI Ready | PS | **무상** | OpenAI 구성, Workspace·관리자·보안 설정, 기본 사용 가이드, 관리자·사용자 교육 |
| ③ Managed Service - Light | MS | **유상 (3개월)** | 사용자 지원, 부서별 사용량·활용률·비용 분석, 정기 운영 리포트, 활용 개선 가이드 |
| 선택 · Change Management | PS | 별도 | 심화 교육, AI Champion Community, 내부 커뮤니케이션, 전사 확산 프로그램 |

> 💡 **구조가 명확하다: 진단과 초기 구축은 무상, 운영은 유상.**
> 라이선스로 진입해 **MS 로 반복 매출을 만들고, PS·ISV 로 확장**하는 형태다.

> 📌 **AI Radar 미반영.** 패키지 6종(DISCOVERY~OPERATE) 어디에도 대응이 없다. **신규 등록 대상 — 남은 작업 1순위.**

### 2-2. 컨설팅 (01 AI Consulting)

| 항목 | 내용 |
|---|---|
| 제공 범위 | Readiness Assessment 및 Gap 분석 · AI 솔루션 시뮬레이터로 우선 적용 업무·Use Case 도출 · ChatGPT Business·Enterprise·Codex·API 적용 범위 설계 · Seat·Credit·API 사용량 및 **TCO·예산 시뮬레이션** · 단계별 도입 로드맵과 권장 오퍼링 구성 |
| **무상 범위** | **라이선스 도입 고객에게 초기 진단 표준 범위 내 무상** |
| 유상 | 심화 컨설팅 별도 산정 |
| 도구 | AI Readiness Assessment(외부) · AI 솔루션 시뮬레이터(AI Radar) |

### 2-3. 프로페셔널 서비스

**02 OpenAI Ready (DS & PS)**

| 항목 | 내용 |
|---|---|
| 제공 범위 | ChatGPT Business·Enterprise·Codex·API 공급 · Workspace·관리자·사용자·그룹·권한 설정 · SSO/도메인/보존정책 등 **OpenAI Native 관리·보안 기능** · 기본 AI 사용정책·관리자 가이드·사용자 온보딩 · OpenAI 기본 Connector 와 고객 업무도구 연결 · Slack·Notion·Google Workspace·Salesforce 연계환경 구성 · 초기 사용자 교육 |
| **무상 범위** | **라이선스 도입 고객에게 초기 구축 표준 범위 내 무상** |
| 유상 | 심화 교육 · 맞춤 연계 · PoC · 추가 구축 |

**03 AIR Service (AI-Ready) — AIR Unit**

| 항목 | 내용 |
|---|---|
| 제공 범위 | 데이터 현황 진단·수집·정제·분류·품질 개선 · 데이터 파운데이션과 접근권한·거버넌스 설계 · **RAG·Vector DB·Search 구축** · OpenAI API 기반 맞춤형 AI 앱 개발 및 **PoC** · AI Agent·Multi-Agent·Workflow 설계·구현 · MCP·API·AI Gateway 연계 · 상용환경 전환·성능 검증·운영 이관 |
| 과금 | **AIR Unit 전문인력 M/D 또는 M/M 기반**, 프로젝트 규모별 별도 산정 |

**04 AI Adoption & Change Management**

| 항목 | 내용 |
|---|---|
| 제공 범위 | 경영진·관리자 AI Briefing, 업무군별 ChatGPT 활용교육 · 개발자 Codex·API 실습, 부서별 Use Case 워크숍 · 부서별 템플릿·표준 Prompt·활용 가이드 · **AI Champion 선발·육성, Community 운영** · 활용률·업무시간 절감·품질 개선 KPI 측정과 우수사례 확산 |

**05 Billing & Managed Service**

| 항목 | 내용 |
|---|---|
| 제공 범위 | 시트·Credit·API 사용량 통합 관리 · **달러 사용료의 원화 환산·청구·정산** · 사용자·부서·프로젝트별 비용 분석 · Budget·Chargeback·비용 한도 관리 · OpenAI 기술지원 연계, 장애 에스컬레이션 · 월간 사용량·비용·품질 리포트 |
| 미확정 | **마진 구조 · 원화 Billing 제공 가능 여부 · 고객 관리자 권한 공유·위임 범위** 확인 후 세부 Scope 확정 |

---

## 3. 가격 방향

### 3-1. 과금 축 — 성격이 다른 다섯 가지가 한 견적에 섞인다

| 축 | 대상 | 과금 방식 | 딜사이징 입력 |
|---|---|---|---|
| **시트** | ChatGPT Business/Enterprise | 사용자당 월정액 | 도입 대상 인원 |
| **Credit** | Codex | Workspace Credit 토큰 종량제 | 개발자 수 |
| **토큰** | OpenAI API | 모델별 입력·캐시입력·출력 | 서비스 규모 |
| **M/D·M/M** | AIR Service (PS) | 전문인력 공수 | 프로젝트 범위 |
| **월정액** | Managed Service | 기간 계약 | 운영 범위·기간 |

### 3-2. 공개 과금 구조 (Appendix C)

| 제품 | 주요 대상 | 공개 과금 | 오퍼링 설계 포인트 |
|---|---|---|---|
| **ChatGPT Business** | 소규모·부서 단위 | **연간 $20/사용자/월**, 월간 $25, **최소 2석** | 표준 시트에 ChatGPT·Codex 기본 사용 포함 |
| **ChatGPT Enterprise** | 대규모·전사 | **OpenAI Sales 별도 견적** | 가격·시트·Credit·지원조건 고객별 협의 |
| **Codex** | 개발자·DevOps | Workspace Credit 토큰 종량제 | 참고 **$100~200/개발자/월** — 모델·인스턴스·자동화·Fast Mode 에 따라 변동 |
| **OpenAI API** | 서비스·Agent 개발 | 모델별 입력·캐시입력·출력 토큰 | 시트와 별도, 사용량·비용 한도 설계 |

### 3-3. 내부 시뮬레이션 가정 (기획안 Appendix D)

| 항목 | 값 | 성격 |
|---|---|---|
| **환율** | **1 USD = 1,500원** | 하나은행 최초고시 전신환 매도율 26/1~7월 평균 1,500.11, 소수점 절삭 |
| ChatGPT License | 100명 × **$18**/월 | Business Yearly 기준가 $20 에 **10% 할인을 임의 가정** |
| Codex Credit | 전체 사용자의 **20%** × **$150**/월 | Rate Card 참고 범위 $100~200 중 임의 적용 |
| **기업당 연간** | **$57,600 = 8,640만원** | 라이선스 + Codex 만. **API·PS·ISV·MS 는 제외** |

**목표 매출 시뮬레이션**

| 구분 | 타깃 고객사 | 예상 시트 | 연 매출 (USD) | 연 매출 (KRW) | 예상 마진 (Referral 10%) |
|---|:---:|:---:|---|---|---|
| 2026 Q4 | 50 개사 | 5,000 | 약 2.88M | 약 40 억원 | 약 4 억원 |
| 2027 Q1 | 60 개사 | 6,000 | 약 3.46M | 약 50 억원 | 약 5 억원 |
| 2027 Q2 | 70 개사 | 7,000 | 약 4.03M | 약 60 억원 | 약 6 억원 |
| **합계** | **180 개사** | **18,000** | **약 10.37M** | **약 150 억원** | **약 15 억원** |

> 연 매출 = (100명 × $18 + 개발자 20% × $150) × 12개월 × 1,500원/USD
> 마진은 Select 등급 **Referral Incentive 10%** 기준 (Min $50K, Max $150K).
> **AIR PS·ISV·MS 의 매출과 마진은 별도 원가·공수 기준으로 산정한다.**
> USD 10M 은 Advanced Partner 매출 요건을 충족하는 수준이다.

**왜 Blended ARPU 방식을 버렸나**

이전 판은 고객 규모별 Blended Monthly ARPU($38·$46·$54)로 잡았다. Seat·Credit·API 를
한 숫자에 섞은 값이라 **어느 축이 얼마나 기여하는지 분해할 수 없었고**, 변동성이 가장
큰 API 가 그 안에 들어가 있어 목표치가 흔들렸다.

기획안은 **API 를 아예 제외**하고 License + Codex 만으로 잡는다. 둘 다 계약 시점에
좌석 수로 고정되는 값이라 예측 가능하고, 고객당 산식이 한 줄로 설명된다. 대신 API·PS·
ISV·MS 매출이 목표에서 빠지므로 **실제 매출은 이 숫자보다 크다** — 보수적으로 잡은 것이다.

### 3-4. Codex 비용관리 원칙

- Codex 는 개발용 Agent 이며, 기본 한도 초과분은 **Workspace Credit 구매**
- **2026년 4월부터** 대부분 플랜에서 메시지 수가 아니라 **입·출력 토큰 연동 Credit Rate Card** 적용
- 개발자별 월 Credit Budget, 동시 실행 인스턴스, 자동화·Fast Mode 사용량과 **생산성 KPI 를 함께 관리**
- 실제 청구금액은 계약통화·지역가격·세금·Enterprise 상업조건에 따라 달라짐

### 3-5. OpenAI 협의 후 확정할 것 — **지금은 전부 미정**

- ChatGPT Enterprise 가격 및 최소 계약 시트
- **Resale·Referral 등 파트너 거래구조와 마진**
- Codex Workspace Credit 의 구매·정산 및 고객 청구방식
- **원화 Billing 제공 가능 여부**와 환율·세금 적용 기준
- 기술지원 범위, 장애 대응 및 Escalation 체계

---

## 4. AI Radar 반영 계획

### 4-1. 지금 바로 넣을 수 있는 것

| 항목 | 값 | 위치 |
|---|---|---|
| **전역 환율** | 1 USD = **1,500원** | admin 전역 설정 · 033 으로 적용 완료 |
| ChatGPT Business 단가 | $20/user/월 (연간), 최소 2석 | 솔루션 단가 |
| Codex 참고 단가 | $100~200/개발자/월 | 딜 시뮬레이터 (범위로 표기) |
| Blended ARPU | $38 / $46 / $54 | 딜사이징 규모별 기본값 |

> 🚨 **"더미 단가" 배너를 지우기 전에 두 가지를 반드시 지킬 것.**
> 1. **Enterprise 는 금액을 찍지 말고 "OpenAI 협의사항" 으로 표기** — 문서가 명시적으로 금지한다
> 2. **Codex·ARPU 는 "내부 가정" 임을 화면에 남길 것** — 고객 제안서로 새어 나가면 예산 보장으로 읽힌다

### 4-2. 구조 변경이 필요한 것

| # | 작업 | 상태 |
|:---:|---|---|
| 1 | 017 의 오퍼링 정의 수정 | ✅ **완료** — 제출본 기준으로 재작성 |
| 2 | Cohere 등록 | ✅ **완료** — 023 |
| 3 | Portal26 본문 채우기 | ✅ **완료** — 022 |
| 4 | **`OpenAI Starter Package` 신규 등록** | ⬜ 진입 상품인데 패키지 6종에 대응이 없다 |
| 5 | **ISV 번들 5종에 「적용 기준」 추가** | ⬜ 019 로 번들은 만들었으나 **언제 붙이는지 기준이 없다** |
| 6 | **미등록 제품 3종 결정** | ⬜ Databricks · Trend Micro (번들 필수) / Google Workspace · Salesforce (선택) |
| 7 | **무상/유상 구분 필드** | ⬜ Consulting·OpenAI Ready 는 조건부 무상 — 견적에 0원으로 나와야 한다 |

### 4-3. 딜사이징(STEP04) 설계 방향

```
시트 매출   = 도입 인원 × 월 단가 × 12 × 환율
Codex       = 개발자 수 × 월 Credit 범위 × 12 × 환율     (범위로 제시)
API         = 사용량 가정 (서비스 규모 입력 필요)
PS          = M/D 또는 M/M × 단가                        (AIR Unit 기준 필요)
MS          = 월정액 × 계약 개월                          (Light 3개월 기준 있음)
────────────────────────────────────────────────
제안 총액   = 위 합계, 단 무상 범위는 0원 + "표준 범위 내 무상" 표기
```

**아직 없는 입력값**: AIR Unit M/D 단가 · MS 월정액 · API 사용량 산정 기준 → **ISSU 확인 필요**

---

## 5. 미결 사항

| # | 항목 | 담당 |
|:---:|---|---|
| 1 | **017~023 DB 적용** — `db/migrations/_combined_apply.sql` 한 번에 실행 | 개발 |
| 2 | AIR Unit M/D·M/M 단가, MS 월정액 | ISV BU |
| 3 | Databricks·Trend Micro 등록 여부 (번들 필수 구성) | ISV BU |
| 4 | Managed Service 세부 Scope (마진·원화 빌링·권한 위임) | ISV BU ← OpenAI 협의 |
| 5 | Starter Package 의 MS Light 가격 | ISV BU |
| 6 | 무상 "표준 범위" 의 경계 정의 | ISV BU |
| 7 | Portal26·Cohere 의 **국내 리전 제공 여부** | ISV BU ← 벤더 확인 |

---

## 참고

- 제출본: `OpenAI_통합_오퍼링_기획안_제출본_20260802(수정).pdf`
- 진단기준: `OpenAI_AI_Offering_Diagnostic_20Q.xlsx` (고객 기본정보 / 진단 문항 / 진단 결과 / 오퍼링 맵 / SFDC산업)
- 대조 분석: `docs/prompt/07-31.md` §3-0 ~ §3-0c
- OpenAI Business Pricing: https://openai.com/business/pricing/
- Codex Rate Card (KR): https://help.openai.com/ko-kr/articles/20001106-codex-rate-card
