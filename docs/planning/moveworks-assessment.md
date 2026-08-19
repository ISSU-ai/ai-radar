# Moveworks 판단 — 들고 갈 것인가

> 2026-08-19 작성 · 1단계(판단). 8/22 Offering 도출 회의용.
> **표기 원칙**(022·023) — 벤더가 낸 수치는 「벤더 주장」으로 명시한다.
> 확인 안 된 것은 「확인 필요」로 남긴다. **모르는 것을 아는 척 쓰지 않는다.**

---

## 결론 — **조건부. 지금은 카탈로그에 올리지 않는다**

포트폴리오상 **자리는 분명히 있다.** 그런데 **팔 수 있는지가 확인이 안 됐다.**
그 확인은 우리가 웹에서 못 하고 8/22 회의에서 ServiceNow 담당자에게 물어야 한다.

| | |
|---|---|
| ✅ 우리 OpenAI 라인을 **안 잡아먹는다** | 층위가 다르다 (Q1) |
| ✅ **비어 있는 슬롯을 정확히 메운다** | 카탈로그가 이미 그 공백을 적어 뒀다 (Q1) |
| ✅ MZC 가 **값을 만들 자리가 크다** | 연동이 성패를 가른다 (Q5) |
| ❓ **파트너가 팔 수 있는지 모른다** | 인수 후 판매 정책 미확인 (Q2) |
| ❓ **국내에서 팔 수 있는지 모른다** | 한국어 품질·레퍼런스·파트너 체계 공개 자료 **없음** (Q4) |

> **8/22 에 이 문서를 들고 가서 세 가지를 물으면, 그날 등재 여부가 정해진다.**
> 질문은 맨 아래에 있다.

---

## 판을 바꾼 사실 둘

| | |
|---|---|
| **ServiceNow 가 인수했다** | 2025-12-15 완료 · 약 **$2.9B**. Moveworks 는 더 이상 독립 ISV 가 아니다 |
| **이미 제품으로 묶였다** | 2026-02 **ServiceNow EmployeeWorks** — Moveworks 대화형 AI + ServiceNow 워크플로. 독립 제품 판매도 계속되고 `servicenow.moveworks.com` 이 별도로 있다 |

그래서 **「ISV 하나 조사」가 아니라 오퍼링 판단**이다.

---

## Q1. 우리 오퍼링과 겹치나 보완하나 → **보완재다**

Moveworks 는 **직원 지원(IT·HR) 특화 에이전트**다. 사내 시스템(ServiceNow·Workday·
Salesforce)에 붙어 티켓·요청을 **끝까지 처리**한다. 범용 대화 도구가 아니다 —
벤더 스스로 *"ChatGPT 나 Gemini 같은 도구가 아니다"* 라고 말한다.

우리 `02 OpenAI Ready` 는 **전사 범용 생산성**이다. 슬롯 언어로 보면 이렇게 갈린다.

```
llm-platform         OpenAI · Anthropic · Cohere      ← 하나를 고르는 자리
business-app-agent   Moveworks                        ← 그 위에 얹는 자리
```

### ⚠ 그리고 이 슬롯은 지금 **비어 있다** — 카탈로그가 그걸 이미 적어 놨다

`db/migrations/011` 의 슬롯 분류표에 이렇게 남아 있다.

```
('business-app-agent', '업무시스템 내장 에이전트', 'L2', true,
 'ServiceNow/AgentForce/SAP Joule 미등록', 31)
```

**공백 메모가 ServiceNow 를 직접 지목한다.** Moveworks 는 그 ServiceNow 것이 됐고,
정확히 이 자리에 들어온다. 우연이 아니라 **처음부터 비어 있던 칸**이다.

42문항으로도 확인된다 — **B3 「AI가 사내 시스템에 직접 접근해서 예약·조회·처리 등
복잡한 업무를 스스로 완료할 수 있습니까?」** 가 정확히 이 제품의 자리다.
지금 그 문항을 덮는 솔루션이 카탈로그에 없다.

