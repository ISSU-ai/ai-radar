'use strict';

/**
 * /readiness 42문항 → 딜 → /hub 연동.
 *
 * 이 경로가 끊기면 고객이 42문항을 다 답해도 영업은 빈 딜을 본다. 화면에서는
 * "접수 완료" 가 뜨기 때문에 아무도 모른 채로 지나간다. 그래서 배선 자체를 건다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateLead, normaliseDealPatch } = require('../lib/hub-domain');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const baseLead = {
  customer: '연동테스트', contact: 'a@b.co.kr', contact_name: '김테스트',
  contact_phone: '02-1111-2222', message: '연동 확인', consent: true
};

// ── 접수 ─────────────────────────────────────────────────────────
test('리드에 42문항 응답을 실어 보낼 수 있다', () => {
  const lead = validateLead({ ...baseLead, readiness_scores: { S1: 3, D4: 1 } });
  assert.deepEqual(lead.readiness_scores, { S1: 3, D4: 1 });
});

test('42문항이 없으면 빈 객체로 지나간다 — 기존 리드 경로가 깨지지 않는다', () => {
  assert.deepEqual(validateLead(baseLead).readiness_scores, {});
});

test('공개 리드는 42문항 진단을 거쳐야 들어온다', () => {
  // 판정 기준이 Appendix A 로 바뀌면서 고객이 답하는 문항집은 42문항 하나뿐이다.
  // 진단 없이 리드만 들어오면 영업이 맥락 없이 만난다.
  const server = read('server.js');
  const open = server.indexOf('const requireReadinessScores');
  assert.ok(open > 0, 'requireReadinessScores 가 있어야 한다');
  const body = server.slice(open, open + 700);
  assert.match(body, /readiness_scores/);
  assert.match(body, /return next\(\)/);
  assert.ok(!/requireCompleteFqaScores/.test(server), '21문항 게이트가 남아 있다');
});

// ── 채점과 bridge ────────────────────────────────────────────────
test('접수 때 채점하고 bridge 로 평가영역을 채운다', () => {
  const routes = read('routes/hub.js');

  const at = routes.indexOf('const applyAssessment');
  assert.ok(at > 0, 'applyAssessment 가 있어야 한다');
  const body = routes.slice(at, routes.indexOf('router.get(', at));
  assert.match(body, /bridgeAssessmentScores/, '037 bridge 로 평가영역을 채워야 한다');
  assert.match(body, /scoreAssessment/);
  assert.match(body, /\{ \.\.\.bridged, \.\.\.\(manualScores \|\| \{\}\) \}/,
    '영업이 확인한 값이 자동 채움을 이겨야 한다');
  assert.match(routes, /hasColumn\('assessment_areas', 'checkpoints'\)/,
    '036 미적용 구간에도 접수는 성공해야 한다');
});

test('21문항 경로가 남아 있지 않다', () => {
  const routes = read('routes/hub.js');
  for (const dead of ['bridgeFqaScores', 'loadFqaItems', 'calculateFqaTotals',
    "'/public/fqa-items'", "'/public/diagnose'"]) {
    assert.ok(!routes.includes(dead), `21문항 경로가 남았다: ${dead}`);
  }
});

test('031 미적용 구간에도 접수가 살아남는다', () => {
  const routes = read('routes/hub.js');
  assert.match(routes, /hasColumn\('deals', 'readiness_scores'\)/);
  assert.match(routes, /hasReadinessCols && readiness/,
    '컬럼이 없으면 준비도만 빼고 딜은 만들어야 한다');
});

// ── 영업 수정과 고객 원본 ────────────────────────────────────────
test('영업은 42문항을 고칠 수 있고, 집계는 고칠 수 없다', () => {
  // STEP02 가 42문항이 되면서 영업도 채운다 — 수동·시트 딜은 응답이 아예 없다.
  // 다만 집계(readiness_totals)는 서버가 낸다. 화면이 보내게 두면 고객 리포트의
  // 숫자와 갈라진다.
  const patch = normaliseDealPatch({
    readiness_scores: { S1: 5 },
    readiness_totals: { average: 5 },
    readiness_customer_scores: { S1: 1 }
  });
  assert.deepEqual(patch, { readiness_scores: { S1: 5 } });
});

test('고객 원본을 따로 남긴다 (032)', () => {
  // 가르지 않으면 영업이 한 번 고친 순간 고객이 뭐라고 답했는지 되찾을 수 없다.
  const sql = read('db/migrations/032_deal_readiness_source.sql');
  assert.match(sql, /add column if not exists readiness_customer_scores jsonb/);
  assert.match(sql, /where readiness_scores <> '\{\}'::jsonb/, '기존 딜 백필이 있어야 한다');
  assert.match(sql, /and readiness_customer_scores = '\{\}'::jsonb/, '백필이 멱등이어야 한다');
  assert.match(read('scripts/apply-migrations.js'), /'032_deal_readiness_source\.sql'/);
  assert.match(read('routes/hub.js'), /hasColumn\('deals', 'readiness_customer_scores'\)/);
});

test('영업이 42문항을 고치면 서버가 다시 채점하고 평가영역을 다시 채운다', () => {
  const routes = read('routes/hub.js');
  const open = routes.indexOf('if (patch.readiness_scores)');
  assert.ok(open > 0, 'PATCH 가 42문항을 처리하지 않는다');
  const body = routes.slice(open, routes.indexOf('const JSONB_DEAL_FIELDS', open));

  assert.match(body, /partial: true/, '영업은 채워 넣는 중이라 부분 응답이 정상이다');
  assert.match(body, /applyAssessment\(patch\.readiness_scores/);
  assert.match(body, /previouslyBridged/,
    '영업이 확인해 넣은 평가영역이 42문항 수정 때마다 지워지면 안 된다');
  for (const field of ['assessment_scores', 'assessment_totals', 'readiness_scores', 'prereq_confirmations']) {
    assert.ok(routes.includes(`'${field}'`), `${field} 가 jsonb 직렬화 목록에 없다`);
  }
});

// ── 허브 화면 ────────────────────────────────────────────────────
test('허브가 준비도 결과를 그대로 보여준다 — 다시 계산하지 않는다', () => {
  const hub = read('hub.js');
  assert.match(hub, /function renderReadinessPanel/);
  assert.match(hub, /state\.deal\.readiness_totals/);
  assert.match(hub, /renderReadinessPanel\(\)/, 'STEP02 에서 실제로 불러야 한다');
  assert.ok(!/scoreReadiness|areaScores|\/ 7\b/.test(hub),
    '허브가 42문항을 다시 채점하면 안 된다');
});

test('고객이 답한 값과 영업이 고친 값을 구분해 보여준다', () => {
  // 제안 근거가 고객 응답인지 영업 추정인지 구분이 안 되면 고객 앞에서 못 쓴다.
  const hub = read('hub.js');
  assert.match(hub, /rd-tag customer/);
  assert.match(hub, /rd-tag edited/);
  assert.match(hub, /readiness_customer_scores/);
  assert.match(read('hub.css'), /\.rd-tag\.customer/);
  assert.match(read('hub.css'), /\.rd-tag\.edited/);
});

test('응답이 없어도 STEP02 가 뜬다 — 영업이 채울 화면이다', () => {
  // 예전 21문항 시절에는 패널을 감췄지만 이제 STEP02 자체가 진단이다.
  // 감추면 수동·시트 딜에서 진단을 시작할 방법이 없다.
  const hub = read('hub.js');
  const open = hub.indexOf('function renderReadinessPanel');
  const body = hub.slice(open, hub.indexOf('function customerAnsweredCount', open));
  assert.doesNotMatch(body, /if \(!totals\.average[^\n]*return ''/);
  assert.match(body, /응답 대기/, '점수가 없으면 대기 상태로 그려야 한다');
  assert.match(body, /if \(!items\.length\)/, '문항 자체가 없을 때만 안내로 대체한다');
});

// ── 진단 화면의 상담 폼 ──────────────────────────────────────────
test('진단 결과 화면에서 응답과 함께 상담을 요청한다', () => {
  const html = read('readiness.html');
  const js = read('readiness.js');

  assert.match(html, /id="lead-form"/);
  assert.match(js, /readiness_scores: state\.scores/,
    '42문항 응답이 리드에 실려야 한다 — 안 실으면 답한 게 버려진다');
  assert.match(js, /'\/api\/hub\/public\/leads'/);
  assert.ok(!/<a[^>]*href="\/#contact"[^>]*class="button primary"/.test(html),
    '랜딩으로 보내면 응답이 사라진다');

  // 결과를 본 뒤에만 연다
  assert.match(html, /id="contact" class="rd-contact section-wrap hidden"/);
  assert.match(js, /\$\('#contact'\)\.classList\.remove\('hidden'\)/);
});

test('상담 폼이 taxonomy 어휘를 쓴다', () => {
  // 여기서 직접 적으면 허브의 업종·규모 값과 갈라져 필터가 안 먹는다.
  const js = read('readiness.js');
  assert.match(js, /window\.IssuTaxonomy\.INDUSTRIES/);
  assert.match(js, /window\.IssuTaxonomy\.COMPANY_SIZES/);
  assert.match(read('readiness.html'), /src="\/taxonomy\.js"/);
});

test('수집 항목 고지에 준비도 응답이 들어 있다', () => {
  // 42문항 응답을 함께 보내면서 고지에 없으면 동의받은 범위를 넘는다.
  const html = read('readiness.html');
  const open = html.indexOf('rd-privacy-title');
  const body = html.slice(open, html.indexOf('</div>', open));
  for (const field of ['담당자 이름', '업무 이메일', '전화번호', '42문항']) {
    assert.ok(body.includes(field), `고지에 ${field} 이(가) 없다`);
  }
});

// ── 마이그레이션 ─────────────────────────────────────────────────
test('031 이 컬럼만 만들고 자동 적용에 들어간다', () => {
  const sql = read('db/migrations/031_deal_readiness.sql');
  assert.match(sql, /add column if not exists readiness_scores jsonb/);
  assert.match(sql, /add column if not exists readiness_totals jsonb/);
  assert.ok(!/insert into|update /.test(sql.split('-- 확인')[0]),
    '데이터를 건드리면 자동 적용에 넣을 수 없다');
  assert.match(read('scripts/apply-migrations.js'), /'031_deal_readiness\.sql'/);
});

test('목업이 037 bridge 와 036 평가영역을 직접 읽고 딜까지 만든다', () => {
  // 베껴 두면 실제와 어긋나고, 딜을 안 만들면 연동을 로컬에서 확인할 수 없다.
  const mock = read('scripts/mock-ui-server.js');
  assert.match(mock, /036_assessment_criteria\.sql/);
  assert.match(mock, /037_readiness_assessment_bridge\.sql/);
  assert.match(mock, /mockApplyAssessment/);
  assert.match(mock, /deals\.push\(/);
  assert.ok(!mock.includes('030_readiness_fqa_bridge.sql'), '21문항 bridge 가 남아 있다');
});

test('21문항이 화면·목업·라우트 어디에도 없다', () => {
  for (const file of ['hub.js', 'routes/hub.js', 'server.js', 'scripts/mock-ui-server.js']) {
    const body = read(file).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const dead of ['fqa_scores', 'fqa_totals', 'fqaItems', 'fqa_coverage', "kind: 'fqa'"]) {
      // leads.fqa_scores 는 접수 당시 기록이라 남긴다(040 주석 참조)
      if (file === 'routes/hub.js' && dead === 'fqa_scores') continue;
      assert.ok(!body.includes(dead), `${file} 에 21문항이 남았다: ${dead}`);
    }
  }
});

test('040 이 지우는 것을 전부 적었다', () => {
  const sql = read('db/migrations/040_drop_fqa.sql');
  for (const target of [
    'alter table deals drop column if exists fqa_scores',
    'alter table solutions drop column if exists fqa_coverage',
    'alter table packages  drop column if exists readiness_lift',
    'drop table if exists readiness_fqa_bridge',
    'drop table if exists fqa_items'
  ]) {
    assert.ok(sql.includes(target), `040 이 안 지운다: ${target}`);
  }
  // 되돌릴 수 없으므로 적용 전 확인 절차를 파일에 남긴다
  assert.match(sql, /되돌릴 수 없다/);
  assert.match(sql, /적용 전 확인/);
  // leads.fqa_scores 는 동의 이력과 같은 자리의 기록이라 남긴다
  assert.ok(!/alter table leads drop column/.test(sql));
});

// ── 고객 진단은 한 곳뿐이다 ──────────────────────────────────────
test('랜딩이 21문항을 직접 받지 않는다', () => {
  // 21문항은 ISV 전제조건 판정용이라 영업이 답할 문항이다. 고객에게 물으면
  // "답할 수 없는 문항" 이 생기고, 그 응답으로 판정이 돌아간다.
  const html = read('offering.html');
  const js = read('offering.js');

  assert.ok(!/id="questions"|category-tab|calculate-result/.test(html),
    '랜딩에 21문항 진단 패널이 남아 있다');
  assert.ok(!/public\/fqa-items|public\/diagnose/.test(js),
    '랜딩이 아직 21문항 API 를 부른다');
  assert.ok(!/id="lead-form"/.test(html),
    '진단을 안 거친 상담 폼이 랜딩에 남아 있다 — 게이트가 400 으로 막는다');
});

test('랜딩의 진단 경로가 전부 /readiness 로 간다', () => {
  const html = read('offering.html');
  for (const [label, pattern] of [
    ['상단 CTA', /class="nav-cta" href="\/readiness"/],
    ['진단 시작 버튼', /id="start-assessment"[^>]*href="\/readiness"/],
    ['상담 안내', /class="contact-cta"[\s\S]*?href="\/readiness"/]
  ]) {
    assert.match(html, pattern, `${label} 가 /readiness 로 가지 않는다`);
  }
});

test('랜딩이 영역·문항 수를 API 에서 받는다', () => {
  // 베껴 두면 문항을 늘렸을 때 랜딩만 옛 숫자를 말한다. 고객이 "42문항" 을 보고
  // 들어갔는데 49문항이 나온다.
  const js = read('offering.js');
  assert.match(js, /public\/readiness-items/);
  assert.match(js, /#item-count/);
  assert.ok(!/'S'.*'P'.*'D'.*'T'/.test(js), '랜딩이 축 목록을 다시 적고 있다');
});

test('한쪽이 죽어도 나머지는 뜬다', () => {
  // 오퍼링 목록이 안 뜬다고 진단 입구까지 닫을 이유가 없다.
  const js = read('offering.js');
  assert.match(js, /Promise\.allSettled/);
});

test('진단 화면에서 랜딩으로 돌아올 수 있다', () => {
  // 좁은 화면에서는 상단 nav 링크가 숨는다(offering.css 900px). 본문에도 있어야
  // 진단만 보고 나가는 길이 브랜드 로고뿐인 상황이 안 생긴다.
  const html = read('readiness.html');
  assert.match(html, /<nav><a href="\/">홈<\/a>/, '상단에 홈 링크가 없다');
  assert.match(html, /class="rd-back" href="\/"/, '본문에 홈 링크가 없다');
  assert.match(read('readiness.css'), /\.rd-back/);
});

// ── 미흡 영역을 ISV 로 넘긴다 ────────────────────────────────────
test('3점 미만 영역과 근거 문항을 STEP03 으로 넘긴다', () => {
  // 숫자만 넘기면 STEP03 에서 "왜 이 ISV 인가" 에 답할 수 없다. 고객이 자기가
  // 고른 말을 다시 읽게 하는 것이 근거로 가장 강하다.
  const hub = read('hub.js');
  const open = hub.indexOf('function renderReadinessGaps');
  assert.ok(open > 0, 'renderReadinessGaps 가 없다');
  const body = hub.slice(open, hub.indexOf('function renderResidualFqa', open));

  assert.match(body, /Number\(area\.score\) < 3/, '3점 미만을 미흡으로 잡아야 한다');
  assert.match(body, /totals\.priorities/, '근거 문항이 있어야 한다');
  assert.match(body, /item\.rubric/, '고른 루브릭 문장이 붙어야 한다');
  assert.match(body, /id="handoff-isv"/);
  assert.match(hub, /renderReadinessGaps\(\)/, 'STEP02 에서 실제로 불러야 한다');

  // 넘어가면서 다시 계산한다 — 방금 고친 응답이 빠진 추천을 보여주면 안 된다
  assert.match(hub, /#handoff-isv'\)\?\.addEventListener[\s\S]{0,220}selectStage\(2\)/);
  assert.match(hub, /#handoff-isv'\)\?\.addEventListener[\s\S]{0,260}loadRecommendations\(\)/);
  assert.match(read('hub.css'), /\.rd-gaps/);
});

test('미흡이 없으면 보완이 아니라 확산으로 말한다', () => {
  const hub = read('hub.js');
  const open = hub.indexOf('function renderReadinessGaps');
  const body = hub.slice(open, hub.indexOf('function renderResidualFqa', open));
  assert.match(body, /if \(!weak\.length\)/);
  assert.match(body, /확산 관점/);
});

test('STEP03 추천 패널이 42문항 근거를 같이 보여준다', () => {
  // 판정은 21문항 게이트로 돌지만, 영업이 고객에게 말할 때 쓰는 언어는 42문항이다.
  const hub = read('hub.js');
  assert.match(hub, /reco-from-readiness/);
  assert.match(hub, /STEP 02 근거/);
  assert.match(read('hub.css'), /\.reco-from-readiness/);
});

// ── 단계별 다운로드 ──────────────────────────────────────────────
test('다섯 단계가 똑같은 다운로드 버튼을 갖는다', () => {
  // 단계마다 다르면 영업이 "여기는 되고 저기는 안 되네" 를 매번 확인해야 한다.
  const hub = read('hub.js');
  const open = hub.indexOf('const STAGE_REPORT_ACTIONS');
  assert.ok(open > 0, 'STAGE_REPORT_ACTIONS 가 없다');
  const block = hub.slice(open, hub.indexOf('function stageHeader', open));
  for (const kind of ['pdf', 'docx', 'md']) {
    assert.match(block, new RegExp(`data-report="${kind}"`), `${kind} 버튼이 없다`);
  }
  // stageHeader 하나에만 넣어야 다섯 단계가 같아진다
  assert.match(hub, /function stageHeader[\s\S]{0,400}\$\{STAGE_REPORT_ACTIONS\}/);
  assert.equal((hub.match(/data-report="pdf"/g) || []).length, 1,
    '버튼을 단계마다 또 적으면 갈라진다');
  assert.match(read('hub.css'), /\.stage-report/);
});

test('내려받는 내용이 지금 보고 있는 단계의 것이다', () => {
  const hub = read('hub.js');
  const open = hub.indexOf("$$('[data-report]')");
  const body = hub.slice(open, hub.indexOf('});', hub.indexOf('IssuReport.pdf', open)));
  assert.match(body, /const stage = state\.activeStage/);
  assert.match(body, /buildStageReport\(stage\)/);
  assert.match(body, /STEP\$\{String\(stage \+ 1\)\.padStart\(2, '0'\)\}/, '파일명에 단계가 들어가야 한다');
  for (const call of ['IssuReport.markdown', 'IssuReport.docx', 'IssuReport.pdf']) {
    assert.ok(body.includes(call), `${call} 배선이 없다`);
  }
});

test('단계별 리포트가 같은 머리말을 쓴다', () => {
  // 여러 단계를 뽑아 붙여 놓았을 때 어느 고객의 어느 단계인지가 섞이면 안 된다.
  const hub = read('hub.js');
  const open = hub.indexOf('function reportHeader');
  const body = hub.slice(open, hub.indexOf('function intakeReport', open));
  assert.match(body, /STAGE_REPORT_TITLES\[stageIndex\]/);
  assert.match(body, /단계 \| STEP/);
  assert.match(body, /작성일/);

  const build = hub.slice(hub.indexOf('function buildStageReport'), hub.indexOf('function renderPitch'));
  assert.match(build, /reportHeader\(stageIndex\)/);
  for (const fn of ['intakeReport', 'readinessReport', 'solutionsReport', 'packagesReport']) {
    assert.ok(build.includes(fn), `${fn} 가 buildStageReport 에 없다`);
  }
});

test('리포트가 화면에 없는 숫자를 만들지 않는다', () => {
  const hub = read('hub.js');
  const open = hub.indexOf('function readinessReport');
  const body = hub.slice(open, hub.indexOf('function solutionsReport', open));
  assert.match(body, /state\.deal\.readiness_totals/);
  assert.ok(!/reduce\([^)]*\+[^)]*\)\s*\/\s*/.test(body), '리포트가 평균을 다시 내고 있다');
  assert.match(body, /고객|영업 수정/, '문항 출처가 표에 있어야 한다');
});

