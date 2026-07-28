-- 추천 판정 데이터 시드 — 상세 작성된 9종.
-- Run after 011_slot_taxonomy_and_layer_fixes.sql. Apply in the Supabase SQL Editor (dfbx).
--
-- ⚠ 이 파일의 값은 sections §3.1 / §7.1 / §7.3 에서 뽑은 **초안**이다.
--   원문은 PreSales 가 작성한 산문이고, 여기 구조화한 것은 그 해석이다.
--   ISSU(ISV 담당부서)가 /admin 에서 검토·수정하는 것을 전제로 한다.
--   on conflict 없이 직접 update 하므로, ISSU 가 수정한 뒤 이 파일을 재실행하면 덮어쓴다.
--   1회성 시드로만 쓸 것 (apply-migrations.js 에서 제외).
--
-- 대상 9종만 넣는다. 나머지 13종은 sections 가 템플릿 껍데기(7종은 {name} 미치환)이거나
-- 아예 비어 있어(Trust Layer 4종) 뽑을 근거가 없다. 콘텐츠 보강 후 별도 시드한다.
--
-- FQA 카테고리
--   A 보안·거버넌스(6) : 데이터 분류와 민감도 기준 / 접근권한과 계정 체계 / 보안 게이트웨이 준비도
--                        / 감사 로그와 추적성 / 규제·컴플라이언스 검토 / 데이터 보존·삭제 정책
--   B 기술·연동(5)     : 업무 시스템 연동성 / 지식 소스 품질 / 개발·테스트 환경 / 확장성·성능 기준 / 모델·벤더 전환성
--   C 운영(5)          : 운영 책임자 지정 / 품질 평가 체계 / 장애 대응 체계 / 비용 모니터링 / 변경·배포 관리
--   D 비즈니스(5)      : 명확한 업무 문제 / 성과 KPI / 현업 오너십 / 변화관리·교육 / 예산·구매 준비도

begin;

