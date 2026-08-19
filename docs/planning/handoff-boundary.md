# ai-radar 와 deployment-Brief — 어디서 갈리나

> 2026-08-19 · 두 프로젝트가 같은 것을 두 번 만들고 있어 경계를 정한다.
> 대상: `~/CC/ai-radar` (구현됨) · `~/CC/deployment-Brief` (기획 v0.2, 구현 미착수)

---

## 발단

deployment-Brief 기획서 §09 는 **「B 실서비스: 미착수」**로 적혀 있다. 그런데 원문을
읽어 보니 **그 기획의 상당 부분이 ai-radar STEP06 에서 이미 돌고 있다.**

| deployment-Brief 기획 | ai-radar 에 있는 것 | 상태 |
|---|---|---|
| `evidence_item` = 값 + 상태 + 출처 | `lib/handoff-snapshot.js` | **구현됨** |
| `status` = confirmed / likely / open | 같은 어휘 + 넷째 `unknown` | **구현됨** |
| Template §A 14필드 | `BRIEF_SECTIONS` — 제목까지 같음 | **구현됨** |
| P3 판정은 계산, 결정은 사람 | `recommendApproach` — 권고 + 이유 | **구현됨** |
| P5 미완성이 정상 | 빈칸을 질문으로 바꿈 | **구현됨** |
| P6 기밀은 상태와 별개 축 | `sections_internal` · 고객용/내부용 | **부분** (문서 단위, 필드 단위 아님) |
| 인터뷰 모드 | `buildInterviewGuide` | **구현됨** |
| `gate_decision` | Proceed / Validation / Re-scope / No-go | **구현됨** (권고까지) |
| RACI · 리스크 레지스터 · 승인 서명 | 없음 | **deployment-Brief 자리** |
| `sync_field_config` · `sync_log` | 없음 | **deployment-Brief 자리** |
| 대시보드(상태 집계) | 없음 | **deployment-Brief 자리** |

**우연이 아니다.** ai-radar Phase 4~6 을 만들 때 Deployment Brief Template 원문을
받아 그대로 따랐다. 상태 어휘도 §B 표기를 그대로 썼다.

---

## 겹치는 것은 **한 점**이다

시간축에 놓으면 둘은 **연속**이고 겹치는 구간은 「인계」 한 지점뿐이다.

```
ai-radar
리드 → 진단(42문항) → ISV 추천 → 견적 → 피치 → ┃인계┃
                                              ┃
                                              ┃ ← 여기서만 겹친다
                                              ┃
                            ┃인계┃ → 근거 축적 → 게이트 → 승인 → 배포 계획
                                                        deployment-Brief
```

그리고 **대상 범위가 다르다.**

| | ai-radar | deployment-Brief |
|---|---|---|
| 다루는 딜 | MZC 가 파는 **전체 ISV** (255종) | **ChatGPT Enterprise 배포** 하나 |
| 쓰는 사람 | 영업 · ISV BU(curator) | 영업 · SA · 배포 책임자 · **고객** |
| 목적 | **팔 수 있게** | **배포할 수 있게** |

> deployment-Brief 는 ai-radar 의 **오퍼링 하나(`02 OpenAI Ready`)의 후속 공정**이다.
> 대체 관계가 아니다.

---

## 판단 — **원본이 시점에 따라 넘어간다**

핵심 질문은 「어느 쪽이 필드의 원본인가」이고, 답은 **시점마다 다르다.**

```
인계 전    ai-radar 가 원본          영업 단계에서 쌓은 근거
인계 시점   스냅샷을 한 번 넘긴다      ← issu.handoff/1
인계 후    deployment-Brief 가 원본   SA·고객이 확인한 근거
```

### 왜 인계 전은 ai-radar 인가

**근거 상태를 판정할 수 있는 것이 ai-radar 뿐이다.** 고객 원본과 영업 수정본을 둘 다
가진 유일한 곳이라서다 — `readiness_customer_scores`(032) · `customer_meta_original`(049).

deployment-Brief 는 그 원본이 없다. 영업이 입력한 값만 받으므로 「고객이 말한 것」과
「영업이 적은 것」을 못 가른다. **그 구분이 이 판의 전부**인데 그렇다.

### 왜 인계 후는 deployment-Brief 인가

인계 뒤의 근거는 ai-radar 가 **모른다.** SA 가 확인한 것, 고객이 승인한 것,
워크스페이스 관리자가 답한 것은 ai-radar 화면에 들어올 일이 없다.

### ⚠ 넘긴 뒤 ai-radar 는 그 필드를 안 고친다

두 곳이 같은 필드를 편집하면 반드시 갈린다. **넘긴 시점 이후 STEP06 의 14필드는
읽기 전용**으로 두고, 고칠 일이 있으면 deployment-Brief 에서 고친다.

이건 이 저장소가 이미 쓰는 규칙과 같다 — `customer_meta_original` 을 `EDITABLE_DEAL_FIELDS`
에서 뺀 것과 같은 이유다. **고칠 수 있으면 「원본」이라는 말이 거짓이 된다.**

