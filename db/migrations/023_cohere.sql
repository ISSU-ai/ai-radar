-- 023. Cohere 신규 등록 (1회성 시드)
--
-- 021 의 노출 목록 8종 중 유일하게 카탈로그에 없던 제품이다. Unique 설명 안에
-- 경쟁제품으로 한 줄 언급될 뿐이었다(isv_data.js).
--
-- 출처: cohere.com (2026-08-03 확인) · Carahsoft 공동 보도자료(2026-07-30) ·
--       AMD-Cohere 협력 발표
--
-- 슬롯을 llm-platform 으로 둔 이유:
--   Cohere 는 자체 모델(Command·Embed·Rerank)과 워크플레이스 플랫폼(North)을 가진
--   범용 LLM 플랫폼이다. 고객이 OpenAI·Claude 와 **하나를 고르는** 자리이지 함께
--   쓰는 자리가 아니다. private-domain-platform(Articul8 자리)에 넣으면
--   "OpenAI Enterprise + Cohere" 같은 조합이 나오는데, SaaS LLM 과 온프레 LLM 을
--   같이 제안하는 꼴이라 말이 안 된다.
--
-- ⚠ 표기 원칙 (022 와 동일)
--   1. 벤더 주장은 "벤더 주장" 으로 명시한다.
--   2. 가격은 공개 정보가 없다. 넣지 않는다.
--   3. 한국 리전·국내 레퍼런스는 확인된 자료가 없다. §7 에 확인 항목으로 남긴다.
--
-- ⚠ apply-migrations.js 에서 제외한다 (1회성 시드).

begin;

insert into solutions (slug, name, delivery, layer, synergy, category, jtbd, value_chain,
                       status, status_op, is_archived)
values (
  'cohere', 'Cohere', 'SaaS / VPC / On-prem', 'L1', '높음',
  'GenAI / 범용 LLM (데이터 주권형)',
  '데이터를 외부로 내보내지 않고 다국어 검색·RAG·에이전트를 기업 내부에 구축',
  'AI Platform', 'published', 'active', false
)
on conflict (slug) do update set
  delivery = excluded.delivery, layer = excluded.layer, synergy = excluded.synergy,
  category = excluded.category, jtbd = excluded.jtbd, value_chain = excluded.value_chain,
  status = 'published', status_op = 'active', is_archived = false;

-- 슬롯 배정 (011 분류표)
update solutions set slot = 'llm-platform' where slug = 'cohere';

