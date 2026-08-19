# ISV 마스터 정리 요청 — 중복 · URL · 표기

> 대상: `ISV Offering Analysis - Master` §1 Company Information (260행 / 고유 255사)
> 작성 2026-08-18 · 카탈로그 임포트 전에 고치는 게 가장 쌉니다.

---

## 0. 먼저 정할 것 하나 — **행의 단위가 회사인가 제품인가**

지금 섞여 있습니다. 오타가 아니라 **기준이 안 정해진 것**이라 이것부터 정해야 나머지가
정리됩니다.

| 방식 | 지금 목록의 예 |
|---|---|
| 회사 단위 | `Cisco` · `Salesforce` · `NHN` |
| 제품 단위인데 URL 은 회사 | `MATLAB` → mathworks.com · `Gamebase (NHN)` → nhn.com · `Dynamics 365 CRM` → microsoft.com |
| 제품 단위인데 URL 도 제품 | `AppDynamics (Cisco)` → appdynamics.com · `Salesforce - Slack` → slack.com |
| 회사인데 URL 은 제품 | `Eglobalsys` → cubeone.co.kr |

같은 Cisco 계열인데 `Cisco` 와 `AppDynamics (Cisco)` 가 따로 있고,
같은 Salesforce 계열인데 `Salesforce` · `Salesforce - Slack` · `Salesforce - Tableau`
가 따로 있습니다. **제품 단위로 가는 것으로 보이는데**, 그러면 `Cisco` 단독 행이
무엇을 가리키는지가 애매합니다.

**권고 — 제품 단위로 통일하고 「공급사」를 별도 칸으로 뺍니다.** 그러면 「Salesforce
계열 3종」·「Cisco 계열」이 검색됩니다. 지금처럼 이름 문자열에 두면 영원히 문자열입니다.

---

## 1. 중복 — 5행 삭제

| 회사 | 상태 |
|---|---|
| `Avepoint` | 완전히 같은 행 2개 |
| `Netskope` | 완전히 같은 행 2개 |
| `Splunk` | 완전히 같은 행 2개 |
| `Vanta` | 완전히 같은 행 2개 |
| `MegazoneCloud` | **첫 행과 마지막 행** — 의도된 것이면 남기고, 아니면 하나 삭제 |

---

## 2. URL 오류 — **다른 회사 도메인**입니다

근거가 분명한 셋입니다. 이대로 두면 카탈로그에서 엉뚱한 회사로 연결됩니다.

| 회사 | 지금 | 고칠 값 | 근거 |
|---|---|---|---|
| **Couchbase** | `contentsquare.com` | `couchbase.com` | Contentsquare 는 프랑스 디지털경험분석 회사로 무관 |
| **Mixpanel** | `mfitlab.com` | `mixpanel.com` | 무관한 도메인 |
| **Reblaze** | `querypie.com` | `link11.com` | **QueryPie 와 도메인이 겹칩니다**(같은 목록에 별도 행 존재). Reblaze 는 2024-01 Link11 에 인수돼 자사 사이트가 Link11 로 넘어갔습니다 |

---

## 3. URL 확인 요청 — 판단이 안 서는 것

**틀렸다고 단정하지 않았습니다.** 회사명과 도메인이 안 닮아 확인이 필요합니다.

| 회사 | 지금 | 의심 이유 |
|---|---|---|
| `Sling Score` | `ke-la.com` | KELA 는 이스라엘 위협인텔리전스 회사입니다. Sling 이 KELA 제품이면 **공급사 = KELA** 로 적어야 하고, 아니면 URL 오류입니다 |
| `Vizcon` | `mksolutions.fr` | 프랑스 도메인. 회사명과 무관해 보입니다 |
| `Photon` | `photon.com` | 게임 네트워킹 Photon 은 `photonengine.com` 입니다. 다른 Photon 이면 무시하세요 |
| `Microsoft Office 365` | `microsoftoffice365.com` | Microsoft 공식 도메인이 아닙니다. `microsoft.com/microsoft-365` 여야 할 것 같습니다 |
| `Hackle` | `hackle.com` | 국내 A/B 테스트 Hackle 은 `hackle.io` 입니다 |
| `Flex` | `flex.com` | 한글명이 「플렉스」인데 `flex.com` 은 미국 제조 EMS 기업(Flex Ltd)입니다. 국내 HR SaaS 플렉스면 `flex.team` 입니다 |
| `Appguard (Trustar)` | `trustar.best` | `.best` TLD 라 확인이 필요합니다 |
| `KS고용정보` | `ks.com` | 사명과 무관해 보입니다 |
| `KCC정보통신` | `kcc.com` | KCC정보통신 도메인이 맞는지 확인 필요 |

### 오류는 아니지만 §0 기준에 걸리는 것

제품 → 모회사 도메인, 회사 → 제품 도메인이 섞여 있습니다. §0 을 정하면 같이 정리됩니다.