// ── 화면 문구 ────────────────────────────────────────────────────
test('단계 이름이 42문항 기준이다', () => {
  const { PIPELINE_STAGES } = require('../lib/hub-domain');
  assert.equal(PIPELINE_STAGES[1], 'AI 준비도 진단');
  assert.ok(!PIPELINE_STAGES.includes('PoC 검증'));
  assert.match(read('scripts/mock-ui-server.js'), /'AI 준비도 진단'/,
    '목업 단계 이름이 어긋나면 화면 확인이 거짓말이 된다');
  assert.match(read('hub.js'), /stageHeader\('03', 'ISV 조합 추천'/);
});

test('허브 화면에 21문항 문구가 없다', () => {
  const hub = read('hub.js');
  // 주석은 bridge 가 왜 있는지를 설명한다. 화면에 나가는 문자열만 본다.
  const strings = hub
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const dead of ['21항목', 'ISV 판정 문항', 'PoC 검증', 'bridgeNote']) {
    assert.ok(!strings.includes(dead), `화면에 "${dead}" 가 남아 있다`);
  }
});

test('접수 후 랜딩으로 돌려보내되 머무를 수 있다', () => {
  // 접수까지 끝나면 이 화면에서 할 일이 없다. 다만 바로 넘기면 접수 여부를 못 보고
  // 다시 넣는다 — 읽을 시간을 주고, 리포트를 더 볼 사람은 남을 수 있어야 한다.
  const js = read('readiness.js');
  const open = js.indexOf('function startHomeCountdown');
  assert.ok(open > 0, 'startHomeCountdown 이 없다');
  const body = js.slice(open, js.indexOf('// ── 시작', open));

  assert.match(body, /window\.location\.href = '\/'/);
  assert.match(body, /clearInterval\(timer\)/, '취소하면 타이머가 멈춰야 한다');
  assert.match(body, /stay-here/);
  assert.match(js, /lead-success'\)\.classList\.remove\('hidden'\)[\s\S]{0,400}startHomeCountdown\(\)/,
    '접수 성공 뒤에만 걸려야 한다');
  const calculateBody = js.slice(js.indexOf('async function calculate'), js.indexOf('function renderResult'));
  assert.ok(!/startHomeCountdown|location\.href/.test(calculateBody),
    '결과 확인 직후에 걸면 고객이 자기 점수를 못 본다');
  assert.match(read('readiness.html'), /id="lead-redirect"/);
});