-- ── 8탭 본문 ────────────────────────────────────────────────────
update solutions set sections = jsonb_build_object(
'1', E'Cohere 는 **"Your data. Your infrastructure. Cohere keeps it that way"** 를 내세우는 엔터프라이즈 LLM 벤더입니다. OpenAI·Anthropic 과 같은 범용 LLM 자리에 있지만, **데이터를 자사 클라우드로 가져가지 않는 배포 형태**를 상품의 중심에 둔다는 점이 다릅니다.\n\n- **제품 라인업**\n  - **North** — 에이전트·지능형 검색·업무 자동화를 묶은 엔터프라이즈 AI 워크플레이스 플랫폼. 전사 배포와 데이터 격리를 전제로 설계됐습니다.\n  - **Command** — 멀티모달·다국어 생성 모델. **49개 언어** 지원(벤더 주장).\n  - **Embed / Rerank** — 검색·검색품질 개선 모델. RAG 파이프라인의 정확도를 올리는 자리에 씁니다.\n  - **Compass** — 지능형 검색·발견.\n  - **Transcribe** — 음성 인식(14개 언어). **North Mini Code** — 코딩 모델.\n- **차별적 비즈니스 가치**\n  - ① **배포 형태가 선택지다.** VPC · 온프레미스 · **에어갭(air-gapped)** · 하이브리드를 지원하고, Cohere 가 운영해 주는 전용 추론 환경(**Model Vault**)도 있습니다. 공공 부문에는 **zero data egress** 를 명시합니다.\n  - ② **검색이 강점이다.** Embed·Rerank 는 생성보다 **검색·재순위**에 특화된 별도 모델입니다. 사내 문서가 많고 정확도가 중요한 RAG 에서 붙는 자리입니다.\n  - ③ **다국어.** Command 49개 언어. 국내 기업 중 해외 법인·다국어 문서를 함께 다뤄야 하는 고객에게 의미가 있습니다.\n- **컴플라이언스**: GDPR · SOC 2 준수를 표방합니다. Trust Center 를 운영합니다.\n- **최근 동향**: 2026-07-30 Carahsoft 와 미국 공공부문 소버린 AI 공급 파트너십. AMD 와 소버린 배포용 인프라 협력.\n- **가격**: 공개 정보 없음.',

'2', E'- **Primary Layer: Q1. Enterprise General Build AI**\n  - 판단 근거: 자체 모델과 워크플레이스 플랫폼을 가진 범용 LLM 입니다. 고객이 전사 AI 기반으로 무엇을 쓸지 고르는 자리에 있습니다.\n- **Secondary Layer: Q4. AI Infrastructure**\n  - 판단 근거: VPC·온프레 배포 시 인프라 설계가 딜의 절반을 차지합니다.\n### 2.1 타 솔루션과의 아키텍처 정합성 (궁합)\n- **OpenAI Enterprise / Anthropic Claude 와의 관계**: **대체재입니다.** 같은 슬롯(범용 LLM 플랫폼)에서 하나를 고릅니다. 갈림길은 성능이 아니라 **데이터가 밖으로 나가도 되는가**입니다.\n- **Articul8 과의 관계**: 둘 다 폐쇄망을 말하지만 결이 다릅니다. Articul8 은 **제조 도메인 특화 모델 오케스트레이션**, Cohere 는 **다국어 검색·RAG 와 에이전트 플랫폼**입니다. 제조 현장 데이터가 중심이면 Articul8, 문서·지식 검색이 중심이면 Cohere 입니다.\n- **Vector DB 와의 관계**: 보완재입니다. Embed 로 임베딩을 만들고 벡터 저장소에 넣는 구성이 일반적입니다.\n- **AWS 와의 관계**: Cohere 모델은 Amazon Bedrock 에서 호출할 수 있습니다. AWS 기반 고객에게는 이 경로가 도입 문턱을 크게 낮춥니다 — **MZC 가 가장 잘 하는 자리**입니다.',

'3', E'### 3.1 산업 적합도\n- **○ 매우 적합**: 금융·보험, 공공, 헬스케어 — 데이터 반출이 규제로 막혀 있고 사내 문서 검색 수요가 큰 영역입니다. 벤더도 이 7개 산업(기술·금융·헬스케어·제조·에너지·공공·통신)을 전면에 둡니다.\n- **△ 보통**: 제조 — 가능하나 현장 데이터 중심이면 Articul8 이 더 맞습니다.\n- **✕ 부적합**: 데이터 반출에 제약이 없고 임직원 생산성만 목적인 조직 — SaaS LLM 이 더 싸고 빠릅니다.\n### 3.2 핵심 의사결정 페르소나\n- **CIO / CDO (의사결정자)**: "데이터가 어디에 머무는가" 가 첫 질문이자 사실상 유일한 질문인 고객입니다.\n- **정보보호·컴플라이언스 (게이트키퍼)**: 반출 불가 요건이 도입 근거 자체라 **우호적인 편**입니다. 다른 LLM 딜과 반대 구도입니다.\n- **인프라 운영 리더 (실행 주체)**: VPC·온프레 배포는 이 사람의 일이 됩니다. **여기서 막히면 딜이 멈춥니다.**\n- **현업 지식관리 담당**: 사내 문서 검색 품질이 실제 성과를 좌우합니다.',

'4', E'Cohere 도입 시 메가존클라우드가 설계하는 구조입니다. 배포 형태에 따라 셋으로 갈립니다.\n- **1) Bedrock 경유 (가장 가벼움)**: AWS 를 이미 쓰는 고객은 Amazon Bedrock 에서 Command·Embed 를 호출합니다. 별도 인프라 없이 리전·네트워크 통제를 고객이 유지합니다. **초기 검증은 대부분 이 경로가 맞습니다.**\n- **2) VPC 배포**: 고객 VPC 안에 모델을 올립니다. 인스턴스 타입·GPU 확보·오토스케일링 설계가 MZC 몫입니다.\n- **3) 온프레미스 / 에어갭**: 고객 데이터센터에 구축합니다. 하드웨어 산정, 모델 업데이트 경로, 운영 이관까지 범위가 커집니다. **딜 규모가 가장 크고 리드타임도 가장 깁니다.**\n- **4) 검색 파이프라인 (공통·MZC 핵심 영역)**: 사내 문서 수집·정제 → Embed 로 임베딩 → 벡터 저장소 적재 → 질의 시 Rerank 로 재순위. 정확도를 결정하는 구간이고 우리가 값을 만드는 자리입니다.\n\n**⚠ 미확인**: 국내 리전 제공 여부와 국내 구축 레퍼런스는 확인된 자료가 없습니다. 공공·금융 딜에서 먼저 물어보는 항목이므로 벤더 확인이 필요합니다.',

'5', E'- **UC1. 금융권 사내 규정·계약 문서 검색**\n  - 기대효과: 규정 해석에 걸리던 시간 단축, 데이터 반출 없이 RAG 구축\n  - MZC 역할: 문서 수집·정제 파이프라인, Embed·Rerank 튜닝, 벡터 저장소 설계, VPC 배포\n- **UC2. 공공기관 폐쇄망 지식 검색**\n  - 기대효과: 외부 반출 없이(zero data egress) 내부 문서 검색·요약\n  - MZC 역할: 온프레 구축, 하드웨어 산정, 모델 업데이트 경로 설계, 운영 이관\n- **UC3. 다국어 문서를 함께 다루는 글로벌 사업 조직**\n  - 기대효과: 한국어·영어·현지어 문서를 한 검색 인덱스에서 처리\n  - MZC 역할: 다국어 임베딩 품질 검증, 언어별 평가셋 구성, Bedrock 경유 구성',

'6', E'- **Cohere**\n  - 강점: VPC·온프레·에어갭까지 배포 선택지가 넓음, 검색·재순위 전용 모델 보유, 다국어 49개 언어(벤더 주장)\n  - 약점: 범용 대화 성능·생태계에서 OpenAI·Anthropic 에 밀림. 국내 레퍼런스와 한국어 품질에 대한 공개 근거 부족\n  - 적합도: 데이터 반출이 막혀 있으면서 문서 검색이 핵심인 고객\n- **OpenAI Enterprise**\n  - 강점: 임직원 친숙도와 생태계가 가장 큼, 도입이 가장 빠름\n  - 약점: 데이터가 벤더 클라우드로 나감. 완전 폐쇄망 불가\n  - 적합도: 반출 제약이 없고 전사 생산성이 목적인 고객\n- **Anthropic Claude**\n  - 강점: 긴 문서 추론과 안전성, Bedrock 경유로 리전 통제 가능\n  - 약점: 완전 에어갭은 불가\n  - 적합도: 리전 통제로 충분하고 긴 문서 해석이 중요한 고객\n- **Articul8**\n  - 강점: 제조 도메인 특화 모델 오케스트레이션, 에어갭 실적\n  - 약점: 범용 문서 검색·다국어는 범위 밖\n  - 적합도: 제조 현장 데이터가 중심인 폐쇄망 고객',

'7', E'### 7.1 필수 요건 (5가지)\n- [ ] AI 에 투입할 데이터 범위와 민감도 등급이 정해져 있는가? (검색 인덱스 대상이 정해져야 시작한다)\n- [ ] 배포 형태가 정해졌는가? (Bedrock 경유 / VPC / 온프레·에어갭)\n- [ ] VPC·온프레 선택 시 인프라를 확보하고 운영할 주체가 있는가?\n- [ ] 사용자 식별을 위한 SSO 인프라가 있는가?\n- [ ] 검색 정확도를 판정할 평가 기준과 평가셋을 만들 수 있는가?\n### 7.2 권장 요건 (5가지)\n- [ ] 사내 문서가 검색 가능한 형태로 정제되어 있는가? (PDF·스캔본 비중 확인)\n- [ ] 벡터 저장소 선택과 운영 계획이 있는가?\n- [ ] 다국어 문서 비중이 실제로 유의미한가? (Cohere 강점이 살아나는 조건)\n- [ ] AWS 를 이미 쓰고 있는가? (Bedrock 경유로 문턱이 크게 낮아진다)\n- [ ] 모델 업데이트·재학습 주기에 대한 합의가 있는가? (온프레는 특히)\n### 7.3 부적합 신호: Red Flag (5가지)\n- [ ] 1. 데이터 반출 제약이 없고 임직원 생산성만 목적 ➔ **OpenAI Enterprise·Claude 제안**\n- [ ] 2. 제조 현장 데이터 중심 폐쇄망 ➔ **Articul8 제안**\n- [ ] 3. 인프라를 운영할 조직이 없는데 온프레를 요구 ➔ **Bedrock 경유로 축소 또는 보류**\n- [ ] 4. 검색 대상 문서가 정제돼 있지 않고 정제 예산도 없음 ➔ **데이터 정비 선행(AIR Service)**\n- [ ] 5. 대화형 챗봇 UX 친숙도가 도입 기준 ➔ **ChatGPT 계열 제안**\n### 7.4 벤더 확인 필요 (공개 자료에 없음)\n- [ ] **국내 리전 제공 여부** — 금융·공공에서 가장 먼저 막히는 항목\n- [ ] 국내 구축 레퍼런스와 한국어 품질 근거\n- [ ] 가격 체계 (공개 정보 없음)\n- [ ] 온프레·에어갭 배포의 최소 하드웨어 요건\n- [ ] Bedrock 에서 쓸 수 있는 모델 목록과 리전',

'8', E'### 8.1 세일즈 핏치 및 영업 팁\n- **어디서 이기나**: 성능 비교로는 못 이깁니다. **"이 데이터를 밖으로 내보낼 수 있습니까?"** 하나로 판이 갈립니다. 답이 "아니오" 인 순간 OpenAI·Claude 가 후보에서 빠지고 Cohere 와 Articul8 만 남습니다.\n- **첫 질문**: "지금 검토 중인 문서가 외부 클라우드로 나가도 되는 자료입니까?" — 이 질문 하나로 딜 성격이 정해집니다.\n- **Articul8 과의 갈림길**: 제조 현장 데이터면 Articul8, 문서·지식 검색이면 Cohere 입니다. 둘을 같이 제안하지 마십시오. 고객이 혼란스러워하고 둘 다 놓칩니다.\n- **진입 경로는 Bedrock**: 온프레부터 제안하면 인프라 논의에 빠져 몇 달이 갑니다. **AWS 고객에게는 Bedrock 경유로 먼저 검증**하고, 반출 제약이 확인되면 VPC·온프레로 확장하는 순서가 빠릅니다.\n- **정보보호 담당이 우군입니다**: 다른 LLM 딜에서는 게이트키퍼지만 여기서는 도입 근거를 만들어 주는 사람입니다. 먼저 만나십시오.\n- **주의**: 49개 언어·zero data egress 는 벤더 주장입니다. **국내 리전과 한국어 품질은 확인된 자료가 없습니다.** PoC 없이 약속하지 마십시오.\n- **SI 번들 마진 전략**: 모델 라이선스만으로는 얇습니다. 값은 검색 파이프라인(문서 정제 → Embed → 벡터 저장소 → Rerank)에서 나옵니다. 03 AIR Service 로 묶어야 딜이 커지고, 온프레 배포면 인프라 구축까지 범위가 붙습니다.\n\n[의견] 이 제품을 "더 싼 OpenAI" 로 팔면 진다. 배포 제약이 없는 고객에게는 객관적으로 OpenAI 가 낫다. **반출 불가라는 조건이 확인된 딜에만** 들고 가야 승률이 산다.'
)
where slug = 'cohere';

