---
name: issu-build
description: ISV BU AI Radar 를 구현할 때. 작업 순서, 절대 규칙, 마이그레이션·개인정보·화면·문서·검사 규약과 이 프로젝트에서 실제로 데인 것들. 표·컬럼을 만들거나 화면·라우트·산출물을 고칠 때 읽는다.
---

# 구현

승인된 기획을 코드로 옮길 때 읽는다. 기획 자체는 `issu-plan`.

## 순서

```
① 마이그레이션        db/migrations/NNN_*.sql
② lib/ 순수 함수      규칙은 여기. 서버·목업·검사가 같이 쓴다
③ routes/ · server.js  hasColumn 으로 가린다
④ 화면               hub.js · *.html · *.css
⑤ 목업 동기화        scripts/mock-ui-server.js
⑥ 검사               test/*.test.js
⑦ 로컬 종단 확인      npm run mock
⑧ npm test && npm run check
⑨ 커밋
```

**⑤를 건너뛰지 않는다.** 목업이 실서버와 어긋나면 ⑦이 **거짓말을 한다** — 이 프로젝트에서
여섯 번 데였다. 화면을 고쳤으면 목업도 고쳤는지 확인하고 넘어간다.

## 절대 규칙

- **모르면 판정하지 않는다** — 빈칸을 기본값·평균·추정으로 채우지 않는다
- **새 컬럼을 읽는 코드는 `hasColumn` 으로 가린다** — 마이그레이션이 수동이라 코드가
  먼저 배포된다. 안 가리면 프로덕션에서만 500 이다
- **목업은 시드를 베끼지 않고 마이그레이션 SQL 을 직접 판다**
- **고객 문서는 내부 필드를 안 부른다** — 읽고 지우는 게 아니다
- **개인정보는 `leads`**, 수집 항목이 늘면 고지·버전·검사를 같이 고친다
- **커밋 전에 `npm test` 와 `npm run check`**

## 무엇을 할 때 무엇을 여나

| | |
|---|---|
| 표·컬럼을 만든다 | `references/migrations.md` |
| 개인정보·동의를 건드린다 | `references/privacy.md` |
| 화면·목업·공개 경로 | `references/frontend.md` |
| 고객용/내부용 산출물 | `references/documents.md` |
| 검사를 쓴다 | `references/testing.md` |
| 판정·오퍼링 구조를 건드린다 | `references/domain.md` |
| **막히거나 결과가 이상하다** | `references/burned.md` ← 먼저 여기 |

## 커밋

제목은 한국어로 **무엇을 했나**, 본문은 **왜 그렇게 했나**. 대안을 버린 이유와 데인 것을
남긴다 — 반년 뒤에 같은 것을 다시 논의하지 않으려는 것이다.

```
feat(hub): 결과 링크 열람 기록 (048)

## 정적 페이지가 아니라 API 에서 센다

기업 메일 게이트웨이가 링크를 미리 열어 보는데 JS 는 실행하지 않는다.
/r/:token 에서 세면 고객이 열지도 않은 메일이 전부 「열람」이 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

`git add -A` 전에 `git status` 를 본다 — 엑셀 잠금 파일(`~$*`)이 섞인 적이 있다.

## 배포

`main` 푸시가 Render 배포를 건다. **배포됐다고 DB 가 바뀐 것이 아니다** —
마이그레이션은 사람이 Supabase 에서 돌린다. 확인은 `/healthz` 의 `version`·`startedAt`.
