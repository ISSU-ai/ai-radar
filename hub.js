'use strict';

const state = {
  user: null,
  deals: [],
  refs: { stages: [], tracks: [], fqaItems: [], packages: [], solutions: [] },
  deal: null,
  activeStage: 0,
  saveTimer: null,
  pendingPatch: {},
  eventSource: null,
  catalogQuery: ''
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const sourceNames = { portal: '포탈 유입', manual: '직접 생성', sheet: '시트 회수' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403 && path === '/api/auth/me') {
    window.location.href = '/login.html?next=/hub';
    throw new Error('로그인이 필요합니다.');
  }
  if (!response.ok) throw new Error(data?.error || '요청을 처리하지 못했습니다.');
  return data;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove('show'), 2600);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(date);
}

function isOwner() {
  return Boolean(state.deal && (state.user.role === 'admin' || state.deal.owner_id === state.user.id));
}

async function init() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    $('#session-name').textContent = me.user.name || me.user.email;
    $('#admin-link').classList.toggle('hidden', me.user.role !== 'admin');
    state.refs = await api('/api/hub/reference-data');
    renderTrackFilter();
    bindGlobalEvents();
    await loadDeals();
    connectEvents();
    window.lucide?.createIcons();
  } catch (error) {
    console.error(error);
  }
}

function bindGlobalEvents() {
  $('#logout-button').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
  $('#new-deal-button').addEventListener('click', () => $('#new-deal-dialog').showModal());
  $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => $('#new-deal-dialog').close()));
  $('#new-deal-form').addEventListener('submit', createDeal);
  $('#back-to-list').addEventListener('click', showDealIndex);

  let filterTimer;
  $('#deal-search').addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadDeals, 250);
  });
  $('#stage-filter').addEventListener('change', loadDeals);
  $('#track-filter').addEventListener('change', loadDeals);
  $('#mine-filter').addEventListener('change', loadDeals);
  $('#claim-button').addEventListener('click', claimDeal);
}

function renderTrackFilter() {
  const select = $('#track-filter');
  select.insertAdjacentHTML('beforeend', state.refs.tracks.map((track) =>
    `<option value="${escapeHtml(track.id)}">${escapeHtml(track.id)} · ${escapeHtml(track.name)}</option>`
  ).join(''));
}

