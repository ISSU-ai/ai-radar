'use strict';

const CATEGORY_LABELS = Object.freeze({
  A: '보안·데이터',
  B: '연동·기술',
  C: '운영·관리',
  D: '업무·성과'
});
const offeringState = { items: [], scores: {}, packages: [], resultReady: false, currentCategoryIndex: 0 };
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
  try {
    [offeringState.items, offeringState.packages] = await Promise.all([
      getJson('/api/hub/public/fqa-items'),
      getJson('/api/hub/public/packages')
    ]);
    renderQuestions();
    renderPackages();
  } catch (error) {
    $('#questions').innerHTML = `<div class="loading">${escapeHtml(error.message)}</div>`;
    $('#package-list').innerHTML = `<div class="loading">오퍼링 정보를 불러오지 못했습니다.</div>`;
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
    offeringState.resultReady = true;
    $('#result').classList.remove('hidden');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.lucide?.createIcons();
  } catch (error) {
    $('#diagnosis-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderPackages() {
  $('#package-list').innerHTML = offeringState.packages.map((pkg, index) => `<article class="package"><small>${String(index + 1).padStart(2, '0')} · ${escapeHtml(pkg.period || '기간 협의')}</small><h3>${escapeHtml(pkg.name)}</h3><p>${escapeHtml(pkg.target || '')}</p><ul>${(pkg.items || []).map((item) => `<li>${escapeHtml(item.label)}</li>`).join('')}</ul></article>`).join('');
}

async function submitLead(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const errorNode = $('#lead-error');
  errorNode.textContent = '';
  if (!offeringState.resultReady) {
    errorNode.textContent = '먼저 준비도 진단 결과를 확인해주세요.';
    $('#diagnosis').scrollIntoView({ behavior: 'smooth' });
    return;
  }

  const submitButton = $('button[type="submit"]', event.currentTarget);
  submitButton.disabled = true;
  submitButton.textContent = '접수 중…';
  try {
    await getJson('/api/hub/public/leads', {
      method: 'POST',
      body: JSON.stringify({
        customer: form.get('customer'),
        contact: form.get('contact'),
        message: form.get('message'),
        consent: form.get('consent') === 'on',
        fqa_scores: offeringState.scores,
        customer_meta: {
          securityStack: form.get('securityStack'),
          investment: form.get('investment'),
          needsInfrastructure: form.get('securityStack') === 'none'
        }
      })
    });
    event.currentTarget.classList.add('hidden');
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
