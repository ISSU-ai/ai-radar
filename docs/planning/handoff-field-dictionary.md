# 인계 필드 사전 — `issu.handoff/1`

> 2026-08-19 · [경계 결정](handoff-boundary.md) 후속.
> **deployment-Brief 는 별도 서비스로 간다**(2026-08-19 결정). 이 문서는 ai-radar 가
> 인계 시점에 **무엇을 어떤 모양으로 넘기는지**의 규격이다.
>
> deployment-Brief 기획서 §10 이 「다음으로 가장 급함」이라고 적은 **필드 사전**의
> ai-radar 몫이다. 나머지(가중치·기밀등급)는 배포 쪽 판단이라 빈칸으로 둔다 —
> **모르는 것을 채우지 않는다.**

---

## 규격

```json
{
  "schema": "issu.handoff/1",
  "generated_on": "2026-08-19",
  "customer": "온누리제조",
  "confidentiality": "internal",
  "fields": [ { "key": "brief_a_4", "label": "ChatGPT 지원 워크플로",
                "value": "…", "status": "likely",
                "source": "2026-08-14 킥오프", "evidence": "법무팀은 지금…" } ],
  "readiness": { "total": 6, "filled": 2, "sourced": 1, "missing": [...] },
  "areas":    [ { "key": "governance", "label": "거버넌스 및 통제", "level": "good", "have": [...] } ],
  "quality":  [ { "key": "frequency", "label": "빈도 · 업무 마찰", "level": "partial" } ],
  "open_items": [ "42문항 중 8개가 미응답입니다." ],
  "recommendation": { "key": "validate", "label": "Focused Validation (집중 검증)",
                      "have": [...], "missing": [...], "why": [...] }
}
```

`field_key` 는 **Template §A 항목 번호와 1:1** 이다 — `brief_a_1` ~ `brief_a_14`.

---

## §A 14필드

`상태` 는 **값이 없을 때의 기본값**이다. 값이 차면 출처에 따라 올라간다.

| # | `field_key` | 항목 | 기본 상태 | ai-radar 가 채우는 출처 |
|---|---|---|---|---|
| 1 | `brief_a_1` | 배포 문제 정의 | `open` | 고객 상담 원문(`lead_message`) + 우선 워크플로 |
| 2 | `brief_a_2` | 초기 사용자 그룹 | `open` | **STEP06 `pilotGroup`** |
| 3 | `brief_a_3` | 비즈니스 성과 책임자 | `open` | **STEP06 `stakeholders`** |
| 4 | `brief_a_4` | ChatGPT 지원 워크플로 | `open` | **STEP06 `workflow`** |
| 5 | `brief_a_5` | 제품 경험 및 통제 의존성 | `open` | **42문항 G·T·D축 + `securityStack` + 문의 제품** |
| 6 | `brief_a_6` | 성공 기준 | `open` | **STEP06 `successCriteria`** |
| 7 | `brief_a_7` | 이해관계자 정렬 | `open` | **STEP06 `stakeholders`** |
| 8 | `brief_a_8` | 범위 경계 | `open` | **STEP06 `scope`** |
| 9 | `brief_a_9` | 사용 사례 품질 점검 | `open` | 영업 판정 6기준 (Template §F) |
| 10 | `brief_a_10` | 롤아웃 가정 | `open` | 시스템이 모으는 미확인 항목 |
| 11 | `brief_a_11` | 초기 추진 방식 권고 | **`likely`** | **근거 충족도로 계산** — 확정은 사람 |
| 12 | `brief_a_12` | 관찰 체계 및 검토 책임 | `open` | **비운다.** 배포 단계(§C) 자리 |
| 13 | `brief_a_13` | 미해결 리스크 | `open` | 미확인 항목 + 품질 점검 공백 |
| 14 | `brief_a_14` | 즉시 다음 단계 | `open` | **STEP06 `nextSteps`** |

### ⚠ 11번만 기본이 `likely` 인 이유

값이 없어도 **계산은 항상 된다** — 근거가 0/6 이면 `No-go / Defer` 가 나온다.
그래서 「미해결」이 아니라 「가능성 높음」이다. 다만 **권고이지 결정이 아니다**
(deployment-Brief P3 과 같은 규칙). `gate_decision.selected` 는 사람이 채운다.

