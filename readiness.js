'use strict';

/**
 * AI 준비도 42문항 진단.
 *
 * nimble-dragon 에서 가져온 것 (계획서 §11-2)
 *   ① 루브릭 칩을 직접 클릭한다. "1~5 중 고르기" 가 아니라 **자기 상태를 서술한
 *      문장을 고른다.** "모르니까 3점" 을 줄이는 실질적 장치다.
 *   ② 미응답이 있으면 계산을 막고, 개수를 알리고, 빨간 테두리를 치고, 첫 미응답
 *      문항으로 스크롤한다. 기본값이 없어 무의식적 3점이 아예 안 생긴다.
 *   ③ 결과에 문항별 응답 + 고른 루브릭 문장을 남긴다.
 *   ④ 성숙도 5단계.
 *
 * 점수 계산은 서버(`/api/hub/public/readiness`)가 한다. 여기서 다시 계산하면
 * 고객이 화면에서 본 숫자와 리포트 안 숫자가 갈라진다.
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const RESPONDENT = Object.freeze({
  exec: { label: '경영진', cls: 'rb-exec' },
  it: { label: 'IT 담당', cls: 'rb-it' },
  staff: { label: '현업 실무자', cls: 'rb-staff' },
  all: { label: '전 직원', cls: 'rb-all' }
});

const MATURITY = Object.freeze([
  { level: 1, name: '초기', range: '1.0 ~ 2.0', note: 'AI 도입 전 단계 — 전략·기반 부재' },
  { level: 2, name: '준비', range: '2.0 ~ 3.0', note: '일부 시도 중 — 체계적 기반 구축 필요' },
  { level: 3, name: '정착', range: '3.0 ~ 3.9', note: 'AI 내재화 진행 중 — 운영 체계 강화 필요' },
  { level: 4, name: '확산', range: '3.9 ~ 4.5', note: '전사 AI 확산 단계 — 고도화·최적화 필요' },
  { level: 5, name: '최적화', range: '4.5 ~ 5.0', note: 'AI 선도 기업 수준 — 자율 진화·신사업 단계' }
]);

const state = { areas: [], items: [], scores: {}, areaIndex: 0, result: null };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

async function getJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '요청을 처리하지 못했습니다.');
    error.payload = data;
    throw error;
  }
  return data;
}

const itemsIn = (area) => state.items.filter((item) => item.area === area);
const answeredIn = (area) => itemsIn(area).filter((item) => state.scores[item.code]).length;
const totalAnswered = () => Object.keys(state.scores).length;

// ── 안내 ──────────────────────────────────────────────────────────
function renderIntro() {
  $('#area-intro').innerHTML = state.areas.map((area) => {
    const count = itemsIn(area.id).length;
    return `<article class="rd-area-card"><b>${escapeHtml(area.id)}</b>
      <strong>${escapeHtml(area.name)}</strong><span>${count}문항</span></article>`;
  }).join('');

  $('#maturity-intro').innerHTML = MATURITY.map((m) =>
    `<article class="rd-maturity-card"><span class="rd-level">Level ${m.level}</span>
      <strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.range)}점</small>
      <p>${escapeHtml(m.note)}</p></article>`).join('');

  $('#total-count').textContent = state.items.length;
}

// ── 진단 ──────────────────────────────────────────────────────────
function renderAreaTabs() {
  $('#area-tabs').innerHTML = state.areas.map((area, index) => {
    const total = itemsIn(area.id).length;
    const done = answeredIn(area.id);
    const cls = ['rd-tab'];
    if (index === state.areaIndex) cls.push('active');
    if (done === total && total > 0) cls.push('done');
    return `<button class="${cls.join(' ')}" type="button" role="tab" data-area-index="${index}"
      aria-selected="${index === state.areaIndex}">
      <b>${escapeHtml(area.id)}</b><span>${escapeHtml(area.name)}</span><small>${done}/${total}</small></button>`;
  }).join('');
}

function renderQuestions() {
  const area = state.areas[state.areaIndex];
  if (!area) return;
  const items = itemsIn(area.id);

  $('#area-head').innerHTML = `<span class="rd-area-mark">${escapeHtml(area.id)}</span>
    <div><h2>${escapeHtml(area.name)}</h2><p>${items.length}개 문항입니다. 현재 상태에 가장 가까운 문장을 고르세요.</p></div>`;

  $('#questions').innerHTML = items.map((item) => {
    const chosen = state.scores[item.code];
    const badge = RESPONDENT[item.respondent] || RESPONDENT.all;
    // 루브릭 칩이 곧 선택지다. 숫자만 있는 라디오보다 "모르니까 가운데" 가 훨씬 줄어든다.
    const chips = (item.rubric || []).map((text, index) => {
      const score = index + 1;
      return `<button class="rd-chip${chosen === score ? ' picked' : ''}" type="button"
        data-code="${escapeHtml(item.code)}" data-score="${score}"
        aria-pressed="${chosen === score}">
        <b>${score}점</b><span>${escapeHtml(text)}</span></button>`;
    }).join('');

    return `<article class="rd-question${chosen ? ' answered' : ''}" id="q-${escapeHtml(item.code)}">
      <header>
        <span class="rd-code">${escapeHtml(item.code)}</span>
        <span class="rd-badge ${badge.cls}">${escapeHtml(badge.label)}</span>
      </header>
      <h3>${escapeHtml(item.text)}</h3>
      ${item.detail ? `<p class="rd-detail-text">${escapeHtml(item.detail)}</p>` : ''}
      <div class="rd-chips">${chips}</div>
    </article>`;
  }).join('');

  renderAreaTabs();
  updateProgress();
  window.lucide?.createIcons();
}

function updateProgress() {
  const done = totalAnswered();
  $('#answered-count').textContent = done;
  $('#progress-value').style.width = state.items.length ? `${done / state.items.length * 100}%` : '0%';
  const last = state.areaIndex === state.areas.length - 1;
  $('#prev-area').classList.toggle('hidden', state.areaIndex === 0);
  $('#next-area').classList.toggle('hidden', last);
  $('#finish').classList.toggle('hidden', !last);
}

function setScore(code, score) {
  state.scores[code] = score;
  const card = $(`#q-${CSS.escape(code)}`);
  if (card) {
    card.classList.remove('unanswered');
    card.classList.add('answered');
    $$('.rd-chip', card).forEach((chip) => {
      const picked = Number(chip.dataset.score) === score;
      chip.classList.toggle('picked', picked);
      chip.setAttribute('aria-pressed', String(picked));
    });
  }
  renderAreaTabs();
  updateProgress();
}

function goToArea(index) {
  state.areaIndex = Math.max(0, Math.min(state.areas.length - 1, index));
  renderQuestions();
  $('#assessment').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 미응답을 화면에서 짚어 준다. 개수만 알리면 어디인지 찾느라 이탈한다. */