-- ── OpenAI Enterprise ────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"D","items":["명확한 업무 문제"],"strength":2},
    {"category":"B","items":["지식 소스 품질"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"seats","min":150,"blocking":true,
     "label":"최소 도입 인원 150명 (ChatGPT Enterprise 기준)"},
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"SSO(Okta/Azure AD) 인프라"},
    {"kind":"fqa","category":"D","item":"현업 오너십","min":3,"blocking":false,
     "label":"AI 도입 총괄 챔피언 지정"},
    {"kind":"manual","label":"사내 데이터의 OpenAI 클라우드 전송에 법무·보안 승인","blocking":true},
    {"kind":"manual","label":"글로벌 DPA 표준안 수용 가능","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"외부 인터넷 100% 차단 에어갭 환경",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"의료 규정상 해외 서버 전송 절대 불가",
     "alternatives":[{"label":"Azure OpenAI 국내 리전"}]},
    {"signal":"50명 이하 소규모인데 Enterprise 등급 요구",
     "alternatives":[{"label":"ChatGPT Team"}]},
    {"signal":"연간 AI 예산 3천만원 이하 · 연동 개발비 없음",
     "alternatives":[{"label":"단순 SaaS 라이선스 구매"}]},
    {"signal":"사내 IdP(SSO) 없고 도입 계획도 없음",
     "alternatives":[{"label":"도입 보류 또는 정책 컨설팅 선행"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'openai-enterprise';

-- ── Articul8 ─────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"A","items":["데이터 분류와 민감도 기준","보안 게이트웨이 준비도"],"strength":3},
    {"category":"B","items":["지식 소스 품질"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"annual_budget_krw","min":100000000,"blocking":true,
     "label":"연간 예산 1억원 이상 (GPU 서버 구축비 포함)"},
    {"kind":"fqa","category":"D","item":"예산·구매 준비도","min":3,"blocking":true,
     "label":"GPU 서버 인프라(L40S/H100) 예산 확보"},
    {"kind":"fqa","category":"C","item":"운영 책임자 지정","min":3,"blocking":true,
     "label":"Kubernetes 관리 인프라 엔지니어"},
    {"kind":"manual","label":"도메인 학습용 사내 기밀 텍스트 데이터셋 최소 수만 건","blocking":true},
    {"kind":"manual","label":"외부망 차단 상태에서 보안 인증 라이선스 갱신 방안","blocking":true},
    {"kind":"manual","label":"MZC 프라이빗 인프라 SI 구축 계약 의사","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"연간 예산 1억원 미만 · GPU 서버 구축비 지출 불가",
     "alternatives":[{"label":"퍼블릭 Cloud RAG"}]},
    {"signal":"10명 이하 부서에서 경량 문서 작성·검색만 요구",
     "alternatives":[{"slug":"openai-enterprise","label":"퍼블릭 ChatGPT"}]},
    {"signal":"사내 문서 보안 등급 관리가 미비해 전 직원 노출 위험",
     "alternatives":[{"label":"보안 등급·권한 정리 선행"}]},
    {"signal":"온프레미스 실사·물리 서버 접속 일절 불허",
     "alternatives":[{"label":"도입 보류"}]},
    {"signal":"도메인 데이터가 전부 스캔 이미지·파편화 포맷",
     "alternatives":[{"label":"데이터 가공 프로젝트 선행"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'articul8';

-- ── Anthropic Claude ─────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"A","items":["규제·컴플라이언스 검토"],"strength":2},
    {"category":"B","items":["지식 소스 품질"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"AWS IAM 보안 정책 관리 엔지니어"},
    {"kind":"fqa","category":"A","item":"규제·컴플라이언스 검토","min":2,"blocking":true,
     "label":"입력 데이터 컴플라이언스 가이드라인 수립"},
    {"kind":"manual","label":"AWS Bedrock 활성화 가능한 엔터프라이즈 계정","blocking":true},
    {"kind":"manual","label":"RAG용 임베딩 모델 활성화 완료","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"퍼블릭 클라우드 인프라 활용 전면 금지 보안망",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"이미지·영상 생성이 주목적",
     "alternatives":[{"label":"OpenAI DALL·E 또는 Midjourney"}]},
    {"signal":"개발 리소스 전무 · 노코드 완제품 앱스토어만 요구",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"}]},
    {"signal":"최소 약정 거부 · 최저 TCO 만 요구",
     "alternatives":[{"label":"Gemini API 검토"}]},
    {"signal":"사내 문서가 전부 종이·스캔 이미지",
     "alternatives":[{"label":"OCR 구축 선행 컨설팅"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'anthropic-claude';

-- ── Twelve Labs ──────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["지식 소스 품질"],"strength":3},
    {"category":"D","items":["명확한 업무 문제"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"annual_budget_krw","min":10000000,"blocking":true,
     "label":"연간 예산 1천만원 이상"},
    {"kind":"fqa","category":"B","item":"개발·테스트 환경","min":3,"blocking":true,
     "label":"API 결과를 화면에 연동할 프론트엔드 개발 리소스"},
    {"kind":"manual","label":"동영상이 디지털 포맷(MP4/AVI)으로 스토리지에 확보","blocking":true},
    {"kind":"manual","label":"동영상 데이터의 외부 API 전송에 법무·보안 승인","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"비디오 데이터의 외부 퍼블릭 클라우드 반출 전면 불가",
     "alternatives":[{"label":"온프레미스 GPU 구축형 SI"}]},
    {"signal":"동영상 없이 콜센터 녹음(오디오)만 분석",
     "alternatives":[{"slug":"eleven-labs","label":"Eleven Labs"}]},
    {"signal":"연 예산 1천만원 미만 · 사내 동영상 10개 미만",
     "alternatives":[{"label":"도입 비추천 (Gemini 무료 테스트)"}]},
    {"signal":"카메라 화질 240p 수준으로 형체 식별 불가",
     "alternatives":[{"label":"카메라 하드웨어 업그레이드 선행"}]},
    {"signal":"사내 개발팀 부재 · 커스텀 화면 개발비 불가",
     "alternatives":[{"label":"MZC 자체 UI 패키지 동반 구축"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'twelve-labs';

-- ── Eleven Labs ──────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"D","items":["명확한 업무 문제"],"strength":2},
    {"category":"B","items":["업무 시스템 연동성"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"B","item":"개발·테스트 환경","min":3,"blocking":true,
     "label":"API 연동 백엔드 개발·서버 구축 리소스"},
    {"kind":"fqa","category":"D","item":"예산·구매 준비도","min":3,"blocking":true,
     "label":"연간 음성 합성 통화량에 맞는 정기 구독 예산"},
    {"kind":"manual","label":"상담 시나리오·지식베이스(Text) 구축 완료","blocking":true},
    {"kind":"manual","label":"AICC 연동을 위한 SIP 또는 WebRTC 표준 지원","blocking":true},
    {"kind":"manual","label":"목소리 복제 대상 화자의 사용·학습 동의서 확보","blocking":true}
  ]'::jsonb,
  red_flags = '[
    {"signal":"동의 없는 유명인 목소리 복제·상업 배포 의도",
     "alternatives":[{"label":"원천 도입 거절 (라이선스 위반)"}]},
    {"signal":"인터넷 연결 불허 폐쇄망 콜센터 환경",
     "alternatives":[{"label":"온프레미스 TTS 솔루션"}]},
    {"signal":"텍스트 상담만 필요하고 음성 불필요",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"}]},
    {"signal":"음성 지연 0.1초 이하 실시간 중계 요건",
     "alternatives":[{"label":"지연 시간 한계로 부적합"}]},
    {"signal":"사내 지식 데이터 부재로 환각 위험 큼",
     "alternatives":[{"label":"지식베이스 RAG 구축 프로젝트 선행"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'eleven-labs';

-- ── Replit ───────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["개발·테스트 환경"],"strength":3}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"manual","label":"사내 소스코드의 외부 SaaS 저장·실행에 법무·보안 제약 없음","blocking":true},
    {"kind":"manual","label":"Replit Agent 가 사내 API·DB 에 접근할 퍼블릭/하이브리드 엔드포인트","blocking":true},
    {"kind":"manual","label":"동시 편집·Git 버전관리 연계 워크플로우 준비","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"100% 온프레미스 에어갭 내에서만 코드 작성·저장 가능",
     "alternatives":[{"slug":"articul8","label":"Articul8 기반 프라이빗 인프라"}]},
    {"signal":"하드웨어 리소스(GPU 분산 학습)를 직접 통제하며 딥러닝 코드 작성",
     "alternatives":[{"slug":"dataiku","label":"Dataiku"},{"slug":"datarobot","label":"DataRobot"}]}
  ]'::jsonb,
  bundle_potential = 2
where slug = 'replit';

-- ── Dataiku ──────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"C","items":["품질 평가 체계","변경·배포 관리"],"strength":2},
    {"category":"B","items":["지식 소스 품질","개발·테스트 환경"],"strength":2},
    {"category":"D","items":["현업 오너십"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"annual_budget_krw","min":50000000,"blocking":true,
     "label":"연간 AI·데이터 도구 예산 5천만원 초과"},
    {"kind":"fqa","category":"B","item":"지식 소스 품질","min":3,"blocking":true,
     "label":"학습에 연결할 사내 정형 데이터(DB/DW) 준비"},
    {"kind":"fqa","category":"C","item":"운영 책임자 지정","min":3,"blocking":true,
     "label":"플랫폼을 리드할 데이터 분석가·기획자 3명 이상"},
    {"kind":"fqa","category":"D","item":"예산·구매 준비도","min":3,"blocking":true,
     "label":"설치용 클라우드 VM 인프라 예산·DW 크레딧"},
    {"kind":"manual","label":"데이터 소스 연결을 위한 네트워크·클라우드 권한 승인","blocking":true},
    {"kind":"manual","label":"가드레일을 씌울 외부 LLM 라이선스 보유","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"분석할 정형 데이터가 전무하고 텍스트 RAG 챗봇만 요구",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"},{"label":"MZC AIR Platform"}]},
    {"signal":"연간 AI·데이터 예산 5천만원 이하 소기업",
     "alternatives":[{"label":"도입 보류 (오픈소스 Python 도구)"}]},
    {"signal":"데이터 연동 API 포트 오픈을 보안 규정상 전면 불허",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"결측치 90% 이상으로 예측 모델 학습 불가",
     "alternatives":[{"label":"데이터 가공 프로젝트 선행"}]},
    {"signal":"데이터 담당자 전무 · 100% 외주 영구 운영 대행 요구",
     "alternatives":[{"label":"도입 비추천"}]}
  ]'::jsonb,
  bundle_potential = 3
where slug = 'dataiku';

-- ── LiteLLM ──────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"C","items":["비용 모니터링"],"strength":3},
    {"category":"B","items":["모델·벤더 전환성"],"strength":3},
    {"category":"A","items":["접근권한과 계정 체계","데이터 분류와 민감도 기준"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"numeric","field":"seats","min":10,"blocking":false,
     "label":"AI 사용 직원 10명 이상 (미만이면 실익 없음)"},
    {"kind":"fqa","category":"A","item":"접근권한과 계정 체계","min":3,"blocking":true,
     "label":"API 호출 권한을 통제할 IT 전산 관리자"},
    {"kind":"fqa","category":"D","item":"예산·구매 준비도","min":2,"blocking":true,
     "label":"프록시 서버 호스팅 클라우드 VM 예산"},
    {"kind":"manual","label":"연동 조율할 LLM 모델 API 2개 이상 존재","blocking":true},
    {"kind":"manual","label":"사내 AI 개발 표준을 OpenAI SDK 규격으로 통일할 의지","blocking":true},
    {"kind":"manual","label":"MZC AI 인프라·비용 통제 컨설팅 파트너십 동의","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"LLM 이 하나뿐이고 확대 계획 없음 · 사용 직원 10명 미만",
     "alternatives":[{"label":"도입 비추천 (원천 불필요)"}]},
    {"signal":"프록시 서버 설치 거부 · 노코드 완제품만 요구",
     "alternatives":[{"slug":"openai-enterprise","label":"OpenAI Enterprise"},{"label":"MZC AIR Platform"}]},
    {"signal":"외부 인터넷 AI 호출 전면 금지 국방·망분리 환경",
     "alternatives":[{"slug":"articul8","label":"Articul8"}]},
    {"signal":"프록시 경유 1ms 지연조차 허용 불가한 초고속 연산",
     "alternatives":[{"label":"다이렉트 API 호출"}]},
    {"signal":"개발진이 표준 API 규격 사용을 거부",
     "alternatives":[{"label":"개발 거버넌스 선행"}]}
  ]'::jsonb,
  bundle_potential = 2
where slug = 'litellm';

-- ── Anaconda ─────────────────────────────────────────────────────
update solutions set
  fqa_coverage = '[
    {"category":"B","items":["개발·테스트 환경"],"strength":3},
    {"category":"A","items":["데이터 분류와 민감도 기준"],"strength":2}
  ]'::jsonb,
  prerequisites = '[
    {"kind":"fqa","category":"C","item":"운영 책임자 지정","min":3,"blocking":true,
     "label":"패키지·레포지토리 정책을 관리할 시스템 관리자 지정"},
    {"kind":"manual","label":"사내 Python/R 사용량과 패키지 다운로드 규모가 상당","blocking":true},
    {"kind":"manual","label":"망분리 규정이 있어 외부 패키지 직접 호출을 통제해야 함","blocking":false}
  ]'::jsonb,
  red_flags = '[
    {"signal":"단독 AI 에이전트·LLM 빌드만 요구하고 거버넌스 니즈 없음",
     "alternatives":[{"slug":"dataiku","label":"Dataiku"}]},
    {"signal":"Python 기반 분석·ML 을 하지 않고 순수 Java/C# 레거시만 보유",
     "alternatives":[{"label":"도입 비추천"}]}
  ]'::jsonb,
  bundle_potential = 2
where slug = 'anaconda';

commit;

-- ── 검증 ─────────────────────────────────────────────────────────
-- 1) 판정 데이터가 들어간 솔루션 (9건이어야 한다)
select slug, name, slot,
       jsonb_array_length(fqa_coverage)  as coverage,
       jsonb_array_length(prerequisites) as prereqs,
       jsonb_array_length(red_flags)     as flags,
       bundle_potential
  from solutions
 where is_archived = false and jsonb_array_length(fqa_coverage) > 0
 order by name;

-- 2) 아직 비어 있는 솔루션 = 콘텐츠 보강 대상 (13건이어야 한다)
select slug, name, slot from solutions
 where is_archived = false and jsonb_array_length(fqa_coverage) = 0
 order by name;

-- 3) red_flags 가 가리키는 slug 가 실재하는지 (0건이어야 한다)
select s.slug as from_slug, alt->>'slug' as missing_target
  from solutions s,
       jsonb_array_elements(s.red_flags) rf,
       jsonb_array_elements(rf->'alternatives') alt
 where alt->>'slug' is not null
   and not exists (select 1 from solutions t where t.slug = alt->>'slug');