-- ── 판정 데이터 ─────────────────────────────────────────────────
-- 덮는 것: 사내 지식 검색(Embed·Rerank·Compass)과 업무 연동(North 에이전트).
--   데이터 분류 기준은 "덮는" 것이 아니라 "전제" 다 — 무엇을 인덱싱할지 고객이
--   정해 줘야 시작한다. 그래서 coverage 가 아니라 prerequisites 에 넣었다.
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["지식 소스 품질"],"strength":3},
    {"category":"B","items":["업무 시스템 연동성"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"데이터 분류와 민감도 기준","min":3,"blocking":true,
     "label":"검색 인덱스에 넣을 데이터 범위와 민감도 등급 확정"},
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"사용자 식별을 위한 SSO 인프라"},
    {"kind":"fqa","category":"B","item":"개발·테스트 환경","min":3,"blocking":false,
     "label":"VPC·온프레 배포 시 검증 환경 (Bedrock 경유면 불필요)"},
    {"kind":"manual","label":"배포 형태 확정 — Bedrock 경유 / VPC / 온프레·에어갭","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"데이터 반출 제약이 없고 임직원 생산성만 목적",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"},
                     {"slug":"anthropic-claude","label":"Anthropic Claude"}]},
    {"signal":"제조 현장 데이터 중심 폐쇄망",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"인프라를 운영할 조직이 없는데 온프레미스를 요구",
     "alternatives":[{"label":"Bedrock 경유로 범위 축소"}]}
  ]'::jsonb,
  bundle_potential = 3, grade = 2, scale = 'L',
  updated_at = now()
  where slug = 'cohere';

commit;

-- 확인
--   select slug, name, slot, layer, delivery, synergy,
--          jsonb_array_length(fqa_coverage) as 커버리지,
--          jsonb_array_length(prerequisites) as 전제,
--          jsonb_array_length(red_flags) as 레드플래그
--     from solutions where slug = 'cohere';
--
--   -- llm-platform 슬롯 경쟁 현황 (하나만 추천된다)
--   select slug, name, grade from solutions
--    where slot = 'llm-platform' and is_archived = false order by grade desc nulls last;
