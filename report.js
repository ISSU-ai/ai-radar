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
  function runs(text) {
    const out = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
      out.push({ text: m[1], bold: true });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ text: text.slice(last), bold: false });
    return out.length ? out : [{ text, bold: false }];
  }

  // ── ZIP (저장 전용) ──────────────────────────────────────────────────────
  // deflate 없이 method 0 으로만 쓴다. 압축 없는 zip 도 규격상 정상이고
  // Word 가 그대로 연다. 브라우저에 deflate API 가 없어 이 편이 확실하다.
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
        const rows = b.rows.map((cells, rowIndex) => {
          const tc = cells.map((cell) =>
            `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>`
            + (rowIndex === 0 ? '<w:shd w:val="clear" w:fill="F2F2F2"/>' : '')
            + `</w:tcPr><w:p>${docxRuns(rowIndex === 0 ? `**${cell}**` : cell)}</w:p></w:tc>`
          ).join('');
          return `<w:tr>${tc}</w:tr>`;
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
  const htmlRuns = (text) => runs(text)
    .map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join('');

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
      else if (b.type === 'table') {
        const [head, ...body] = b.rows;
        out.push('<table><thead><tr>'
          + head.map((c) => `<th>${htmlRuns(c)}</th>`).join('')
          + '</tr></thead><tbody>'
          + body.map((r) => `<tr>${r.map((c) => `<td>${htmlRuns(c)}</td>`).join('')}</tr>`).join('')
          + '</tbody></table>');
      } else out.push(`<p>${htmlRuns(b.text)}</p>`);
    }
    closeList();
    return out.join('\n');
  }

  const PRINT_CSS = `
    @page { size: A4; margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Pretendard","맑은 고딕","Malgun Gothic",sans-serif;
           font-size: 10.5pt; line-height: 1.65; color: #16181d; margin: 0; }
    h1 { font-size: 19pt; margin: 0 0 4mm; }
    h2 { font-size: 13.5pt; margin: 7mm 0 2.5mm; padding-bottom: 1.5mm;
         border-bottom: 1px solid #d8dbe2; }
    h3 { font-size: 11.5pt; margin: 5mm 0 2mm; }
    p { margin: 0 0 2.5mm; }
    ul { margin: 0 0 3mm; padding-left: 5mm; }
    li { margin-bottom: 1mm; }
    hr { border: 0; border-top: 1px solid #e3e6ec; margin: 5mm 0; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; font-size: 9.5pt; }
    th, td { border: 1px solid #ccd0d8; padding: 1.8mm 2.5mm; text-align: left;
             vertical-align: top; }
    th { background: #f3f5f8; font-weight: 700; }
    h1, h2, h3 { break-after: avoid; }
    table, ul { break-inside: avoid; }
    .hint { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #e3e6ec;
            font-size: 8.5pt; color: #6b7280; }
    @media print { .hint { display: none; } }`;

  function openPrint(title, markdown) {
    const win = global.open('', '_blank');
    if (!win) {
      global.alert('팝업이 차단되어 인쇄 화면을 열지 못했습니다. 이 사이트의 팝업을 허용해주세요.');
      return;
    }
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8">`
      + `<title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>`
      + toHtml(parse(markdown))
      + `<p class="hint">인쇄 대화상자에서 대상을 <strong>PDF로 저장</strong>으로 선택하세요.</p>`
      + `</body></html>`);
    win.document.close();
    // 폰트가 적용되기 전에 인쇄창이 뜨면 레이아웃이 흔들린다.
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
