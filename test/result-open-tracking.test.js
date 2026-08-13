'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const MIGRATION = read('db/migrations/048_lead_result_open.sql');
const ROUTE = read('routes/hub.js');
const HUB = read('hub.js');
const MOCK = read('scripts/mock-ui-server.js');

test('열람 요약은 셋뿐이고 이벤트 로그를 만들지 않는다', () => {
  for (const column of ['result_opened_at', 'result_last_opened_at', 'result_open_count']) {
    assert.ok(MIGRATION.includes(`add column if not exists ${column}`), `${column} 이 없다`);
  }
  // 표를 새로 만들면 열람 이벤트를 행으로 쌓는다는 뜻이다. 그 순간 개인 행동 추적이 된다.
  assert.ok(!/create table/i.test(MIGRATION), '열람 로그 표를 만들면 안 된다');
  // IP·User-Agent 는 저장하지 않는다. 고지에 쓸 수 없는 것을 저장하지 않는다.
  assert.ok(!/ip_address|user_agent/i.test(MIGRATION), '식별 정보를 저장하면 안 된다');
});

test('열람은 API 에서 세고 정적 페이지에서는 안 센다', () => {
  // /r/:token 은 정적 HTML 이라 기업 메일 게이트웨이의 링크 검사에도 열린다.
  // 거기서 세면 고객이 안 본 것을 봤다고 말하게 된다.
  const serverJs = read('server.js');
  const staticRoute = serverJs.slice(serverJs.indexOf("app.get('/r/:token'"));
  assert.ok(!staticRoute.slice(0, 400).includes('result_open'),
    '정적 라우트에서 열람을 세면 안 된다');
  assert.ok(ROUTE.includes('void recordResultOpen('), 'API 라우트가 기록을 부른다');
});

test('기록 실패가 결과 조회를 막지 않는다', () => {
  const body = ROUTE.slice(ROUTE.indexOf('async function recordResultOpen'));
  const fn = body.slice(0, body.indexOf('\n  }\n') + 5);
  assert.ok(/catch \(error\)/.test(fn), '예외를 삼켜야 한다');
  assert.ok(!/throw/.test(fn), '기록 실패를 던지면 고객이 결과를 못 본다');
  // 응답을 보낸 뒤에 부른다.
  const route = ROUTE.slice(ROUTE.indexOf("router.get('/public/result/:token'"));
  const jsonAt = route.indexOf('res.json({ customer:');
  const trackAt = route.indexOf('void recordResultOpen(');
  assert.ok(jsonAt > 0 && trackAt > jsonAt, '기록은 res.json 뒤에 온다');
});

test('30분 창 안의 재조회는 한 번으로 센다', () => {
  const fn = ROUTE.slice(ROUTE.indexOf('async function recordResultOpen'));
  assert.ok(fn.includes("result_open_count = result_open_count + (case"), '조건부 증가여야 한다');
  assert.ok(/result_last_opened_at < now\(\) - interval/.test(fn), '창 조건이 있어야 한다');
  assert.ok(fn.includes('coalesce(result_opened_at, now())'), '처음 시각은 덮어쓰지 않는다');
});

test('열람 상태는 딜 상세에만 실리고 목록에는 없다', () => {
  const list = ROUTE.slice(ROUTE.indexOf("router.get('/deals'"), ROUTE.indexOf("router.get('/deals/:id'"));
  const code = list.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!code.includes('result_open'), '목록은 owner 게이트가 없다 — 실으면 안 된다');
  const detail = ROUTE.slice(ROUTE.indexOf("router.get('/deals/:id'"));
  assert.ok(detail.includes('lead.result_open_count as lead_result_open_count'), '상세에는 실린다');
  assert.ok(detail.includes("hasColumn('leads', 'result_open_count')"), '컬럼 존재를 확인한다');
});

test('개인정보 고지가 열람 기록을 포함하고 버전이 올라갔다', () => {
  assert.ok(ROUTE.includes("version: '2026-08-13-v3'"), '고지 버전을 올려야 한다');
  const html = read('readiness.html');
  const notice = html.slice(html.indexOf('<b>수집 항목</b>'), html.indexOf('<b>이용 목적</b>'));
  assert.ok(notice.includes('열람 기록'), '수집 항목에 열람 기록이 있어야 한다');
});

