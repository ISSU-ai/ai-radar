'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scoreReadiness, maturityFor } = require('../lib/readiness-scoring');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const AREAS = [
  ['S', '전략·리더십'], ['P', '인재·조직문화'], ['D', '데이터 기반'],
  ['T', '시스템·인프라'], ['B', '업무 적용·성과'], ['G', '신뢰·안전 관리']
].map(([id, name], i) => ({ id, name, sort_order: (i + 1) * 10 }));

const ITEMS = AREAS.flatMap((area) => Array.from({ length: 7 }, (_, i) => ({
  code: `${area.id}${i + 1}`, area: area.id, seq: i + 1, respondent: 'exec',
  text: `${area.id}${i + 1} 문항`,
  rubric: ['체계 없음', '초기 검토', '기본 체계', '조직적 운영', '전사 표준화'],
  target: 4
})));

const all = (value) => Object.fromEntries(ITEMS.map((i) => [i.code, value]));

// ── 성숙도 ───────────────────────────────────────────────────────
test('성숙도 5단계 경계가 nimble 구간과 같다', () => {
  // 경계에서 한 칸 어긋나면 고객이 보는 등급이 달라진다
  const cases = [
    [1.0, 1], [1.99, 1], [2.0, 2], [2.99, 2], [3.0, 3],
    [3.89, 3], [3.9, 4], [4.49, 4], [4.5, 5], [5.0, 5]
  ];
  for (const [score, level] of cases) {
    assert.equal(maturityFor(score).level, level, `${score} 점이 Level ${level} 이어야 한다`);
  }
});

// ── 채점 ─────────────────────────────────────────────────────────
test('축 평균의 평균으로 종합을 낸다', () => {
  // 문항 평균이 아니라 축 평균의 평균이다. 축마다 문항 수가 달라져도
  // 축 하나가 종합을 끌고 가지 않는다.
  const scores = { ...all(2), D1: 1, D2: 1, D3: 1, D4: 1, D5: 1, D6: 1, D7: 1 };
  const result = scoreReadiness(ITEMS, AREAS, scores);
  assert.equal(result.areas.find((a) => a.area === 'D').score, 1);
  assert.equal(result.average, Math.round(((2 * 5 + 1) / 6) * 100) / 100);
  assert.equal(result.weakest.area, 'D');
});

test('전부 5점이면 최적화, 전부 1점이면 초기', () => {
  const high = scoreReadiness(ITEMS, AREAS, all(5));
  assert.equal(high.average, 5);
  assert.equal(high.maturity.level, 5);
  assert.equal(high.lowAreas.length, 0);

  const low = scoreReadiness(ITEMS, AREAS, all(1));
  assert.equal(low.average, 1);
  assert.equal(low.maturity.level, 1);
  assert.equal(low.lowAreas.length, 6);
});

test('우선 개선은 낮은 축 3개와 그 근거 문항을 낸다', () => {
  // 근거가 없으면 "왜 이게 1순위인가" 에 답할 수 없다
  const scores = { ...all(4), D2: 1, D4: 1, T3: 2, S1: 2 };
  const result = scoreReadiness(ITEMS, AREAS, scores);
  assert.equal(result.priorities.length, 3);
  assert.equal(result.priorities[0].area, 'D', '가장 낮은 축이 1순위여야 한다');

  const drivers = result.priorities[0].items;
  assert.ok(drivers.length <= 3);
  assert.deepEqual(drivers.slice(0, 2).map((d) => d.code).sort(), ['D2', 'D4']);
  for (const driver of drivers) {
    assert.ok(driver.rubric && driver.rubric.length > 0,
      `${driver.code} 에 고른 루브릭 문장이 붙어야 한다 — 숫자만으로는 근거가 안 된다`);
  }
});

test('문항별 응답에 고른 루브릭 문장이 남는다', () => {
  const result = scoreReadiness(ITEMS, AREAS, { ...all(3), S1: 5 });
  assert.equal(result.answers.length, 42);
  const s1 = result.answers.find((a) => a.code === 'S1');
  assert.equal(s1.score, 5);
  assert.equal(s1.rubric, '전사 표준화', '5점을 고르면 5번째 루브릭이 남아야 한다');
  assert.equal(s1.gap, 0, 'target 4 이상이면 갭이 0');
  const other = result.answers.find((a) => a.code === 'S2');
  assert.equal(other.gap, 1, '3점이면 target 4 대비 갭 1');
});

// ── 입력 검증 ────────────────────────────────────────────────────
test('미응답이 하나라도 있으면 계산하지 않는다', () => {
  // 부분 응답으로 점수를 내면 "3점을 안 골랐는데 3점으로 계산된" 결과가 나온다.
  // nimble 이 미응답을 막는 이유와 같다.
  const scores = all(3);
  delete scores.S1;
  delete scores.G7;
  assert.throws(() => scoreReadiness(ITEMS, AREAS, scores), (error) => {
    assert.match(error.message, /선택하지 않은 문항이 2개/);
    assert.deepEqual(error.unanswered.sort(), ['G7', 'S1']);
    assert.equal(error.expected, true, '400 으로 내려보낼 수 있어야 한다');
    return true;
  });
});

