'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

/**
 * 이벤트 핸들러 본문을 이름으로 떼어 낸다.
 *
 * ⚠ **주석을 걷어낸다.** 이 함정을 설명하는 주석에 「await 뒤」·「currentTarget」이
 *   그대로 들어 있어, 안 걷어내면 주석이 코드로 잡힌다.
 */
function handler(source, name) {
  const at = source.indexOf(`async function ${name}(`);
  assert.ok(at > 0, `${name} 이 없다`);
  return source.slice(at, source.indexOf('\n}\n', at))
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

test('currentTarget 을 await 뒤에 만지지 않는다', () => {
  // ⚠ event.currentTarget 은 첫 await 뒤 null 이 된다(디스패치가 끝나서).
  //   거기서 TypeError 가 나면 catch 로 떨어지고, **성공했는데 실패한 것처럼** 굴어
  //   사용자가 한 번 더 누른다 — 딜이 둘이 되던 실제 원인이다.
  for (const [file, name] of [['hub.js', 'createDeal'], ['readiness.js', 'submitLead']]) {
    const fn = handler(read(file), name);
    const firstAwait = fn.indexOf('await ');
    assert.ok(firstAwait > 0, `${name} 에 await 이 없다`);
    assert.ok(!fn.slice(firstAwait).includes('currentTarget'),
      `${file}:${name} 이 await 뒤에 currentTarget 을 만진다`);
    // 대신 미리 잡아 둔 참조를 쓴다.
    assert.match(fn.slice(0, firstAwait), /=\s*event\.currentTarget/,
      `${name} 이 폼 참조를 미리 안 잡는다`);
  }
});

test('보내는 동안 제출 버튼을 잠근다', () => {
  // 응답이 오는 동안 버튼이 살아 있으면 두 번 눌린다. 서버는 둘 다 만든다 —
  // 고객사가 같아도 다른 딜일 수 있어 서버가 임의로 합칠 수 없다.
  for (const [file, name] of [['hub.js', 'createDeal'], ['readiness.js', 'submitLead']]) {
    const fn = handler(read(file), name);
    assert.match(fn, /button\.disabled = true/, `${file}:${name} 이 버튼을 안 잠근다`);
    assert.match(fn, /button\.disabled = false/, `${file}:${name} 이 버튼을 안 푼다`);
  }
  // 실패해도 반드시 풀린다 — 안 풀면 오타 한 번에 다시 못 만든다.
  const create = handler(read('hub.js'), 'createDeal');
  assert.match(create, /\} finally \{[\s\S]*button\.disabled = false/,
    'finally 밖에서 풀면 예외 때 잠긴 채로 남는다');
});

test('성공 경로가 예외로 끊기지 않는다', () => {
  // 딜은 만들어졌는데 토스트·목록 갱신·딜 열기가 안 돌면 「안 됐네」로 읽힌다.
  const fn = handler(read('hub.js'), 'createDeal');
  const after = fn.slice(fn.indexOf('await api('));
  for (const step of ['toast(', 'await loadDeals()', 'await openDeal(']) {
    assert.ok(after.includes(step), `${step} 가 성공 경로에 없다`);
  }
  assert.ok(after.indexOf('formEl.reset()') < after.indexOf('toast('),
    'reset 이 토스트보다 뒤면 순서가 바뀐 것이다');
});