async function loadDeals() {
  const params = new URLSearchParams();
  const q = $('#deal-search')?.value.trim();
  const stage = $('#stage-filter')?.value;
  const track = $('#track-filter')?.value;
  if (q) params.set('q', q);
  if (stage !== '') params.set('stage', stage);
  if (track) params.set('track', track);
  if ($('#mine-filter')?.checked) params.set('mine', 'true');

  try {
    state.deals = await api(`/api/hub/deals?${params}`);
    renderMetrics();
    renderDealList();
  } catch (error) {
    $('#deal-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderMetrics() {
  const all = state.deals;
  $('#metric-total').textContent = all.length;
  $('#metric-new').textContent = all.filter((deal) => deal.source === 'portal' && !deal.owner_id).length;
  $('#metric-poc').textContent = all.filter((deal) => [1, 2].includes(deal.stage)).length;
  $('#metric-pitch').textContent = all.filter((deal) => deal.stage === 4).length;
}

function renderDealList() {
  const list = $('#deal-list');
  if (!state.deals.length) {
    list.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><br>조건에 맞는 딜이 없습니다.</div>`;
    window.lucide?.createIcons();
    return;
  }

  list.innerHTML = state.deals.map((deal) => {
    const stageLabel = state.refs.stages[deal.stage] || '들어온 데이터';
    const isNew = deal.source === 'portal' && !deal.owner_id;
    return `<button class="deal-row" type="button" data-deal-id="${deal.id}">
      <span class="customer-cell"><strong>${escapeHtml(deal.customer)}</strong>${isNew ? '<span class="new-tag">NEW</span>' : ''}<small>${escapeHtml(sourceNames[deal.source] || deal.source)}</small></span>
      <span class="stage-cell"><i class="stage-num">${deal.stage + 1}</i>${escapeHtml(stageLabel)}</span>
      <span class="track-badge" data-track="${escapeHtml(deal.track || '')}">${escapeHtml(deal.track || '미정')}</span>
      <span>${escapeHtml(deal.owner_name || '미배정')}</span>
      <span>${formatDate(deal.updated_at)}</span>
      <i class="row-arrow" data-lucide="chevron-right"></i>
    </button>`;
  }).join('');
  $$('.deal-row', list).forEach((row) => row.addEventListener('click', () => openDeal(row.dataset.dealId)));
  window.lucide?.createIcons();
}

async function createDeal(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  $('#new-deal-error').textContent = '';
  try {
    const deal = await api('/api/hub/deals', {
      method: 'POST',
      body: JSON.stringify({
        customer: form.get('customer'),
        source: form.get('source'),
        customer_meta: { industry: form.get('industry') }
      })
    });
    $('#new-deal-dialog').close();
    event.currentTarget.reset();
    toast('새 딜을 만들었습니다.');
    await loadDeals();
    await openDeal(deal.id);
  } catch (error) {
    $('#new-deal-error').textContent = error.message;
  }
}

async function openDeal(id) {
  try {
    state.deal = await api(`/api/hub/deals/${id}`);
    state.activeStage = state.deal.stage;
    $('#deal-index').classList.add('hidden');
    $('#workspace').classList.remove('hidden');
    renderWorkspace();
    history.replaceState({}, '', `/hub?deal=${id}`);
  } catch (error) {
    toast(error.message);
  }
}

function showDealIndex() {
  state.deal = null;
  clearTimeout(state.saveTimer);
  state.pendingPatch = {};
  $('#workspace').classList.add('hidden');
  $('#deal-index').classList.remove('hidden');
  history.replaceState({}, '', '/hub');
  loadDeals();
}

function renderWorkspace() {
  const deal = state.deal;
  $('#workspace-customer').textContent = deal.customer;
  $('#workspace-source').textContent = sourceNames[deal.source] || deal.source;
  $('#context-owner').textContent = deal.owner_name || '미배정';
  $('#context-track').textContent = deal.track ? `${deal.track} · ${deal.track_name || ''}` : '미정';
  $('#context-source').textContent = sourceNames[deal.source] || deal.source;
  $('#context-updated').textContent = formatDate(deal.updated_at);
  $('#claim-button').classList.toggle('hidden', Boolean(deal.owner_id));
  renderStageRail();
  renderStage();
  renderReadiness();
  window.lucide?.createIcons();
}

function renderStageRail() {
  const rail = $('#stage-rail');
  rail.innerHTML = state.refs.stages.map((label, index) => `<button type="button" class="stage-button ${index === state.activeStage ? 'active' : ''} ${index < state.deal.stage ? 'done' : ''}" data-stage="${index}">
    <span>${index + 1}</span><div><strong>${escapeHtml(label)}</strong><small>${['리드·고객 맥락','21항목·보완벽','카탈로그·포컬','패키지·공수','제안 스크립트'][index]}</small></div>
  </button>`).join('');
  $$('.stage-button', rail).forEach((button) => button.addEventListener('click', async () => {
    const nextStage = Number(button.dataset.stage);
    state.activeStage = nextStage;
    if (isOwner() && nextStage !== state.deal.stage) {
      await savePatch({ stage: nextStage }, true);
    } else {
      renderStageRail();
      renderStage();
    }
  }));
}

function stageHeader(no, title, copy, action = '') {
  return `<header class="stage-header"><div><p class="eyebrow">STEP ${no}</p><h2>${title}</h2><p>${copy}</p></div>${action}</header>`;
}

function renderStage() {
  const stage = state.activeStage;
  const content = $('#stage-content');
  if (stage === 0) content.innerHTML = renderIntake();
  if (stage === 1) content.innerHTML = renderFqa();
  if (stage === 2) content.innerHTML = renderSolutions();
  if (stage === 3) content.innerHTML = renderPackages();
  if (stage === 4) content.innerHTML = renderPitch();
  bindStageEvents();
  window.lucide?.createIcons();
}

function disabledAttr() { return isOwner() ? '' : 'disabled'; }

function renderIntake() {
  const meta = state.deal.customer_meta || {};
  return `${stageHeader('01', '들어온 데이터', '포탈·미팅·시트에서 들어온 고객 맥락을 한곳에 정리합니다. 이 정보는 이후 모든 단계에 그대로 이어집니다.')}
    <div class="form-grid">
      <div class="field"><label>고객사</label><input data-deal-field="customer" value="${escapeHtml(state.deal.customer)}" ${disabledAttr()}></div>
      <div class="field"><label>업종</label><input data-meta-field="industry" value="${escapeHtml(meta.industry || '')}" placeholder="금융 / 제조 / 공공" ${disabledAttr()}></div>
      <div class="field"><label>조직 규모</label><select data-meta-field="companySize" ${disabledAttr()}><option value="">선택</option>${['1~99명','100~499명','500~1,999명','2,000명 이상'].map((v) => `<option ${meta.companySize === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>도입 대상</label><input data-meta-field="targetUsers" value="${escapeHtml(meta.targetUsers || '')}" placeholder="예: 전사 2,000명 / 개발조직 200명" ${disabledAttr()}></div>
      <div class="field full"><label>고객 연락처</label><input data-meta-field="contact" value="${escapeHtml(meta.contact || state.deal.lead_contact || '')}" placeholder="업무 이메일 또는 전화번호" ${disabledAttr()}></div>
      <div class="field"><label>현재 보안 환경</label><select data-meta-field="securityStack" ${disabledAttr()}><option value="">미정</option><option value="none" ${meta.securityStack === 'none' ? 'selected' : ''}>별도 SWG 없음</option><option value="zscaler" ${meta.securityStack === 'zscaler' ? 'selected' : ''}>Zscaler</option><option value="other-swg" ${meta.securityStack === 'other-swg' ? 'selected' : ''}>타사 SWG</option></select></div>
      <div class="field"><label>투자 여력</label><select data-meta-field="investment" ${disabledAttr()}><option value="">미정</option><option value="low" ${meta.investment === 'low' ? 'selected' : ''}>제한적</option><option value="medium" ${meta.investment === 'medium' ? 'selected' : ''}>PoC 예산 확보</option><option value="high" ${meta.investment === 'high' ? 'selected' : ''}>전사 확장 가능</option></select></div>
      <div class="field full"><label>고객 상황·요청 메모</label><textarea data-meta-field="notes" ${disabledAttr()} placeholder="미팅에서 확인한 문제, 의사결정자, 일정 등을 적어주세요.">${escapeHtml(meta.notes || state.deal.lead_message || '')}</textarea></div>
    </div>`;
}

function renderFqa() {
  const totals = state.deal.fqa_totals || {};
  const scoreCards = ['A','B','C','D'].map((category) => {
    const total = totals[category];
    const status = total ? (total.ready ? 'pass' : 'fail') : '';
    return `<div class="score-card ${status}"><span>${category} AREA</span><strong>${total ? total.score.toFixed(2) : '—'}</strong><small>${total ? `${total.answered}개 응답 · ${total.ready ? '기준 충족' : '보완 필요'}` : '응답 대기'}</small></div>`;
  }).join('');
  const trackOptions = state.refs.tracks.map((track) => `<option value="${track.id}" ${state.deal.track === track.id ? 'selected' : ''}>${track.id} · ${escapeHtml(track.name)}</option>`).join('');
  const scores = state.deal.fqa_scores || {};
  const rows = state.refs.fqaItems.map((item) => `<div class="fqa-row"><span class="fqa-no">${item.category}-${String(item.no).padStart(2,'0')}</span><span class="fqa-copy"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.detail || '')}</small></span><select data-fqa-no="${item.no}" ${disabledAttr()}><option value="">미응답</option>${[1,2,3,4,5].map((score) => `<option value="${score}" ${Number(scores[item.no]) === score ? 'selected' : ''}>${score} · ${['','매우 미흡','미흡','보통','양호','준비됨'][score]}</option>`).join('')}</select></div>`).join('');
  return `${stageHeader('02', 'PoC 검증과 보완 벽', '21개 항목을 1~5점으로 진단합니다. 가중 평균이 기준에 못 미치는 영역은 견적 전 보완 과제로 남습니다.')}
    <div class="score-grid">${scoreCards}</div>
    <div class="field" style="margin-bottom:18px"><label>딜 트랙</label><select id="deal-track" ${disabledAttr()}><option value="">트랙 선택</option>${trackOptions}</select></div>
    <div class="fqa-list">${rows}</div>`;
}

function renderSolutions() {
  const selected = new Set(state.deal.isv_combo || []);
  const query = state.catalogQuery.toLowerCase();
  const filtered = state.refs.solutions.filter((solution) => `${solution.name} ${solution.category} ${solution.jtbd}`.toLowerCase().includes(query));
  const cards = filtered.map((solution) => `<label class="select-card ${selected.has(solution.id) ? 'selected' : ''}">
    <input type="checkbox" data-solution-id="${solution.id}" ${selected.has(solution.id) ? 'checked' : ''} ${disabledAttr()}>
    <h3>${escapeHtml(solution.name)}</h3><p>${escapeHtml(solution.jtbd || '카탈로그 설명 준비 중')}</p>
    <div class="card-meta"><span>급 ${solution.grade ?? '—'}</span><span>${escapeHtml(solution.scale || '규모 미정')}</span><span>${escapeHtml(solution.focal_name || '포컬 미배정')}</span>${solution.status_op === 'paused' ? '<span>준비중</span>' : ''}</div>
    ${solution.tech_note ? `<div class="tech-note">기술 확인 · ${escapeHtml(solution.tech_note)}</div>` : ''}
  </label>`).join('');
  return `${stageHeader('03', 'ISV 조합 확정', 'AI Radar의 내부 카탈로그를 딜과 연결합니다. 급·포컬·기술 제약은 내부에서만 보입니다.')}
    <div class="catalog-toolbar"><div class="search-wrap"><i data-lucide="search"></i><input id="catalog-search" type="search" value="${escapeHtml(state.catalogQuery)}" placeholder="솔루션·카테고리 검색"></div></div>
    <div class="selection-grid">${cards || '<div class="empty-state">검색 결과가 없습니다.</div>'}</div>`;
}

function renderPackages() {
  const selected = new Map((state.deal.packages || []).map((item) => [typeof item === 'string' ? item : item.id, item]));
  const cards = state.refs.packages.map((pkg) => {
    const value = selected.get(pkg.id);
    const checked = Boolean(value);
    return `<label class="select-card package-card ${checked ? 'selected' : ''}"><input type="checkbox" data-package-id="${pkg.id}" ${checked ? 'checked' : ''} ${disabledAttr()}>
      <div class="package-top"><div><h3>${escapeHtml(pkg.name)}</h3><p>${escapeHtml(pkg.target || '')}</p></div><span class="track-badge">${escapeHtml(pkg.scale || '—')}</span></div>
      <div class="card-meta"><span>${escapeHtml(pkg.period || '기간 협의')}</span>${(pkg.items || []).slice(0,2).map((item) => `<span>${escapeHtml(item.label)}</span>`).join('')}</div>
      <div class="md-control"><input type="number" min="0" max="999" step="1" data-package-md="${pkg.id}" value="${checked && typeof value === 'object' ? escapeHtml(value.md || '') : ''}" placeholder="MD" ${checked && isOwner() ? '' : 'disabled'}><span>조정 공수(MD)</span></div>
    </label>`;
  }).join('');
  return `${stageHeader('04', '패키지와 딜 사이즈', '확정한 ISV 조합 위에 필요한 서비스 패키지를 얹습니다. 조정 공수는 딜별로 저장됩니다.')}<div class="selection-grid">${cards}</div>`;
}

function buildPitch() {
  const meta = state.deal.customer_meta || {};
  const selectedSolutions = state.refs.solutions.filter((solution) => (state.deal.isv_combo || []).includes(solution.id));
  const packageMap = new Map(state.refs.packages.map((pkg) => [pkg.id, pkg]));
  const selectedPackages = (state.deal.packages || []).map((item) => packageMap.get(typeof item === 'string' ? item : item.id)).filter(Boolean);
  const track = state.refs.tracks.find((item) => item.id === state.deal.track);
  const failing = Object.entries(state.deal.fqa_totals || {}).filter(([, value]) => !value.ready).map(([key]) => key);
  return `${state.deal.customer} 제안 대화 가이드

1. 고객 상황
${meta.industry ? `${meta.industry} 업종의 ` : ''}${state.deal.customer}는 ${meta.targetUsers || '핵심 사용자'}를 대상으로 Enterprise AI 도입을 검토하고 있습니다. ${meta.notes || '현재 업무 문제와 PoC 성공 기준을 먼저 합의합니다.'}

2. 권고 접근
${track ? `${track.name}: ${track.why}` : '진단 결과에 맞춰 도입 트랙을 확정합니다.'}
${failing.length ? `진단에서 ${failing.join(', ')} 영역이 기준 미달이므로, 이 영역을 PoC 선행 과제로 둡니다.` : '현재 입력된 진단 영역은 기준을 충족합니다.'}

3. 권고 조합
${selectedSolutions.length ? selectedSolutions.map((solution) => `• ${solution.name} — ${solution.jtbd || '핵심 요구 대응'}`).join('\n') : '• ISV 조합을 ③ 단계에서 선택해주세요.'}

4. 실행 패키지
${selectedPackages.length ? selectedPackages.map((pkg) => `• ${pkg.name} (${pkg.period || '기간 협의'}) — ${pkg.target || ''}`).join('\n') : '• 서비스 패키지를 ④ 단계에서 선택해주세요.'}

5. 다음 합의
의사결정자·현업 오너와 PoC 성공 KPI, 보안 검토 범위, 일정과 예산을 확정합니다. 최종 제안 전 기술 제약과 포컬 배정을 다시 확인합니다.`;
}

function renderPitch() {
  return `${stageHeader('05', '세일즈 피치 준비', '앞 단계에서 확정한 고객 맥락·트랙·ISV·패키지를 한 번에 묶은 대화 가이드입니다.', '<button id="copy-pitch" class="secondary-button" type="button"><i data-lucide="copy"></i> 피치 복사</button>')}
    <div id="pitch-content" class="pitch-box">${escapeHtml(buildPitch())}</div>`;
}

function bindStageEvents() {
  $$('[data-deal-field]').forEach((input) => input.addEventListener('input', () => {
    state.deal[input.dataset.dealField] = input.value;
    scheduleSave({ [input.dataset.dealField]: input.value });
  }));
  $$('[data-meta-field]').forEach((input) => input.addEventListener('change', () => {
    const meta = { ...(state.deal.customer_meta || {}), [input.dataset.metaField]: input.type === 'checkbox' ? input.checked : input.value };
    state.deal.customer_meta = meta;
    scheduleSave({ customer_meta: meta });
  }));
  $$('[data-fqa-no]').forEach((select) => select.addEventListener('change', () => {
    const scores = { ...(state.deal.fqa_scores || {}) };
    if (select.value) scores[select.dataset.fqaNo] = Number(select.value);
    else delete scores[select.dataset.fqaNo];
    state.deal.fqa_scores = scores;
    scheduleSave({ fqa_scores: scores }, true);
  }));
  $('#deal-track')?.addEventListener('change', (event) => {
    state.deal.track = event.target.value || null;
    scheduleSave({ track: state.deal.track }, true);
  });
  $('#catalog-search')?.addEventListener('input', (event) => {
    state.catalogQuery = event.target.value;
    renderStage();
    const input = $('#catalog-search');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  $$('[data-solution-id]').forEach((input) => input.addEventListener('change', () => {
    const selected = new Set(state.deal.isv_combo || []);
    input.checked ? selected.add(input.dataset.solutionId) : selected.delete(input.dataset.solutionId);
    state.deal.isv_combo = [...selected];
    scheduleSave({ isv_combo: state.deal.isv_combo }, true);
    renderStage();
  }));
  $$('[data-package-id]').forEach((input) => input.addEventListener('change', () => {
    const map = new Map((state.deal.packages || []).map((item) => [typeof item === 'string' ? item : item.id, typeof item === 'string' ? { id: item } : item]));
    input.checked ? map.set(input.dataset.packageId, { id: input.dataset.packageId, md: null }) : map.delete(input.dataset.packageId);
    state.deal.packages = [...map.values()];
    scheduleSave({ packages: state.deal.packages }, true);
    renderStage();
  }));
  $$('[data-package-md]').forEach((input) => input.addEventListener('change', () => {
    state.deal.packages = (state.deal.packages || []).map((item) => {
      const normal = typeof item === 'string' ? { id: item } : item;
      return normal.id === input.dataset.packageMd ? { ...normal, md: input.value ? Number(input.value) : null } : normal;
    });
    scheduleSave({ packages: state.deal.packages });
  }));
  $('#copy-pitch')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(buildPitch());
    toast('피치 가이드를 복사했습니다.');
  });
}

function scheduleSave(patch, quick = false) {
  if (!isOwner()) return;
  Object.assign(state.pendingPatch, patch);
  clearTimeout(state.saveTimer);
  setSaveState('saving', '저장 중…');
  state.saveTimer = setTimeout(() => flushSave(), quick ? 180 : 700);
}

async function flushSave() {
  const patch = { ...state.pendingPatch };
  state.pendingPatch = {};
  if (!Object.keys(patch).length) return;
  await savePatch(patch);
}

async function savePatch(patch, rerender = false) {
  setSaveState('saving', '저장 중…');
  try {
    const updated = await api(`/api/hub/deals/${state.deal.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    state.deal = { ...state.deal, ...updated };
    state.activeStage = Object.prototype.hasOwnProperty.call(patch, 'stage') ? updated.stage : state.activeStage;
    setSaveState('', '저장됨');
    renderReadiness();
    if (rerender || Object.prototype.hasOwnProperty.call(patch, 'stage')) {
      renderWorkspace();
    }
  } catch (error) {
    setSaveState('error', '저장 실패');
    toast(error.message);
  }
}

function setSaveState(className, label) {
  const node = $('#save-state');
  node.className = `save-state ${className}`;
  node.textContent = label;
}

function renderReadiness() {
  const totals = state.deal?.fqa_totals || {};
  const entries = Object.entries(totals);
  $('#readiness-card').innerHTML = `<h3>FQA 준비도</h3>${entries.length ? entries.map(([category, value]) => `<div class="mini-bar"><span>${category}</span><span class="mini-bar-track"><i style="width:${Math.min(100, value.score / 5 * 100)}%"></i></span><span>${Number(value.score).toFixed(1)}</span></div>`).join('') : '<p style="color:var(--muted);font-size:10px;line-height:1.6;margin:0">② 단계에서 진단을 시작하면 영역별 준비도가 표시됩니다.</p>'}`;
}

async function claimDeal() {
  try {
    state.deal = { ...state.deal, ...(await api(`/api/hub/deals/${state.deal.id}/claim`, { method: 'POST' })), owner_name: state.user.name };
    toast('이 딜의 담당자로 배정되었습니다.');
    renderWorkspace();
  } catch (error) {
    toast(error.message);
  }
}

function connectEvents() {
  state.eventSource?.close();
  const events = new EventSource('/api/hub/events');
  state.eventSource = events;
  events.addEventListener('ready', () => {
    $('#sync-status').innerHTML = '<i data-lucide="radio"></i> 실시간 연결';
    window.lucide?.createIcons();
  });
  events.addEventListener('deal-change', async (event) => {
    const change = JSON.parse(event.data || '{}');
    if (state.deal?.id === change.id && !Object.keys(state.pendingPatch).length) {
      state.deal = await api(`/api/hub/deals/${change.id}`);
      renderWorkspace();
    } else if (!state.deal) {
      await loadDeals();
    }
  });
  events.onerror = () => { $('#sync-status').textContent = '재연결 중'; };
}

document.addEventListener('DOMContentLoaded', async () => {
  await init();
  const dealId = new URLSearchParams(window.location.search).get('deal');
  if (dealId) await openDeal(dealId);
});