test('범위 밖·모르는 문항을 거절한다', () => {
  assert.throws(() => scoreReadiness(ITEMS, AREAS, { ...all(3), S1: 7 }), /1~5 범위/);
  assert.throws(() => scoreReadiness(ITEMS, AREAS, { ...all(3), S1: 2.5 }), /1~5 범위/);
  assert.throws(() => scoreReadiness(ITEMS, AREAS, { ...all(3), Z9: 3 }), /알 수 없는 문항/);
  assert.throws(() => scoreReadiness(ITEMS, AREAS, null), /객체여야/);
  assert.throws(() => scoreReadiness([], AREAS, all(3)), /문항을 불러오지/);
});

// ── 화면 배선 ────────────────────────────────────────────────────
test('진단 화면이 nimble 에서 가져온 넷을 갖춘다', () => {
  const html = read('readiness.html');
  const js = read('readiness.js');

  // ① 루브릭 칩을 직접 클릭한다 — 숫자 라디오가 아니다
  assert.match(js, /rd-chip[\s\S]{0,200}data-score/, '루브릭 칩이 선택지여야 한다');
  assert.ok(!/type="radio"/.test(html), '라디오로 되돌아가면 안 된다');
  assert.match(js, /\$\('#questions'\)\.addEventListener/, '위임으로 받아야 다시 그려도 동작한다');

  // ② 미응답 차단·배너·스크롤
  assert.match(js, /function showUnanswered/);
  assert.match(js, /unanswered/);
  assert.match(js, /scrollIntoView/);
  assert.match(html, /id="unanswered-banner"/);

  // ③ 문항별 상세 응답표
  assert.match(html, /id="detail-tables"/);
  assert.match(js, /선택한 상태/, '고른 루브릭 문장이 표에 있어야 한다');

  // ④ 성숙도 5단계
  assert.match(js, /MATURITY\s*=\s*Object\.freeze/);
  assert.match(html, /id="maturity-intro"/);
});

