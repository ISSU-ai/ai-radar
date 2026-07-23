'use strict';

if (window.self !== window.top) {
  window.parent.postMessage({ type: 'issu-hub:navigate', route: 'deals' }, window.location.origin);
}

const state = {
  user: null,
  deals: [],
  refs: { stages: [], tracks: [], fqaItems: [], packages: [], solutions: [] },
  deal: null,
  activeStage: 0,
  dealFilter: 'all',
  mode: 'deals',
  userCollapsed: false,
  openSequence: 0,
  dealListSequence: 0,
  saveTimer: null,
  pendingPatch: {},
  pendingDealId: null,
  inFlightSaves: new Map(),
  eventSource: null,
  catalogQuery: ''
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
// jsonb array fields (isv_combo, packages) can come back as a non-array object
// for malformed deals; coerce so `new Set(...)`/`.map(...)` never throw.
const asArray = (value) => (Array.isArray(value) ? value : []);
const sourceNames = { portal: '포탈 유입', manual: '직접 생성', sheet: '시트 회수' };
const DEAL_SIM_TYPE_LABEL = { seat: '좌석 라이선스', once: '일회성', mrr: '운영 MRR' };
const fqaCategoryLabels = Object.freeze({
  A: '보안·데이터',
  B: '연동·기술',
  C: '운영·관리',
  D: '업무·성과'
});
const fqaScoreLabels = Object.freeze(['', '매우 미흡', '미흡', '보통', '양호', '준비됨']);

function hasFqaScore(scores, no) {
  const score = Number(scores[no]);
  return Number.isInteger(score) && score >= 1 && score <= 5;
}

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

function formatKRW(value) {
  return `₩${Math.round(Number(value) || 0).toLocaleString('ko-KR')}`;
}

function formatKRWCompact(value) {
  const n = Math.round(Number(value) || 0);
  if (n >= 100000000) return `₩${(n / 100000000).toFixed(n % 100000000 === 0 ? 0 : 1)}억`;
  if (n >= 10000) return `₩${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
  return `₩${n.toLocaleString('ko-KR')}`;
}

function isOwner() {
  return Boolean(state.deal && (state.user.role === 'admin' || state.deal.owner_id === state.user.id));
}

async function init() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    const userLabel = me.user.name || me.user.email || '사용자';
    $('#rail-user-avatar').textContent = userLabel.trim().charAt(0).toUpperCase() || 'U';
    $('#rail-user-avatar').title = userLabel;
    $('#admin-mode-button').classList.toggle('hidden', me.user.role !== 'admin');
    state.refs = await api('/api/hub/reference-data');
    bindGlobalEvents();
    await loadDeals();
    connectEvents();
    updateLayoutState();
    window.lucide?.createIcons();
  } catch (error) {
    console.error(error);
  }
}

function bindGlobalEvents() {
  $('#logout-button').addEventListener('click', async () => {
    try {
      await flushSave();
    } catch (_error) {
      const leaveAnyway = window.confirm('변경사항을 저장하지 못했습니다. 저장되지 않은 내용을 버리고 로그아웃할까요?');
      if (!leaveAnyway) return;
    }
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
  $('#new-deal-button').addEventListener('click', () => {
    $('#new-deal-dialog').showModal();
    requestAnimationFrame(() => $('#new-customer').focus());
  });
  $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => $('#new-deal-dialog').close()));
  $('#new-deal-form').addEventListener('submit', createDeal);
  $('#list-toggle').addEventListener('click', toggleDealList);
  $('#reference-list-toggle').addEventListener('click', toggleDealList);
  $('#admin-list-toggle').addEventListener('click', switchToDeals);
  $('#deal-mode-button').addEventListener('click', switchToDeals);
  $('#reference-mode-button').addEventListener('click', openReferenceMode);
  $('#admin-mode-button').addEventListener('click', openAdminMode);
  $('#deal-list').addEventListener('click', (event) => {
    const card = event.target.closest('[data-deal-id]');
    if (card) void openDeal(card.dataset.dealId, { historyMode: 'push' });
  });
  $('#stage-rail').addEventListener('click', (event) => {
    const button = event.target.closest('[data-stage]');
    if (button) void selectStage(Number(button.dataset.stage));
  });
  $('#deal-filter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button || button.dataset.filter === state.dealFilter) return;
    state.dealFilter = button.dataset.filter;
    $$('[data-filter]', $('#deal-filter')).forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    void loadDeals();
  });

  let filterTimer;
  $('#deal-search').addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadDeals, 250);
  });
  $('#claim-button').addEventListener('click', claimDeal);
  $('#reference-frame').addEventListener('load', guardReferenceFrame);
  $('#admin-frame').addEventListener('load', guardAdminFrame);
  window.addEventListener('message', handleEmbeddedNavigation);
  window.addEventListener('popstate', handlePopState);
  window.addEventListener('resize', updateLayoutState);
  window.addEventListener('beforeunload', warnIfUnsaved);
  window.addEventListener('pagehide', flushPendingOnPageHide);
}

async function loadDeals() {
  const requestId = ++state.dealListSequence;
  const params = new URLSearchParams();
  const q = $('#deal-search')?.value.trim();
  if (q) params.set('q', q);
  if (state.dealFilter === 'mine') params.set('mine', 'true');

  try {
    const deals = await api(`/api/hub/deals?${params}`);
    if (requestId !== state.dealListSequence) return;
    state.deals = state.dealFilter === 'new'
      ? deals.filter((deal) => deal.source === 'portal' && !deal.owner_id)
      : deals;
    renderMetrics();
    renderDealList();
  } catch (error) {
    if (requestId !== state.dealListSequence) return;
    $('#deal-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderMetrics() {
  $('#deal-count').textContent = state.deals.length;
}

function renderDealList() {
  const list = $('#deal-list');
  const scrollTop = list.scrollTop;
  if (!state.deals.length) {
    list.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><br>조건에 맞는 딜이 없습니다.</div>`;
    window.lucide?.createIcons();
    return;
  }

  list.innerHTML = state.deals.map((deal) => {
    const stageLabel = state.refs.stages[deal.stage] || '들어온 데이터';
    const isNew = deal.source === 'portal' && !deal.owner_id;
    const meta = deal.customer_meta || {};
    const sub = [meta.industry, meta.companySize || meta.targetUsers].filter(Boolean).join(' · ') || sourceNames[deal.source] || '고객 정보 확인 중';
    const selected = state.deal?.id === deal.id;
    const dots = state.refs.stages.map((_, index) => `<i class="${index < deal.stage ? 'done' : ''} ${index === deal.stage ? 'current' : ''}"></i>`).join('');
    return `<button class="deal-card ${selected ? 'selected' : ''}" type="button" data-deal-id="${deal.id}" aria-current="${selected ? 'true' : 'false'}">
      <span class="deal-card-head"><span class="deal-card-customer"><strong>${escapeHtml(deal.customer)}</strong>${isNew ? '<span class="new-tag">신규</span>' : ''}</span><span class="track-badge" data-track="${escapeHtml(deal.track || '')}">${escapeHtml(deal.track || '미정')}</span></span>
      <span class="deal-card-sub">${escapeHtml(sub)}</span>
      <span class="deal-card-foot"><span class="deal-stage-summary"><span class="stage-dots">${dots}</span><span class="deal-stage-label">${deal.stage + 1} · ${escapeHtml(stageLabel)}</span></span><span class="deal-owner">${escapeHtml(deal.owner_name || '미배정')}</span></span>
    </button>`;
  }).join('');
  list.scrollTop = scrollTop;
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
    await openDeal(deal.id, { historyMode: 'push' });
  } catch (error) {
    $('#new-deal-error').textContent = error.message;
  }
}