`Liapp` → lockincomp.com · `Eglobalsys` → cubeone.co.kr · `MATLAB` → mathworks.com ·
`Gamebase (NHN)` → nhn.com · `Rancher (Suse)` → suse.com · `Posit (RStudio)` → posit.com
(공식은 `posit.co`) · `Dynamics 365 CRM` → microsoft.com · `Google SecOps` → cloud.google.com

---

## 4. 이름 칸 보완

### 영문명·한글명이 같은 것

| 회사 | 문제 |
|---|---|
| `Spiceware / AhnLab` | 영문·한글이 동일. **두 회사가 한 행에 있습니다** — 나눠야 할 것 같습니다 |
| `KS고용정보` | 영문명 없음 |
| `KCC정보통신` | 영문명 없음 |

### 이름에 섞인 관계정보 — 25건

`(모회사)` · `(구 .옛이름)` · `(a.k.a 별칭)` · `- 계열` 이 이름 문자열에 들어 있습니다.
**§0 대로 「공급사」·「구명」 칸을 만들면** 이름이 깨끗해지고 검색이 됩니다.

```
AppDynamics (Cisco)   Cohesity(Veritas)      VMware (Broadcom 인수)
Citrix (Cloud Software Group)   Rancher (Suse)   Spot inst → 스팟 바이 넷앱
DoveRunner(구. 잉카엔트웍스)   Tenable(구 .Ermetic)   Eviden (구 .Atos)
Gravitational (a.k.a Teleport)   Imply (Druid)   Maria DB (Clustrix)
EDB (PSQL)   PingCap(TiDB)   PnP Secure(DB Safer)   Posit (RStudio)
Leakjar (SEWorks)   Shorebird (Code Town)   Appguard (Trustar)
Secureletter (시큐레터)   Eglobalsys (이글로벌시스템)   Gamebase (NHN)
Redhat (CCSP level)   Salesforce - Slack   Salesforce - Tableau
HPE (Hewlett Packard Enterprise)
```

`Redhat (CCSP level)` 는 성격이 다릅니다 — 괄호가 **파트너 등급**입니다. 이름이 아니라
등급 칸으로 가야 합니다.

---

## 5. slug 지정 — 임포트 키

카탈로그의 고유 키입니다. 자동 생성이 안 되거나 기존 것과 안 맞는 것만 적습니다.

### 한글 사명 — **직접 지정** (요청 반영)

| 회사 | slug |
|---|---|
| `KCC정보통신` | **`kccinfo`** |
| `KS고용정보` | **`ksinfo`** |

### ⚠ 기존 카탈로그와 표기가 달라 **그대로 넣으면 중복이 생기는 것 — 8건**

지금 카탈로그 22종 중 이 8종은 마스터의 이름으로 slug 를 만들면 **다른 값**이 나옵니다.
임포트할 때 아래 짝을 맞춰야 새 행이 안 생깁니다.

| 마스터 이름 | 자동 slug | **기존 카탈로그 slug** |
|---|---|---|
| `Anthropic` | `anthropic` | **`anthropic-claude`** |
| `OpenAI` | `openai` | **`openai-enterprise`** |
| `Checkpoint` | `checkpoint` | **`check-point`** |
| `TrendMicro` | `trendmicro` | **`trend-micro`** |
| `Elevenlabs` | `elevenlabs` | **`eleven-labs`** |
| `Twelvelabs` | `twelvelabs` | **`twelve-labs`** |
| `Palo Alto Networks` | `palo-alto-networks` | **`palo-alto`** |
| `Salesforce - Slack` | `salesforce-slack` | **`slack`** |

**마스터 쪽 표기를 바꿔 달라는 요청이 아닙니다** — 임포트에서 짝을 맞추면 됩니다.
다만 어느 쪽 표기를 정답으로 할지는 정해 주셔야 합니다.

### 마스터에 없는데 카탈로그에 있는 것 — 2건

| | |
|---|---|
| **Cohere** | 마스터 누락인지, 취급 중단인지 확인 필요 |
| **FollowerRabbit** | 위와 같음 |

---

## 요약

| | 건수 | 조치 |
|---|---|---|
| 중복 행 | 5 | 삭제 |
| URL 오류(확실) | 3 | 값 교체 |
| URL 확인 요청 | 9 | 담당자 확인 |
| 이름 칸 보완 | 3 | 영문명·회사 분리 |
| 관계정보 분리 | 25 | §0 결정 후 칸 분리 |
| slug 지정 | 2 | `kccinfo` · `ksinfo` |
| 기존 카탈로그와 짝짓기 | 8 | 임포트에서 처리 |
| 마스터 누락 확인 | 2 | Cohere · FollowerRabbit |

**가장 급한 것은 §0(행의 단위)입니다.** 그게 정해져야 나머지 정리 방향이 하나로 모입니다.

출처 — [Link11 acquires Reblaze (2024-01)](https://www.crunchbase.com/acquisition/link11-gmbh-acquires-reblaze--08f1c0db)
