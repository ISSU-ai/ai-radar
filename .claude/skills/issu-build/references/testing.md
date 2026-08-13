# 검사

`node --test` (`npm test`). 파일은 `test/*.test.js`. 이름은 **한국어 문장**으로,
무엇이 참이어야 하는지 쓴다 — `열람 상태는 딜 상세에만 실리고 목록에는 없다`.

DB 가 없어도 돌아야 한다. 대부분 **파일을 읽어 구조를 확인**하거나 `lib/` 순수 함수를
부른다.

## 무딘 assert 를 쓰지 않는다 — 다섯 번 데였다

금지 문자열을 찾을 때 소스 전체에 `includes()` 를 걸면 **주석에 걸린다.** 주석이
그 단어를 설명하고 있을 뿐인데 검사가 실패한다(그리고 반대로, 통과하는 것처럼 보이게
주석을 고치는 유혹이 생긴다).

```js
// ✗ 주석 한 줄에 걸린다
assert.ok(!code.includes('unit_price'));

// ✓ 주석을 걷어내고 실제 참조 형태로 좁힌다
const body = code.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
assert.ok(!/\bdeal\.unit_price\b/.test(body));
```

## 개수를 세지 말고 이름을 센다

```js
// ✗ 탭이 하나 늘 때마다 깨진다. 무엇이 늘었는지도 안 알려준다
assert.equal((admin.match(/switch-tab/g) || []).length, 5);

// ✓ 무엇이 있어야 하는지를 말한다
const tabs = [...admin.matchAll(/switch-tab" data-tab="([\w-]+)"/g)].map((m) => m[1]);
assert.deepEqual(tabs, ['form', 'members', 'history', 'packages', 'reco-report', 'cases']);
```

## 화면 함수를 떼어 검사할 때

`hub.js` 는 모듈이 아니라 브라우저 스크립트다. 함수를 잘라 `vm` 으로 돌린다.

⚠ **`const` 는 vm 컨텍스트 전역에 안 닿는다.** 마지막에 `var` 로 내보낸다.

```js
const src = [pick('resultOpenState'), pick('resultOpenChipMarkup'),
  ';var __x = { resultOpenState, resultOpenChipMarkup };'].join('\n');
vm.createContext(context);
vm.runInContext(src, context);
return context.__x;
```

`test/report-export.test.js`·`test/result-open-tracking.test.js` 에 패턴이 있다.

## 규칙마다 검사를 남긴다

이 프로젝트의 검사는 **규칙이 지켜지는지**를 본다. 기능이 도는지만 보지 않는다.

- 마이그레이션 구조 — 뷰 의존성을 명시로 지우는가, 이벤트 표를 만들지 않는가
- 누출 — 고객 문서에 내부 문구·단가·연락처가 없는가
- 경계 — 목록 응답에 PII 가 없는가, 원본 컬럼이 편집 허용목록에 없는가
- 어휘 — 고지와 `PRIVACY_NOTICE.version` 이 같이 올라갔는가

**옛 동작을 굳히고 있는 검사를 발견하면 고친다.** 어드민 커버리지 편집기가 엔진이 못
읽는 모양으로 저장하고 있었는데, 검사 둘이 그 **깨진 동작을 확인**하고 있었다.

## 데인 것을 발견하면 검사로 건다

고치는 것으로 끝내지 않는다. 같은 실수가 두 번 나면 사람 기억으로는 못 막는다.
목업 어긋남·마이그레이션 함정·누출은 전부 검사가 지키고 있다.

## 커밋 전

```
npm test && npm run check
```

`npm run check`는 `node --check` 로 구문만 본다 — 검사와 별개다. 둘 다 통과해야 한다.