// ── 034 · 고객 진입 시나리오 ─────────────────────────────────────
test('034 — 트랙이 진입 시나리오 3유형으로 바뀐다', () => {
  const sql = read('db/migrations/034_entry_scenarios.sql');
  for (const [id, name] of [['E-1', '빠른 도입형'], ['E-2', '개발 생산성형'], ['E-3', '서비스 개발형']]) {
    assert.match(sql, new RegExp(`'${id}', '${name}'`), `${id} ${name} 이 없다`);
  }
  assert.match(sql, /delete from tracks where id in \('T-A', 'T-B', 'T-C', 'T-D'\)/);
});

test('034 — 딜을 옮긴 뒤에 옛 트랙을 지운다', () => {
  // deals.track 이 tracks(id) 를 참조한다. 순서가 바뀌면 FK 위반으로 통째로 롤백된다.
  const sql = read('db/migrations/034_entry_scenarios.sql');
  const insertAt = sql.indexOf('insert into tracks');
  const updateAt = sql.indexOf('update deals set track');
  const deleteAt = sql.indexOf('delete from tracks');
  assert.ok(insertAt < updateAt && updateAt < deleteAt,
    `순서가 틀렸다: insert ${insertAt} → update ${updateAt} → delete ${deleteAt}`);
  assert.match(sql, /where track in \('T-A', 'T-B', 'T-C', 'T-D'\)/, '이관 대상이 명시돼야 한다');
});

