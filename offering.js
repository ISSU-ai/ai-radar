'use strict';

const CATEGORY_LABELS = Object.freeze({
  A: '보안·데이터',
  B: '연동·기술',
  C: '운영·관리',
  D: '업무·성과'
});
const offeringState = { items: [], scores: {}, packages: [], result: null, resultReady: false, currentCategoryIndex: 0 };

/**
 * 업종 분류. 진단기준 엑셀「SFDC산업」시트의 33종을 그대로 쓴다.
 * 자유입력으로 두면 "금융"·"금융업"·"은행" 이 다 다른 값이 되어 업종 벤치마크
 * 비교를 못 한다. CRM 과도 값이 맞는다.
 */
const INDUSTRIES = Object.freeze([
  ['Agriculture', '농업'], ['Apparel', '의류'], ['Banking', '은행'],
  ['Biotechnology', '생명공학'], ['Chemicals', '화학'], ['Communications', '커뮤니케이션'],
  ['Construction', '건설'], ['Consulting', '컨설팅'], ['Education', '교육'],
  ['Electronics', '전자'], ['Energy', '에너지'], ['Engineering', '기술'],
  ['Entertainment', '엔터테인먼트'], ['Environmental', '환경'], ['Finance', '금융'],
  ['Food & Beverage', '식음료'], ['Government', '정부'], ['Healthcare', '건강'],
  ['Hospitality', '숙박'], ['Insurance', '보험'], ['Machinery', '기계'],
  ['Manufacturing', '제조'], ['Media', '미디어'], ['Not for Profit', '비영리'],
  ['Recreation', '레크레이션'], ['Retail', '유통'], ['Shipping', '선박'],
  ['Technology', 'IT'], ['Telecommunications', '통신'], ['Transportation', '교통'],
  ['Utilities', '인프라'], ['Other', '기타']
]);

function renderIndustryOptions() {
  const select = $('#lead-industry');
  if (!select) return;
  select.insertAdjacentHTML('beforeend', INDUSTRIES
    .map(([code, label]) => `<option value="${escapeHtml(code)}">${escapeHtml(label)} (${escapeHtml(code)})</option>`)
    .join(''));
}
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

async function getJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}

async function initOffering() {
  window.lucide?.createIcons();
  $('#calculate-result').addEventListener('click', calculateResult);
  $('#next-category').addEventListener('click', showNextCategory);
  $('#previous-category').addEventListener('click', showPreviousCategory);
  $('#lead-form').addEventListener('submit', submitLead);
  bindReportButtons();
  renderIndustryOptions();
  try {
    [offeringState.items, offeringState.packages] = await Promise.all([
      getJson('/api/hub/public/fqa-items'),
      getJson('/api/hub/public/packages')
    ]);
    renderQuestions();
    renderPackages();
  } catch (error) {
    console.error('Offering bootstrap failed:', error.message);
    $('#questions').innerHTML = '<div class="loading">진단 문항을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>';
    $('#package-list').innerHTML = `<div class="loading">오퍼링 정보를 불러오지 못했습니다.</div>`;
    $('#next-category').disabled = true;
    $('#calculate-result').disabled = true;
  }
}

function renderQuestions() {
  const category = currentCategory();
  const items = itemsForCategory(category);
  $('#current-category-label').textContent = `${category} · ${CATEGORY_LABELS[category] || '진단'} 영역`;
  $('#question-count').textContent = items.length;
  $('#questions').innerHTML = items.map((item) => `<div class="question">
    <span class="question-no">${escapeHtml(item.category)}-${String(item.no).padStart(2, '0')}</span>
    <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.detail || '')}</small></span>
    <span class="score-options">${[1, 2, 3, 4, 5].map((score) => `<span><input id="score-${item.no}-${score}" type="radio" name="score-${item.no}" value="${score}" data-score-no="${item.no}" data-category="${escapeHtml(item.category)}" ${Number(offeringState.scores[item.no]) === score ? 'checked' : ''}><label for="score-${item.no}-${score}">${score}</label></span>`).join('')}</span>
  </div>`).join('');
  $$('[data-score-no]').forEach((input) => input.addEventListener('change', () => {
    offeringState.scores[input.dataset.scoreNo] = Number(input.value);
    offeringState.resultReady = false;
    $('#result').classList.add('hidden');
    $('#diagnosis-error').textContent = '';
    updateProgress();
  }));
  renderCategoryTabs();
  updateProgress();
  window.lucide?.createIcons();
}

function updateProgress() {
  const category = currentCategory();
  const items = itemsForCategory(category);
  const answered = items.filter((item) => hasScore(item.no)).length;
  const totalAnswered = offeringState.items.filter((item) => hasScore(item.no)).length;
  $('#answer-count').textContent = answered;
  $('#progress-value').style.width = `${offeringState.items.length ? totalAnswered / offeringState.items.length * 100 : 0}%`;
  renderCategoryTabs();
  updateStepControls();
}

