'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../lib/handoff-doc');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const NOTES = [{ id: 'n1', met_on: '2026-08-14', title: '킥오프' }];
const ANCHOR = { quote: '법무팀은 수작업으로 합니다.', note_id: 'n1', met_on: '2026-08-14', note_title: '킥오프' };
const DEAL = {
  customer: '한빛금융', source: 'portal',
  lead_message: '전사 문서 업무에 AI 를 도입하려 합니다.',
  customer_meta: { industry: 'Finance', companySize: '1000+', securityStack: 'zscaler' },
  customer_contact_name: '박확인',
  readiness_scores: { G1: 3, G3: 2, T1: 4, D2: 2 },
  inquiry_products: ['openai-enterprise']
};
const ctx = (handoff = {}, extra = {}) => ({
  deal: DEAL, handoff, notes: NOTES, openItems: [], today: '2026-08-14', ...extra
});
const FULL = {
  workflow: { value: '계약 검토 요약', quote: ANCHOR },
  pilotGroup: { value: '법무팀 12명 (확정)' },
  stakeholders: { value: '스폰서 CFO' },
  successCriteria: { value: '40분 → 25분' },
  nextSteps: { value: '8/28 보안 검토' }
};

test('브리프가 Deployment Brief §A 14필드를 그대로 낸다', () => {
  assert.equal(D.BRIEF_SECTIONS.length, 14);
  const md = D.buildBrief(ctx(FULL));
  for (const section of D.BRIEF_SECTIONS) {
    assert.ok(md.includes(`### ${section.no}. ${section.title}`), `§A ${section.no} 이 없다`);
  }
  // §B 근거표가 붙는다.
  assert.match(md, /## B\. 근거 · 가정 · 미해결/);
});

test('빈칸을 채우지 않고 미해결로 남긴다', () => {
  const md = D.buildBrief(ctx({}));
  assert.match(md, /_아직 확인되지 않았습니다\._/);
  assert.match(md, /`미해결`/);
  // 그럴듯한 값을 지어내면 배포팀이 그걸 근거로 설계한다.
  assert.ok(!/예: /.test(md), '자리표시자(예시 문구)가 문서에 새어 나갔다');
});

test('§A 12 는 배포 단계 자리라 여기서 안 만든다', () => {
  // deployment-Brief §C 자리다. 여기 만들면 두 번 만든다 — 다만 빈칸을 숨기지도 않는다.
  const md = D.buildBrief(ctx(FULL));
  assert.match(md, /### 12\. 관찰 체계 및 검토 책임/);
  assert.match(md, /배포 단계에서 정합니다 \(Deployment Brief §C\)/);
});

test('내부용이라고 문서 머리에 박는다', () => {
  for (const md of [D.buildBrief(ctx(FULL)), D.buildInterviewGuide(ctx(FULL)), D.buildEvidenceSummary(ctx(FULL))]) {
    assert.match(md, /\*\*내부용\*\*/, '기밀 구분이 없다');
  }
});

test('상업 정보와 포탈 원본 연락처를 안 부른다', () => {
  const code = read('lib/handoff-doc.js').split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
  for (const field of ['unit_price', 'list_price', 'opinion', 'mzc_sales', 'lead_contact_name', 'lead_contact_phone']) {
    assert.ok(!code.includes(field), `${field} 를 읽고 있다`);
  }
  const dump = JSON.stringify(D.buildHandoffExport(ctx(FULL)));
  for (const leak of ['마진', '별도협의', 'unit_price']) {
    assert.ok(!dump.includes(leak), `${leak} 이 스냅샷에 실렸다`);
  }
});

test('인용이 브리프에 출처와 함께 실린다', () => {
  const md = D.buildBrief(ctx(FULL));
  assert.match(md, /> 법무팀은 수작업으로 합니다\./);
  assert.match(md, /출처 2026-08-14 킥오프/);
});

test('회의록이 지워지면 되짚을 수 없다고 적는다', () => {
  // 조용히 지우면 근거가 사라진 줄 모른다.
  const md = D.buildBrief(ctx(FULL, { notes: [] }));
  assert.match(md, /원문 회의록이 삭제되어 되짚을 수 없습니다/);
});

test('인터뷰 가이드가 이미 아는 것을 안 묻는다', () => {
  const empty = D.buildInterviewGuide(ctx({}));
  assert.match(empty, /아래 6개가 지금 비어 있는 칸입니다/);
  const partial = D.buildInterviewGuide(ctx(FULL));
  assert.match(partial, /아래 1개가 지금 비어 있는 칸입니다/);
  assert.ok(!partial.includes('가장 먼저 지원해야 할 구체적인 업무'), '답한 것을 또 묻는다');
  assert.match(partial, /이번 범위에 명시적으로 포함되는 것/, '안 채운 칸은 물어야 한다');
});

test('7영역 등급이 근거 개수로 정해지고 이유가 붙는다', () => {
  // 사람이 눈으로 매기면 딜마다 기준이 달라진다.
  const areas = D.evidenceAreas(ctx({}));
  assert.equal(areas.length, 7);
  const byKey = Object.fromEntries(areas.map((a) => [a.key, a]));
  // 42문항이 실제로 덮는 둘은 진단만으로도 근거가 선다.
  assert.equal(byKey.governance.level, 'good');
  assert.equal(byKey.technical.level, 'good');
  // 나머지는 STEP06 칸이 있어야 찬다.
  assert.equal(byKey.value.level, 'weak');
  assert.deepEqual(byKey.value.have, []);
  assert.equal(byKey.stakeholders.level, 'watch');
  assert.deepEqual(byKey.stakeholders.have, ['영업이 확인한 담당자']);
});

test('추진 방식은 권고이고 이유를 같이 낸다', () => {
  // 문서가 「의사결정 책임자」를 요구한다. 시스템이 판정하면 근거를 못 따진다.
  const full = D.recommendApproach(ctx(FULL));
  assert.equal(full.key, 'proceed');
  assert.equal(full.missing.length, 0);

  const four = D.recommendApproach(ctx({ ...FULL, nextSteps: { value: '' }, stakeholders: { value: '' } }));
  assert.equal(four.key, 'validate');
  assert.deepEqual(four.missing, ['성과 책임자', '즉시 다음 단계']);

  const none = D.recommendApproach(ctx({}));
  assert.equal(none.key, 'defer');

  // 품질 미충족이 하나라도 있으면 범위를 좁혀야 한다.
  const unmet = D.recommendApproach(ctx({ ...FULL, quality: { observable: 'unmet' } }));
  assert.equal(unmet.key, 'rescope');
  assert.match(unmet.why[0], /미충족이 1건/);

  // 모든 권고에 이유가 붙는다 — 이유 없는 판정은 따질 수가 없다.
  for (const r of [full, four, none, unmet]) assert.ok(r.why.length >= 1);
});

test('요약 문서가 권고를 확정이 아니라 권고로 쓴다', () => {
  const md = D.buildEvidenceSummary(ctx(FULL));
  assert.match(md, /이것은 \*\*권고\*\*입니다/);
  assert.match(md, /확정은 의사결정 책임자가 합니다/);
});

test('스냅샷이 deployment-Brief 가 읽을 모양이다', () => {
  const snap = D.buildHandoffExport(ctx(FULL));
  assert.equal(snap.schema, 'issu.handoff/1');
  assert.equal(snap.confidentiality, 'internal');
  assert.equal(snap.fields.length, 14);
  for (const field of snap.fields) {
    // key + value + status + source + evidence — 계획이 정한 접점 모양이다.
    assert.deepEqual(Object.keys(field).sort(),
      ['evidence', 'key', 'label', 'source', 'status', 'value']);
    assert.match(field.key, /^brief_a_\d+$/);
    assert.ok(['confirmed', 'likely', 'open'].includes(field.status), field.status);
  }
  assert.equal(snap.fields.find((f) => f.key === 'brief_a_4').evidence, ANCHOR.quote);
  assert.equal(snap.recommendation.key, 'proceed');
});

test('상태 어휘가 handoff-snapshot 과 같다', () => {
  // 두 문서가 나란히 놓인다. 말이 갈리면 같은 것을 다르게 읽는다.
  const { STATUS_LABEL } = require('../lib/handoff-snapshot');
  const md = D.buildBrief(ctx(FULL));
  for (const label of [STATUS_LABEL.confirmed, STATUS_LABEL.likely, STATUS_LABEL.open]) {
    assert.ok(md.includes(label), `${label} 표기가 문서에 없다`);
  }
});

test('인쇄 팝업을 한 번만 연다', () => {
  // ⚠ IssuReport.pdf 는 팝업을 열어 인쇄한다. 브라우저가 팝업을 하나만 허용하므로
  //   따로 부르면 **둘째부터 조용히 막힌다** — 화면에는 아무 표시도 안 난다.
  const hub = read('hub.js');
  const fn = hub.slice(hub.indexOf('function exportHandoff'), hub.indexOf('function downloadJson'));
  assert.equal((fn.match(/IssuReport\.pdf\(/g) || []).length, 1, '인쇄 팝업을 여러 번 연다');
  // 셋을 이어 붙여 한 장으로 낸다.
  for (const doc of ['buildBrief', 'buildInterviewGuide', 'buildEvidenceSummary']) {
    assert.ok(fn.includes(`lib.${doc}(full)`), `${doc} 가 빠졌다`);
  }
  // 스냅샷은 기계가 읽는다. PDF 로 만들면 쓸 수 없다.
  assert.match(fn, /downloadJson\(lib\.buildHandoffExport/);
  // 이어 붙인 문서가 새 페이지에서 시작해야 한 장에 겹치지 않는다.
  assert.match(read('report.js'), /h1:not\(:first-of-type\) \{ break-before: page; \}/);
});

test('고객에게 나가는 문서는 PDF 만 낸다', () => {
  // Word·Markdown 으로 주면 우리 문구가 고쳐진 채로 돌아다닌다.
  const hub = read('hub.js');
  const at = hub.indexOf("$('#customer-kit')?.addEventListener");
  const fn = hub.slice(at, at + 800);
  assert.match(fn, /IssuReport\.pdf\(/);
  assert.ok(!/IssuReport\.(docx|markdown)\(/.test(fn), '고객용 키트가 편집 가능한 형식으로 나간다');
});

test('화면이 문서 규칙을 따로 짜지 않는다', () => {
  // 두 곳에 적으면 영업이 보는 문서와 검사가 보는 문서가 갈린다.
  const hub = read('hub.js');
  assert.match(hub, /window\.IssuHandoff/);
  for (const fn of ['buildBrief', 'buildInterviewGuide', 'buildEvidenceSummary', 'buildHandoffExport']) {
    assert.ok(hub.includes(`lib.${fn}(`), `화면이 ${fn} 을 안 쓴다`);
    assert.ok(!hub.includes(`function ${fn}(`), `화면이 ${fn} 을 다시 만들었다`);
  }
});

test('인계 스크립트가 로그인 뒤에만 나가고 프로덕션에서 404 가 안 난다', () => {
  const server = read('server.js');
  // 내부용이라 공개 자산이 아니다.
  const publicBlock = server.slice(server.indexOf('const publicFrontendAssets'), server.indexOf('const authedFrontendAssets'));
  assert.ok(!publicBlock.includes('handoff'), '인계 문서 규칙이 비로그인에 나간다');
  const authedBlock = server.slice(server.indexOf('const authedFrontendAssets'), server.indexOf('for (const [route, filename]'));
  for (const file of ['handoff-doc.js', 'handoff-fields.js', 'handoff-snapshot.js', 'meeting-notes.js']) {
    assert.ok(authedBlock.includes(file), `${file} 이 서빙되지 않는다`);
  }
  // ⚠ APP_SURFACE 를 빠뜨리면 로컬은 멀쩡하고 프로덕션에서만 404 다.
  const surface = server.slice(server.indexOf('const allowed = {'), server.indexOf('if (!allowed)'));
  assert.match(surface, /hub: [^\n]*startsWith\('\/lib\/'\)/, 'hub 분기에 /lib/ 이 없다');
  // hub.html 이 순서대로 부른다 — handoff-doc 이 앞의 셋을 전역으로 읽는다.
  const html = read('hub.html');
  const order = ['handoff-fields.js', 'handoff-snapshot.js', 'meeting-notes.js', 'handoff-doc.js']
    .map((f) => html.indexOf(f));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '스크립트 순서가 어긋나면 전역이 비어 있다');
});

test('브라우저에서 <script> 로 나란히 불러도 죽지 않는다', () => {
  // ⚠ 두 번 데였다. node require 검사는 통과하고 **브라우저에서만** 터진다 —
  //   ① module.exports 를 맨몸으로 두면 ReferenceError
  //   ② top-level const(asArray 등)가 전역에서 겹쳐 SyntaxError
  //   화면은 조용히 버튼만 안 먹으므로 여기서 실제로 실행해 본다.
  const vm = require('node:vm');
  const context = { console };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['lib/handoff-fields.js', 'lib/handoff-snapshot.js',
    'lib/meeting-notes.js', 'lib/handoff-doc.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  assert.ok(context.IssuHandoff, 'window.IssuHandoff 가 안 생겼다');
  assert.equal(context.IssuHandoff.BRIEF_SECTIONS.length, 14);
  // 문서가 실제로 만들어져야 한다 — 전역만 생기고 안 도는 경우가 있다.
  const md = context.IssuHandoff.buildBrief({
    deal: { customer: 'A' }, handoff: {}, notes: [], openItems: [], today: '2026-08-14'
  });
  assert.match(md, /Deployment Brief/);
});

test('인계 브리프 버튼이 단계 리포트 버튼과 무게가 다르다', () => {
  // 이 버튼은 문서 넷을 한 번에 만든다. 옆의 PDF/Word/Markdown 은 지금 단계 하나다.
  const css = read('hub.css');
  assert.match(css, /#handoff-brief \{[^}]*min-width:/, '폭이 지정돼 있지 않다');
});