function showUnanswered(codes) {
  $$('.rd-question').forEach((card) => card.classList.remove('unanswered'));
  const first = codes[0];
  const area = state.items.find((item) => item.code === first)?.area;
  const index = state.areas.findIndex((a) => a.id === area);
  if (index >= 0) { state.areaIndex = index; renderQuestions(); }

  for (const code of codes) $(`#q-${CSS.escape(code)}`)?.classList.add('unanswered');

  const banner = $('#unanswered-banner');
  banner.innerHTML = `<span>⚠️ 선택하지 않은 문항이 <b>${codes.length}개</b> 있습니다. 표시된 문항을 모두 선택해주세요.</span>
    <button type="button" id="close-banner">✕</button>`;
  banner.classList.add('show');
  $('#close-banner').addEventListener('click', () => banner.classList.remove('show'));
  setTimeout(() => banner.classList.remove('show'), 6000);

  setTimeout(() => $(`#q-${CSS.escape(first)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
}

// ── 결과 ──────────────────────────────────────────────────────────
async function calculate() {
  const button = $('#finish');
  button.disabled = true;
  try {
    const result = await getJson('/api/hub/public/readiness', {
      method: 'POST',
      body: JSON.stringify({ scores: state.scores })
    });
    state.result = result;
    renderResult(result);
    $('#result').classList.remove('hidden');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    const codes = error.payload?.unanswered;
    if (Array.isArray(codes) && codes.length) showUnanswered(codes);
    else {
      const banner = $('#unanswered-banner');
      banner.innerHTML = `<span>${escapeHtml(error.message)}</span>`;
      banner.classList.add('show');
      setTimeout(() => banner.classList.remove('show'), 5000);
    }
  } finally {
    button.disabled = false;
  }
}

function renderResult(result) {
  $('#total-score').textContent = result.average.toFixed(2);
  $('#maturity-label').textContent = `Level ${result.maturity.level}. ${result.maturity.name} — ${result.maturity.note}`;

  $('#area-scores').innerHTML = result.areas.map((area) => {
    const tone = area.score < 3 ? 'low' : area.score < 4 ? 'mid' : 'high';
    return `<div class="rd-score-row ${tone}">
      <b>${escapeHtml(area.area)}</b><span>${escapeHtml(area.name)}</span>
      <div class="rd-bar"><i style="width:${area.score / 5 * 100}%"></i></div>
      <strong>${area.score.toFixed(2)}</strong></div>`;
  }).join('');

  // 2단계에서 오퍼링 순위로 교체된다. 지금은 최저 축 3개와 그 근거 문항을 낸다.
  $('#priorities').innerHTML = result.priorities.map((p, index) => `
    <article class="rd-priority">
      <header><span class="rd-rank">${index + 1}순위</span>
        <b>${escapeHtml(p.name)}</b><small>${p.score.toFixed(2)} / 5</small></header>
      <ul>${p.items.map((item) => `<li><span class="rd-code">${escapeHtml(item.code)}</span>
        <span>${escapeHtml(item.text)}</span>
        <em>${item.score}점 — ${escapeHtml(item.rubric)}</em></li>`).join('')}</ul>
    </article>`).join('');

  $('#insight').textContent = result.insight;
  $('#detail-count').textContent = `(${result.answers.length}문항)`;
  $('#detail-tables').innerHTML = result.areas.map((area) => {
    const rows = result.answers.filter((a) => a.area === area.area).map((a) => `<tr>
      <td class="rd-code">${escapeHtml(a.code)}</td><td>${escapeHtml(a.text)}</td>
      <td class="rd-pill-cell"><span class="rd-pill s${a.score}">${a.score}점</span></td>
      <td>${escapeHtml(a.rubric)}</td></tr>`).join('');
    return `<h4>${escapeHtml(area.area)} · ${escapeHtml(area.name)} — ${area.score.toFixed(2)}점</h4>
      <table class="rd-table"><thead><tr><th>번호</th><th>문항</th><th>점수</th><th>선택한 상태</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }).join('');

  drawRadar(result.areas);
  window.lucide?.createIcons();
}

