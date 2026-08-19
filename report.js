'use strict';

/**
 * 진단 결과 리포트 내보내기.
 *
 * 내용은 마크다운 하나로만 만들고, 여기서 세 형식으로 렌더한다.
 * 형식마다 따로 조립하면 셋이 서로 달라지고, "고객이 받은 PDF 와 영업이 보는
 * 화면의 숫자가 다르다"는 사고가 난다.
 *
 *   .md    Blob 그대로
 *   .docx  OOXML 을 직접 만든다 (라이브러리 없이)
 *   PDF    브라우저 인쇄 대화상자 → "PDF 로 저장"
 *
 * PDF 를 서버에서 만들지 않는 이유: 한글을 넣으려면 CJK 폰트를 embed 해야 하는데
 * 폰트 파일을 저장소에 넣는 건 용량·라이선스 판단이 필요한 별건이다. 인쇄 경로는
 * 그 판단 없이 지금 쓸 수 있고, 사용자가 미리보기로 확인한 뒤 저장한다.
 */
(function (global) {
  const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

  // ── 마크다운 파서 ────────────────────────────────────────────────────────
  // 지원 범위: #/##/### 제목 · 목록 · 파이프 표 · **굵게** · 문단.
  // 리포트에 실제로 쓰는 것만 넣었다. 범용 파서가 필요한 문서가 아니다.
  function parse(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];

    const flush = () => {
      if (paragraph.length) {
        blocks.push({ type: 'p', text: paragraph.join(' ') });
        paragraph = [];
      }
    };

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) { flush(); continue; }

      const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
      if (heading) {
        flush();
        blocks.push({ type: 'h', level: heading[1].length, text: heading[2] });
        continue;
      }

      // 인용. 문서마다 「이 문서는 …입니다」 안내와 회의록 발췌가 이걸로 들어온다.
      // 안 다루면 &gt; 가 본문에 그대로 찍힌다.
      if (/^>\s?/.test(trimmed)) {
        flush();
        const quote = [trimmed.replace(/^>\s?/, '')];
        while (i + 1 < lines.length && /^\s*>\s?/.test(lines[i + 1])) {
          i += 1;
          quote.push(lines[i].trim().replace(/^>\s?/, ''));
        }
        blocks.push({ type: 'quote', text: quote.filter(Boolean).join(' ') });
        continue;
      }

      if (/^[-*•]\s+/.test(trimmed)) {
        flush();
        blocks.push({ type: 'li', text: trimmed.replace(/^[-*•]\s+/, '') });
        continue;
      }

      // 표: 헤더 줄 다음이 |---|---| 인 경우에만 표로 본다.
      if (trimmed.startsWith('|') && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) {
        flush();
        const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const rows = [cells(trimmed)];
        i += 1;
        while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
          i += 1;
          rows.push(cells(lines[i]));
        }
        blocks.push({ type: 'table', rows });
        continue;
      }

      if (trimmed.startsWith('---')) { flush(); blocks.push({ type: 'hr' }); continue; }

      paragraph.push(trimmed);
    }
    flush();
    return blocks;
  }

  /** **굵게** 만 인식해 [{text, bold}] 로 쪼갠다. */
  /**
   * 인라인 조각. **굵게·코드·기울임 셋을 한 번에 훑는다.**
   *
   * 코드 스팬을 안 다루면 인계 브리프의 상태 배지(`확인됨` 같은 것)가 백틱 문자
   * 그대로 인쇄된다 — 문서의 시각적 핵심이 거기 있는데.
   * docx 도 이 함수를 쓰므로 `bold` 는 그대로 두고 플래그만 늘린다.
   */
  function runs(text) {
    const out = [];
    const re = /\*\*(.+?)\*\*|`([^`]+)`|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
      if (m[1] !== undefined) out.push({ text: m[1], bold: true });
      else if (m[2] !== undefined) out.push({ text: m[2], bold: false, code: true });
      else out.push({ text: m[3], bold: false, italic: true });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ text: text.slice(last), bold: false });
    return out.length ? out : [{ text, bold: false }];
  }

  /**
   * 표의 열 너비를 내용 길이로 정한다. 퍼센트 배열을 돌려준다.
   *
   * 왜 필요한가: 자동 너비로 두면 89자짜리 문항 한 칸이 표 전체를 밀어내 A4 를
   * 넘친다(실제로 진단 리포트에서 그랬다). 브라우저와 Word 가 각자 다르게 재는
   * 것도 문제다 — 여기서 정해 양쪽에 같은 값을 준다.
   *
   * 머리글 길이와 본문 평균 길이 중 큰 쪽을 무게로 쓰고, 한 열이 표를 독식하거나
   * 사라지지 않도록 6~55% 로 조인 뒤 다시 정규화한다.
   */
  function columnWidths(rows) {
    const columns = Math.max(...rows.map((r) => r.length));
    const weights = [];
    for (let i = 0; i < columns; i += 1) {
      const head = (rows[0][i] || '').length;
      const body = rows.slice(1);
      const avg = body.length
        ? body.reduce((sum, r) => sum + (r[i] || '').length, 0) / body.length
        : 0;
      weights.push(Math.max(head, avg, 2));
    }
    const MIN = 6;
    const MAX = 55;
    const total = weights.reduce((a2, b2) => a2 + b2, 0) || 1;
    let pct = weights.map((w) => (w / total) * 100);

    // 조인 뒤 다시 정규화하면 조였던 값이 한계를 도로 넘는다. 한계에 걸린 열은
    // 고정해 두고 남은 몫만 나머지 열에 나눠 몇 번 수렴시킨다.
    for (let pass = 0; pass < 4; pass += 1) {
      pct = pct.map((w) => Math.min(MAX, Math.max(MIN, w)));
      const sum = pct.reduce((a2, b2) => a2 + b2, 0);
      if (Math.abs(sum - 100) < 0.05) break;
      const free = pct.map((w) => w > MIN && w < MAX);
      const freeSum = pct.reduce((acc, w, i) => acc + (free[i] ? w : 0), 0);
      if (!freeSum) break;
      const delta = 100 - sum;
      pct = pct.map((w, i) => (free[i] ? w + delta * (w / freeSum) : w));
    }

    // 열이 둘뿐이고 둘 다 한계에 걸리면 남은 몫이 갈 데가 없다(6% + 55% = 61%).
    // 그때는 최대치를 포기하고 가장 넓은 열에 몰아준다 — 최소 너비는 지킨다.
    const sum = pct.reduce((a2, b2) => a2 + b2, 0);
    if (Math.abs(sum - 100) > 0.05) {
      const widest = pct.indexOf(Math.max(...pct));
      pct[widest] += 100 - sum;
    }
    return pct.map((w) => Math.round(w * 10) / 10);
  }

  // ── ZIP (저장 전용) ──────────────────────────────────────────────────────
  // deflate 없이 method 0 으로만 쓴다. 압축 없는 zip 도 규격상 정상이고 Word 가 그대로 연다.
  // 브라우저에 CompressionStream('deflate-raw') 이 있긴 하지만 스트림 기반이라 쓰려면
  // 이 경로 전체가 비동기가 된다. 리포트는 수십 KB 라 압축해서 얻는 게 거의 없다.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zipStore(entries) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    const push = (arr) => { chunks.push(arr); offset += arr.length; };
    const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
    const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

    for (const [name, text] of entries) {
      const nameBytes = enc.encode(name);
      const data = enc.encode(text);
      const crc = crc32(data);
      const local = [
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0)
      ];
      central.push({ name: nameBytes, crc, size: data.length, offset });
      push(new Uint8Array(local));
      push(nameBytes);
      push(data);
    }

    const centralStart = offset;
    for (const e of central) {
      const rec = [
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
        ...u32(e.crc), ...u32(e.size), ...u32(e.size),
        ...u16(e.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(e.offset)
      ];
      push(new Uint8Array(rec));
      push(e.name);
    }
    const centralSize = offset - centralStart;
    push(new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0),
      ...u16(central.length), ...u16(central.length),
      ...u32(centralSize), ...u32(centralStart), ...u16(0)
    ]));

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  // ── DOCX ────────────────────────────────────────────────────────────────
  const FONT = '<w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕"/>';

  const docxRuns = (text) => runs(text)
    .map((r) => `<w:r><w:rPr>${FONT}${r.bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`)
    .join('');

  function docxBody(blocks) {
    return blocks.map((b) => {
      if (b.type === 'h') {
        return `<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>${docxRuns(b.text)}</w:p>`;
      }
      if (b.type === 'li') {
        return `<w:p><w:pPr><w:ind w:left="360" w:hanging="180"/></w:pPr>`
          + `<w:r><w:rPr>${FONT}</w:rPr><w:t xml:space="preserve">• </w:t></w:r>${docxRuns(b.text)}</w:p>`;
      }
      if (b.type === 'hr') {
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>';
      }
      if (b.type === 'table') {
        // 머리글이 전부 빈 표(`| | |`)는 키-값 표로 쓰는 것이다. 머리글 행을 그대로 내면
        // 빈 칸에 회색 음영이 깔리고, 빈 칸을 굵게 감싸면 "****" 가 본문에 찍힌다.
        const headed = b.rows[0].some((cell) => cell.trim());
        const body = headed ? b.rows : b.rows.slice(1);
        const widths = columnWidths(b.rows);
        const rows = body.map((cells, index) => {
          const isHead = headed && index === 0;
          const tc = cells.map((cell, col) =>
            `<w:tc><w:tcPr><w:tcW w:w="${Math.round((widths[col] || 0) * 50)}" w:type="pct"/>`
            + (isHead ? '<w:shd w:val="clear" w:fill="F2F2F2"/>' : '')
            + `</w:tcPr><w:p>${docxRuns(isHead && cell ? `**${cell}**` : cell)}</w:p></w:tc>`
          ).join('');
          // 머리글 행은 페이지가 넘어가도 반복된다. 42행짜리 표에서 이게 없으면
          // 둘째 장부터 무슨 열인지 알 수 없다.
          const trPr = isHead ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
          return `<w:tr>${trPr}${tc}</w:tr>`;
        }).join('');
        return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>'
          + '<w:tblBorders>'
          + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
            .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="BFBFBF"/>`).join('')
          + '</w:tblBorders></w:tblPr>' + rows + '</w:tbl><w:p/>';
      }
      return `<w:p>${docxRuns(b.text)}</w:p>`;
    }).join('');
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
    <w:rPr>${FONT}<w:sz w:val="20"/></w:rPr></w:style>
  ${[[1, 32], [2, 26], [3, 22]].map(([lv, sz]) => `<w:style w:type="paragraph" w:styleId="Heading${lv}">
    <w:name w:val="heading ${lv}"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="${240 - lv * 40}" w:after="120"/><w:outlineLvl w:val="${lv - 1}"/></w:pPr>
    <w:rPr>${FONT}<w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join('')}
</w:styles>`;

  function buildDocx(markdown) {
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${docxBody(parse(markdown))}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

    const bytes = zipStore([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`],
      ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
      ['word/styles.xml', STYLES],
      ['word/document.xml', document]
    ]);

    return new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }

  // ── 인쇄 뷰 (→ PDF 저장) ────────────────────────────────────────────────
  const htmlRuns = (text) => runs(text).map((r) => {
    if (r.bold) return `<strong>${esc(r.text)}</strong>`;
    if (r.code) return `<code>${esc(r.text)}</code>`;
    if (r.italic) return `<em>${esc(r.text)}</em>`;
    return esc(r.text);
  }).join('');

  function toHtml(blocks) {
    const out = [];
    let list = [];
    const closeList = () => {
      if (list.length) { out.push(`<ul>${list.join('')}</ul>`); list = []; }
    };
    for (const b of blocks) {
      if (b.type === 'li') { list.push(`<li>${htmlRuns(b.text)}</li>`); continue; }
      closeList();
      if (b.type === 'h') out.push(`<h${b.level}>${htmlRuns(b.text)}</h${b.level}>`);
      else if (b.type === 'hr') out.push('<hr>');
      else if (b.type === 'quote') out.push(`<blockquote>${htmlRuns(b.text)}</blockquote>`);
      else if (b.type === 'table') {
        const headed = b.rows[0].some((cell) => cell.trim());
        const [head, ...rest] = b.rows;
        const body = headed ? rest : b.rows.slice(1);
        const cols = columnWidths(b.rows)
          .map((w) => `<col style="width:${w}%">`).join('');
        out.push('<table>' + `<colgroup>${cols}</colgroup>`
          + (headed ? `<thead><tr>${head.map((c) => `<th>${htmlRuns(c)}</th>`).join('')}</tr></thead>` : '')
          + '<tbody>'
          + body.map((r) => `<tr>${r.map((c) => `<td>${htmlRuns(c)}</td>`).join('')}</tr>`).join('')
          + '</tbody></table>');
      } else out.push(`<p>${htmlRuns(b.text)}</p>`);
    }
    closeList();
    return out.join('\n');
  }

  /**
   * 인쇄 스타일. **PDF 로 저장되는 그 모양이다.**
   *
   * 고객용 키트는 대외 문서라 여기가 회사 얼굴이다. 그래서 셋을 지킨다.
   *   ① **색에만 기대지 않는다.** 흑백으로 뽑는 사람이 있다 — 상태는 색 + 테두리로,
   *      표 머리는 색 + 굵기로 구분한다
   *   ② **print-color-adjust: exact.** 없으면 브라우저가 배경색을 통째로 지운다.
   *      배지도 인용 막대도 안 보인다
   *   ③ **끊기면 안 되는 것을 묶는다.** 제목 뒤 첫 줄, 표 행, 인용 한 덩이
   */
  const PRINT_CSS = `
    @page { size: A4; margin: 16mm 14mm 14mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: "Pretendard","맑은 고딕","Malgun Gothic",sans-serif;
           font-size: 10.5pt; line-height: 1.65; color: #16181d; margin: 0;
           word-break: keep-all; }

    /* ── 문서 머리 ── 제목과 첫 메타 표를 한 덩이로 묶는다 */
    h1 { font-size: 20pt; line-height: 1.25; margin: 0 0 3mm; letter-spacing: -.02em;
         padding-bottom: 3mm; border-bottom: 2px solid #16181d; }
    /* ⚠ 이 표는 머리글 줄이 없는 표다 — <th> 가 아예 안 생긴다.
       th 셀렉터로 잡으면 아무 일도 안 일어난다. 첫 칸을 자리로 잡는다.
       너비는 colgroup 이 이미 정한다(table-layout: fixed) — 여기서 또 주지 않는다. */
    h1 + table { margin-top: 0; }
    h1 + table td { border: 0; border-bottom: 1px solid #eceef2;
         padding: 1.4mm 0; font-size: 9.5pt; }
    h1 + table td:first-child { color: #6b7280; font-weight: 600; }

    h2 { font-size: 13pt; margin: 8mm 0 2.5mm; padding-bottom: 1.5mm;
         border-bottom: 1px solid #d8dbe2; letter-spacing: -.01em; }
    h3 { font-size: 11.5pt; margin: 5mm 0 1.5mm; letter-spacing: -.01em; }
    p { margin: 0 0 2.5mm; }
    ul { margin: 0 0 3mm; padding-left: 5mm; }
    li { margin-bottom: 1mm; }
    li::marker { color: #9aa2ad; }
    hr { border: 0; border-top: 1px solid #e3e6ec; margin: 6mm 0; }
    strong { font-weight: 700; }
    em { font-style: normal; color: #6b7280; }

    /* ── 상태 배지 ── 인계 브리프의 시각적 핵심. 흑백에서도 읽히게 테두리를 준다 */
    code { display: inline-block; padding: .4mm 1.6mm; border-radius: 2px;
           border: 1px solid #c9ced8; background: #f3f5f8;
           font-family: inherit; font-size: 8.8pt; font-weight: 700;
           letter-spacing: -.01em; white-space: nowrap; }

    /* ── 인용 ── 회의록 발췌와 문서 안내가 이걸로 들어온다 */
    blockquote { margin: 0 0 3mm; padding: 2mm 0 2mm 4mm;
                 border-left: 2px solid #b9c0cb; color: #43474e; font-size: 9.8pt;
                 break-inside: avoid; }

    /* table-layout: fixed 가 colgroup 너비를 실제로 강제한다. 없으면 브라우저가
       내용 길이로 다시 계산해 89자짜리 칸이 표를 A4 밖으로 밀어낸다. */
    table { width: 100%; table-layout: fixed; border-collapse: collapse;
            margin: 0 0 4mm; font-size: 9.5pt; }
    th, td { border: 1px solid #ccd0d8; padding: 1.8mm 2.5mm; text-align: left;
             vertical-align: top;
             /* 한국어는 단어 안에서 끊지 않는 편이 읽기 좋다. 띄어쓰기 없는 긴
                토큰만 예외적으로 끊는다. */
             word-break: keep-all; overflow-wrap: anywhere; }
    th { background: #f3f5f8; font-weight: 700; }
    td strong { color: #0f1115; }

    h1, h2, h3 { break-after: avoid; }
    ul { break-inside: avoid; }
    /* 문서 여럿을 한 장으로 이어 붙일 때 각자 새 페이지에서 시작한다.
       인쇄는 팝업 한 개만 열 수 있어 여러 문서를 따로 못 띄운다. */
    h1:not(:first-of-type) { break-before: page; }
    /* 표 전체에 break-inside: avoid 를 걸면 한 장을 넘는 표가 통째로 밀려 잘린다.
       행 단위로만 막고, 머리글은 페이지마다 반복시킨다. */
    tr { break-inside: avoid; }
    thead { display: table-header-group; }

    /* ── 브랜드 ── 고객이 받는 문서라 어디서 온 문서인지가 첫 줄에 있어야 한다.
       이미지가 못 뜨면(오프라인 인쇄 등) 자리만 비고 문서는 멀쩡하다 */
    .brand { display: flex; align-items: center; justify-content: space-between;
             gap: 6mm; margin-bottom: 6mm; }
    /* ⚠ 세로형 락업(심볼 위 · 워드마크 아래)이라 7mm 로는 글자가 2mm 도 안 돼
       안 읽힌다. 12mm 로 잡아야 「MEGAZONE CLOUD」가 인쇄에서 보인다. */
    .brand img { height: 12mm; width: auto; }
    .brand span { font-size: 8.5pt; color: #8b929c; letter-spacing: .04em; }

    /* ── 꼬리 ── 인쇄물에는 안 나온다. 화면에서만 저장 방법을 알려준다 */
    .hint { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #e3e6ec;
            font-size: 8.5pt; color: #6b7280; }
    @media print { .hint { display: none; } }`;

  function openPrint(title, markdown) {
    const win = global.open('', '_blank');
    if (!win) {
      global.alert('팝업이 차단되어 인쇄 화면을 열지 못했습니다. 이 사이트의 팝업을 허용해주세요.');
      return;
    }
    // 로고는 절대 경로로 넣는다. 인쇄 창은 about:blank 라 상대 경로가 안 먹는다.
    const logo = `${global.location.origin}/assets/megazone-cloud.png`;
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8">`
      + `<title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>`
      + `<div class="brand"><img src="${logo}" alt="메가존클라우드" onerror="this.remove()">`
      + `<span>${esc(new Date().toISOString().slice(0, 10))}</span></div>`
      + toHtml(parse(markdown))
      + `<p class="hint">인쇄 대화상자에서 대상을 <strong>PDF로 저장</strong>으로 선택하세요.</p>`
      + `</body></html>`);
    win.document.close();
    // print() 는 그 시점의 화면을 잡는다. document.write 직후에 부르면 아직 레이아웃이
    // 잡히기 전이라 표가 잘린 채로 인쇄되는 경우가 있어 한 틱 뒤로 미룬다.
    win.addEventListener('load', () => setTimeout(() => win.print(), 120));
  }

  // ── 내려받기 ────────────────────────────────────────────────────────────
  function save(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 파일명에 쓸 수 없는 문자를 걷어낸다. 한글은 남긴다. */
  const safeName = (s) => String(s || 'report')
    .replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);

  global.IssuReport = {
    parse,
    toHtml: (md) => toHtml(parse(md)),
    markdown(markdown, baseName) {
      save(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), `${safeName(baseName)}.md`);
    },
    docx(markdown, baseName) {
      save(buildDocx(markdown), `${safeName(baseName)}.docx`);
    },
    pdf(title, markdown) {
      openPrint(title, markdown);
    }
  };
})(window);