**⚠ 다만 영원히 보완재는 아니다.** EmployeeWorks 가 「전사 직원 포털」로 확장하면
겹치기 시작한다. 지금은 아니고, 1년 뒤에는 다시 봐야 한다.

---

## Q2. ServiceNow 계열을 어떻게 다루나 → **핵심 미확인**

| | |
|---|---|
| 독립 판매 | **계속된다.** moveworks.com 이 살아 있고 별도 제품으로 소개된다 |
| ServiceNow 고객 | EmployeeWorks 로 흡수되는 흐름으로 보인다 |
| **파트너 판매 정책** | **확인 불가.** 인수 후 채널 정책이 공개 자료에 없다 |
| MZC 의 ServiceNow 관계 | ISV 마스터에 `ServiceNow` 행이 있으나 **관계 단계는 문서에 없다** |

**이게 등재 여부를 실제로 가른다.** ServiceNow 파트너 채널로만 판매된다면
MZC 의 ServiceNow 관계가 전제가 되고, 그건 우리가 웹에서 알 수 없다.

### ⚠ ISV 마스터 §0 과 같은 문제다

Moveworks 를 **별도 행**으로 넣을지 **ServiceNow 행의 제품**으로 넣을지는
[`isv-master-cleanup.md`](isv-master-cleanup.md) §0 「행의 단위가 회사인가 제품인가」와
정확히 같은 질문이다. `Salesforce - Slack` · `AppDynamics (Cisco)` 와 같은 구조다.

**이 건이 그 결정의 첫 실제 사례가 된다.**

---

## Q3. Microsoft 365 Copilot 제휴가 우리 라인과 충돌하나 → **아니다. 오히려 근거다**

Moveworks 는 **M365 Copilot 의 서드파티 에이전트** 중 하나로 들어가 있다.
처음엔 「ChatGPT 대신 Copilot」 구도를 밀어 줄 위험으로 보였는데, 뒤집어 보면 다르다.

> **Moveworks 는 프론트엔드에 중립적이다.** Copilot 에도 붙고, Slack·Teams·웹에도 붙는다.
> 그렇다면 **ChatGPT Enterprise 를 쓰는 고객에게도 얹을 수 있다.**

이게 Q1 의 「보완재」 판단을 뒷받침하는 증거다. 같은 층에서 다투는 제품이면
Copilot 에만 붙었을 것이다.

---

## Q4. 국내에서 팔 수 있나 → **공개 자료가 없다**

**이 항목은 전부 「확인 필요」다. 지어내지 않는다.**

| 항목 | 확인된 것 |
|---|---|
| 한국어 지원 | 「100개 이상 언어 처리」 — **벤더 주장**(2021 발표 기준). **한국어 품질 근거는 없다** |
| 국내 레퍼런스 | **공개 자료 없음** |
| 국내 파트너 체계 | **공개 자료 없음** |
| 국내 리전·데이터 소재 | **확인 못 함** |

### 가격 — 공식 공시가가 없다

- 벤더는 **공개 가격을 내지 않는다.** 견적 기반 · 직원당 연 단위
- **AWS Marketplace 에 등재돼 있다는 언급**이 있다 — 1,000~2,500 사용자 구간
  **$150/user/year**(12개월 계약). ⚠ **직접 확인 안 했다**
- 서드파티 집계는 **$15~45/user/year** 로 말한다 — 위 숫자와 **3~10배 어긋난다**

> ⚠ **042 에서 세운 규칙을 따른다** — 벤더 9곳을 조사했을 때 서드파티 집계 사이트가
> 공식 페이지와 적극적으로 어긋났다. **출처 없는 숫자를 카탈로그에 쓰지 않는다.**
> 등재한다면 §9 가격은 **「협의」**로 두고, AWS Marketplace 등재만 사실로 적는다.

참고 — 500명 미만은 최소 계약에 못 미친다는 집계가 있다(벤더 확인 아님).
사실이면 **국내 중견기업 상당수가 대상에서 빠진다.**

---

## Q5. MZC 가 값을 만드는 자리가 있나 → **크다. 여기가 이 제품의 매력이다**

Moveworks 는 **연동 품질이 성패를 가르는 제품**이다. 라이선스만 얹는 자리가 아니다.