async function openDeal(id, { historyMode = 'replace' } = {}) {
  const requestId = ++state.openSequence;
  try {
    await flushSave();
    const deal = await api(`/api/hub/deals/${id}`);
    if (requestId !== state.openSequence) return;
    state.deal = deal;
    state.activeStage = state.deal.stage;
    state.mode = 'deals';
    $('#empty-workspace').classList.add('hidden');
    $('#reference-workspace').classList.add('hidden');
    $('#admin-workspace').classList.add('hidden');
    $('#workspace').classList.remove('hidden');
    $('#app').classList.toggle('mobile-workspace', isMobile());
    state.userCollapsed = false;
    updateLayoutState();
    renderWorkspace();
    syncDealSelection();
    $('#workspace-scroll').scrollTop = 0;
    updateHistoryForDeal(id, historyMode);
  } catch (error) {
    toast(error.message);
  }
}

function syncDealSelection() {
  $$('.deal-card', $('#deal-list')).forEach((card) => {
    const selected = card.dataset.dealId === state.deal?.id;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-current', String(selected));
  });
}

function isMobile() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function updateLayoutState() {
  const app = $('#app');
  const mobile = isMobile();
  const collapsed = state.mode === 'admin' || state.userCollapsed;
  app.classList.toggle('list-collapsed', !mobile && collapsed);
  if (!mobile) {
    app.classList.remove('mobile-workspace');
  } else {
    const detailRoute = new URLSearchParams(window.location.search).has('deal');
    const showMobileWorkspace = state.mode !== 'deals'
      || detailRoute
      || app.classList.contains('mobile-workspace');
    app.classList.toggle('mobile-workspace', showMobileWorkspace);
  }

  const sidebarHidden = (!mobile && collapsed) || (mobile && app.classList.contains('mobile-workspace'));
  $('#deal-sidebar').inert = sidebarHidden;
  $('#deal-sidebar').setAttribute('aria-hidden', String(sidebarHidden));

  const toggle = $('#list-toggle');
  if (toggle) {
    const mobileBack = mobile && app.classList.contains('mobile-workspace');
    const icon = mobileBack ? 'arrow-left' : collapsed ? 'panel-left-open' : 'panel-left-close';
    const label = mobileBack ? '딜 목록으로 돌아가기' : collapsed ? '딜 목록 펼치기' : '딜 목록 접기';
    toggle.innerHTML = `<i data-lucide="${icon}"></i>`;
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-expanded', String(!sidebarHidden));
  }

  const dealActive = state.mode === 'deals';
  $('#deal-mode-button').classList.toggle('active', dealActive);
  $('#deal-mode-button').setAttribute('aria-current', dealActive ? 'page' : 'false');
  $('#admin-mode-button').classList.toggle('active', state.mode === 'admin');
  $('#admin-mode-button').setAttribute('aria-current', state.mode === 'admin' ? 'page' : 'false');
  $('#reference-mode-button').classList.toggle('active', state.mode === 'reference');
  $('#reference-mode-button').setAttribute('aria-current', state.mode === 'reference' ? 'page' : 'false');

  const referenceToggle = $('#reference-list-toggle');
  if (referenceToggle) {
    const mobileBack = mobile && sidebarHidden;
    const icon = mobileBack ? 'arrow-left' : collapsed ? 'panel-left-open' : 'panel-left-close';
    const label = mobileBack ? '딜 목록으로 돌아가기' : collapsed ? '딜 목록 펼치기' : '딜 목록 접기';
    referenceToggle.innerHTML = `<i data-lucide="${icon}"></i>`;
    referenceToggle.title = label;
    referenceToggle.setAttribute('aria-label', label);
    referenceToggle.setAttribute('aria-expanded', String(!sidebarHidden));
  }
  window.lucide?.createIcons();
}

function toggleDealList() {
  if (isMobile()) {
    if (state.mode !== 'deals') {
      switchToDeals();
      return;
    }
    if (history.state?.hubDetail) {
      history.back();
    } else {
      $('#app').classList.remove('mobile-workspace');
      history.replaceState({ hubList: true }, '', '/hub');
      updateLayoutState();
    }
    return;
  }
  state.userCollapsed = !state.userCollapsed;
  updateLayoutState();
}

function switchToDeals() {
  state.openSequence += 1;
  state.mode = 'deals';
  state.userCollapsed = false;
  $('#admin-workspace').classList.add('hidden');
  $('#reference-workspace').classList.add('hidden');
  $('#workspace').classList.toggle('hidden', !state.deal);
  $('#empty-workspace').classList.toggle('hidden', Boolean(state.deal));
  const mobile = isMobile();
  if (mobile) $('#app').classList.remove('mobile-workspace');
  const selectedId = state.deal?.id;
  const url = selectedId && !mobile ? `/hub?deal=${encodeURIComponent(selectedId)}` : '/hub';
  history.replaceState({ hubList: !selectedId || mobile, hubDetail: false, dealId: selectedId || null }, '', url);
  updateLayoutState();
}

