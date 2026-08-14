'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  HANDOFF_FIELDS, QUALITY_CHECKS, QUALITY_LEVELS, FIELD_LIMIT,
  normaliseHandoff, handoffReadiness, interviewQuestions, qualityGaps
} = require('../lib/handoff-fields');
const { PIPELINE_STAGES, EDITABLE_DEAL_FIELDS, normaliseDealPatch } = require('../lib/hub-domain');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const ANCHOR = { quote: '법무팀은 수작업입니다', note_id: 'n1', met_on: '2026-08-14' };

test('문서1 전체가 아니라 여섯 칸만 받는다', () => {
  // 입력란이 100개를 넘으면 아무도 안 채우고, 안 채워진 문서는 없는 것과 같다.
  assert.equal(HANDOFF_FIELDS.length, 6);
  assert.deepEqual(HANDOFF_FIELDS.map((f) => f.key),
    ['workflow', 'pilotGroup', 'successCriteria', 'stakeholders', 'scope', 'nextSteps']);
  // 각 칸이 Deployment Brief §A 의 어느 항목인지 안다 — 규격이 바뀌면 여기만 고친다.
  assert.deepEqual(HANDOFF_FIELDS.map((f) => f.brief), [4, 2, 6, 7, 8, 14]);
  // 못 채웠을 때 나갈 질문이 반드시 있다.
  for (const field of HANDOFF_FIELDS) {
    assert.ok(field.ask && field.ask.endsWith('?'), `${field.key} 에 질문이 없다`);
  }
});

test('품질 점검 어휘가 문서 §F 원문과 같다', () => {
  assert.equal(QUALITY_CHECKS.length, 6);
  assert.deepEqual(QUALITY_LEVELS.map(([, label]) => label), ['충족', '부분 충족', '미충족']);
});

test('모르는 키를 버린다', () => {
  // jsonb 한 칸이라 아무거나 들어올 수 있다. 한 번 들어가면 읽는 코드가 진짜인 줄 안다.
  const out = normaliseHandoff({
    workflow: { value: '계약 검토' },
    bogus: { value: '아무거나' },
    quality: { realWorkflow: 'met', fake: 'met', frequency: '아무거나' }
  });
  assert.deepEqual(Object.keys(out).sort(), ['quality', 'workflow']);
  assert.deepEqual(out.quality, { realWorkflow: 'met' });
});

test('출처 없는 인용은 저장하지 않는다', () => {
  // 되짚을 수 없는 인용은 근거가 아니라 그냥 옮겨 적은 문장이다.
  const noSource = normaliseHandoff({ workflow: { value: 'x', quote: { quote: '법무팀은…' } } });
  assert.deepEqual(noSource.workflow, { value: 'x' }, '인용이 남으면 안 된다');
  const withSource = normaliseHandoff({ workflow: { value: 'x', quote: ANCHOR } });
  assert.equal(withSource.workflow.quote.note_id, 'n1');
  assert.equal(withSource.workflow.quote.met_on, '2026-08-14');
  // 나중에 LLM 추출을 얹을 때 이 칸만 늘어난다.
  assert.equal(withSource.workflow.quote.source, 'human');
  assert.equal(normaliseHandoff({ workflow: { value: 'x', quote: { ...ANCHOR, source: 'extracted' } } })
    .workflow.quote.source, 'extracted');
});

test('값이 비어도 근거만 있으면 남긴다', () => {
  // 「근거는 가져왔는데 아직 정리 못 함」이 실제로 있는 상태다. 지우면 다시 찾아야 한다.
  const out = normaliseHandoff({ workflow: { value: '', quote: ANCHOR } });
  assert.equal(out.workflow.value, '');
  assert.equal(out.workflow.quote.note_id, 'n1');
  // 둘 다 없으면 칸 자체를 안 만든다.
  assert.deepEqual(normaliseHandoff({ workflow: { value: '  ' } }), {});
});

