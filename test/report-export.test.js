'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');

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

test('offering·hub 양쪽이 report.js 를 로드한다', () => {
  for (const page of ['offering.html', 'hub.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(html, /<script src="\/report\.js"/, `${page} 에 report.js 로드가 없다`);
    const reportAt = html.indexOf('/report.js');
    const consumerAt = html.indexOf(page === 'offering.html' ? '/offering.js' : '/hub.js');
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
