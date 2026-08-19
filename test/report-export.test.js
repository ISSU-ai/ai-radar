'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/**
 * report.js 는 브라우저 전역에 붙는 스크립트다. 최소한의 window 만 만들어 실행한다.
 * 여기서 검증하는 건 "생성한 .docx 가 Word 가 열 수 있는 zip 인가" 하나다 —
 * 문서가 안 열리면 영업이 고객 앞에서 파일을 못 여는 사고가 나고, 그건 화면에서
 * 확인이 안 되는 종류의 실패다.
 */
function loadReport() {
  const source = fs.readFileSync(path.join(root, 'report.js'), 'utf8');
  const made = [];
  class SpyBlob extends Blob {
    constructor(parts, options) { super(parts, options); made.push(this); }
  }
  const sandbox = {
    TextEncoder,
    Blob: SpyBlob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } },
    setTimeout,
    alert: () => {},
    open: () => null
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'report.js' });
  sandbox.lastBlob = () => made[made.length - 1];
  return sandbox;
}

/** 저장 전용 zip 을 풀어 { 경로: 내용 } 으로 돌려준다. CRC 도 같이 확인한다. */
function readZip(buffer) {
  const out = {};
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const crc = buffer.readUInt32LE(offset + 14);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
    const start = offset + 30 + nameLen + extraLen;
    const data = buffer.slice(start, start + size);
    assert.equal(method, 0, `${name} 은 저장(무압축) 방식이어야 한다`);
    assert.equal(zlib.crc32 ? zlib.crc32(data) : crc, crc, `${name} CRC 불일치`);
    out[name] = data.toString('utf8');
    offset = start + size;
  }
  return out;
}

const SAMPLE = `# AI 준비도 진단 결과

| 영역 | 점수 |
|---|---|
| A · 보안·데이터 | 1.8 / 5 |
| B · 연동·기술 | 4.2 / 5 |

## 우선 보완 영역

- **A · 보안·데이터** (1.8 / 5) — 기본 통제를 먼저 정리합니다.
- 두 번째 항목

일반 문단입니다. <태그> & "따옴표" 가 섞여 있습니다.`;

test('마크다운 파서 — 제목·표·목록·문단을 구분한다', () => {
  const { IssuReport } = loadReport();
  const blocks = IssuReport.parse(SAMPLE);
  const kinds = blocks.map((b) => b.type);

  assert.ok(kinds.includes('h'), '제목 블록이 있어야 한다');
  assert.ok(kinds.includes('table'), '표 블록이 있어야 한다');
  assert.equal(blocks.filter((b) => b.type === 'li').length, 2);

  const table = blocks.find((b) => b.type === 'table');
  // VM 컨텍스트에서 만든 배열이라 프로토타입이 달라 deepStrictEqual 이 안 먹는다
  assert.equal(table.rows[0].join('|'), '영역|점수');
  assert.equal(table.rows.length, 3, '헤더 + 데이터 2행');
  // 구분선(|---|)이 데이터 행으로 새어 들어가면 표에 빈 줄이 생긴다
  assert.ok(!table.rows.some((row) => row.every((cell) => /^-*$/.test(cell))));
});