test('034 — 판정 문구의 T-D 참조를 정리한다', () => {
  // 019 의 red_flag 가 "T-D 트랙" 을 가리킨다. 화면에 그대로 나가는 문장이다.
  const sql = read('db/migrations/034_entry_scenarios.sql');
  assert.match(sql, /update solutions set red_flags = replace/);
  assert.match(sql, /T-D 트랙/);
});

test('034 — 추천 필터가 트랙 대신 보안 환경을 직접 본다', () => {
  const engine = read('lib/recommendation-engine.js');
  const at = engine.indexOf("candidate.slot === 'security-gateway'");
  assert.ok(at > 0);
  const body = engine.slice(engine.lastIndexOf('const swg', at) - 400, at + 200);
  assert.match(body, /meta\.securityStack/);
  assert.ok(!/deal\.track/.test(body), '아직 트랙을 보고 있다');
  // 트랙이 판정에 다시 물리면 영업이 손으로 바꿔 보안 환경과 어긋난다
  assert.ok(!/deal\.track === '/.test(engine), '엔진이 특정 트랙 id 에 물려 있다');
});

test('034 — 화면·목업에 옛 트랙이 남지 않았다', () => {
  for (const file of ['hub.js', 'hub.css', 'scripts/mock-ui-server.js']) {
    const body = read(file).replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/T-[ABCD]\b/.test(body), `${file} 에 옛 트랙이 남아 있다`);
  }
});