test('한 칸이 회의록이 되지 않게 상한을 둔다', () => {
  const out = normaliseHandoff({ workflow: { value: 'ㄱ'.repeat(FIELD_LIMIT + 500) } });
  assert.equal(out.workflow.value.length, FIELD_LIMIT);
});

test('진행도는 칸만 세고 체크박스를 안 센다', () => {
  // 섞으면 「체크만 하고 칸은 비운」 딜이 준비된 것처럼 보인다.
  const onlyChecks = handoffReadiness({
    quality: { realWorkflow: 'met', frequency: 'met', observable: 'met',
      pilotFit: 'met', dependencies: 'met', decisionBasis: 'met' }
  });
  assert.equal(onlyChecks.filled, 0, '체크만 했는데 준비된 것처럼 보인다');
  assert.equal(onlyChecks.missing.length, 6);

  const partial = handoffReadiness({
    workflow: { value: '계약 검토', quote: ANCHOR }, pilotGroup: { value: '법무 12명' }
  });
  assert.equal(partial.filled, 2);
  assert.equal(partial.sourced, 1, '근거가 붙은 칸은 따로 센다');
});

test('못 채운 칸이 질문으로 바뀐다 — 이미 아는 것은 안 묻는다', () => {
  const all = interviewQuestions({});
  assert.equal(all.length, 6);
  const partial = interviewQuestions({ workflow: { value: '계약 검토 요약' } });
  assert.equal(partial.length, 5);
  assert.ok(!partial.some((q) => q.key === 'workflow'), '답한 것을 또 묻는다');
  assert.ok(partial.every((q) => q.question.endsWith('?')));
});

test('품질 점검의 공백만 뽑는다', () => {
  const gaps = qualityGaps({ quality: { realWorkflow: 'met', frequency: 'partial', observable: 'unmet' } });
  assert.deepEqual(gaps.map((g) => [g.key, g.levelLabel]),
    [['frequency', '부분 충족'], ['observable', '미충족']]);
});

test('배포 인계가 파이프라인 6번째 단계다', () => {
  // 단계로 둬야 041 정체 시계와 목록 필터가 그대로 작동한다.
  assert.equal(PIPELINE_STAGES.length, 6);
  assert.equal(PIPELINE_STAGES[5], '배포 인계');
  assert.deepEqual(normaliseDealPatch({ stage: 5 }), { stage: 5 });
  assert.throws(() => normaliseDealPatch({ stage: 6 }), /0부터 5/);
});

test('051 은 제약을 넓히기만 하고 좁히지 않는다', () => {
  const sql = read('db/migrations/051_deal_handoff.sql');
  assert.match(sql, /add column if not exists handoff jsonb/);
  assert.match(sql, /check \(stage between 0 and 5\)/);
  // 기존 딜은 전부 0~4 라 넓히는 것만으로 안전하다. 소급 백필도 없다.
  assert.ok(!/^\s*update\s+deals\s+set\s+handoff/im.test(sql), '소급해서 채우면 안 된다');
  // 제약 이름이 환경마다 다를 수 있어 정의로 찾아 지운다.
  assert.match(sql, /pg_get_constraintdef/);
});

test('051 미적용 구간에 저장이 통째로 실패하지 않는다', () => {
  const routes = read('routes/hub.js');
  assert.match(routes, /hasColumn\('deals', 'handoff'\)/);
  assert.match(routes, /051 마이그레이션을 확인하세요/);
  // 6단계로 올리는 것도 막는다 — DB 제약(0~4)이 거절해 patch 전체가 날아간다.
  assert.match(routes, /「배포 인계」 단계는 051/);
});

