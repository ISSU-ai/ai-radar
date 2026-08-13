'use strict';

/**
 * 고객용 핸드오프 키트.
 *
 * 여기서 잡으려는 것은 하나다 — **내부 문구가 고객 쪽으로 새는 것.**
 * 플래그 하나로 내부용과 갈라 쓰면 언젠가 반드시 샌다. buildCustomerKit 은
 * 내부 재료를 지우는 게 아니라 **애초에 부르지 않아야** 한다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const hubJs = read('hub.js');
const kit = hubJs.slice(hubJs.indexOf('function buildCustomerKit'), hubJs.indexOf('const STAGE_REPORT_TITLES'));

test('고객용 키트가 내부 재료를 아예 읽지 않는다', () => {
  assert.ok(kit.length > 500, 'buildCustomerKit 을 못 찾았다');
  // 지우는 게 아니라 안 부르는 것이다 — 읽는 순간 언젠가 샌다.
  const forbidden = [
    'opinion', 'tech_note', 'internalBulletLabels', 'sections_internal',
    'talkTracks', 'mzc_sales', 'msp_status', 'stallState', 'stallChipsMarkup',
    'customer_contact_name', 'customer_contact_phone', 'customer_contact_email',
    'lead_contact_name', 'lead_contact_phone', 'unit_price', 'row.amount * ', 'focal', 'grade'
  ];
  // 주석으로 「안 넣는다」를 적는 건 괜찮다. 코드에서 실제로 읽는 것만 막는다.
  const code = kit.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
  for (const token of forbidden) {
    assert.ok(!code.includes(token), `고객용 키트가 ${token} 을 읽는다`);
  }
  // 가격은 벤더 공시가만. 우리 견적 단가는 안 쓴다.
  assert.match(kit, /listPrice/);
  assert.match(kit, /price\.status === 'published'/);
  assert.match(kit, /공시가가 없어 별도 견적이 필요합니다/);
});

test('금액은 실단가 확정 전까지 별도협의로만 나간다', () => {
  assert.match(kit, /금액은 범위 확정 후 별도 산정합니다/);
  // OpenAI Enterprise 는 확정 금액으로 제시하면 안 된다 — 기존 규약 유지
  assert.match(kit, /OpenAI 협의사항이라 확정 금액이 아닙니다/);
  assert.match(kit, /API 는 포함하지 않았습니다/);
  // 「내부 참고용」·「더미 단가」 배너를 고객 문서로 옮기지 않는다
  assert.ok(!/내부 참고용|더미 단가|견적서 인용 금지/.test(kit));
});

test('고객이 물어본 제품을 붙인다', () => {
  // 041 의 inquiry_products 가 여기서 처음으로 쓰인다.
  assert.match(kit, /asArray\(deal\.inquiry_products\)/);
  // 조합(우리가 제안한 것)과 가른다
  assert.match(kit, /asArray\(deal\.isv_combo\)/);
  // 본문을 통째로 넣지 않는다 — 카탈로그 한 절이 수백 자다
  assert.match(hubJs, /function parseUseCases/);
  const parser = hubJs.slice(hubJs.indexOf('function parseUseCases'), hubJs.indexOf('function parseUseCases') + 900);
  assert.match(parser, /slice\(0, 2\)/);
  // 조합에 없는 문의 제품도 본문을 받아야 한다
  const loader = hubJs.slice(hubJs.indexOf('async function loadPitchSources'), hubJs.indexOf('function buildPitch'));
  assert.match(loader, /inquiry_products/);
});

test('아직 모르는 것을 한 곳에 모으되 고객 문서엔 안 넣는다', () => {
  // 지금 네 곳에 흩어져 있다. 인계(deployment-Brief)의 핵심 절이 될 자리다.
  const open = hubJs.slice(hubJs.indexOf('function collectOpenItems'), hubJs.indexOf('function buildCustomerKit'));
  assert.match(open, /42문항 중/);
  assert.match(open, /assessment_totals\?\.unanswered/);
  assert.match(open, /pendingManual/);
  assert.match(open, /hasPlaceholder/);
  // 고객 문서에는 목록이 안 들어간다 — 개수만 보고 문장을 바꾼다
  assert.match(kit, /const openCount = collectOpenItems\(\)\.length/);
  assert.ok(!/collectOpenItems\(\)\.forEach|\.\.\.collectOpenItems/.test(kit),
    '미확인 목록을 고객 문서에 넣었다');
  // 영업에게는 토스트로 알린다
  assert.match(hubJs, /미확인 \$\{open\.length\}건은 문서에 넣지 않았습니다/);
});

test('키트는 피치와 다른 문서다', () => {
  // 피치는 영업 대본(내부 준비용), 키트는 고객에게 보내는 것.
  assert.match(hubJs, /id="customer-kit"/);
  assert.match(hubJs, /\$\('#customer-kit'\)\?\.addEventListener/);
  assert.ok(!/buildCustomerKit\(\)[\s\S]{0,80}buildPitch\(\)/.test(hubJs), '두 문서를 섞었다');
  // 피치의 「내부 준비용」 머리는 그대로 남아야 한다
  assert.match(hubJs, /⚠ 내부 준비용입니다\. 고객에게 그대로 전달하지 마세요\./);
});

test('목업의 채점 경로가 하나다', () => {
  // 딜 채점과 공개 진단이 다른 문항 배열을 쓰면 「무엇부터」가 한쪽에서만 사라진다.
  const mock = read('scripts/mock-ui-server.js');
  assert.match(mock, /const readinessItemsWithFix = \(\) =>/);
  assert.equal((mock.match(/scoreReadiness\(readinessItemsWithFix\(\)/g) || []).length, 3,
    '채점하는 곳이 세 곳이고 전부 같은 문항을 써야 한다');
  assert.ok(!/scoreReadiness\(readiness\.items/.test(mock), '처방 없는 문항으로 채점하는 경로가 남았다');
});
