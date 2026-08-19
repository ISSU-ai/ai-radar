#!/usr/bin/env node
'use strict';

/**
 * 인쇄 미리보기를 파일로 뽑는다.  `npm run preview` → 브라우저로 연다.
 *
 * **인쇄 CSS 는 아무도 못 보는 코드다.** 브라우저에서 인쇄 대화상자를 열어야만
 * 보이고, 거기 가려면 로그인 → 딜 선택 → STEP06 까지 가야 한다. 그래서 셀렉터가
 * 어긋난 채로 오래 남았다(`h1 + table th` — 대상이 아예 없었다).
 *
 * 이 스크립트는 `report.js` 의 **진짜 PRINT_CSS 와 진짜 문서 생성기**를 그대로 써서
 * openPrint 가 만드는 것과 같은 HTML 을 파일로 낸다. DB 도 로그인도 필요 없다.
 * 검사는 「대상이 있는가」까지만 본다 — **보기 좋은가는 사람이 봐야 한다.**
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'tmp', 'print-preview.html');

// ── report.js 를 브라우저인 척 로드한다 ────────────────────────────────────
function loadReport() {
  const sandbox = { console, Date, setTimeout, TextEncoder };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'report.js'), 'utf8'), sandbox, { filename: 'report.js' });
  return sandbox.IssuReport;
}

// ── 표본 딜 ────────────────────────────────────────────────────────────────
// 실제 값이 아니다. **모양을 보기 위한 것**이라 빈칸과 찬칸이 섞여 있어야 한다 —
// 전부 채우면 「아직 확인되지 않았습니다」가 어떻게 보이는지 못 본다.
const NOTES = [{ id: 'n1', met_on: '2026-08-14', title: '킥오프' }];
const CTX = {
  deal: {
    customer: '한빛금융', source: 'portal',
    lead_message: '전사 문서 업무에 AI 를 도입하려 합니다. 특히 계약서 검토가 급합니다.',
    customer_meta: { industry: 'Finance', companySize: '1000+', securityStack: 'zscaler' },
    inquiry_products: ['openai-enterprise'],
    readiness_scores: { G1: 3, G3: 2, T1: 4, D2: 2 }
  },
  handoff: {
    whyNow: { value: '연말 감사 대응 일정에 맞춰야 합니다.' },
    workflow: {
      value: '계약서 초안 검토 요약',
      quote: { quote: '법무팀은 계약서 검토를 전부 수작업으로 합니다.', note_id: 'n1', met_on: '2026-08-14', note_title: '킥오프' }
    },
    pilotGroup: { value: '법무팀 12명' },
    stakeholders: { value: '스폰서 CFO · 실무 법무팀장' },
    successCriteria: { value: '건당 40분 → 25분' }
    // scope · nextSteps 는 일부러 비운다 — 빈칸의 모양을 봐야 한다.
  },
  notes: NOTES,
  openItems: ['42문항 중 8개가 미응답입니다.', '보안 검토 일정이 아직 없습니다.'],
  today: new Date().toISOString().slice(0, 10)
};

function main() {
  const R = loadReport();
  const D = require(path.join(root, 'lib/handoff-doc.js'));

  // hub.js 가 STEP06 에서 이어 붙이는 것과 같은 순서다. 인쇄 팝업은 하나만
  // 열 수 있어 문서 셋이 한 장으로 나간다.
  const paper = [D.buildBrief(CTX), D.buildInterviewGuide(CTX), D.buildEvidenceSummary(CTX)]
    .join('\n\n');

  // 로고는 file:// 로 열리므로 저장소 안의 실제 파일을 상대 경로로 건다.
  const logo = path.relative(path.dirname(out), path.join(root, 'assets/megazone-cloud.png'));
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
    + `<title>인쇄 미리보기 — 배포 인계</title><style>${R.printCss}</style>`
    // 화면에서 A4 본문 폭을 눈으로 가늠할 수 있게 한다. @page 는 인쇄에만 걸린다.
    + `<style>@media screen { body { max-width: ${R.page.widthMm - R.page.marginMm * 2}mm;`
    + ` margin: 12mm auto; padding: 0 4mm; } }</style>`
    + `</head><body>`
    + `<div class="brand"><img src="${logo}" alt="메가존클라우드" onerror="this.remove()">`
    + `<span>${CTX.today}</span></div>`
    + R.toHtml(paper)
    + `<p class="hint">인쇄 대화상자에서 대상을 <strong>PDF로 저장</strong>으로 선택하세요.</p>`
    + `</body></html>`;

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  process.stdout.write(`${out}\n브라우저로 열고 ⌘P 를 누르면 실제 인쇄 모양이 나옵니다.\n`);
}

main();