function categories() {
  return [...new Set(offeringState.items.map((item) => item.category))];
}

function currentCategory() {
  return categories()[offeringState.currentCategoryIndex] || '';
}

function itemsForCategory(category) {
  return offeringState.items.filter((item) => item.category === category);
}

function hasScore(no) {
  const score = Number(offeringState.scores[no]);
  return Number.isFinite(score) && score >= 1 && score <= 5;
}

function categoryComplete(category) {
  const items = itemsForCategory(category);
  return items.length > 0 && items.every((item) => hasScore(item.no));
}

function renderCategoryTabs() {
  const activeCategory = currentCategory();
  $('#category-tabs').innerHTML = categories().map((category) => {
    const active = category === activeCategory;
    const done = categoryComplete(category);
    const className = `category-tab${active ? ' active' : ''}${done && !active ? ' done' : ''}`;
    const status = done ? '완료' : active ? '진행 중' : '대기';
    return `<div class="${className}" aria-current="${active ? 'step' : 'false'}"><b>${escapeHtml(category)}</b><span><strong>${escapeHtml(CATEGORY_LABELS[category] || `${category} 영역`)}</strong><small>${status}</small></span></div>`;
  }).join('');
}

function updateStepControls() {
  const categoryList = categories();
  const last = offeringState.currentCategoryIndex === categoryList.length - 1;
  const complete = categoryComplete(currentCategory());
  const previousButton = $('#previous-category');
  const nextButton = $('#next-category');
  const resultButton = $('#calculate-result');

  previousButton.classList.toggle('hidden', offeringState.currentCategoryIndex === 0);
  nextButton.classList.toggle('hidden', last);
  resultButton.classList.toggle('hidden', !last);
  nextButton.disabled = !complete;
  resultButton.disabled = !complete || !categoryList.every(categoryComplete);
}