function openReferenceMode() {
  state.openSequence += 1;
  state.mode = 'reference';
  $('#workspace').classList.add('hidden');
  $('#empty-workspace').classList.add('hidden');
  $('#admin-workspace').classList.add('hidden');
  $('#reference-workspace').classList.remove('hidden');
  ensureReferenceFrame();
  if (isMobile()) $('#app').classList.add('mobile-workspace');
  history.replaceState({ hubReference: true }, '', '/hub?mode=reference');
  updateLayoutState();
}

async function openAdminMode() {
  if (state.user?.role !== 'admin') return;
  state.openSequence += 1;
  try {
    await flushSave();
  } catch (_error) {
    return;
  }
  state.mode = 'admin';
  $('#workspace').classList.add('hidden');
  $('#empty-workspace').classList.add('hidden');
  $('#reference-workspace').classList.add('hidden');
  $('#admin-workspace').classList.remove('hidden');
  const frame = $('#admin-frame');
  if (!frame.getAttribute('src')) frame.setAttribute('src', frame.dataset.src);
  history.replaceState({ hubAdmin: true }, '', '/hub?mode=admin');
  updateLayoutState();
}

function ensureReferenceFrame(force = false) {
  const frame = $('#reference-frame');
  let needsReset = force || !frame.getAttribute('src');
  if (!needsReset) {
    try {
      const current = new URL(frame.contentWindow.location.href);
      needsReset = current.origin !== window.location.origin || current.pathname !== '/radar';
    } catch (_error) {
      needsReset = true;
    }
  }
  if (needsReset) frame.setAttribute('src', frame.dataset.src);
}

function handleEmbeddedNavigation(event) {
  const frame = $('#reference-frame');
  if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type !== 'issu-hub:navigate') return;
  ensureReferenceFrame(true);
  if (event.data.route === 'deals') switchToDeals();
  if (event.data.route === 'admin') void openAdminMode();
}

function guardReferenceFrame() {
  const frame = $('#reference-frame');
  if (!frame.getAttribute('src')) return;
  try {
    const current = new URL(frame.contentWindow.location.href);
    if (current.origin !== window.location.origin) return;
    if (current.pathname === '/hub') {
      ensureReferenceFrame(true);
      switchToDeals();
    } else if (current.pathname.startsWith('/admin')) {
      ensureReferenceFrame(true);
      void openAdminMode();
    } else if (current.pathname === '/login' || current.pathname === '/login.html') {
      window.location.href = '/login.html?next=/hub';
    }
  } catch (_error) {
    // Cross-origin content is allowed only as a passive reference and cannot be inspected.
  }
}

function guardAdminFrame() {
  const frame = $('#admin-frame');
  if (!frame.getAttribute('src')) return;
  try {
    const current = new URL(frame.contentWindow.location.href);
    if (current.origin === window.location.origin && (current.pathname === '/login' || current.pathname === '/login.html')) {
      window.location.href = '/login.html?next=/hub?mode=admin';
    }
  } catch (_error) {
    // Ignore a future cross-origin admin deployment.
  }
}

function updateHistoryForDeal(id, historyMode) {
  if (historyMode === 'none') return;
  const url = `/hub?deal=${encodeURIComponent(id)}`;
  if (isMobile() && historyMode === 'push' && window.location.search !== `?deal=${encodeURIComponent(id)}`) {
    history.pushState({ hubDetail: true, dealId: id }, '', url);
  } else {
    history.replaceState({ hubDetail: isMobile(), dealId: id }, '', url);
  }
}

function handlePopState() {
  const params = new URLSearchParams(window.location.search);
  const dealId = params.get('deal');
  if (params.get('mode') === 'admin' && state.user?.role === 'admin') {
    void openAdminMode();
    return;
  }
  if (params.get('mode') === 'reference') {
    openReferenceMode();
    return;
  }
  if (dealId) {
    void openDeal(dealId, { historyMode: 'none' });
    return;
  }
  state.mode = 'deals';
  $('#admin-workspace').classList.add('hidden');
  $('#reference-workspace').classList.add('hidden');
  $('#workspace').classList.toggle('hidden', !state.deal);
  $('#empty-workspace').classList.toggle('hidden', Boolean(state.deal));
  if (isMobile()) $('#app').classList.remove('mobile-workspace');
  updateLayoutState();
}