// ── 화면 문구·동작 ───────────────────────────────────────────────
test('미응답 보정은 남은 것만 따라간다', () => {
  // 다 채운 영역을 다시 훑게 하면 거기서 이탈한다.
  const js = read('readiness.js');
  assert.match(js, /function remainingFixes/);
  assert.match(js, /state\.fixing\.filter\(\(code\) => !state\.scores\[code\]\)/);
  assert.match(js, /function goToFix/);
  // 다음 버튼이 보정 중에는 남은 미응답으로 간다
  assert.match(js, /#next-area'\)\.addEventListener[\s\S]{0,300}goToFix\(left\[0\]\)/);
  // 마지막 하나를 채우면 결과 확인으로 데려간다
  assert.match(js, /remainingFixes\(\)\.length === 0[\s\S]{0,200}#finish'\)\?\.scrollIntoView/);
  // 결과가 나오면 보정 모드를 끝낸다
  assert.match(js, /state\.fixing = \[\];\s*\n\s*state\.result = result/);
});

test('고객에게 제품명을 묻지 않는다', () => {
  // 보안 담당자가 아닌 사람도 답해야 한다.
  const html = read('readiness.html');
  const at = html.indexOf('name="securityStack"');
  const block = html.slice(at, html.indexOf('</select>', at));
  assert.ok(!/Zscaler|SWG/i.test(block), `고객 폼에 제품명이 있다: ${block}`);
  assert.match(block, /value="existing"/);
  assert.match(block, /value="managed"/);

  // 영업 화면에는 제품 확정 선택지가 남는다
  const hub = read('hub.js');
  assert.match(hub, /value="zscaler"/);
  assert.match(hub, /value="other-swg"/);
  assert.match(hub, /value="existing"/, '고객이 답한 값이 허브에서 사라지면 안 된다');
});

test('모르는 보안 환경으로 후보를 거르지 않는다', () => {
  // "장비는 있는데 무엇인지 모른다" 로 게이트웨이 후보를 빼면 조용히 틀린다.
  const engine = read('lib/recommendation-engine.js');
  assert.match(engine, /unknownStack = \['none', '없음', 'unknown', '미정', 'existing', 'managed'\]/);
});

test('미응답 오류에 대상 목록이 같이 내려간다', () => {
  // sendError 가 메시지만 담아 화면이 어디를 고쳐야 할지 몰랐다. 목업은 내려보내서
  // 로컬에서만 정상으로 보였다 — 프로덕션에서만 나는 종류다.
  const routes = read('routes/hub.js');
  const open = routes.indexOf('const sendError = (res, error');
  const body = routes.slice(open, routes.indexOf('const sendPublicUnavailable', open));
  assert.match(body, /Array\.isArray\(error\?\.unanswered\)/);
  // 에러 객체를 통째로 직렬화하면 스택·쿼리가 공개 응답에 섞인다
  assert.ok(!/\.\.\.error/.test(body), '화이트리스트여야 한다');

  // 화면이 그 목록으로 이동한다
  const js = read('readiness.js');
  assert.match(js, /error\.payload\?\.unanswered/);
  assert.match(js, /showUnanswered\(codes\)/);
});