test('.docx — Word 가 여는 zip 구조를 갖춘다', async () => {
  const { IssuReport, lastBlob } = loadReport();
  IssuReport.docx(SAMPLE, '테스트');
  const captured = lastBlob();

  assert.ok(captured, 'docx Blob 이 만들어져야 한다');
  assert.equal(
    captured.type,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  const buffer = Buffer.from(await captured.arrayBuffer());
  assert.equal(buffer.slice(0, 2).toString('latin1'), 'PK', 'zip 시그니처');

  const files = readZip(buffer);
  for (const required of [
    '[Content_Types].xml', '_rels/.rels',
    'word/_rels/document.xml.rels', 'word/styles.xml', 'word/document.xml'
  ]) {
    assert.ok(files[required], `${required} 가 들어 있어야 한다`);
  }

  const doc = files['word/document.xml'];
  assert.match(doc, /<w:document/);
  assert.match(doc, /AI 준비도 진단 결과/, '한글이 UTF-8 로 살아 있어야 한다');
  assert.match(doc, /<w:tbl>/, '표가 실제 워드 표로 나가야 한다');
  assert.match(doc, /<w:pStyle w:val="Heading1"\/>/);

  // XML 이스케이프가 빠지면 Word 가 "읽을 수 없는 내용" 이라며 파일을 거부한다
  assert.match(doc, /&lt;태그&gt;/);
  assert.match(doc, /&amp;/);
  assert.ok(!/<w:t[^>]*>[^<]*<태그>/.test(doc), '원시 꺾쇠가 본문에 남으면 안 된다');
});

test('.docx — 굵게 표기가 런으로 분리된다', async () => {
  const { IssuReport, lastBlob } = loadReport();
  IssuReport.docx('앞 **굵게** 뒤', 'x');

  const files = readZip(Buffer.from(await lastBlob().arrayBuffer()));
  const doc = files['word/document.xml'];
  assert.match(doc, /<w:b\/>[^]*?굵게/, '굵은 런에 w:b 가 붙어야 한다');
  assert.match(doc, /앞/);
  assert.match(doc, /뒤/);
});

test('인쇄용 HTML — 표와 목록이 태그로 나온다', () => {
  const { IssuReport } = loadReport();
  const html = IssuReport.toHtml(SAMPLE);
  assert.match(html, /<h1>AI 준비도 진단 결과<\/h1>/);
  assert.match(html, /<table>[^]*<th>영역<\/th>/);
  assert.match(html, /<ul><li>/);
  assert.match(html, /<strong>A · 보안·데이터<\/strong>/);
  assert.match(html, /&lt;태그&gt;/, 'HTML 이스케이프');
});

test('공개 자산 목록에 report.js 가 들어 있다', () => {
  // offering(비로그인)에서 로드하므로 인증 게이트 뒤에 있으면 고객 화면이 깨진다
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const open = server.indexOf('const publicFrontendAssets');
  const block = server.slice(open, server.indexOf('});', open));
  assert.match(block, /'\/report\.js':\s*'report\.js'/);
  // 반대로 내부 로직이 든 파일이 공개로 새면 안 된다
  assert.ok(!block.includes('hub.js'));
  assert.ok(!block.includes('app.js'));
});

test('리포트를 내려받는 두 페이지가 report.js 를 로드한다', () => {
  // 랜딩은 결과를 보여주지 않으므로 빠졌다. 진단 결과는 /readiness 에만 있다.
  for (const page of ['readiness.html', 'hub.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(html, /<script src="\/report\.js"/, `${page} 에 report.js 로드가 없다`);
    const reportAt = html.indexOf('/report.js');
    const consumerAt = html.indexOf(page === 'readiness.html' ? '/readiness.js' : '/hub.js');
    assert.ok(reportAt < consumerAt, `${page}: report.js 가 먼저 로드돼야 한다`);
  }
});

test('머리글 없는 표(| | |)는 키-값 표로 나간다', async () => {
  // 리포트 상단 메타 표가 이 형태다. 빈 칸을 굵게 감싸면 "****" 가 본문에 찍히고,
  // 머리글 행을 그대로 내면 빈 칸에 회색 음영이 깔린다.
  const { IssuReport, lastBlob } = loadReport();
  const md = '| | |\n|---|---|\n| 진단일 | 2026-08-03 |\n| 업종 | 금융 |';

  IssuReport.docx(md, 'x');
  const doc = readZip(Buffer.from(await lastBlob().arrayBuffer()))['word/document.xml'];
  assert.ok(!doc.includes('****'), '빈 머리글이 별표로 새면 안 된다');
  assert.ok(!doc.includes('F2F2F2'), '머리글이 없으면 음영도 없어야 한다');
  assert.equal((doc.match(/<w:tr>/g) || []).length, 2, '데이터 2행만 나가야 한다');
  assert.match(doc, /진단일/);

  const html = IssuReport.toHtml(md);
  assert.ok(!html.includes('<thead>'), '머리글 없는 표에 thead 를 만들지 않는다');
  assert.match(html, /<td>진단일<\/td>/);

  // 머리글이 있는 표는 그대로 동작해야 한다
  const withHead = IssuReport.toHtml('| 영역 | 점수 |\n|---|---|\n| A | 1.8 |');
  assert.match(withHead, /<thead><tr><th>영역<\/th>/);
});

test('긴 내용 표가 A4 를 넘치지 않게 열 너비를 계산한다', async () => {
  // 진단 리포트의 문항 셀이 89자다. 자동 너비로 두면 그 한 칸이 표를 밀어내
  // 인쇄본이 잘린다 — 실제로 그랬다.
  const { IssuReport, lastBlob } = loadReport();
  const long = '경영진이 AI로 무엇을 할 것인가에 대한 명확한 방향과 3년 이상의 실행 계획을 공식 문서로 수립했습니까?';
  const md = `| 번호 | 문항 | 점수 | 선택한 상태 |\n|---|---|---|---|\n`
    + `| S1 | ${long} | 3점 | 전사 AI 전략은 있으나 실행이 더디다 |\n`
    + `| S2 | ${long} | 2점 | 단기 시범 계획만 있다 |`;

  const html = IssuReport.toHtml(md);
  const cols = [...html.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
  assert.equal(cols.length, 4, '열 4개 너비가 나와야 한다');
  assert.ok(Math.abs(cols.reduce((a, b) => a + b, 0) - 100) < 1.5, `합이 ${cols}`);
  assert.ok(cols[1] > cols[0] * 3, '문항 열이 번호 열보다 훨씬 넓어야 한다');
  assert.ok(Math.max(...cols) <= 55.5, '한 열이 표를 독식하면 안 된다');
  assert.ok(Math.min(...cols) >= 5.5, '한 열이 사라지면 안 된다');
  assert.match(html, /<colgroup>/);

  // Word 도 같은 너비를 받아야 브라우저와 다르게 그리지 않는다
  IssuReport.docx(md, 'x');
  const doc = readZip(Buffer.from(await lastBlob().arrayBuffer()))['word/document.xml'];
  const pct = [...doc.matchAll(/<w:tcW w:w="(\d+)" w:type="pct"\/>/g)].map((m) => Number(m[1]));
  assert.ok(pct.length >= 4, 'tcW 가 pct 로 박혀야 한다');
  assert.ok(!doc.includes('w:type="auto"'), '자동 너비로 두면 Word 가 다시 계산한다');
  // 42행짜리 표가 페이지를 넘어가면 머리글이 반복돼야 무슨 열인지 안다
  assert.match(doc, /<w:trPr><w:tblHeader\/><\/w:trPr>/);
});

test('인쇄 CSS 가 표를 페이지 단위로 자르지 않는다', () => {
  const { IssuReport } = loadReport();
  const css = read('report.js');
  // 표 전체에 break-inside: avoid 를 걸면 한 장을 넘는 표가 통째로 밀려 잘린다
  assert.ok(!/table,\s*ul\s*\{\s*break-inside:\s*avoid/.test(css));
  assert.match(css, /tr\s*\{\s*break-inside:\s*avoid/);
  assert.match(css, /thead\s*\{\s*display:\s*table-header-group/);
  assert.match(css, /table-layout:\s*fixed/, 'colgroup 너비를 강제하려면 필요하다');
  assert.match(css, /word-break:\s*keep-all/, '한국어는 단어 안에서 끊지 않는다');
});

test('인쇄 문서가 인용·상태배지·기울임을 렌더한다', () => {
  // ⚠ 셋 다 파싱이 없어서 백틱·꺾쇠·밑줄이 **문자 그대로 인쇄되고 있었다.**
  //   인계 브리프의 시각적 핵심이 거기 있는데.
  const html = loadReport().IssuReport.toHtml([
    '> 이 문서는 최소 근거 패키지입니다.', '',
    '`가능성 높음` · 출처 2026-08-14 킥오프', '',
    '  > 법무팀은 수작업으로 합니다.', '',
    '_아직 확인되지 않았습니다._'
  ].join('\n'));
  assert.match(html, /<blockquote>이 문서는 최소 근거 패키지입니다\.<\/blockquote>/);
  assert.match(html, /<code>가능성 높음<\/code>/);
  assert.match(html, /<blockquote>법무팀은 수작업으로 합니다\.<\/blockquote>/);
  assert.match(html, /<em>아직 확인되지 않았습니다\.<\/em>/);
  // 백틱·꺾쇠가 본문에 남으면 안 된다.
  assert.ok(!html.includes('&gt; '), '인용 꺾쇠가 본문에 남았다');
  assert.ok(!/`/.test(html), '백틱이 본문에 남았다');
});

test('밑줄이 든 낱말을 기울임으로 잘못 먹지 않는다', () => {
  // field_key 가 brief_a_4 · snake_case 컬럼명이 문서에 자주 나온다.
  const html = loadReport().IssuReport.toHtml('필드 brief_a_4 와 customer_meta_original 을 봅니다.');
  assert.ok(!html.includes('<em>'), 'snake_case 를 기울임으로 먹었다');
  assert.match(html, /brief_a_4/);
});

test('인쇄 CSS 가 배경색을 지키고 색에만 기대지 않는다', () => {
  const source = read('report.js');
  // 없으면 브라우저가 배경을 통째로 지운다 — 배지도 인용 막대도 안 보인다.
  assert.match(source, /print-color-adjust: exact/);
  // 흑백으로 뽑는 사람이 있다. 상태 배지는 테두리로도 구분되어야 한다.
  const badge = source.slice(source.indexOf('code { display: inline-block'));
  assert.match(badge.slice(0, 300), /border: 1px solid/);
  // 인용은 왼쪽 막대로 구분한다.
  assert.ok(/blockquote \{[^}]*border-left: 2px solid/.test(source), '인용 막대가 없다');
});

test('고객이 받는 문서에 어디서 온 것인지가 있다', () => {
  const source = read('report.js');
  assert.match(source, /assets\/megazone-cloud\.png/);
  // 인쇄 창은 about:blank 라 상대 경로가 안 먹는다.
  assert.match(source, /global\.location\.origin/);
  // 이미지가 못 뜨면 자리만 비고 문서는 멀쩡해야 한다.
  assert.match(source, /onerror="this\.remove\(\)"/);
});

/**
 * ⚠ 이 검사가 있는 이유.
 *
 * 인쇄 CSS 는 **아무도 못 보는 코드**다. 브라우저에서 인쇄 미리보기를 열어야만
 * 보이고, 셀렉터가 어긋나도 조용히 아무 일도 안 일어난다. 실제로 그랬다 —
 * 문서 머리의 메타 표를 `h1 + table th` 로 잡아 뒀는데 그 표는 **머리글 줄이 없는
 * 표**라 <th> 가 아예 안 생긴다. 라벨 열 스타일이 한 번도 걸린 적이 없었다.
 *
 * 그래서 「규칙마다 대상이 실제로 있는가」를 센다.
 */
const HANDOFF = require('../lib/handoff-doc');

/** 실제 인계 문서 셋을 그대로 만든다 — 검사용 마크다운을 새로 쓰지 않는다. */
function realDocs() {
  const notes = [{ id: 'n1', met_on: '2026-08-14', title: '킥오프' }];
  const ctx = {
    deal: {
      customer: '한빛금융', source: 'portal',
      lead_message: '전사 문서 업무에 AI 를 도입하려 합니다.',
      customer_meta: { industry: 'Finance', companySize: '1000+' },
      inquiry_products: ['openai-enterprise'],
      readiness_scores: { G1: 3, G3: 2, T1: 4, D2: 2 }
    },
    handoff: {
      whyNow: { value: '연말 감사 대응' },
      workflow: { value: '계약 검토 요약', quote: { quote: '법무팀은 수작업으로 합니다.', note_id: 'n1', met_on: '2026-08-14', note_title: '킥오프' } },
      pilotGroup: { value: '법무팀 12명' }, stakeholders: { value: '스폰서 CFO' },
      successCriteria: { value: '40분 → 25분' }, scope: { value: '고객 PII 제외' },
      nextSteps: { value: '8/28 보안 검토' }
    },
    notes, openItems: ['42문항 중 8개가 미응답입니다.'], today: '2026-08-19'
  };
  return [HANDOFF.buildBrief(ctx), HANDOFF.buildInterviewGuide(ctx), HANDOFF.buildEvidenceSummary(ctx)];
}

test('문서 머리의 메타 표는 <th> 가 없다 — 라벨 열을 td 로 잡아야 한다', () => {
  const html = loadReport().IssuReport.toHtml(realDocs()[0]);
  const head = html.match(/<h1>[\s\S]*?<\/table>/);
  assert.ok(head, 'h1 바로 뒤에 메타 표가 없다');
  assert.ok(!head[0].includes('<th>'), '메타 표에 <th> 가 생겼다면 CSS 도 같이 바꿔야 한다');
  assert.match(head[0], /<td>고객사<\/td>/);

  const css = read('report.js');
  assert.ok(!/h1 \+ table th/.test(css), 'h1 + table th 는 대상이 없는 셀렉터다');
  assert.match(css, /h1 \+ table td:first-child \{/, '라벨 열 스타일이 없다');
  // colgroup 이 table-layout: fixed 로 이미 너비를 정한다. 여기서 또 주면 안 먹는데 준 척한다.
  const rule = css.slice(css.indexOf('h1 + table td:first-child {'));
  assert.ok(!/width/.test(rule.slice(0, 120)), '먹지 않는 width 를 주고 있다');
});

test('인쇄 CSS 에 대상 없는 규칙이 없다', () => {
  const R = loadReport().IssuReport;
  const rendered = realDocs().map((md) => R.toHtml(md)).join('\n');

  const css = read('report.js').match(/const PRINT_CSS = `([\s\S]*?)`;/)[1];
  const selectors = new Set();
  css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').forEach((chunk) => {
    const brace = chunk.indexOf('{');
    if (brace < 0) return;
    chunk.slice(0, brace).split(',').forEach((s) => {
      s = s.trim();
      if (s && !s.startsWith('@')) selectors.add(s);
    });
  });
  assert.ok(selectors.size > 15, '셀렉터를 못 읽었다');

  // openPrint 가 직접 쓰는 것들 — 문서 마크다운에는 안 나온다.
  const fromOpenPrint = new Set(['*', 'body', '.brand', '.brand img', '.brand span', '.hint']);

  /**
   * ⚠ 마지막 태그만 전역에서 찾으면 안 된다. `h1 + table th` 는 **다른 표의 <th>**
   *  에 걸려 살아 있는 것처럼 보인다 — 바로 그렇게 놓쳤던 버그다.
   *  결합자가 있으면 앞부분이 가리키는 **구간 안에서만** 찾는다.
   */
  function hasTarget(sel) {
    const clean = sel.replace(/::?[a-z-]+(\([^)]*\))?/g, '').trim();
    const adjacent = clean.match(/^([a-z0-9]+) \+ ([a-z0-9]+)(?: ([a-z0-9]+))?$/);
    if (adjacent) {
      const [, first, next, inner] = adjacent;
      const region = rendered.match(new RegExp(`<${first}[ >][\\s\\S]*?</${first}>\\s*<${next}[ >][\\s\\S]*?</${next}>`));
      if (!region) return false;
      return inner ? new RegExp(`<${inner}[ >]`).test(region[0]) : true;
    }
    const parts = clean.split(/\s+/);
    if (!parts.every((p) => /^[a-z0-9]+$/.test(p))) return null;   // 검사 못 하는 모양
    if (parts.length === 1) return new RegExp(`<${parts[0]}[ >]`).test(rendered);
    // `td code` 처럼 후손 결합자 — 바깥 태그 안쪽만 본다.
    const [outer, inner] = parts;
    const blocks = rendered.match(new RegExp(`<${outer}[ >][\\s\\S]*?</${outer}>`, 'g')) || [];
    return blocks.some((b) => new RegExp(`<${inner}[ >]`).test(b));
  }

  const dead = [];
  const unchecked = [];
  for (const sel of selectors) {
    if (fromOpenPrint.has(sel)) continue;
    const hit = hasTarget(sel);
    if (hit === null) unchecked.push(sel);
    else if (!hit) dead.push(sel);
  }
  assert.deepEqual(dead, [], `대상이 없는 규칙: ${dead.join(' · ')}`);
  // 검사에서 빠진 모양이 늘어나면 이 검사가 조용히 무의미해진다.
  assert.deepEqual(unchecked, [], `검사하지 못한 셀렉터가 늘었다: ${unchecked.join(' · ')}`);
});
