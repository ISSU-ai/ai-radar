'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const HUB = read('hub.js');
const CSS = read('hub.css');

/** 화면 함수를 떼어 돌린다. const 는 vm 전역에 안 닿아 var 로 내보낸다. */
function load(names, extra = '') {
  const pick = (name) => {
    const at = HUB.indexOf(`function ${name}(`);
    assert.ok(at > 0, `${name} 이 없다`);
    const from = HUB.slice(at);
    return from.slice(0, from.indexOf('\n}\n') + 3);
  };
  const src = [
    'const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");',
    'const asArray = (v) => (Array.isArray(v) ? v : []);',
    extra,
    ...names.map(pick),
    `;var __x = { ${names.join(', ')} };`
  ].join('\n');
  const context = { console, location: { origin: 'https://radar.example' } };
  vm.createContext(context);
  vm.runInContext(src, context);
  return { api: context.__x, context };
}

test('정체 칩이 남의 딜에는 안 뜬다', () => {
  // 목록은 담당자 게이트가 없어 승인된 전 직원이 본다. 남의 딜이 빨간 것까지 보이면
  // 「내 딜이 빨간 걸 다들 보네」가 되고, 감시 도구로 한 번 읽히면 못 되돌린다.
  const at = HUB.indexOf('const tags = (deal.msp_status');
  assert.ok(at > 0);
  const block = HUB.slice(at - 400, at + 260);
  assert.match(block, /deal\.owner_id === state\.user\?\.id/, '본인 딜 판정이 없다');
  assert.match(block, /mine \? stallChipsMarkup\(deal\) : ''/, '남의 딜에도 칩이 붙는다');
  // 상세와 컨텍스트 카드에서는 그대로 본다 — 거기는 담당자·admin·미배정만 연다.
  assert.match(HUB, /const chips = stallChipsMarkup\(state\.deal\)/);
  assert.match(HUB, /getElementById\('context-stall'\)/);
});

test('응답이 없으면 42문항을 접고 진단 링크를 먼저 보여준다', () => {
  // 빈 딜에서 42문항이 펼쳐져 있으면 그게 「지금 할 일」로 보이고 거기서 멈춘다.
  const at = HUB.indexOf('function renderFqa(');
  const fn = HUB.slice(at, HUB.indexOf('\n}\n', at));
  assert.match(fn, /const answered = Object\.keys\(state\.deal\.readiness_scores \|\| \{\}\)\.length > 0/);
  assert.match(fn, /answered \?/, '응답 유무로 갈리지 않는다');
  assert.match(fn, /readinessInviteMarkup\(\)/);
  assert.match(fn, /<details class="rd-manual">/, '42문항이 접히지 않는다');
  // 안내 문구도 정상 경로를 말해야 한다.
  assert.ok(!fn.includes('아니면 여기서 함께 채웁니다'), '영업이 채우는 것을 기본으로 안내한다');
});

test('진단 링크 안내가 링크와 복사 수단을 같이 준다', () => {
  const { api } = load(['readinessInviteMarkup']);
  const html = api.readinessInviteMarkup();
  assert.match(html, /https:\/\/radar\.example\/readiness/, '링크가 안 보인다');
  assert.match(html, /id="copy-readiness-link"/);
  assert.match(html, /data-link="https:\/\/radar\.example\/readiness"/);
  // 직접 채우는 길도 막지 않는다 — 미팅에서 확인한 값이 있을 수 있다.
  assert.match(html, /직접 채우기/);
  assert.ok(HUB.includes("$('#copy-readiness-link')?.addEventListener"), '복사 버튼이 안 물려 있다');
});

test('읽기 전용인 이유를 화면이 말한다', () => {
  // 「전부 회색인데 고장 났나」로 읽히는 자리다.
  // ⚠ 밖에서 값을 갈아끼우려면 var 여야 한다 — let/const 는 vm 전역에 안 닿는다.
  const { api, context } = load(['readOnlyNoticeMarkup'],
    'var __deal = null, __owner = false;\n'
    + 'const state = { get deal() { return __deal; } };\n'
    + 'const isOwner = () => __owner;');

  // 담당자 본인 — 배너 없음
  context.__deal = { owner_id: 'me' };
  context.__owner = true;
  assert.equal(api.readOnlyNoticeMarkup(), '');

  // 미배정 — 「담당하기」를 가리킨다
  context.__owner = false;
  context.__deal = { owner_id: null };
  const unowned = api.readOnlyNoticeMarkup();
  assert.match(unowned, /담당하기/, '무엇을 눌러야 하는지 안 알려준다');
  assert.match(unowned, /claimable/);

  // 남의 딜 — 누구 것인지 알려주되 담당하기를 권하지 않는다
  context.__deal = { owner_id: 'other', owner_name: '김영업' };
  const others = api.readOnlyNoticeMarkup();
  assert.match(others, /김영업/);
  assert.ok(!others.includes('claimable'), '남의 딜에 담당하기를 권하면 안 된다');
});

test('읽기 전용 안내가 모든 단계에 붙는다', () => {
  // 한 단계에만 붙이면 다른 단계로 넘어간 사람이 또 막힌다.
  const at = HUB.indexOf('const renderer = STAGE_RENDERERS[stage];');
  const block = HUB.slice(at, at + 200);
  assert.match(block, /readOnlyNoticeMarkup\(\) \+ \(renderer/);
});

test('필요한 스타일이 있다', () => {
  for (const selector of ['.rd-invite', '.rd-manual > summary', '.readonly-banner', '.readonly-banner.claimable']) {
    assert.ok(CSS.includes(selector), `${selector} 스타일이 없다`);
  }
});