| MZC 몫 | 왜 |
|---|---|
| **사내 시스템 연동** | ServiceNow·Workday·Salesforce·SSO·지식베이스. 이게 안 되면 제품이 아무것도 못 한다 |
| **지식베이스 정비** | 벤더는 250M 건 티켓으로 학습했다지만(**벤더 주장**) 고객사 문서·규정 정제는 별개다. `03 AIR Service` 자리 |
| **워크플로 설계** | 어떤 요청을 자동 처리하고 어디서 사람이 검토하는지 — 컨설팅 영역 |
| **AWS Marketplace 경유** | 채널 파트너 사설 오퍼(CPPO) 구조가 존재하고, 채널 파트너는 **거래 수수료를 안 낸다.** ⚠ **Moveworks 가 CPPO 를 여는지는 확인 필요** |

구축 비용이 **$50K~$200K+ · 8~16주** 라는 집계가 있다(벤더 확인 아님).
사실이라면 **라이선스보다 서비스가 큰 딜**이고, 그건 우리에게 유리하다.

---

## 8/22 회의에서 물어야 할 것 — **세 가지**

이 셋이 답해지면 등재 여부가 그날 정해진다.

### 1. 파트너가 Moveworks 를 팔 수 있습니까?

- 인수 후 채널 정책이 어떻게 됐는지
- **ServiceNow 파트너 자격이 전제인지**
- MZC 의 지금 ServiceNow 관계 단계가 그 조건을 만족하는지

### 2. ServiceNow 를 안 쓰는 고객에게도 팝니까?

- Moveworks 단독 판매가 계속되는지, EmployeeWorks 로 수렴하는지
- 우리 고객 상당수는 ServiceNow 를 안 쓴다. **답이 「아니오」면 대상 고객이 급감한다**

### 3. 국내 사업이 있습니까?

- 한국어 품질 · 국내 레퍼런스 · 국내 지원 체계 · 데이터 소재
- 그리고 **AWS Marketplace CPPO 를 여는지** — 열려 있으면 우리 진입 경로가 하나 생긴다

---

## 그래서 지금 하는 것 / 안 하는 것

| | |
|---|---|
| **한다** | 이 문서를 8/22 에 들고 간다 |
| **한다** | ISV 마스터 §0 논의에 이 건을 **사례로** 올린다 |
| **안 한다** | 카탈로그 8탭 본문 작성 — 세 질문이 답해진 뒤 |
| **안 한다** | 가격을 카탈로그에 넣는 것 — 공식 공시가가 없다 |

세 질문의 답이 「판매 가능」이면 **`business-app-agent` 슬롯의 첫 등재**로 바로
착수한다. 슬롯·레이어(L2)·경쟁 구도까지는 이미 정해져 있어 본문만 쓰면 된다.

---

## 출처

- [ServiceNow completes acquisition of Moveworks](https://www.moveworks.com/us/en/company/news/press-releases/servicenow-completes-acquisition-of-moveworks) — 2025-12-15 완료
- [ServiceNow integrates Moveworks, launches EmployeeWorks — Constellation Research](https://www.constellationr.com/insights/news/servicenow-integrates-moveworks-launches-autonomous-workforce-employeeworks) — 2026-02
- [Moveworks AI Assistant 플랫폼 소개](https://www.moveworks.com/us/en/platform/ai-assistant)
- [Moveworks × Microsoft 마켓플레이스 제휴](https://www.moveworks.com/us/en/company/news/press-releases/moveworks-partnership-with-microsoft-thought-marketplace-integration)
- [Moveworks 다국어 지원 발표](https://www.moveworks.com/us/en/resources/blog/moveworks-announces-multilingual-support) — 2021
- [AWS Marketplace 채널 파트너 사설 오퍼(CPPO)](https://docs.aws.amazon.com/marketplace/latest/userguide/channel-partner-info.html)
- 가격 집계 — [eesel](https://www.eesel.ai/blog/moveworks-pricing) · [Vendr](https://www.vendr.com/marketplace/moveworks) ⚠ **서로 어긋난다. 참고만**
