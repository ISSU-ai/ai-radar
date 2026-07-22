'use strict';

const offeringState = { items: [], scores: {}, packages: [], resultReady: false };
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
  $('#question-count').textContent = offeringState.items.length;
  $('#questions').innerHTML = offeringState.items.map((item) => `<div class="question">
    <span class="question-no">${escapeHtml(item.category)}-${String(item.no).padStart(2, '0')}</span>
    <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.detail || '')}</small></span>
    <span class="score-options">${[1, 2, 3, 4, 5].map((score) => `<span><input id="score-${item.no}-${score}" type="radio" name="score-${item.no}" value="${score}" data-score-no="${item.no}" data-category="${escapeHtml(item.category)}"><label for="score-${item.no}-${score}">${score}</label></span>`).join('')}</span>
  </div>`).join('');
  $$('[data-score-no]').forEach((input) => input.addEventListener('change', () => {
    offeringState.scores[input.dataset.scoreNo] = Number(input.value);
    updateProgress();
  }));
}

function updateProgress() {
  const answered = Object.keys(offeringState.scores).length;
  $('#answer-count').textContent = answered;
  $('#progress-value').style.width = `${offeringState.items.length ? answered / offeringState.items.length * 100 : 0}%`;
}

async function calculateResult() {
  const answered = Object.keys(offeringState.scores).length;
  const minimum = Math.ceil(offeringState.items.length * .7);
  if (answered < minimum) {
    $('#diagnosis-error').textContent = `정확한 결과를 위해 최소 ${minimum}개 문항에 답해주세요.`;
    return;
  }
  $('#diagnosis-error').textContent = '';
  const labels = { A: '보안·데이터', B: '연동·기술', C: '운영·관리', D: '업무·성과' };
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
      return `<article class="result-card ${good ? 'good' : 'watch'}"><span>${escapeHtml(category.category)} AREA</span><strong>${Number(category.score).toFixed(1)} / 5</strong><p><b>${escapeHtml(labels[category.category] || `${category.category} 영역`)}</b><br>${good ? '현재 강점을 유지하면서 실제 업무 검증으로 이어갈 수 있습니다.' : '작은 검증 전에 책임자와 기본 통제를 먼저 정리하면 좋습니다.'}</p></article>`;
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