---

## 접점 규격 — 이미 있다

`buildHandoffExport()` 가 내는 `issu.handoff/1` 이 그 자리다.

```json
{ "schema": "issu.handoff/1", "confidentiality": "internal",
  "fields": [{ "key": "brief_a_4", "label": "ChatGPT 지원 워크플로",
               "value": "…", "status": "likely",
               "source": "2026-08-14 킥오프", "evidence": "법무팀은…" }],
  "readiness": {…}, "areas": […], "quality": […],
  "open_items": […], "recommendation": {…} }
```

`field_key` 가 `brief_a_1`~`brief_a_14` 로 **Template §A 항목 번호와 1:1** 이다.

### 모자란 넷 — 배포 단계에서 채우는 것

| evidence_item 이 요구 | ai-radar | 누가 채우나 |
|---|---|---|
| `owner_id` | 없음 | 배포 단계 |
| `verify_method` | 없음 | 배포 단계 |
| `due_date` | 없음 | 배포 단계 |
| `confidentiality` | **문서 단위**만 | 배포 단계에서 **필드 단위**로 |

**모자란 것이 정상이다.** 영업 단계에서 「이 값을 누가 언제까지 어떻게 검증하나」를
정할 수 없다. 그건 인계받은 쪽의 일이다.

---

## 그래서 지금 할 것

### ① deployment-Brief 의 「가장 급한 것」이 이미 절반 있다

기획서 §10 이 이렇게 적고 있다.

> **미완료 (다음으로 가장 급함): Template §A–§I 14필드 각각의 field_key, 필수/선택
> 가중치, 기본 근거상태, 기밀등급을 목록화.** 이 목록이 없으면 Phase 1 입력 폼
> 구현이 시작될 수 없습니다.

프로토타입은 **14필드 중 2개(01·06)만** 실제 콘텐츠를 갖고 있다.
**ai-radar 는 14개 전부 있다** — key · label · 어디서 값을 끌어오는지까지.

`lib/handoff-doc.js` 의 `BRIEF_SECTIONS` 를 그대로 넘기면 **Phase 0 이 풀린다.**
남는 것은 가중치·기본 근거상태·기밀등급 셋이고, 그건 deployment-Brief 쪽 판단이다.

### ② ai-radar 는 §C~§I 를 만들지 않는다

Phase 5 계획서에 이미 적어 둔 경계이고, 원문을 읽고 나서도 **그대로 맞다.**

```
ai-radar          §A 14필드 초안 + §B 근거표 + §F 품질점검 + §G 권고
deployment-Brief  §C 성공기준 계획 · §D RACI · §E 범위경계 · §H 리스크 레지스터 · §I 승인
```

### ③ 스냅샷을 실제로 주고받아 본다

지금은 JSON 을 내려받기만 한다. deployment-Brief 가 그걸 읽어 케이스를 만드는 것까지
한 번 돌려 봐야 규격이 맞는지 안다. **문서로만 맞추면 반드시 어긋난다.**

---

## 정할 것 — 네 가지

| # | 질문 | 왜 지금 |
|---|---|---|
| 1 | ~~deployment-Brief 를 별도 서비스로 갈 것인가~~ | ✅ **별도로 간다 (2026-08-19 결정).** 지금 정리한 경계가 그대로 답이다 |
| 2 | **인계 뒤 ai-radar 를 읽기 전용으로 잠글 것인가** | 안 잠그면 두 곳이 갈린다. 잠그면 영업이 「왜 못 고치지」를 묻는다 |
| 3 | **ChatGPT Enterprise 외 오퍼링도 배포 인계가 필요한가** | 필요하면 deployment-Brief 는 「ChatGPT 배포」가 아니라 **일반 인계 플랫폼**이 되고, ai-radar 와의 경계가 다시 흔들린다 |
| 4 | **필드 사전을 누가 확정하나** | ai-radar 가 초안을 냈지만 가중치·기밀등급은 배포 쪽 판단이다 |

**1번은 정해졌다** — 별도 서비스다. 그래서 위 경계가 확정이고, 접점은
`issu.handoff/1` 하나다. 규격은 [필드 사전](handoff-field-dictionary.md) 에 있다.

남은 2·3·4 는 인계를 실제로 한 번 돌려 본 뒤에 답이 선명해진다.

---

## 하지 않을 것

| | 이유 |
|---|---|
| ai-radar 에 RACI·리스크 레지스터·승인 서명 추가 | deployment-Brief 자리다. 여기 만들면 두 번 만든다 |
| deployment-Brief 에 근거상태 판정 로직 재구현 | 고객 원본을 가진 쪽이 판정해야 한다. 스냅샷으로 받는다 |
| 두 곳에서 §A 14필드를 편집 | 반드시 갈린다. 시점으로 원본을 넘긴다 |
| 규격을 문서로만 맞추기 | 한 번 주고받아 봐야 안다 |