function selectStage(nextStage) {
  if (!state.deal || !Number.isInteger(nextStage) || nextStage < 0 || nextStage >= state.refs.stages.length) return;
  state.activeStage = nextStage;
  renderStageRail();
  renderStage();
  $('#workspace-scroll').scrollTo({ top: 0, behavior: 'smooth' });
  requestAnimationFrame(() => $(`.stage-button[data-stage="${nextStage}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' }));
}

function renderWorkspace() {
  const deal = state.deal;
  $('#workspace-customer').textContent = deal.customer;
  $('#workspace-track').textContent = deal.track || '미정';
  $('#workspace-track').dataset.track = deal.track || '';
  $('#workspace-owner').textContent = `담당 ${deal.owner_name || '미배정'}`;
  $('#workspace-source').textContent = `유입 ${sourceNames[deal.source] || deal.source}`;
  $('#context-owner').textContent = deal.owner_name || '미배정';
  $('#context-track').textContent = deal.track ? `${deal.track} · ${deal.track_name || ''}` : '미정';
  $('#context-source').textContent = sourceNames[deal.source] || deal.source;
  $('#context-updated').textContent = formatDate(deal.updated_at);
  $('#claim-button').classList.toggle('hidden', Boolean(deal.owner_id));
  renderStageRail();
  renderStage();
  renderReadiness();
  syncDealSelection();
  window.lucide?.createIcons();
}

function renderStageRail() {
  const rail = $('#stage-rail');
  rail.innerHTML = state.refs.stages.map((label, index) => `<button type="button" class="stage-button ${index === state.activeStage ? 'active' : ''} ${index < state.deal.stage ? 'done' : ''}" data-stage="${index}" aria-current="${index === state.activeStage ? 'step' : 'false'}">
    <span>${index + 1}</span><div><strong>${escapeHtml(label)}</strong><small>${['리드·고객 맥락','21항목·보완벽','카탈로그·포컬','패키지·공수','제안 스크립트'][index]}</small></div>
  </button>`).join('');
}

function stageHeader(no, title, copy, action = '') {
  return `<header class="stage-header"><div><p class="eyebrow">STEP ${no}</p><h2>${title}</h2><p>${copy}</p></div>${action}</header>`;
}

const STAGE_RENDERERS = [renderIntake, renderFqa, renderSolutions, renderPackages, renderPitch];

function renderStage() {
  const stage = state.activeStage;
  const content = $('#stage-content');
  const carryMessages = [
    '포탈·미팅·시트에서 들어온 고객 맥락을 정리하며 시작합니다.',
    '↑ 들어온 데이터의 고객 맥락을 이어서 PoC 검증을 시작합니다.',
    '↑ 진단 점수와 트랙을 이어서 ISV 조합을 확정합니다.',
    '↑ 선택한 ISV 조합을 이어서 패키지와 공수를 구성합니다.',
    '↑ 앞 단계의 고객·진단·조합·패키지를 한 번에 이어받습니다.'
  ];
  // Never let a render exception leave the step blank/stuck: on error, show a
  // message and log the real error instead of silently aborting mid-render.
  try {
    const carryBadge = $('#carry-badge')?.querySelector('span');
    if (carryBadge) carryBadge.textContent = carryMessages[stage] || '';
    const renderer = STAGE_RENDERERS[stage];
    content.innerHTML = renderer ? renderer() : '';
    bindStageEvents();
    window.lucide?.createIcons();
  } catch (error) {
    console.error(`[hub] renderStage(${stage}) failed:`, error);
    content.innerHTML = `<div class="empty-state">이 단계를 표시하는 중 문제가 발생했습니다. 새로고침 후 다시 시도해주세요.<br><small>${escapeHtml(error && error.message || '')}</small></div>`;
  }
}

function disabledAttr() { return isOwner() ? '' : 'disabled'; }

function renderIntake() {
  const meta = state.deal.customer_meta || {};
  return `${stageHeader('01', '들어온 데이터', '포탈·미팅·시트에서 들어온 고객 맥락을 한곳에 정리합니다. 이 정보는 이후 모든 단계에 그대로 이어집니다.')}
    <div class="form-grid">
      <div class="field"><label for="deal-customer">고객사</label><input id="deal-customer" type="text" data-deal-field="customer" value="${escapeHtml(state.deal.customer)}" ${disabledAttr()}></div>
      <div class="field"><label for="deal-industry">업종</label><input id="deal-industry" type="text" data-meta-field="industry" value="${escapeHtml(meta.industry || '')}" placeholder="금융 / 제조 / 공공" ${disabledAttr()}></div>
      <div class="field"><label for="deal-company-size">조직 규모</label><select id="deal-company-size" data-meta-field="companySize" ${disabledAttr()}><option value="">선택</option>${['1~99명','100~499명','500~1,999명','2,000명 이상'].map((v) => `<option ${meta.companySize === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="deal-target-users">도입 대상</label><input id="deal-target-users" type="text" data-meta-field="targetUsers" value="${escapeHtml(meta.targetUsers || '')}" placeholder="예: 전사 2,000명 / 개발조직 200명" ${disabledAttr()}></div>
      <div class="field full"><label for="deal-contact">고객 연락처</label><input id="deal-contact" type="text" data-meta-field="contact" value="${escapeHtml(meta.contact || state.deal.lead_contact || '')}" placeholder="업무 이메일 또는 전화번호" ${disabledAttr()}></div>
      <div class="field"><label for="deal-security-stack">현재 보안 환경</label><select id="deal-security-stack" data-meta-field="securityStack" ${disabledAttr()}><option value="">미정</option><option value="none" ${meta.securityStack === 'none' ? 'selected' : ''}>별도 SWG 없음</option><option value="zscaler" ${meta.securityStack === 'zscaler' ? 'selected' : ''}>Zscaler</option><option value="other-swg" ${meta.securityStack === 'other-swg' ? 'selected' : ''}>타사 SWG</option></select></div>
      <div class="field"><label for="deal-investment">투자 여력</label><select id="deal-investment" data-meta-field="investment" ${disabledAttr()}><option value="">미정</option><option value="low" ${meta.investment === 'low' ? 'selected' : ''}>제한적</option><option value="medium" ${meta.investment === 'medium' ? 'selected' : ''}>PoC 예산 확보</option><option value="high" ${meta.investment === 'high' ? 'selected' : ''}>전사 확장 가능</option></select></div>
      <div class="field full"><label for="deal-notes">고객 상황·요청 메모</label><textarea id="deal-notes" data-meta-field="notes" ${disabledAttr()} placeholder="미팅에서 확인한 문제, 의사결정자, 일정 등을 적어주세요.">${escapeHtml(meta.notes || state.deal.lead_message || '')}</textarea></div>
    </div>`;
}

function renderFqa() {
  const totals = state.deal.fqa_totals || {};
  const scoreCards = ['A','B','C','D'].map((category) => {
    const total = totals[category];
    const status = total ? (total.ready ? 'pass' : 'fail') : '';
    return `<div class="score-card ${status}" data-category="${category}"><span>${category} · ${fqaCategoryLabels[category]}</span><strong>${total ? total.score.toFixed(2) : '—'}</strong><small>${total ? `${total.answered}개 응답 · ${total.ready ? '기준 충족' : '보완 필요'}` : '응답 대기'}</small></div>`;
  }).join('');
  const trackOptions = state.refs.tracks.map((track) => `<option value="${track.id}" ${state.deal.track === track.id ? 'selected' : ''}>${track.id} · ${escapeHtml(track.name)}</option>`).join('');
  const scores = state.deal.fqa_scores || {};
  const groups = ['A','B','C','D'].map((category) => {
    const items = state.refs.fqaItems.filter((item) => item.category === category);
    if (!items.length) return '';
    const answered = items.filter((item) => hasFqaScore(scores, item.no)).length;
    const rows = items.map((item) => {
      const scoreButtons = [1,2,3,4,5].map((score) => `<label class="fqa-score-option" title="${score}점 · ${fqaScoreLabels[score]}">
        <input type="radio" name="fqa-${item.no}" value="${score}" data-fqa-no="${item.no}" data-fqa-category="${category}" ${Number(scores[item.no]) === score ? 'checked' : ''} ${disabledAttr()}>
        <span><strong>${score}</strong><small>${fqaScoreLabels[score]}</small></span>
      </label>`).join('');
      return `<div class="fqa-row">
        <div class="fqa-question"><span class="fqa-no">${category}-${String(item.no).padStart(2,'0')}</span><span class="fqa-copy"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.detail || '')}</small></span></div>
        <div class="fqa-score-control"><fieldset class="fqa-score-group" aria-label="${escapeHtml(item.name)} 점수 선택">${scoreButtons}</fieldset><button class="fqa-score-clear ${hasFqaScore(scores, item.no) ? '' : 'hidden'}" type="button" data-fqa-clear="${item.no}" data-fqa-category="${category}" ${disabledAttr()}>선택 해제</button></div>
      </div>`;
    }).join('');
    return `<section class="fqa-group" data-category="${category}" aria-labelledby="fqa-group-${category}">
      <header class="fqa-group-header"><span class="fqa-category-mark">${category}</span><div><h3 id="fqa-group-${category}">${fqaCategoryLabels[category]}</h3><p>${items.length}개 문항을 순서대로 평가하세요.</p></div><strong data-fqa-progress="${category}">${answered} / ${items.length} 응답</strong></header>
      <div class="fqa-list">${rows}</div>
    </section>`;
  }).join('');
  return `${stageHeader('02', 'PoC 검증과 보완 벽', '21개 항목을 1~5점으로 진단합니다. 가중 평균이 기준에 못 미치는 영역은 견적 전 보완 과제로 남습니다.')}
    <div class="score-grid">${scoreCards}</div>
    <div class="field" style="margin-bottom:18px"><label for="deal-track">딜 트랙</label><select id="deal-track" ${disabledAttr()}><option value="">트랙 선택</option>${trackOptions}</select></div>
    <div class="fqa-groups">${groups}</div>`;
}

function renderSolutions() {
  const selected = new Set(asArray(state.deal.isv_combo));
  const query = state.catalogQuery.toLowerCase();
  const filtered = state.refs.solutions.filter((solution) => `${solution.name} ${solution.category} ${solution.jtbd}`.toLowerCase().includes(query));
  const cards = filtered.map((solution) => `<label class="select-card ${selected.has(solution.id) ? 'selected' : ''}">
    <input type="checkbox" data-solution-id="${solution.id}" ${selected.has(solution.id) ? 'checked' : ''} ${disabledAttr()}>
    <h3>${escapeHtml(solution.name)}</h3><p>${escapeHtml(solution.jtbd || '카탈로그 설명 준비 중')}</p>
    <div class="card-meta"><span>급 ${solution.grade ?? '—'}</span><span>${escapeHtml(solution.scale || '규모 미정')}</span><span>${escapeHtml(solution.focal_name || '포컬 미배정')}</span>${solution.status_op === 'paused' ? '<span>준비중</span>' : ''}</div>
    ${solution.tech_note ? `<div class="tech-note">기술 확인 · ${escapeHtml(solution.tech_note)}</div>` : ''}
  </label>`).join('');
  return `${stageHeader('03', 'ISV 조합 확정', 'AI Radar의 내부 카탈로그를 딜과 연결합니다. 급·포컬·기술 제약은 내부에서만 보입니다.')}
    <div class="catalog-toolbar"><div class="search-wrap"><i data-lucide="search"></i><input id="catalog-search" type="search" value="${escapeHtml(state.catalogQuery)}" placeholder="솔루션·카테고리 검색"></div><a class="secondary-button" href="/radar" target="_blank" rel="noopener" title="AI Radar를 새 창으로 열기"><i data-lucide="external-link"></i> AI Radar</a></div>
    <div class="selection-grid">${cards || '<div class="empty-state">검색 결과가 없습니다.</div>'}</div>`;
}

function updateFqaProgress(category, scores) {
  const categoryItems = state.refs.fqaItems.filter((item) => item.category === category);
  const answered = categoryItems.filter((item) => hasFqaScore(scores, item.no)).length;
  const progress = $(`[data-fqa-progress="${category}"]`);
  if (progress) progress.textContent = `${answered} / ${categoryItems.length} 응답`;
}

function renderPackages() {
  const selected = new Map((asArray(state.deal.packages)).map((item) => [typeof item === 'string' ? item : item.id, item]));
  const cards = state.refs.packages.map((pkg) => {
    const value = selected.get(pkg.id);
    const checked = Boolean(value);
    const baseMd = Number(pkg.base_md) || 0;
    const unit = Number(pkg.unit_price) || 0;
    return `<label class="select-card package-card ${checked ? 'selected' : ''}"><input type="checkbox" data-package-id="${pkg.id}" ${checked ? 'checked' : ''} ${disabledAttr()}>
      <div class="package-top"><div><h3>${escapeHtml(pkg.name)}</h3><p>${escapeHtml(pkg.target || '')}</p></div><span class="track-badge">${escapeHtml(pkg.scale || '—')}</span></div>
      <div class="card-meta"><span>${escapeHtml(pkg.period || '기간 협의')}</span><span>기준 ${baseMd}MD</span><span>${unit ? `${formatKRW(unit)}/MD` : '단가 미설정'}</span></div>
      <div class="md-control"><input type="number" min="0" max="999" step="1" data-package-md="${pkg.id}" value="${checked && typeof value === 'object' ? escapeHtml(value.md || '') : ''}" placeholder="0" aria-label="${escapeHtml(pkg.name)} 조정 공수" ${checked && isOwner() ? '' : 'disabled'}><span>조정 공수(MD)</span></div>
    </label>`;
  }).join('');
  return `${stageHeader('04', '패키지와 딜 사이즈', '확정한 ISV 조합 위에 필요한 서비스 패키지를 얹습니다. 조정 공수는 딜별로 저장되고, 가견적은 (기준MD + 조정MD) × MD 단가로 합산됩니다.')}<div class="selection-grid">${cards}</div><div id="quote-estimate" class="quote-estimate">${quoteEstimateMarkup()}</div>${dealSimMarkup()}`;
}

function computeQuote() {
  const priceById = new Map(state.refs.packages.map((pkg) => [pkg.id, pkg]));
  const rows = (asArray(state.deal.packages)).map((item) => {
    const id = typeof item === 'string' ? item : item.id;
    const adjMd = (item && typeof item === 'object' && item.md != null) ? Number(item.md) || 0 : 0;
    const pkg = priceById.get(id);
    if (!pkg) return null;
    const baseMd = Number(pkg.base_md) || 0;
    const unit = Number(pkg.unit_price) || 0;
    const totalMd = baseMd + adjMd;
    return { id, name: pkg.name, baseMd, adjMd, totalMd, unit, amount: totalMd * unit };
  }).filter(Boolean);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return { rows, total, hasUnpriced: rows.some((row) => row.unit === 0) };
}

function quoteEstimateMarkup() {
  const { rows, total, hasUnpriced } = computeQuote();
  if (!rows.length) {
    return '<div class="quote-empty">패키지를 선택하면 가견적이 여기에 표시됩니다.</div>';
  }
  const lines = rows.map((row) => `<tr>
    <td>${escapeHtml(row.name)}</td>
    <td class="num">${row.baseMd}</td>
    <td class="num">${row.adjMd ? `+${row.adjMd}` : '0'}</td>
    <td class="num">${row.totalMd} MD</td>
    <td class="num">${row.unit ? formatKRW(row.unit) : '미설정'}</td>
    <td class="num amount">${formatKRW(row.amount)}</td>
  </tr>`).join('');
  return `<div class="quote-head"><h3>가견적<span> · 내부 참고용</span></h3><strong>${formatKRW(total)}</strong></div>
    <div class="quote-scroll"><table class="quote-table">
      <thead><tr><th>패키지</th><th class="num">기준MD</th><th class="num">조정MD</th><th class="num">합계</th><th class="num">MD 단가</th><th class="num">금액</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot><tr><td colspan="5">합계 (VAT 별도)</td><td class="num amount">${formatKRW(total)}</td></tr></tfoot>
    </table></div>
    ${hasUnpriced ? '<p class="quote-note">⚠ MD 단가가 설정되지 않은 패키지가 있어 ₩0으로 계산됩니다. 단가를 설정하세요.</p>' : ''}`;
}

function renderQuoteEstimate() {
  const node = document.getElementById('quote-estimate');
  if (node) node.innerHTML = quoteEstimateMarkup();
}

function getDealSeats() {
  const seats = Number(state.deal?.customer_meta?.sim?.seats);
  return Number.isFinite(seats) && seats > 0 ? Math.round(seats) : 100;
}

// Pick the volume tier that applies at `seats`. Tiers are ordered by up_to
// ascending; up_to null is the top/unbounded tier.
function pickTier(tiers, seats) {
  const usable = tiers.filter((tier) => tier && (tier.per_user != null || tier.flat != null));
  for (const tier of usable) {
    if (tier.up_to == null) return tier;
    if (seats <= Number(tier.up_to)) return tier;
  }
  return usable.length ? usable[usable.length - 1] : null;
}

function computeDealSim() {
  const seats = getDealSeats();
  const fx = Number(state.refs.settings?.usd_krw) || 1400;
  const selected = new Set(asArray(state.deal?.isv_combo));
  // Every ISV selected in STEP 03 (isv_combo) becomes a quote-list row here —
  // priced ones contribute to the totals, unpriced ones show "단가 미설정".
  const rows = (state.refs.solutions || [])
    .filter((sol) => selected.has(sol.id))
    .map((sol) => {
      const unit = Number(sol.unit_price) || 0;
      const tiers = asArray(sol.price_tiers);
      const isUsd = sol.currency === 'USD';
      const cur = isUsd ? '$' : '₩';
      const money = (n) => `${cur}${Math.round(Number(n) || 0).toLocaleString('ko-KR')}`;
      let local = 0;         // annual amount in the solution's own currency
      let formula = '';
      if (sol.price_type === 'seat' && tiers.length) {
        const tier = pickTier(tiers, seats);
        if (tier && tier.flat != null) { local = Number(tier.flat) || 0; formula = `고정 ${money(tier.flat)}/년 (≤${tier.up_to ?? '∞'})`; }
        else if (tier) { const pu = Number(tier.per_user) || 0; local = seats * pu; formula = `${seats}석 × ${money(pu)}/인·년`; }
      } else if (sol.price_type === 'seat') {
        local = seats * unit * 12; formula = `${seats}석 × ${money(unit)}/월 × 12`;
      } else if (sol.price_type === 'once') {
        local = unit; formula = `일회성 ${money(unit)}`;
      } else if (sol.price_type === 'mrr') {
        local = unit * 12; formula = `${money(unit)}/월 × 12`;
      }
      const annual = isUsd ? local * fx : local;
      const priced = annual > 0;
      return {
        id: sol.id, name: sol.name, type: sol.price_type || null, annual, priced,
        formula: priced ? formula + (isUsd ? ` ×${fx.toLocaleString('ko-KR')}` : '') : '단가 미설정 · admin에서 설정'
      };
    });
  const sumByType = (type) => rows.filter((row) => row.priced && row.type === type).reduce((sum, row) => sum + row.annual, 0);
  const license = sumByType('seat');
  const once = sumByType('once');
  const mrr = sumByType('mrr');
  const total = license + once + mrr;
  return {
    seats, rows, license, once, mrr, total,
    multiplier: license > 0 ? total / license : 0,
    anySelected: selected.size > 0,
    hasPriced: rows.some((row) => row.priced)
  };
}

function dealSimSummaryMarkup() {
  const { rows, license, once, mrr, total, multiplier, anySelected, hasPriced } = computeDealSim();
  if (!anySelected) return '<div class="quote-empty">STEP 03에서 ISV 솔루션을 선택하면 견적 리스트가 만들어집니다.</div>';
  const lineRows = rows.map((row) => `<tr class="${row.priced ? '' : 'unpriced'}">
    <td>${escapeHtml(row.name)}</td>
    <td>${row.type ? (DEAL_SIM_TYPE_LABEL[row.type] || row.type) : '—'}</td>
    <td class="num">${escapeHtml(row.formula)}</td>
    <td class="num amount">${row.priced ? formatKRW(row.annual) : '<span class="quote-muted">—</span>'}</td>
  </tr>`).join('');
  return `<div class="deal-sim-metrics">
      <div class="dsm" title="${formatKRW(license)}"><span>라이선스(연)</span><b>${formatKRWCompact(license)}</b></div>
      <div class="dsm" title="${formatKRW(once)}"><span>일회성 구축</span><b>${formatKRWCompact(once)}</b></div>
      <div class="dsm" title="${formatKRW(mrr)}"><span>운영 MRR(연환산)</span><b>${formatKRWCompact(mrr)}</b></div>
      <div class="dsm dsm-total" title="${formatKRW(total)}"><span>1년차 총 딜</span><b>${formatKRWCompact(total)}</b></div>
    </div>
    <div class="deal-sim-listhead">견적 리스트 · STEP 03 선택 ISV ${rows.length}건</div>
    <div class="quote-scroll"><table class="quote-table">
      <thead><tr><th>솔루션</th><th>유형</th><th class="num">산식</th><th class="num">연 금액</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table></div>
    ${!hasPriced ? '<p class="quote-note">선택한 솔루션에 단가가 없습니다. admin에서 가격(종류·단가/티어)을 설정하면 금액이 계산됩니다.</p>' : ''}
    ${multiplier > 0 ? `<p class="deal-sim-mult">라이선스 단독 대비 <b>${multiplier.toFixed(1)}배</b> — 결합 판매로 딜 사이즈가 확대됩니다.</p>` : ''}`;
}

function dealSimMarkup() {
  const seats = getDealSeats();
  return `<div class="deal-sim">
    <div class="quote-head"><h3>딜 사이즈 시뮬레이터<span> · 내부 참고용</span></h3></div>
    <div class="deal-sim-dummy">⚠ 더미 단가 · 구조 시연용. 실단가 확정 전 견적서 인용 금지.</div>
    <div class="deal-sim-seats">
      <label for="deal-sim-seat-num">좌석 수 (SEATS)</label>
      <input type="range" id="deal-sim-seat-range" min="10" max="3000" step="10" value="${Math.min(3000, Math.max(10, seats))}">
      <input type="number" id="deal-sim-seat-num" min="1" max="100000" step="10" value="${seats}">
    </div>
    <div id="deal-sim-summary">${dealSimSummaryMarkup()}</div>
  </div>`;
}

function renderDealSimulator() {
  const node = document.getElementById('deal-sim-summary');
  if (node) node.innerHTML = dealSimSummaryMarkup();
}

function setDealSeats(value, source) {
  const seats = Math.max(1, Math.round(Number(value) || 0));
  const meta = { ...(state.deal.customer_meta || {}) };
  meta.sim = { ...(meta.sim || {}), seats };
  state.deal.customer_meta = meta;
  const range = document.getElementById('deal-sim-seat-range');
  const num = document.getElementById('deal-sim-seat-num');
  if (source !== 'range' && range) range.value = Math.min(Number(range.max), Math.max(Number(range.min), seats));
  if (source !== 'num' && num) num.value = seats;
  renderDealSimulator();
  scheduleSave({ customer_meta: meta });
}

function buildPitch() {
  const meta = state.deal.customer_meta || {};
  const selectedSolutions = state.refs.solutions.filter((solution) => (asArray(state.deal.isv_combo)).includes(solution.id));
  const packageMap = new Map(state.refs.packages.map((pkg) => [pkg.id, pkg]));
  const selectedPackages = (asArray(state.deal.packages)).map((item) => packageMap.get(typeof item === 'string' ? item : item.id)).filter(Boolean);
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
  $$('[data-meta-field]').forEach((input) => input.addEventListener('input', () => {
    const meta = { ...(state.deal.customer_meta || {}), [input.dataset.metaField]: input.type === 'checkbox' ? input.checked : input.value };
    state.deal.customer_meta = meta;
    scheduleSave({ customer_meta: meta });
  }));
  $$('input[data-fqa-no]').forEach((input) => input.addEventListener('change', () => {
    if (!input.checked) return;
    const scores = { ...(state.deal.fqa_scores || {}) };
    scores[input.dataset.fqaNo] = Number(input.value);
    state.deal.fqa_scores = scores;
    input.closest('.fqa-score-control')?.querySelector('[data-fqa-clear]')?.classList.remove('hidden');
    updateFqaProgress(input.dataset.fqaCategory, scores);
    scheduleSave({ fqa_scores: scores }, true);
  }));
  $$('[data-fqa-clear]').forEach((button) => button.addEventListener('click', () => {
    const scores = { ...(state.deal.fqa_scores || {}) };
    delete scores[button.dataset.fqaClear];
    state.deal.fqa_scores = scores;
    $$('input[data-fqa-no]', button.closest('.fqa-score-control')).forEach((input) => { input.checked = false; });
    button.classList.add('hidden');
    updateFqaProgress(button.dataset.fqaCategory, scores);
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
    const selected = new Set(asArray(state.deal.isv_combo));
    input.checked ? selected.add(input.dataset.solutionId) : selected.delete(input.dataset.solutionId);
    state.deal.isv_combo = [...selected];
    scheduleSave({ isv_combo: state.deal.isv_combo }, true);
    renderStage();
  }));
  $$('[data-package-id]').forEach((input) => input.addEventListener('change', () => {
    const map = new Map((asArray(state.deal.packages)).map((item) => [typeof item === 'string' ? item : item.id, typeof item === 'string' ? { id: item } : item]));
    input.checked ? map.set(input.dataset.packageId, { id: input.dataset.packageId, md: null }) : map.delete(input.dataset.packageId);
    state.deal.packages = [...map.values()];
    scheduleSave({ packages: state.deal.packages }, true);
    renderStage();
  }));
  $$('[data-package-md]').forEach((input) => input.addEventListener('input', () => {
    state.deal.packages = (asArray(state.deal.packages)).map((item) => {
      const normal = typeof item === 'string' ? { id: item } : item;
      return normal.id === input.dataset.packageMd ? { ...normal, md: input.value ? Number(input.value) : null } : normal;
    });
    renderQuoteEstimate();
    scheduleSave({ packages: state.deal.packages });
  }));
  $('#deal-sim-seat-range')?.addEventListener('input', (event) => setDealSeats(event.target.value, 'range'));
  $('#deal-sim-seat-num')?.addEventListener('input', (event) => setDealSeats(event.target.value, 'num'));
  $('#copy-pitch')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(buildPitch());
    toast('피치 가이드를 복사했습니다.');
  });
}

function scheduleSave(patch, quick = false) {
  if (!isOwner()) return;
  state.pendingDealId = state.deal.id;
  Object.assign(state.pendingPatch, patch);
  clearTimeout(state.saveTimer);
  setSaveState('saving', '자동 저장 중…');
  state.saveTimer = setTimeout(() => {
    void flushSave().catch(() => {});
  }, quick ? 180 : 700);
}

async function flushSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  const patch = { ...state.pendingPatch };
  const dealId = state.pendingDealId;
  state.pendingPatch = {};
  state.pendingDealId = null;
  if (!dealId || !Object.keys(patch).length) return;
  try {
    await savePatch(patch, false, dealId);
  } catch (error) {
    if (!state.pendingDealId || state.pendingDealId === dealId) {
      const newerPatch = state.pendingDealId === dealId ? state.pendingPatch : {};
      state.pendingDealId = dealId;
      state.pendingPatch = { ...patch, ...newerPatch };
    }
    throw error;
  }
}

async function savePatch(patch, rerender = false, dealId = state.deal?.id) {
  if (!dealId) return;
  const isCurrentDeal = state.deal?.id === dealId;
  if (isCurrentDeal) setSaveState('saving', '자동 저장 중…');
  beginDealSave(dealId);
  try {
    const updated = await api(`/api/hub/deals/${dealId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    updateDealSummary(updated);
    if (state.deal?.id === dealId) {
      const track = state.refs.tracks.find((item) => item.id === updated.track);
      state.deal = { ...state.deal, ...updated, track_name: track?.name || state.deal.track_name };
      state.activeStage = Object.prototype.hasOwnProperty.call(patch, 'stage') ? updated.stage : state.activeStage;
      setSaveState('', '자동 저장됨');
      renderReadiness();
      if (rerender || Object.prototype.hasOwnProperty.call(patch, 'stage')) renderWorkspace();
    }
  } catch (error) {
    if (state.deal?.id === dealId) setSaveState('error', '자동 저장 실패');
    toast(error.message);
    throw error;
  } finally {
    endDealSave(dealId);
  }
}

function hasUnsavedChanges() {
  return Boolean(
    state.pendingDealId && Object.keys(state.pendingPatch).length
    || state.inFlightSaves.size
  );
}

function warnIfUnsaved(event) {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = '';
}

function flushPendingOnPageHide() {
  if (!state.pendingDealId || !Object.keys(state.pendingPatch).length) return;
  void fetch(`/api/hub/deals/${state.pendingDealId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.pendingPatch),
    credentials: 'same-origin',
    keepalive: true
  }).catch(() => {});
}

function setSaveState(className, label) {
  const node = $('#save-state');
  if (!node) return;
  node.className = `save-state ${className}`;
  node.innerHTML = `<i></i> ${escapeHtml(label)}`;
}

function beginDealSave(dealId) {
  state.inFlightSaves.set(dealId, (state.inFlightSaves.get(dealId) || 0) + 1);
}

function endDealSave(dealId) {
  const remaining = (state.inFlightSaves.get(dealId) || 1) - 1;
  if (remaining > 0) state.inFlightSaves.set(dealId, remaining);
  else state.inFlightSaves.delete(dealId);
}

function updateDealSummary(updated) {
  const index = state.deals.findIndex((deal) => deal.id === updated.id);
  if (index < 0) return;
  const previous = state.deals[index];
  const track = state.refs.tracks.find((item) => item.id === updated.track);
  state.deals[index] = {
    ...previous,
    ...updated,
    owner_name: updated.owner_id === state.user.id ? state.user.name : previous.owner_name,
    track_name: track?.name || previous.track_name
  };
  renderDealList();
}

function renderReadiness() {
  const totals = state.deal?.fqa_totals || {};
  const entries = ['A', 'B', 'C', 'D']
    .filter((category) => totals[category] && Number.isFinite(Number(totals[category].score)))
    .map((category) => [category, totals[category]]);
  $('#readiness-card').innerHTML = `<h3>FQA 준비도</h3>${entries.length ? entries.map(([category, value]) => {
    const score = Math.max(0, Math.min(5, Number(value.score)));
    return `<div class="mini-bar"><span>${category}</span><span class="mini-bar-track"><i style="width:${score / 5 * 100}%"></i></span><span>${score.toFixed(1)}</span></div>`;
  }).join('') : '<p style="color:var(--faint);font-size:10px;line-height:1.6;margin:0">② 단계에서 진단을 시작하면 영역별 준비도가 표시됩니다.</p>'}`;
}

async function claimDeal() {
  const dealId = state.deal?.id;
  if (!dealId) return;
  try {
    const claimed = await api(`/api/hub/deals/${dealId}/claim`, { method: 'POST' });
    updateDealSummary({ ...claimed, owner_name: state.user.name });
    if (state.deal?.id === dealId) {
      state.deal = { ...state.deal, ...claimed, owner_name: state.user.name };
      toast('이 딜의 담당자로 배정되었습니다.');
      renderWorkspace();
    }
    await loadDeals();
  } catch (error) {
    toast(error.message);
  }
}

function connectEvents() {
  state.eventSource?.close();
  const events = new EventSource('/api/hub/events');
  state.eventSource = events;
  events.addEventListener('ready', () => {
    $('#sync-status').classList.add('connected');
    $('#sync-status').innerHTML = '<span></span> 실시간 연결';
  });
  events.addEventListener('deal-change', async (event) => {
    const change = JSON.parse(event.data || '{}');
    await loadDeals();
    const knownUpdatedAt = Date.parse(state.deal?.updated_at || '');
    const eventUpdatedAt = Date.parse(change.updated_at || '');
    const alreadyApplied = Number.isFinite(knownUpdatedAt)
      && Number.isFinite(eventUpdatedAt)
      && eventUpdatedAt <= knownUpdatedAt;
    const hasLocalSave = state.pendingDealId === change.id || state.inFlightSaves.has(change.id);
    if (state.deal?.id === change.id && !hasLocalSave && !alreadyApplied) {
      const refreshed = await api(`/api/hub/deals/${change.id}`);
      const stillHasLocalSave = state.pendingDealId === change.id || state.inFlightSaves.has(change.id);
      if (state.deal?.id !== change.id || stillHasLocalSave) return;
      const currentUpdatedAt = Date.parse(state.deal.updated_at || '');
      const refreshedUpdatedAt = Date.parse(refreshed.updated_at || '');
      if (Number.isFinite(currentUpdatedAt) && Number.isFinite(refreshedUpdatedAt) && refreshedUpdatedAt < currentUpdatedAt) return;
      state.deal = refreshed;
      if (state.mode === 'deals') renderWorkspace();
    }
  });
  events.onerror = () => {
    $('#sync-status').classList.remove('connected');
    $('#sync-status').innerHTML = '<span></span> 재연결 중';
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const initialParams = new URLSearchParams(window.location.search);
  const initialDealId = initialParams.get('deal');
  const initialMode = initialParams.get('mode');
  history.replaceState({ hubList: true }, '', '/hub');
  await init();
  if (initialMode === 'admin' && state.user?.role === 'admin') await openAdminMode();
  else if (initialMode === 'reference') openReferenceMode();
  else if (initialDealId) await openDeal(initialDealId, { historyMode: isMobile() ? 'push' : 'replace' });
});
