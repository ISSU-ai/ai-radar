# Render 배포 가이드

이 저장소는 외부 오퍼링, 내부 딜 허브, 관리자 화면을 서로 다른 Render Web Service로 배포합니다. 세 서비스는 하나의 PostgreSQL/Supabase 원본을 공유하지만, `APP_SURFACE`로 각 서비스의 화면과 API 노출 범위를 제한합니다.

운영 사용자 흐름은 `외부 Offering → 준비도 진단·상담 제출 → 신규 딜 생성 → 내부 로그인 → Deal Hub → AI Radar 참조 → Admin 운영`입니다. AI Radar는 공개 랜딩이 아니라 승인된 내부 영업 사용자의 참조 도구이며, 내부 업무 시작 화면은 Deal Hub입니다.

`render.yaml`은 배포 정의일 뿐이며, 파일을 커밋하는 것만으로 Render 서비스가 생성되지는 않습니다. 최초 1회 Render Dashboard에서 이 저장소의 Blueprint를 연결해야 합니다.

## 배포 흐름

1. 기능 브랜치에서 Pull Request를 생성합니다.
2. GitHub Actions의 `Verify Node application` 검사를 통과시킵니다.
3. 리뷰 후 `main`에 병합합니다.
4. Render가 `main`의 GitHub 검사가 통과한 커밋만 자동 배포합니다.
5. 세 서비스의 `/healthz`와 핵심 동선을 점검한 뒤 커스텀 도메인 트래픽을 전환합니다.

Render 빌드에서도 `npm ci`, 구문 검사, 테스트를 다시 실행합니다. GitHub Actions와 Render 런타임은 Node.js `24.14.1`로 맞추고, 시작 명령은 `npm start`를 사용합니다.

## 리전과 비용 확인

현재 Supabase DB 호스트가 서울(`ap-northeast-2`) 리전이므로 Render 서비스는 지원 리전 중 가까운 `singapore`로 정의했습니다. Render 서비스 리전은 생성 후 변경할 수 없으므로 Blueprint 적용 전에 운영 DB 리전을 다시 확인합니다.

`plan`은 명시하지 않았습니다. 기존 Render 서비스에 연결하면 현재 플랜을 유지하지만, 새 서비스는 Render의 기본 유료 플랜으로 생성될 수 있습니다. Blueprint 적용 화면에서 세 서비스의 예상 월 비용을 확인하고 승인한 뒤 생성합니다. 무료 스테이징으로 시작하려면 `plan: free`의 슬립·성능 제한을 검토한 후 명시적으로 변경합니다.

## 최초 배포 준비

### 0. 공개 저장소 보안 사고 정리

기존 공개 `main`에 `.env`와 `radar.db`가 추적된 상태가 확인됐습니다. PR에서 파일을 삭제해도 이전 커밋, 캐시, fork에서는 계속 조회될 수 있습니다. 프로덕션 배포 전에 저장소 조직 관리자가 아래 조치를 완료해야 합니다.

1. `.env`와 `radar.db`를 모든 공개 ref와 Git 이력에서 제거하고 관련 fork·캐시를 점검합니다.
2. 노출된 DB 비밀번호와 JWT secret을 폐기하고 새 값으로 교체합니다.
3. `radar.db`에 포함됐던 사용자 자격 증명을 무효화하고 비밀번호 재설정을 안내합니다.
4. `git log --all -- .env radar.db`와 GitHub의 과거 raw URL에서 더는 파일을 가져올 수 없는지 확인합니다.
5. 위 조치가 끝난 뒤에만 Render 비밀값을 입력하고 서비스를 생성합니다.

### 1. 운영 비밀값 설정

Blueprint 생성 화면에서 각 서비스의 아래 값을 입력합니다. 세 서비스가 같은 DB와 로그인을 공유하도록 동일한 운영 값을 사용합니다.