function showNextCategory() {
  if (!categoryComplete(currentCategory())) return;
  offeringState.currentCategoryIndex = Math.min(categories().length - 1, offeringState.currentCategoryIndex + 1);
  renderQuestions();
  $('.diagnosis-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showPreviousCategory() {
  offeringState.currentCategoryIndex = Math.max(0, offeringState.currentCategoryIndex - 1);
  renderQuestions();
  $('.diagnosis-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function calculateResult() {
  if (!categories().every(categoryComplete)) {
    $('#diagnosis-error').textContent = '모든 영역의 문항에 답해주세요.';
    return;
  }
  $('#diagnosis-error').textContent = '';
  const button = $('#calculate-result');
  button.disabled = true;
  try {
    const result = await getJson('/api/hub/public/diagnose', {
      method: 'POST',
      body: JSON.stringify({ fqa_scores: offeringState.scores })
    });
    $('#result-summary').textContent = result.summary;
    $('#result-grid').innerHTML = result.categories.map((category) => {
      const good = category.status === 'ready';
      return `<article class="result-card ${good ? 'good' : 'watch'}"><span>${escapeHtml(category.category)} AREA</span><strong>${Number(category.score).toFixed(1)} / 5</strong><p><b>${escapeHtml(CATEGORY_LABELS[category.category] || `${category.category} 영역`)}</b><br>${good ? '현재 강점을 유지하면서 실제 업무 검증으로 이어갈 수 있습니다.' : '작은 검증 전에 책임자와 기본 통제를 먼저 정리하면 좋습니다.'}</p></article>`;
    }).join('');
    offeringState.result = result;
    offeringState.resultReady = true;
    $('#result').classList.remove('hidden');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.lucide?.createIcons();
  } catch (error) {
    console.error('Offering diagnosis failed:', error.message);
    $('#diagnosis-error').textContent = '진단 결과를 계산하지 못했습니다. 잠시 후 다시 시도해주세요.';
  } finally {
    button.disabled = false;
  }
}

/**
 * 화면에 보이는 것과 같은 값으로 리포트를 만든다.
 * 점수는 서버(`/public/diagnose`)가 계산해 준 값을 그대로 쓴다 — 여기서 다시 계산하면
 * 고객이 화면에서 본 숫자와 파일 안 숫자가 갈라질 수 있다.
 */
function buildReportMarkdown() {
  const result = offeringState.result;
  if (!result) return '';
  const today = new Date().toISOString().slice(0, 10);
  const answered = Object.keys(offeringState.scores).length;

  const scoreRows = result.categories
    .map((c) => `| ${c.category} · ${CATEGORY_LABELS[c.category] || ''} | ${Number(c.score).toFixed(1)} / 5 `
      + `| ${c.answered}개 | ${c.status === 'ready' ? '기준 충족' : '보완 필요'} |`)
    .join('\n');

  const watch = result.categories.filter((c) => c.status !== 'ready');

  const answerRows = categories().flatMap((category) => itemsForCategory(category).map((item) => {
    const score = offeringState.scores[item.no];
    return `| ${item.category}-${String(item.no).padStart(2, '0')} | ${item.name} | ${score ? `${score} / 5` : '미응답'} |`;
  })).join('\n');

  return `# AI 준비도 진단 결과

| | |
|---|---|
| 진단일 | ${today} |
| 응답 문항 | ${answered}개 |
| 종합 판정 | **${result.summary}** |

## 영역별 결과

| 영역 | 점수 | 응답 | 판정 |
|---|---|---|---|
${scoreRows}

## 우선 보완 영역

${watch.length
    ? watch.map((c) => `- **${c.category} · ${CATEGORY_LABELS[c.category] || ''}** (${Number(c.score).toFixed(1)} / 5) — 작은 검증에 앞서 책임자와 기본 통제를 먼저 정리하는 편이 안전합니다.`).join('\n')
    : '- 현재 응답 기준으로는 모든 영역이 기준을 충족합니다. 실제 업무 검증으로 이어갈 수 있습니다.'}

## 다음 단계로 검토할 수 있는 구성

${offeringState.packages.length
    ? offeringState.packages.map((pkg) => `- **${pkg.name}** (${pkg.period || '기간 협의'}) — ${pkg.target || ''}`).join('\n')
    : '- 상담 시 고객 환경에 맞춰 구성을 제안드립니다.'}

## 문항별 응답

| 번호 | 문항 | 응답 |
|---|---|---|
${answerRows}

---

이 결과는 현재 상태를 빠르게 확인하기 위한 참고용입니다.
실제 실행 범위는 업무·보안·데이터 환경을 함께 검토해 확정합니다.`;
}

function bindReportButtons() {
  const baseName = `AI_준비도_진단결과_${new Date().toISOString().slice(0, 10)}`;
  $$('[data-report]').forEach((button) => button.addEventListener('click', () => {
    if (!offeringState.resultReady) return;
    const markdown = buildReportMarkdown();
    const kind = button.dataset.report;
    if (kind === 'md') window.IssuReport.markdown(markdown, baseName);
    else if (kind === 'docx') window.IssuReport.docx(markdown, baseName);
    else window.IssuReport.pdf('AI 준비도 진단 결과', markdown);
  }));
}

function renderPackages() {
  $('#package-list').innerHTML = offeringState.packages.map((pkg, index) => `<article class="package"><small>${String(index + 1).padStart(2, '0')} · ${escapeHtml(pkg.period || '기간 협의')}</small><h3>${escapeHtml(pkg.name)}</h3><p>${escapeHtml(pkg.target || '')}</p><ul>${(pkg.items || []).map((item) => `<li>${escapeHtml(item.label)}</li>`).join('')}</ul></article>`).join('');
}

async function submitLead(event) {
  event.preventDefault();
  // Capture the form element now: event.currentTarget becomes null after the
  // first await below (the event has finished dispatching by then), which was
  // throwing "Cannot read properties of null (reading 'classList')" on the
  // success path even though the lead had already been saved.
  const formEl = event.currentTarget;
  const form = new FormData(formEl);
  const errorNode = $('#lead-error');
  errorNode.textContent = '';
  if (!offeringState.resultReady) {
    errorNode.textContent = '먼저 준비도 진단 결과를 확인해주세요.';
    $('#diagnosis').scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const submitButton = $('button[type="submit"]', formEl);
  submitButton.disabled = true;
  submitButton.textContent = '접수 중…';
  try {
    await getJson('/api/hub/public/leads', {
      method: 'POST',
      body: JSON.stringify({
        customer: form.get('customer'),
        contact: form.get('contact'),
        // 개인정보라 서버에서 leads 컬럼으로 들어간다(027). customer_meta 로 보내지
        // 않는다 — 거기 두면 deals 로 흘러가 어디까지 퍼졌는지 추적할 수 없다.
        contact_name: form.get('contactName'),
        contact_phone: form.get('contactPhone'),
        message: form.get('message'),
        consent: form.get('consent') === 'on',
        fqa_scores: offeringState.scores,
        customer_meta: {
          industry: form.get('industry'),
          companySize: form.get('companySize'),
          securityStack: form.get('securityStack'),
          investment: form.get('investment'),
          needsInfrastructure: form.get('securityStack') === 'none'
        }
      })
    });
    formEl.classList.add('hidden');
    $('#lead-success').classList.remove('hidden');
    window.lucide?.createIcons();
  } catch (error) {
    errorNode.textContent = error.message;
    submitButton.disabled = false;
    submitButton.innerHTML = '상담 요청 보내기 <i data-lucide="send"></i>';
    window.lucide?.createIcons();
  }
}

document.addEventListener('DOMContentLoaded', initOffering);