test('점수는 서버가 계산한다 — 화면에서 다시 계산하지 않는다', () => {
  // 다시 계산하면 고객이 화면에서 본 숫자와 리포트 안 숫자가 갈라진다
  const js = read('readiness.js');
  assert.match(js, /getJson\('\/api\/hub\/public\/readiness'/);
  assert.ok(!/state\.result\s*=\s*\{[\s\S]{0,200}average\s*:/.test(js),
    '화면이 average 를 직접 만들면 안 된다');
});

test('벤치마크 오버레이를 넣지 않았다', () => {
  // nimble 도 이번 판에서 뺐다. 출처 없는 수치다.
  const js = read('readiness.js');
  assert.ok(!/benchAvg|benchLead|업계 평균|글로벌 선도/.test(js));
});

test('공개 자산으로 서빙된다', () => {
  const server = read('server.js');
  const open = server.indexOf('const publicFrontendAssets');
  const block = server.slice(open, server.indexOf('});', open));
  assert.match(block, /'\/readiness\.js'/);
  assert.match(block, /'\/readiness\.css'/);
  assert.match(server, /app\.get\(\['\/readiness', '\/readiness\.html'\]/);

  const html = read('readiness.html');
  for (const asset of ['/report.js', '/readiness.js']) {
    assert.ok(html.includes(asset), `${asset} 로드가 없다`);
  }
  assert.ok(html.indexOf('/report.js') < html.indexOf('/readiness.js'),
    'report.js 가 먼저 로드돼야 한다');
});

test('목업이 029 시드를 직접 읽는다', () => {
  // 베껴 두면 둘이 어긋나고 화면 확인이 거짓말이 된다
  const mock = read('scripts/mock-ui-server.js');
  assert.match(mock, /029_readiness_items\.sql/);
  assert.match(mock, /scoreReadiness/, '목업도 실제 채점 함수를 써야 한다');
});

test('레이더차트가 숨겨진 상태에서도 정상 크기로 그려진다', () => {
  // #result 는 hidden 으로 시작한다. 그 상태에서 그리면 offsetWidth 가 0 인데
  // 예전 식 `Math.min(0 - 16, 320) || 320` 은 **-16 이 truthy 라 폴백이 안 먹었다.**
  // 반지름이 음수가 되어 도형이 뒤집힌 채 작게 그려졌다.
  const js = read('readiness.js');
  const open = js.indexOf('function drawRadar');
  const body = js.slice(open, js.indexOf('function buildMarkdown', open));

  assert.match(body, /available > 0 \?/, '0·음수를 걸러야 한다');
  assert.ok(!/offsetWidth - 16, 320\) \|\| 320/.test(body), '옛 폴백이 남아 있다');

  // 그리기 전에 보이게 한다 — 캔버스는 레이아웃이 잡힌 뒤에야 부모 폭을 안다
  const at = js.indexOf('state.fixing = [];');
  const calc = js.slice(at, js.indexOf('$(\'#contact\')', at));
  assert.ok(calc.indexOf("$('#result').classList.remove('hidden')") < calc.indexOf('renderResult(result)'),
    'renderResult 가 unhide 보다 먼저면 0 폭으로 계산된다');
});

// ── 043 문항별 처방 ──────────────────────────────────────────────
test('처방은 목표에 못 미친 문항에만 붙는다', () => {
  // 잘하고 있는 항목에 처방을 달면 나머지 처방도 같이 안 읽힌다.
  const items = [
    { code: 'D1', area: 'D', seq: 1, respondent: 'it', text: '통합', rubric: ['1', '2', '3', '4', '5'], target: 4, fix: '세 종류부터.' },
    { code: 'D2', area: 'D', seq: 2, respondent: 'it', text: '품질', rubric: ['1', '2', '3', '4', '5'], target: 4, fix: '자동 검사로.' }
  ];
  const areas = [{ id: 'D', name: '데이터' }];
  const result = scoreReadiness(items, areas, { D1: 2, D2: 5 }, { partial: true });
  const byCode = new Map(result.answers.map((a) => [a.code, a]));
  assert.equal(byCode.get('D1').fix, '세 종류부터.', 'gap 이 있는데 처방이 안 붙었다');
  assert.equal(byCode.get('D2').fix, '', 'gap 이 0인데 처방이 붙었다');
  // priorities 로도 흘러가야 화면·리포트가 쓴다
  const driver = result.priorities[0].items.find((i) => i.code === 'D1');
  assert.equal(driver.fix, '세 종류부터.');
  assert.equal(driver.gap, 2, 'gap 은 계산만 하고 버려지던 값이다 — 같이 살렸다');
});

test('처방문에 제품·오퍼링 이름이 없다', () => {
  // 고객이 받는 문서에 그대로 들어간다. 처방이 광고가 되면 처방도 같이 안 읽힌다.
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '043_readiness_fix.sql'), 'utf8');
  const rows = [...sql.matchAll(/set fix = '((?:[^']|'')*)' where code = '([A-Z]\d)'/g)];
  assert.equal(rows.length, 42, `처방문이 ${rows.length}개다`);
  const banned = /openai|chatgpt|codex|claude|portal26|zscaler|databricks|litellm|AIR Service|OpenAI Ready|AI Consulting|메가존|MZC/i;
  for (const [, fix, code] of rows) {
    assert.ok(!banned.test(fix), `${code} 처방문에 제품 이름이 들어갔다: ${fix}`);
    assert.ok(fix.length <= 70, `${code} 처방문이 ${fix.length}자다 — 루브릭 아래 한 줄이라 길면 안 읽힌다`);
  }
  // 42문항과 코드가 정확히 맞아야 한다
  const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '029_readiness_items.sql'), 'utf8');
  const codes = new Set([...seed.slice(seed.indexOf('insert into readiness_items'))
    .matchAll(/\('([A-Z]\d)', '[A-Z]', \d+, '\w+',/g)].map((m) => m[1]));
  for (const [, , code] of rows) assert.ok(codes.has(code), `${code} 는 42문항에 없는 코드다`);
});

test('처방과 오퍼링을 가른다', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'hub.js'), 'utf8');
  // 축→패키지는 이미 DB 에 있는 readiness_coverage 를 읽는다.
  // readiness_offering_weights(ISV BU 검토 병목)를 기다리지 않는다.
  assert.match(routes, /const coveringPackages = async/);
  assert.match(routes, /hasColumn\('packages', 'readiness_coverage'\)/);
  // 주석으로 「기다리지 않는다」를 적는 건 괜찮다. 실제 조회만 막는다.
  assert.ok(!/(from|join|into)\s+readiness_offering_weights/i.test(routes), '아직 없는 표를 조회한다');
  // 공개 화면이고 단가는 미정이다
  const block = routes.slice(routes.indexOf('const coveringPackages'), routes.indexOf("router.post('/public/readiness'"));
  assert.ok(!/unit_price|base_md|price/.test(block), '공개 응답에 가격이 실렸다');
  // 043 미적용 구간에도 진단이 돌아야 한다
  assert.match(routes, /hasColumn\('readiness_items', 'fix'\)/);

  const js = fs.readFileSync(path.join(__dirname, '..', 'readiness.js'), 'utf8');
  assert.match(js, /class="rd-fix"/);
  assert.match(js, /class="rd-offer"/);
  assert.match(js, /\*\*무엇부터\*\*/, '리포트에도 처방이 들어가야 한다');
  // 목업이 시드를 직접 읽는다
  const mock = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'mock-ui-server.js'), 'utf8');
  assert.match(mock, /043_readiness_fix\.sql/);
  assert.match(mock, /readiness_coverage/);
});