- `DATABASE_URL`: Supabase PostgreSQL 연결 문자열
- `SUPABASE_URL`: Supabase 프로젝트 URL
- `SUPABASE_ANON_KEY`: 현재 프로젝트의 anon key
- `JWT_SECRET`: 32자 이상의 새 임의 문자열

이 값들은 각 서비스에 `sync: false`로 선언되어 Git에 저장되지 않습니다. Render는 Blueprint를 처음 생성할 때만 이 값을 요청하므로 빠뜨리지 않아야 합니다. Slack 알림을 사용할 서비스에는 Render Dashboard에서 `SLACK_WEBHOOK_URL`을 별도로 Secret으로 추가합니다.

과거 Git 이력에 포함됐던 DB 비밀번호, Supabase 키, JWT secret은 폐기하고 재발급한 값만 사용합니다.

### 2. 데이터베이스 준비

첫 운영 배포 전에 승인된 마이그레이션을 Supabase SQL Editor에서 순서대로 적용합니다. `render.yaml`은 스키마를 자동 변경하지 않습니다. 자동 실행으로 인한 운영 데이터 손상을 피하기 위한 의도적인 설정입니다.

마이그레이션은 애플리케이션 배포와 역호환되게 설계하고, 적용 결과와 anon/authenticated 권한을 별도로 검증합니다. Render의 애플리케이션 롤백은 DB 스키마를 되돌리지 않습니다.

### 3. Render Blueprint 연결

1. Render Dashboard에서 **New > Blueprint**를 선택합니다.
2. GitHub의 `ISSU-ai/ai-radar` 저장소를 연결하고 `render.yaml`을 선택합니다.
3. 아래 세 서비스가 생성되는지 확인합니다.
   - `issu-ai-radar-offering` (`APP_SURFACE=offering`)
   - `issu-ai-radar-hub` (`APP_SURFACE=hub`)
   - `issu-ai-radar-admin` (`APP_SURFACE=admin`)
4. 각 서비스가 `main` 브랜치와 `After CI Checks Pass` 정책을 사용하는지 확인합니다.
5. 커스텀 도메인을 연결하기 전 Render 기본 URL로 스모크 테스트합니다.

내부 허브와 관리자 서비스는 인증만으로 공개 범위를 결정하지 않습니다. 사내 VPN, 허용 IP 프록시 또는 동등한 네트워크 접근 제한을 먼저 구성한 뒤 커스텀 도메인을 공개합니다.

### 4. 도메인 및 외부 연동

- 외부 오퍼링: `offering.<도메인>`
- 내부 딜 허브: `hub.<도메인>`
- 관리자: `admin.<도메인>`

각 도메인을 Supabase의 허용 URL/CORS 및 Redirect 목록에 등록합니다. DNS와 TLS가 정상화되기 전에는 기존 트래픽을 전환하지 않습니다.

## 공개 전 검증

모든 서비스에서 `GET /healthz`가 `200`을 반환해야 합니다. 이어서 아래 항목을 확인합니다.

- 오퍼링: 진단 문항 조회, A-D 단계 이동, 상담 제출, 신규 딜 생성
- 허브: 로그인, 딜 목록, 딜 전환, PoC 점수 저장, AI Radar 왕복 이동
- 관리자: 관리자 로그인, 서비스 조회/수정, 권한 없는 계정의 접근 거부
- 격리: 오퍼링 URL에서 허브·관리자·카탈로그 API가 `404`인지 확인
- 정적 파일: `/server.js`, `/package.json`, `/radar.db`, `/db/`가 `404`인지 확인
- 데이터: 제출된 회사명·연락처·상담 내용·문항별 점수·영역 집계·추천 트랙이 같은 딜에 연결되는지 확인
- 로그: 비밀값, 비밀번호, 연락처, 상담 본문이 Render 로그에 출력되지 않는지 확인

검증이 끝나기 전에는 외부 DNS를 연결하지 않습니다. 문제가 있으면 Render에서 직전 정상 배포로 롤백하고, DB 변경이 있었다면 별도의 역호환 복구 절차를 적용합니다.