test('화면 필드 정의가 lib 과 같다', () => {
  // 갈리면 저장이 조용히 버려진다 — normaliseHandoff 가 모르는 키를 버리기 때문이다.
  const hub = read('hub.js');
  for (const field of HANDOFF_FIELDS) {
    assert.ok(hub.includes(`key: '${field.key}'`), `화면에 ${field.key} 가 없다`);
    assert.ok(hub.includes(`brief: ${field.brief}`), `화면의 ${field.key} 에 §A 번호가 없다`);
  }
  for (const check of QUALITY_CHECKS) {
    assert.ok(hub.includes(`key: '${check.key}'`), `화면에 ${check.key} 가 없다`);
  }
  for (const [value] of QUALITY_LEVELS) {
    assert.ok(hub.includes(`['${value}'`), `화면에 ${value} 등급이 없다`);
  }
  // 목업도 같은 단계 목록을 쓴다 — 따로 적으면 갈린다.
  const mock = read('scripts/mock-ui-server.js');
  assert.match(mock, /stages: require\('\.\.\/lib\/hub-domain'\)\.PIPELINE_STAGES/);
  // ⚠ 목업 PATCH 가 허용목록만 흉내 내면 그 안의 검증(단계 범위·handoff 모양)이
  //   로컬에서만 빠져 "저장됐는데 서버에서는 튕기는" 상태가 된다. 같은 함수를 쓴다.
  assert.match(mock, /patch = normaliseDealPatch\(req\.body\)/, '목업이 실서버 검증을 건너뛴다');
});

test('인계 칸은 PATCH 허용목록을 통과하되 모양이 강제된다', () => {
  assert.ok(EDITABLE_DEAL_FIELDS.includes('handoff'));
  const patch = normaliseDealPatch({ handoff: { workflow: { value: 'x' }, evil: { value: 'y' } } });
  assert.deepEqual(patch.handoff, { workflow: { value: 'x' } });
});

test('발췌는 원문 참조가 아니라 복사다', () => {
  // 참조만 두면 원문이 고쳐졌을 때 근거가 조용히 바뀐다.
  const hub = read('hub.js');
  const pin = hub.slice(hub.indexOf('function pinSelectionToField'), hub.indexOf('/** 계산 결과만.'));
  assert.match(pin, /quote: raw/, '인용 문자열을 저장하지 않는다');
  assert.match(pin, /note_id: note\.id/);
  assert.match(pin, /met_on: note\.met_on/);
  // 출처가 없으면 안 꽂는다.
  assert.match(pin, /if \(!note\?\.id \|\| !note\?\.met_on\)/);
});

test('타이핑 중 renderStage 를 부르지 않는다', () => {
  // 부르면 포커스를 잃는다. 진행도만 좁게 갱신한다.
  const hub = read('hub.js');
  const at = hub.indexOf("$$('[data-handoff-field]')");
  const block = hub.slice(at, at + 600);
  assert.ok(!block.includes('renderStage()'), '입력 중 renderStage 를 부른다');
  assert.match(block, /renderHandoffProgress\(\)/);
});

test('단계 자막이 단계 수와 같아 undefined 가 안 찍힌다', () => {
  // 051 로 여섯 번째가 늘었을 때 자막 배열이 다섯이라 화면에 「undefined」가 찍혔다.
  const hub = read('hub.js');
  const at = hub.indexOf('const STAGE_SUBTITLES');
  assert.ok(at > 0, '자막을 인라인 배열로 두면 단계가 늘 때 또 어긋난다');
  const literal = hub.slice(at, hub.indexOf(']);', at));
  assert.equal((literal.match(/'/g) || []).length / 2, PIPELINE_STAGES.length,
    '자막 수가 단계 수와 다르다');
  // 그래도 undefined 를 그리지 않는다 — 배열이 짧아도 빈 칸으로 둔다.
  assert.match(hub, /STAGE_SUBTITLES\[index\] \|\| ''/);
});

test('단계 레일이 몇 개가 되든 한 줄이다', () => {
  // repeat(5) 로 개수를 박았더니 여섯 번째가 두 줄로 접혔다.
  const css = read('hub.css');
  const rail = css.slice(css.indexOf('.stage-rail {'), css.indexOf('.stage-rail::'));
  assert.ok(!/repeat\(\d+/.test(rail), '단계 수를 CSS 에 박으면 늘 때마다 접힌다');
  assert.match(rail, /grid-auto-flow: column/);
  assert.match(rail, /overflow-x: auto/, '좁은 화면에서 넘칠 자리가 있어야 한다');
});
