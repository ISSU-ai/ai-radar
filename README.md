# ISSU AI Radar + Enablement Hub

외부 고객용 Offering 포탈과 내부 영업용 Deal Hub·AI Radar·관리자 기능을 하나의 Supabase 데이터 흐름으로 연결한 Node.js 애플리케이션입니다.

## 제품 흐름

1. 외부 고객은 공개 Offering에서 AI 준비도 진단과 상담 신청을 제출합니다.
2. 제출 데이터는 문항별 점수·영역 집계·추천 트랙과 함께 신규 딜로 저장됩니다.
3. 승인된 내부 사용자는 로그인 후 Deal Hub를 업무 시작 화면으로 사용합니다.
4. AI Radar는 Hub의 참조자료 메뉴에서 사용하는 내부 영업지원용 솔루션 카탈로그입니다.
5. 관리자는 승인된 관리자 계정으로 서비스·사용자·운영 상태를 관리합니다.

## 로컬 실행

1. `.env.example`을 `.env`로 복사합니다.
2. `SUPABASE_ANON_KEY`, `DATABASE_URL`, 32자 이상의 새 `JWT_SECRET`을 로컬 환경에만 입력합니다.
3. Supabase SQL Editor에서 아래 순서로 실행합니다.
   - `issu_ai_radar_schema.sql`
   - `issu_ai_radar_seed.sql`
   - `db/migrations/001_enablement_hub.sql`
   - `db/migrations/002_release_hardening.sql`
4. `npm install` 후 `npm run dev`를 실행합니다.

화면 진입점:

- 외부 Offering 메인: `/`
- 내부 딜 허브: `/hub`
- 내부 AI Radar: `/radar`
- 관리자: `/admin`
- 외부 Offering 별칭: `/offering`

`APP_SURFACE=all`인 로컬 개발에서도 `/`는 외부 Offering을 표시합니다. 내부 업무는 `/login`에서 로그인한 뒤 `/hub`로 시작합니다.

## 배포 표면 분리

`APP_SURFACE`로 배포별 노출 범위를 고정합니다.

- `offering`: 공개 진단·리드 API와 외부 Offering만 노출
- `hub`: 로그인·딜 허브·내부 AI Radar만 노출하며 `/`는 Hub를 표시
- `admin`: 로그인·관리자 기능만 노출
- `all`: 로컬 개발용

서브도메인별 배포에서는 `offering`, `hub`, `admin` 중 하나를 반드시 지정하세요. Supabase 허용 URL과 리버스 프록시/사내망 정책도 각 서브도메인에 맞게 설정해야 합니다.

## 보안 체크리스트

- 공개 저장소의 기존 `main`과 Git 이력에 `.env`와 `radar.db`가 포함된 적이 있습니다. 기본 브랜치에서 삭제하는 것만으로 폐기되지 않으므로, 조직 관리자가 모든 공개 ref의 이력을 정리하고 DB 비밀번호·JWT secret·영향받은 사용자 자격 증명을 재발급한 뒤에만 프로덕션을 공개합니다.
- `.env`와 모든 파생 비밀 파일은 Git에 커밋하지 않습니다.
- 외부 포탈은 `solutions`, `deals`, 포컬, 급, 공수 데이터를 조회하지 않습니다.
- 딜 수정은 담당자 또는 관리자만 가능하며, 미배정 딜은 명시적으로 `담당하기`를 실행합니다.
- Slack 알림은 `SLACK_WEBHOOK_URL`이 설정된 경우에만 전송됩니다.

## 검증

```sh
npm test
npm run check
```

`db/migrations/001_enablement_hub.sql`의 FQA 21항목은 현재 기획 기준의 초기 베이스라인입니다. 운영 적용 전 승인된 FQA 원본 시트와 문구·가중치·임계값을 대조하세요. `002_release_hardening.sql`은 브라우저 역할의 PostgREST 직접 접근을 철회하므로 애플리케이션 API 배포와 함께 적용해야 합니다.