### ⚠ 12번은 의도적으로 비운다

deployment-Brief §C(성공 기준 및 근거 계획) 자리다. **여기서 만들면 두 번 만든다.**
빈칸을 숨기지도 않는다 — 「배포 단계에서 정합니다」라고 적어 보낸다.

---

## 상태 어휘

Template §B 원문 표기를 그대로 쓴다.

| 값 | 표기 | 뜻 |
|---|---|---|
| `confirmed` | 확인됨 | 고객이 직접 낸 값 그대로 |
| `likely` | 가능성 높음 | 영업이 넣거나 고친 값. **틀렸다는 뜻이 아니라 재확인 대상** |
| `open` | 미해결 | 아직 아무도 모른다 |
| `unknown` | **구분 불가** | 접수 원본이 없어 **판정할 수 없다** (049 이전 딜) |

### `unknown` 은 ai-radar 가 추가한 넷째다

Template 은 셋만 정의한다. 그런데 **원본이 없는 딜**에서는 셋 중 어느 것도 참이
아니다 — 값이 있어도 그게 고객이 낸 것인지 영업이 적은 것인지 모른다. 셋 중 하나를
고르면 **셋 다 거짓말**이 된다.

> deployment-Brief 가 이 값을 어떻게 받을지 정해야 한다. `open` 으로 접어도 되고
> 네 번째 상태를 두어도 된다. **접는다면 「구분 불가」였다는 사실이 사라진다는 것만
> 알고 접어야 한다.**

---

## ai-radar 가 못 채우는 넷 — **정상이다**

`evidence_item` 이 요구하는데 스냅샷에 없는 것들이다.

| 필드 | 왜 없나 |
|---|---|
| `owner_id` | 영업 단계에서 「이 값을 누가 책임지나」가 안 정해진다 |
| `verify_method` | 어떻게 검증할지는 배포팀이 정한다 |
| `due_date` | 검증 기한도 같다 |
| `confidentiality` (필드 단위) | 지금은 **문서 단위**로만 `internal` 이다 |

**빈칸으로 받는 것이 맞다.** 영업이 추측해서 채우면 배포팀이 그걸 근거로 계획을 세운다.

---

## 같이 넘어가는 것 — `fields` 밖

`fields` 14개 외에 네 덩이가 더 간다. Template 에는 자리가 없지만 **판정의 근거**라
버리면 배포팀이 다시 물어야 한다.

| 키 | 무엇 | 어디에 쓰나 |
|---|---|---|
| `readiness` | STEP06 6칸 중 몇 개가 찼나 · 회의록 근거가 붙은 칸 수 | 인계 품질 한 줄 요약 |
| `areas` | 7 준비도 영역 × 양호/주의/미흡 + **왜 그 등급인지** | Kit §A 「근거 품질 요약」 |
| `quality` | 사용 사례 품질 6기준 중 **미충족·부분충족만** | Template §F |
| `open_items` | 시스템이 모으는 미확인 항목 | §A10 가정 · §A13 리스크의 재료 |

---

## deployment-Brief 가 정해야 하는 셋

기획서 §10 이 요구한 네 항목 중 **ai-radar 가 낼 수 있는 둘은 위에 있다**
(`field_key` · 기본 근거상태). 남은 둘 + 하나는 배포 쪽 판단이다.

| | 왜 우리가 못 정하나 |
|---|---|
| **필수/선택 가중치** | 준비도 점수 계산식이 deployment-Brief 쪽에 있다. ai-radar 는 「필수 근거 6종」이라는 자체 기준을 쓰는데 **같은 것이 아니다** |
| **기밀등급 기본값** | 필드 단위 기밀은 고객 공유 정책에 달렸고, 그건 §11 미해결 항목 ①이다 |
| **`unknown` 을 어떻게 받을지** | 위 참고 |

---

## 다음 — 한 번 주고받아 본다

**문서로만 맞추면 반드시 어긋난다.** ai-radar 에서 실제 딜 하나로 JSON 을 뽑아
deployment-Brief 프로토타입이 그걸 읽어 케이스를 만드는 것까지 돌려 봐야 규격이
맞는지 안다.

지금 `/hub` STEP06 의 **「인계 브리프 4종」** 버튼이 이 JSON 을 내려받는다.