/** 화면 함수는 vm 으로 떼어 검사한다 — const 는 vm 전역에 안 닿아 객체로 내보낸다. */
function loadHubFns() {
  const pick = (name) => {
    const at = HUB.indexOf(`function ${name}(`);
    assert.ok(at > 0, `${name} 이 없다`);
    const from = HUB.slice(at);
    return from.slice(0, from.indexOf('\n}\n') + 3);
  };
  const src = [
    'const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");',
    pick('resultOpenState'),
    "const dayPhrase = (v) => (v == null ? '' : v === 0 ? '오늘' : `${v}일 전`);",
    pick('resultOpenChipMarkup'),
    ';var __x = { resultOpenState, resultOpenChipMarkup };'
  ].join('\n');
  const context = { console };
  vm.createContext(context);
  vm.runInContext(src, context);
  return context.__x;
}

test('링크가 없던 리드는 「미열람」이라고 말하지 않는다', () => {
  const { resultOpenState, resultOpenChipMarkup } = loadHubFns();
  // 044 이전 딜에는 링크 자체가 없다. 안 연 것과 보낼 수 없었던 것은 다르다.
  assert.equal(resultOpenState({ customer: 'A' }), null);
  assert.equal(resultOpenChipMarkup({ customer: 'A' }), '');
});

test('열람 칩은 「보냄」이라고 말하지 않는다', () => {
  const { resultOpenChipMarkup } = loadHubFns();
  const unopened = resultOpenChipMarkup({ lead_result_open_count: 0 });
  assert.ok(unopened.includes('결과 미열람'));
  // 발송 수단이 없어 보냈는지를 우리가 모른다. 모르는 것을 말하지 않는다.
  assert.ok(!/보냄|발송함|전송함/.test(unopened.replace(/data-hint="[^"]*"/, '')), '보냈다고 쓰면 안 된다');
  assert.ok(unopened.includes('data-hint'), '왜 「미열람」까지만 쓰는지 설명이 붙는다');
});

test('열람 칩이 마지막 열람과 횟수를 말한다', () => {
  const { resultOpenChipMarkup, resultOpenState } = loadHubFns();
  const threeDays = new Date(Date.now() - 3 * 86400000).toISOString();
  const today = new Date().toISOString();
  const state = resultOpenState({
    lead_result_opened_at: threeDays, lead_result_last_opened_at: today, lead_result_open_count: 4
  });
  assert.equal(state.firstDays, 3);
  assert.equal(state.lastDays, 0);
  const chip = resultOpenChipMarkup({
    lead_result_opened_at: threeDays, lead_result_last_opened_at: today, lead_result_open_count: 4
  });
  assert.ok(chip.includes('결과 열람 오늘'), chip);
  assert.ok(chip.includes('4회'), chip);
  // 열람은 좋은 신호다. 정체 칩의 경고색을 쓰면 같은 뜻으로 읽힌다.
  assert.ok(chip.includes('stall-chip opened'), chip);
  assert.ok(!/\bwarn\b|\blate\b/.test(chip), chip);
});

test('한 번만 열었으면 횟수를 안 붙인다', () => {
  const { resultOpenChipMarkup } = loadHubFns();
  const chip = resultOpenChipMarkup({
    lead_result_opened_at: new Date().toISOString(), lead_result_open_count: 1
  });
  assert.ok(!chip.replace(/data-hint="[^"]*"/, '').includes('1회'), '1회는 군더더기다');
});

test('목업도 API 에서만 세고 같은 30분 창을 쓴다', () => {
  assert.ok(MOCK.includes('recordResultOpen(lead);'), '목업이 기록을 부른다');
  assert.ok(MOCK.includes('30 * 60 * 1000'), '실서버와 같은 창이어야 한다');
  const staticRoute = MOCK.slice(MOCK.indexOf("app.get('/r/:token'"));
  assert.ok(!staticRoute.slice(0, 200).includes('recordResultOpen'),
    '목업도 정적 페이지에서 세면 안 된다 — 로컬에서 본 숫자가 거짓이 된다');
});

test('허브 화면이 열람 상태를 그린다', () => {
  const html = read('hub.html');
  assert.ok(html.includes('id="context-result-open"'), 'DEAL CONTEXT 에 자리가 있다');
  assert.ok(HUB.includes("getElementById('context-result-open')"), '갱신도 같이 한다');
  // STEP01 정체 칩 옆에도 붙는다 — 세 시계를 한자리에서 본다.
  assert.ok(HUB.includes('const open = resultOpenChipMarkup(state.deal);'), 'STEP01 에도 붙는다');
});
