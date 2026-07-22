# ISSU AI Radar + Enablement Hub

기존 AI Radar 솔루션 카탈로그에 딜 파이프라인, 외부 진단 포탈, 관리자 운영 필드를 추가한 Node.js/Supabase 애플리케이션입니다.

## 로컬 실행

1. `.env.example`을 `.env`로 복사합니다.
2. `SUPABASE_ANON_KEY`, `DATABASE_URL`, 32자 이상의 새 `JWT_SECRET`을 로컬 환경에만 입력합니다.
3. Supabase SQL Editor에서 아래 순서로 실행합니다.
   - `issu_ai_radar_schema.sql`
   - `issu_ai_radar_seed.sql`
   - `db/migrations/001_enablement_hub.sql`
4. `npm install` 후 `npm run dev`를 실행합니다.

화면 진입점:

- 내부 딜 허브: `/hub`
- AI Radar 카탈로그: `/`
- 관리자: `/admin`
- 외부 오퍼링: `/offering`

## 배포 표면 분리

`APP_SURFACE`로 배포별 노출 범위를 고정합니다.

- `offering`: 공개 진단·리드 API와 외부 포탈만 노출
- `hub`: 로그인·딜 허브·내부 카탈로그만 노출
- `admin`: 로그인·관리자 기능만 노출
- `all`: 로컬 개발용

서브도메인별 배포에서는 `offering`, `hub`, `admin` 중 하나를 반드시 지정하세요. Supabase 허용 URL과 리버스 프록시/사내망 정책도 각 서브도메인에 맞게 설정해야 합니다.

## 보안 체크리스트

- 이 저장소의 과거 커밋에 `.env`가 포함됐습니다. 삭제만으로 폐기되지 않으므로 Supabase 키, DB 비밀번호, JWT secret을 모두 재발급해야 합니다.
- `.env`와 모든 파생 비밀 파일은 Git에 커밋하지 않습니다.
- 외부 포탈은 `solutions`, `deals`, 포컬, 급, 공수 데이터를 조회하지 않습니다.
- 딜 수정은 담당자 또는 관리자만 가능하며, 미배정 딜은 명시적으로 `담당하기`를 실행합니다.
- Slack 알림은 `SLACK_WEBHOOK_URL`이 설정된 경우에만 전송됩니다.

## 검증

```sh
npm test
npm run check
```

`db/migrations/001_enablement_hub.sql`의 FQA 21항목은 현재 기획 기준의 초기 베이스라인입니다. 운영 적용 전 승인된 FQA 원본 시트와 문구·가중치·임계값을 대조하세요.