/** 라이브러리 없이 canvas 로 그린다. CDN 을 늘릴 이유가 없다. */
function drawRadar(areas) {
  const canvas = $('#radar');
  if (!canvas || !areas.length) return;
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(canvas.parentElement.offsetWidth - 16, 320) || 320;
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2, radius = size / 2 - 42, n = areas.length;
  const point = (value, index) => {
    const angle = (Math.PI * 2 * index / n) - Math.PI / 2;
    const r = (value / 5) * radius;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };

  for (let ring = 1; ring <= 5; ring += 1) {
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const [x, y] = point(ring, i);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = ring === 3 ? 'rgba(35,103,232,.28)' : 'rgba(20,30,50,.10)';
    ctx.lineWidth = 1; ctx.stroke();
  }

  ctx.font = 'bold 11px Pretendard, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i += 1) {
    const [ex, ey] = point(5, i);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
    ctx.strokeStyle = 'rgba(20,30,50,.10)'; ctx.stroke();
    const [lx, ly] = point(5.9, i);
    ctx.fillStyle = '#5b6b80';
    ctx.fillText(areas[i].area, lx, ly - 6);
    ctx.font = '10px Pretendard, sans-serif';
    ctx.fillText(areas[i].name.split('·')[0], lx, ly + 7);
    ctx.font = 'bold 11px Pretendard, sans-serif';
  }

  ctx.beginPath();
  areas.forEach((area, i) => {
    const [x, y] = point(Math.max(area.score, 0.08), i);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(35,103,232,.18)'; ctx.fill();
  ctx.strokeStyle = 'rgba(35,103,232,.9)'; ctx.lineWidth = 2; ctx.stroke();
  areas.forEach((area, i) => {
    const [x, y] = point(Math.max(area.score, 0.08), i);
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#2367e8'; ctx.fill();
  });
}

// ── 리포트 ────────────────────────────────────────────────────────
function buildMarkdown() {
  const r = state.result;
  if (!r) return '';
  const today = new Date().toISOString().slice(0, 10);
  const areaRows = r.areas.map((a) =>
    `| ${a.area} · ${a.name} | ${a.score.toFixed(2)} / 5 | ${a.score < 3 ? '보완 필요' : a.score < 4 ? '보통' : '양호'} |`).join('\n');

  const priorities = r.priorities.map((p, i) => `### ${i + 1}순위 · ${p.name} (${p.score.toFixed(2)} / 5)\n\n`
    + p.items.map((it) => `- **${it.code}** ${it.text}\n  - ${it.score}점 — ${it.rubric}`).join('\n')).join('\n\n');

  const detail = r.areas.map((area) => {
    const rows = r.answers.filter((a) => a.area === area.area)
      .map((a) => `| ${a.code} | ${a.text} | ${a.score}점 | ${a.rubric} |`).join('\n');
    return `### ${area.area} · ${area.name} — ${area.score.toFixed(2)}점\n\n`
      + `| 번호 | 문항 | 점수 | 선택한 상태 |\n|---|---|---|---|\n${rows}`;
  }).join('\n\n');

  return `# AI 준비도 진단 결과

| | |
|---|---|
| 진단일 | ${today} |
| 종합 점수 | **${r.average.toFixed(2)} / 5.00** |
| 성숙도 | **Level ${r.maturity.level}. ${r.maturity.name}** — ${r.maturity.note} |
| 응답 문항 | ${r.answers.length}개 |

## 영역별 점수

| 영역 | 점수 | 판정 |
|---|---|---|
${areaRows}

## 종합 소견

${r.insight}

## 우선 개선 영역

${priorities}

## 문항별 상세 응답

${detail}

---

이 결과는 자가 진단 기반의 참고용입니다.
실제 실행 범위는 데이터·보안·업무 환경을 함께 검토해 확정합니다.`;
}

/** CSV 는 영업이 엑셀에서 다루기 좋다. 계획서 §11-3. */
function buildCsv() {
  const r = state.result;
  if (!r) return '';
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['﻿' + ['영역', '번호', '문항', '점수', '선택한 상태'].map(cell).join(',')];
  const areaName = new Map(r.areas.map((a) => [a.area, a.name]));
  for (const a of r.answers) {
    lines.push([areaName.get(a.area) || a.area, a.code, a.text, a.score, a.rubric].map(cell).join(','));
  }
  lines.push('');
  for (const a of r.areas) lines.push(['영역 점수', a.area, a.name, a.score.toFixed(2), ''].map(cell).join(','));
  lines.push(['종합', '', '', r.average.toFixed(2), `Level ${r.maturity.level}. ${r.maturity.name}`].map(cell).join(','));
  return lines.join('\n');
}

function bindReport() {
  const base = () => `AI_준비도_진단결과_${new Date().toISOString().slice(0, 10)}`;
  $$('[data-report]').forEach((button) => button.addEventListener('click', () => {
    if (!state.result) return;
    const kind = button.dataset.report;
    if (kind === 'csv') {
      const blob = new Blob([buildCsv()], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${base()}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const markdown = buildMarkdown();
    if (kind === 'md') window.IssuReport.markdown(markdown, base());
    else if (kind === 'docx') window.IssuReport.docx(markdown, base());
    else window.IssuReport.pdf('AI 준비도 진단 결과', markdown);
  }));
}

// ── 시작 ──────────────────────────────────────────────────────────
async function init() {
  window.lucide?.createIcons();
  bindReport();

  $('#start-button').addEventListener('click', () => {
    $('#assessment').classList.remove('hidden');
    goToArea(0);
  });
  $('#prev-area').addEventListener('click', () => goToArea(state.areaIndex - 1));
  $('#next-area').addEventListener('click', () => goToArea(state.areaIndex + 1));
  $('#finish').addEventListener('click', calculate);

  // 칩·탭은 다시 그려지므로 위임으로 받는다
  $('#questions').addEventListener('click', (event) => {
    const chip = event.target.closest('.rd-chip');
    if (chip) setScore(chip.dataset.code, Number(chip.dataset.score));
  });
  $('#area-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-area-index]');
    if (tab) goToArea(Number(tab.dataset.areaIndex));
  });
  window.addEventListener('resize', () => { if (state.result) drawRadar(state.result.areas); });

  try {
    const data = await getJson('/api/hub/public/readiness-items');
    state.areas = data.areas;
    state.items = data.items;
    renderIntro();
    window.lucide?.createIcons();
  } catch (error) {
    console.error('Readiness bootstrap failed:', error.message);
    $('#area-intro').innerHTML = `<div class="loading">${escapeHtml(error.message)}</div>`;
    $('#start-button').disabled = true;
  }
}

document.addEventListener('DOMContentLoaded', init);
