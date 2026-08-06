'use strict';

if (window.self !== window.top) {
  window.parent.postMessage({ type: 'issu-hub:navigate', route: 'deals' }, window.location.origin);
}

const state = {
  user: null,
  deals: [],
  refs: { stages: [], tracks: [], readinessAreas: [], readinessItems: [], assessmentAreas: [], assessmentDomains: [], isvBundles: [], packages: [], solutions: [] },
  // 피치 부록에 쓸 8탭 발췌. slug 로 캐시해 같은 딜에서 다시 그릴 때 재요청하지 않는다.
  pitchSources: {},
  deal: null,
  reco: null,
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
    state.pitchSources = {};
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
    fillNewDealTaxonomy();
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
        customer_meta: {
          industry: form.get('industry') || undefined,
          companySize: form.get('companySize') || undefined
        }
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
    state.reco = null;
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
    // 상세는 담당자·admin·미배정 딜에만 열린다. 남의 딜은 존재 여부를 숨기려고 404 로 온다.
    toast(error.message === '딜을 찾을 수 없습니다.'
      ? '이 딜은 담당자만 열 수 있습니다.'
      : error.message);
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
    <span>${index + 1}</span><div><strong>${escapeHtml(label)}</strong><small>${['리드·고객 맥락','42문항·성숙도','카탈로그·포컬','패키지·공수','제안 스크립트'][index]}</small></div>
  </button>`).join('');
}

/**
 * 모든 단계가 같은 다운로드 버튼을 갖는다.
 *
 * 단계마다 다르게 두면 영업이 "여기는 되고 저기는 안 되네" 를 매번 확인해야 한다.
 * 버튼은 같고 내용만 그 단계 것이 나온다.
 */
const STAGE_REPORT_ACTIONS = '<div class="stage-report">'
  + '<button class="secondary-button" type="button" data-report="pdf" title="인쇄 화면으로 열기"><i data-lucide="printer"></i> PDF</button>'
  + '<button class="secondary-button" type="button" data-report="docx" title="Word 파일로 내려받기"><i data-lucide="file-text"></i> Word</button>'
  + '<button class="secondary-button" type="button" data-report="md" title="Markdown 파일로 내려받기"><i data-lucide="file-code-2"></i> Markdown</button>'
  + '</div>';

function stageHeader(no, title, copy, action = '') {
  return `<header class="stage-header"><div><p class="eyebrow">STEP ${no}</p><h2>${title}</h2><p>${copy}</p></div>`
    + `<div class="stage-actions">${action}${STAGE_REPORT_ACTIONS}</div></header>`;
}

const STAGE_RENDERERS = [renderIntake, renderFqa, renderSolutions, renderPackages, renderPitch];

function renderStage() {
  const stage = state.activeStage;
  const content = $('#stage-content');
  const carryMessages = [
    '포탈·미팅·시트에서 들어온 고객 맥락을 정리하며 시작합니다.',
    '↑ 들어온 데이터의 고객 맥락을 이어서 AI 준비도 진단을 시작합니다.',
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
    // STEP 03 에 들어오면 추천을 한 번 계산한다. 렌더 안에서 부르면 재귀가 되므로
    // 렌더가 끝난 뒤에, 아직 결과가 없을 때만 시작한다.
    if (stage === 2 && !state.reco) loadRecommendations();
    else if (stage === 2) renderRecommendationPanel();
  } catch (error) {
    console.error(`[hub] renderStage(${stage}) failed:`, error);
    content.innerHTML = `<div class="empty-state">이 단계를 표시하는 중 문제가 발생했습니다. 새로고침 후 다시 시도해주세요.<br><small>${escapeHtml(error && error.message || '')}</small></div>`;
  }
}

function disabledAttr() { return isOwner() ? '' : 'disabled'; }

/** 카탈로그를 손보는 사람(ISSU·관리자). 보강 신호는 이 사람들만 본다. */
function isCatalogEditor() { return ['admin', 'curator'].includes(state.user?.role); }

/** 추천 후보가 될 최소 조건. 이게 없으면 근거를 댈 수 없다. */
function hasJudgementData(solution) {
  return asArray(solution?.assessment_coverage).length > 0;
}

/**
 * 규모 선택지. 목록은 taxonomy.js 에만 둔다 — 화면마다 적으면 같은 필드에 다른 어휘가
 * 섞여 들어간다(실제로 그래서 "100~499명" 과 "200~500명" 이 공존했다).
 * 028 이전에 저장된 값은 새 구간으로 읽어 선택 상태를 잃지 않게 한다.
 */
/** 새 딜 다이얼로그의 업종·규모 셀렉트를 채운다. 목록은 taxonomy.js 한 곳에서 온다. */
function fillNewDealTaxonomy() {
  const industry = document.getElementById('new-industry');
  if (industry && industry.options.length <= 1) {
    industry.insertAdjacentHTML('beforeend', window.IssuTaxonomy.INDUSTRIES
      .map(([code, label]) => `<option value="${escapeHtml(code)}">${escapeHtml(label)} (${escapeHtml(code)})</option>`).join(''));
  }
  const size = document.getElementById('new-company-size');
  if (size && size.options.length <= 1) {
    size.insertAdjacentHTML('beforeend', window.IssuTaxonomy.COMPANY_SIZES
      .map((v) => `<option>${escapeHtml(v)}</option>`).join(''));
  }
}

function companySizeOptions(current) {
  const value = window.IssuTaxonomy.normaliseCompanySize(current);
  return window.IssuTaxonomy.COMPANY_SIZES
    .map((v) => `<option ${value === v ? 'selected' : ''}>${v}</option>`).join('');
}

/**
 * 포탈로 들어온 담당자 정보. leads 에만 있고 customer_meta 에는 없다 —
 * 개인정보라 동의 이력과 같은 표에 두고 딜로 복사하지 않는다(027).
 * 그래서 편집 불가 표시로만 보여준다. 영업이 고쳐야 할 값이 아니라 고객이 남긴 값이다.
 */
function portalContactMarkup() {
  const name = state.deal.lead_contact_name;
  const phone = state.deal.lead_contact_phone;
  if (!name && !phone) return '';
  return `<div class="field"><label>포탈 담당자 <small>(고객 입력)</small></label>
    <div class="readonly-value">${escapeHtml([name, phone].filter(Boolean).join(' · '))}</div></div>`;
}

function renderIntake() {
  const meta = state.deal.customer_meta || {};
  return `${stageHeader('01', '들어온 데이터', '포탈·미팅·시트에서 들어온 고객 맥락을 한곳에 정리합니다. 이 정보는 이후 모든 단계에 그대로 이어집니다.')}
    <div class="form-grid">
      <div class="field"><label for="deal-customer">고객사</label><input id="deal-customer" type="text" data-deal-field="customer" value="${escapeHtml(state.deal.customer)}" ${disabledAttr()}></div>
      <div class="field"><label for="deal-industry">업종</label><input id="deal-industry" type="text" data-meta-field="industry" value="${escapeHtml(meta.industry || '')}" placeholder="금융 / 제조 / 공공" ${disabledAttr()}></div>
      <div class="field"><label for="deal-company-size">조직 규모</label><select id="deal-company-size" data-meta-field="companySize" ${disabledAttr()}><option value="">선택</option>${companySizeOptions(meta.companySize)}</select></div>
      <div class="field"><label for="deal-target-users">도입 대상</label><input id="deal-target-users" type="text" data-meta-field="targetUsers" value="${escapeHtml(meta.targetUsers || '')}" placeholder="예: 전사 2,000명 / 개발조직 200명" ${disabledAttr()}></div>
      <div class="field"><label for="deal-contact">고객 연락처</label><input id="deal-contact" type="text" data-meta-field="contact" value="${escapeHtml(meta.contact || state.deal.lead_contact || '')}" placeholder="업무 이메일 또는 전화번호" ${disabledAttr()}></div>
      ${portalContactMarkup()}
      <div class="field"><label for="deal-security-stack">보안 게이트웨이 <small>(영업 확인)</small></label><select id="deal-security-stack" data-meta-field="securityStack" ${disabledAttr()}><option value="">미정</option><option value="none" ${meta.securityStack === 'none' ? 'selected' : ''}>별도 SWG 없음</option><option value="existing" ${meta.securityStack === 'existing' ? 'selected' : ''}>있으나 제품 미확인 (고객 응답)</option><option value="managed" ${meta.securityStack === 'managed' ? 'selected' : ''}>AI 전용 정책까지 운영 (고객 응답)</option><option value="zscaler" ${meta.securityStack === 'zscaler' ? 'selected' : ''}>Zscaler</option><option value="other-swg" ${meta.securityStack === 'other-swg' ? 'selected' : ''}>타사 SWG</option></select></div>
      <div class="field"><label for="deal-investment">투자 여력</label><select id="deal-investment" data-meta-field="investment" ${disabledAttr()}><option value="">미정</option><option value="low" ${meta.investment === 'low' ? 'selected' : ''}>제한적</option><option value="medium" ${meta.investment === 'medium' ? 'selected' : ''}>PoC 예산 확보</option><option value="high" ${meta.investment === 'high' ? 'selected' : ''}>전사 확장 가능</option></select></div>
      <div class="field full"><label for="deal-notes">고객 상황·요청 메모</label><textarea id="deal-notes" data-meta-field="notes" ${disabledAttr()} placeholder="미팅에서 확인한 문제, 의사결정자, 일정 등을 적어주세요.">${escapeHtml(meta.notes || state.deal.lead_message || '')}</textarea></div>
    </div>`;
}

/**
 * STEP 02 — AI 준비도 진단.
 *
 * 고객이 답하는 진단은 6대 영역 42문항 하나뿐이다. 포탈로 들어온 딜에는 응답이
 * 들어와 있고, 수동·시트 딜은 영업이 여기서 채운다.
 *
 * 응답은 서버가 채점한다(`PATCH /deals/:id`). 화면에서 다시 계산하면 고객이
 * 리포트에서 본 숫자와 영업이 보는 숫자가 갈라진다.
 *
 * ISV 전제조건 판정에 필요한 값은 서버가 응답에서 끌어낸다 — 화면에서 따로 묻지
 * 않는다. 끌어낼 수 없는 것만 STEP 03 에서 후보별로 확인한다.
 */

const READINESS_TONE = (score) => (score < 2.5 ? 'low' : score < 3.5 ? 'mid' : 'high');

/** 축별 점수·성숙도. 서버가 낸 값을 그대로 쓴다 — 여기서 다시 계산하면 갈라진다. */
function renderReadinessPanel() {
  const totals = state.deal.readiness_totals || {};
  const areas = asArray(totals.areas);
  const items = asArray(state.refs.readinessItems);
  if (!items.length) {
    return `<div class="empty-state">진단 문항을 불러오지 못했습니다. 029 마이그레이션을 확인하세요.</div>`;
  }

  const bars = (areas.length ? areas : asArray(state.refs.readinessAreas).map((a) => ({
    area: a.id, name: a.name, score: null, answered: 0
  }))).map((area) => {
    const score = Number(area.score);
    const has = Number.isFinite(score);
    return `<div class="rdp-axis ${has ? READINESS_TONE(score) : 'none'}">
      <span class="rdp-axis-id">${escapeHtml(area.area)}</span>
      <div class="rdp-axis-body">
        <b>${escapeHtml(area.name)}</b>
        <div class="rdp-track"><i style="width:${has ? (score / 5 * 100).toFixed(1) : 0}%"></i></div>
      </div>
      <strong>${has ? score.toFixed(2) : '—'}</strong>
    </div>`;
  }).join('');

  const maturity = totals.maturity || {};
  const hasAverage = Number.isFinite(Number(totals.average));
  const source = customerAnsweredCount()
    ? '고객이 포탈에서 직접 답한 결과입니다.'
    : '아직 고객 응답이 없습니다. 확인한 내용을 아래에서 직접 채워주세요.';

  return `<section class="readiness-panel">
    <header>
      <div>
        <span class="rdp-mark">AI READINESS · ${items.length}문항</span>
        <p>${source}</p>
      </div>
      <div class="rdp-total">
        <b>${hasAverage ? Number(totals.average).toFixed(2) : '—'}</b><span>/ 5.00</span>
        <small>${hasAverage ? `Level ${escapeHtml(maturity.level ?? '—')} · ${escapeHtml(maturity.name || '')}` : '응답 대기'}</small>
      </div>
    </header>
    <div class="rdp-axes">${bars}</div>
  </section>`;
}

/** 고객이 직접 답한 문항 수. 032 미적용이면 0 이 되어 문구만 보수적으로 나온다. */
function customerAnsweredCount() {
  return Object.keys(state.deal.readiness_customer_scores || {}).length;
}

/**
 * 42문항 입력.
 *
 * /readiness 와 같은 루브릭 칩이다. 숫자 라디오로 두면 "모르니까 3점" 이 늘고,
 * 그 값이 그대로 추천의 근거가 된다. 고객이 답한 값과 영업이 고친 값은 배지로
 * 구분한다 — 제안 근거가 고객 응답인지 영업 추정인지 구분이 안 되면 못 쓴다.
 */
function renderReadinessQuestions() {
  const areas = asArray(state.refs.readinessAreas);
  const items = asArray(state.refs.readinessItems);
  const scores = state.deal.readiness_scores || {};
  const customer = state.deal.readiness_customer_scores || {};

  return areas.map((area) => {
    const list = items.filter((item) => item.area === area.id);
    if (!list.length) return '';
    const done = list.filter((item) => scores[item.code]).length;

    const rows = list.map((item) => {
      const chosen = Number(scores[item.code]) || 0;
      const fromCustomer = Number(customer[item.code]) || 0;
      const badge = fromCustomer && chosen === fromCustomer ? '<span class="rd-tag customer">고객 응답</span>'
        : fromCustomer ? `<span class="rd-tag edited" title="고객은 ${fromCustomer}점으로 답했습니다">영업 수정</span>`
        : '';
      const chips = asArray(item.rubric).map((text, index) => {
        const score = index + 1;
        return `<button class="rd-pick${chosen === score ? ' picked' : ''}" type="button"
          data-readiness-code="${escapeHtml(item.code)}" data-readiness-score="${score}"
          aria-pressed="${chosen === score}" ${disabledAttr()}>
          <b>${score}</b><span>${escapeHtml(text)}</span></button>`;
      }).join('');

      return `<div class="rd-item${chosen ? ' answered' : ''}" id="rd-${escapeHtml(item.code)}">
        <div class="rd-item-head">
          <span class="rd-item-code">${escapeHtml(item.code)}</span>
          <span class="rd-item-copy"><b>${escapeHtml(item.text)}${badge}</b>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</span>
          <button class="rd-item-clear ${chosen ? '' : 'hidden'}" type="button" data-readiness-clear="${escapeHtml(item.code)}" ${disabledAttr()}>선택 해제</button>
        </div>
        <div class="rd-picks">${chips}</div>
      </div>`;
    }).join('');

    return `<section class="rd-group" data-area="${escapeHtml(area.id)}" aria-labelledby="rd-group-${escapeHtml(area.id)}">
      <header class="rd-group-head">
        <span class="rd-group-mark">${escapeHtml(area.id)}</span>
        <div><h3 id="rd-group-${escapeHtml(area.id)}">${escapeHtml(area.name)}</h3><p>${list.length}개 문항. 현재 상태에 가장 가까운 문장을 고르세요.</p></div>
        <strong data-readiness-progress="${escapeHtml(area.id)}">${done} / ${list.length} 응답</strong>
      </header>
      <div class="rd-list">${rows}</div>
    </section>`;
  }).join('');
}

/**
 * 미흡 영역 — STEP03 으로 넘기는 지점.
 *
 * 3점 미만 축과 그 축에서 가장 낮은 문항을 고른 루브릭 문장까지 함께 보여준다.
 * 숫자만 넘기면 STEP03 에서 "왜 이 ISV 인가" 에 답할 수 없다. 고객이 자기가 고른
 * 말을 다시 읽게 하는 것이 근거로 가장 강하다.
 *
 * 여기서 넘기는 것은 판정의 **근거 언어**다. 영업이 고객 앞에서 "D 축이 2.1 이고
 * D2 를 1점으로 답하셨다" 라고 말할 수 있어야 제안이 선다.
 */
function renderReadinessGaps() {
  const totals = state.deal.readiness_totals || {};
  const weak = asArray(totals.areas).filter((area) => Number(area.score) < 3);
  if (!Number.isFinite(Number(totals.average))) return '';

  if (!weak.length) {
    return `<section class="rd-gaps ok">
      <p><b>6대 영역 모두 3점 이상입니다.</b> 종합 ${Number(totals.average).toFixed(2)}점 · ${escapeHtml(totals.maturity?.name || '')} 단계.
         보완이 아니라 확산 관점에서 조합을 고르세요.</p>
      <button type="button" id="handoff-isv" class="button-primary">ISV 조합으로 <i data-lucide="arrow-right"></i></button>
    </section>`;
  }

  const byArea = new Map(asArray(totals.priorities).map((p) => [p.area, p]));
  const blocks = weak.map((area) => {
    const drivers = asArray(byArea.get(area.area)?.items).slice(0, 3);
    return `<article class="rd-gap">
      <header><span class="rd-gap-id">${escapeHtml(area.area)}</span>
        <b>${escapeHtml(area.name)}</b><strong>${Number(area.score).toFixed(2)}</strong></header>
      ${drivers.length ? `<ul>${drivers.map((item) => `<li>
        <span class="rd-gap-code">${escapeHtml(item.code)}</span>
        <span class="rd-gap-text">${escapeHtml(item.text)}</span>
        <span class="rd-gap-score">${item.score}점</span>
        ${item.rubric ? `<small>“${escapeHtml(item.rubric)}”</small>` : ''}
      </li>`).join('')}</ul>` : ''}
    </article>`;
  }).join('');

  return `<section class="rd-gaps">
    <header class="rd-gaps-head">
      <div><b>보완이 필요한 ${weak.length}개 영역</b>
        <p>3점 미만 영역과 그 근거 문항입니다. 이 내용을 STEP 03 에서 ISV·패키지 선정 근거로 씁니다.</p></div>
      <button type="button" id="handoff-isv" class="button-primary">이 근거로 ISV 추천 보기 <i data-lucide="arrow-right"></i></button>
    </header>
    <div class="rd-gap-grid">${blocks}</div>
  </section>`;
}

function renderFqa() {
  const trackOptions = state.refs.tracks.map((track) => `<option value="${track.id}" ${state.deal.track === track.id ? 'selected' : ''}>${track.id} · ${escapeHtml(track.name)}</option>`).join('');
  return `${stageHeader('02', 'AI 준비도 진단', '6대 영역 42문항으로 고객의 현재 수준을 확인합니다. 고객이 포탈에서 답했으면 그 값이 들어와 있고, 아니면 여기서 함께 채웁니다.')}
    ${renderReadinessPanel()}
    <div class="field" style="margin-bottom:18px"><label for="deal-track">딜 트랙</label><select id="deal-track" ${disabledAttr()}><option value="">트랙 선택</option>${trackOptions}</select></div>
    ${renderReadinessGaps()}
    <div class="rd-groups">${renderReadinessQuestions()}</div>`;
}


// ── STEP 03 추천 ──────────────────────────────────────────────────
// 추천은 제안이지 강제가 아니다. 수동 선택은 그대로 두고 위에 얹는다.
// 그룹을 나누는 이유: 영업이 고객 앞에서 "지금 되는 것"과 "선행이 필요한 것"을
// 다르게 말해야 한다. 한 줄로 세우면 번들이 항상 위로 가 정렬이 아니라 왜곡이 된다.
// 제안은 3단 구조다. 패키지와 ISV 를 한 줄로 세우지 않는다 — 둘은 다른 질문에 답하고,
// 패키지에는 synergy·grade·bundle_potential 이 없어 점수 비교 자체가 성립하지 않는다.
const RECO_GROUPS = [
  { path: ['proposal', 'prepare'], title: '① 준비 — 지금 넣으려면', tone: 'ok' },
  { path: ['proposal', 'adopt'], title: '② 도입 — ISV 조합', tone: 'ok' },
  { key: 'bundles', title: '선행 조건이 필요', tone: 'bundle' },
  { path: ['proposal', 'operate'], title: '③ 정착·운영', tone: 'ok' },
  { path: ['proposal', 'unclassified'], title: '역할 미지정 패키지', tone: 'warn' },
  { key: 'needsConfirmation', title: '확인 필요 — 진단으로 판정되지 않는 전제', tone: 'warn' }
];

async function loadRecommendations() {
  if (!state.deal?.id) return;
  state.reco = { loading: true };
  renderRecommendationPanel();
  try {
    state.reco = await api(`/api/hub/deals/${state.deal.id}/recommendations`);
    saveRecommendationSnapshot();
  } catch (error) {
    state.reco = { error: error.message };
  }
  renderRecommendationPanel();
}

/** 무엇을 추천했는지 남긴다. 나중에 실제 채택과 대조할 기준선이다. */
function saveRecommendationSnapshot() {
  const reco = state.reco;
  if (!reco || reco.error) return;
  const slim = (items) => (items || []).map((item) => ({
    slug: item.slug, name: item.name, kind: item.kind,
    slot: item.slot, domain: item.domain, score: item.score,
    enabler: item.enabler?.slug || null
  }));
  postSnapshot({
    recommended: {
      at: new Date().toISOString(),
      label: reco.label,
      reviewed: reco.reviewed,
      failingCategories: reco.failingCategories || [],
      eligible: slim(reco.eligible),
      bundles: slim(reco.bundles),
      needsConfirmation: slim(reco.needsConfirmation),
      excludedNoData: (reco.excluded || [])
        .filter((x) => x.excludedBy?.some((r) => /판정 데이터/.test(r)))
        .map((x) => ({ slug: x.slug, name: x.name }))
    }
  });
}

/**
 * 영업이 실제로 무엇을 골랐는지 남긴다.
 * 추천 목록에 없던 선택이 가장 값진 신호다 — 엔진이 놓친 것이고 그대로
 * 판정 데이터 보강 목록이 된다.
 */
function saveAdoptionSnapshot() {
  if (!state.deal?.id || !state.reco || state.reco.error) return;
  const picked = asArray(state.deal.isv_combo).map((id) => {
    const solution = (state.refs.solutions || []).find((item) => item.id === id);
    return { id, slug: solution?.slug || null, name: solution?.name || null };
  });
  postSnapshot({ adopted: { at: new Date().toISOString(), picked } });
}

/** 기록 실패가 영업 작업을 막으면 안 된다. 조용히 삼킨다. */
function postSnapshot(patch) {
  api(`/api/hub/deals/${state.deal.id}/recommendations/snapshot`, {
    method: 'POST', body: JSON.stringify(patch)
  }).catch(() => {});
}

function recoCardMarkup(item, tone) {
  const selected = new Set(asArray(state.deal?.isv_combo));
  const isSolution = item.kind === 'solution';
  const picked = isSolution && selected.has(item.id);
  const reasons = (item.reasons || []).slice(0, 3)
    .map((r) => `<li>${escapeHtml(r)}</li>`).join('');
  const flags = (item.redFlags || []).slice(0, 2).map((f) =>
    `<li>${escapeHtml(f.signal)} → ${escapeHtml((f.alternatives || []).map((a) => a.label).join(', '))}</li>`).join('');
  // 진단 응답으로 자동 판정이 안 되는 전제만 여기 온다. 확인은 후보별로 남는다 —
  // 같은 전제라도 솔루션마다 요구 수준이 다르고, 한 번 확인한 것이 다른 후보까지
  // 통과시키면 그게 조용히 틀리는 자리다.
  //
  // 평가영역 전제면 기획안 Appendix A 의 「핵심 확인사항」을 같이 보여준다.
  // 영업이 무엇을 확인해야 하는지가 문서 문장 그대로 나온다.
  const areaById = new Map(asArray(state.refs.assessmentAreas).map((a) => [a.id, a]));
  const pending = (item.prerequisites?.pendingManual || []).map((p) => {
    const area = p.area ? areaById.get(p.area) : null;
    return `<li>
    <label class="prereq-check">
      <input type="checkbox" data-prereq-slug="${escapeHtml(item.slug || item.id)}"
        data-prereq-label="${escapeHtml(p.label)}" ${isOwner() ? '' : 'disabled'}>
      <span>${escapeHtml(p.label)}${area ? `<small>${escapeHtml(area.checkpoints)}</small>` : ''}</span>
    </label></li>`;
  }).join('');

  return `<div class="reco-card reco-${tone}">
    <div class="reco-head">
      <span class="reco-name">${escapeHtml(item.name)}${item.enabler ? ` <em>← ${escapeHtml(item.enabler.name)} 선행</em>` : ''}</span>
      ${item.roleLabel ? `<span class="reco-role">${escapeHtml(item.roleLabel)}</span>` : ''}
    </div>
    <div class="reco-meta">${item.domainName ? `<b>${escapeHtml(item.domainName)}</b> · ` : ''}${escapeHtml(item.slotName || (item.kind === 'package' ? '서비스 패키지' : '슬롯 미지정'))}${item.layer ? ` · ${escapeHtml(item.layer)}` : ''}</div>
    ${reasons ? `<ul class="reco-reasons">${reasons}</ul>` : ''}
    ${(item.dependsOn || []).length ? `<div class="reco-sub reco-depends">${escapeHtml(item.dependsOn.join(', '))} 선행 권고</div>` : ''}
    ${pending ? `<div class="reco-sub">확인 필요<ul>${pending}</ul></div>` : ''}
    ${flags ? `<div class="reco-sub reco-flags">부적합 신호<ul>${flags}</ul></div>` : ''}
    ${isSolution ? `<button type="button" class="reco-add ${picked ? 'picked' : ''}" data-reco-add="${item.id}" ${isOwner() ? '' : 'disabled'}>${picked ? '조합에 포함됨' : '조합에 추가'}</button>` : ''}
  </div>`;
}

function renderRecommendationPanel() {
  const host = document.getElementById('reco-panel');
  if (!host) return;
  const reco = state.reco;

  if (!reco) { host.innerHTML = ''; return; }
  if (reco.loading) { host.innerHTML = '<div class="reco-empty">추천을 계산하는 중...</div>'; return; }
  if (reco.error) {
    host.innerHTML = `<div class="reco-empty">추천을 불러오지 못했습니다. <small>${escapeHtml(reco.error)}</small></div>`;
    return;
  }

  if (!reco.failingCategories?.length) {
    host.innerHTML = `<div class="reco-empty">STEP 02 진단에서 미달 영역이 없어 추천할 보강 항목이 없습니다.
      진단을 아직 입력하지 않았다면 STEP 02 를 먼저 채워주세요.</div>`;
    return;
  }

  // STEP02 에서 넘어온 근거. 후보를 고른 계산과 별개로, 고객에게 말할 때 쓰는
  // 언어는 이쪽이다.
  const weakAreas = asArray((state.deal.readiness_totals || {}).areas)
    .filter((area) => Number(area.score) < 3);

  // 데이터가 없어서 빠진 것과 안 맞아서 빠진 것은 다르게 읽어야 한다.
  const excluded = reco.excluded || [];
  const noData = excluded.filter((x) => x.excludedBy?.some((r) => /판정 데이터/.test(r)));
  const notFit = excluded.filter((x) => !noData.includes(x));

  const groups = RECO_GROUPS.map(({ key, path, title, tone }) => {
    const items = (path ? path.reduce((acc, step) => acc?.[step], reco) : reco[key]) || [];
    if (!items.length) return '';
    // 대분류 분포를 헤더에 요약한다. "보안 3건 · 운영 2건" 이 한눈에 보여야
    // 영업이 어느 영역을 제안하는지 바로 안다.
    const byDomain = items.reduce((acc, item) => {
      const key = item.domainName || (item.kind === 'package' ? '서비스 패키지' : '미분류');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(byDomain).map(([name, n]) => `${name} ${n}`).join(' · ');
    return `<div class="reco-group">
      <h4>${title} <span>${items.length}</span><small>${escapeHtml(summary)}</small></h4>
      <div class="reco-grid">${items.map((item) => recoCardMarkup(item, tone)).join('')}</div>
    </div>`;
  }).join('');

  host.innerHTML = `
    <div class="reco-head-bar">
      <div>
        <strong>추천 조합</strong>
        <span class="reco-label ${reco.reviewed ? '' : 'tentative'}">${escapeHtml(reco.label)}</span>
      </div>
      <button type="button" id="reco-refresh" class="secondary-button">다시 계산</button>
    </div>
    <div class="reco-gaps">미달 영역 · ${escapeHtml(reco.failingCategories.join(' · '))}</div>
    ${weakAreas.length ? `<div class="reco-from-readiness">
      <span>STEP 02 근거</span>
      ${weakAreas.map((area) => `<b>${escapeHtml(area.name)} ${Number(area.score).toFixed(1)}</b>`).join('')}
    </div>` : ''}
    ${groups || '<div class="reco-empty">조건에 맞는 후보가 없습니다.</div>'}
    ${notFit.length ? `<details class="reco-details"><summary>이 고객에게 맞지 않아 제외 ${notFit.length}건</summary>
      <ul>${notFit.map((x) => `<li>${escapeHtml(x.name)} — ${escapeHtml(x.excludedBy[0])}</li>`).join('')}</ul></details>` : ''}
    ${noData.length && isCatalogEditor() ? `<details class="reco-details reco-nodata"><summary>판정 데이터가 없어 후보에서 빠짐 ${noData.length}건</summary>
      <p>추천 판정 데이터가 아직 입력되지 않은 솔루션입니다. 보강 우선순위로 삼으세요.</p>
      <ul>${noData.map((x) => `<li>${escapeHtml(x.name)}</li>`).join('')}</ul></details>` : ''}`;

  document.getElementById('reco-refresh')?.addEventListener('click', loadRecommendations);
  // 확인하면 그 후보의 전제만 통과한다. 저장하고 바로 다시 계산해 후보가
  // 「확인 필요」에서 실제 추천으로 옮겨 가는 것을 눈으로 보게 한다.
  $$('[data-prereq-slug]').forEach((box) => box.addEventListener('change', async () => {
    const { prereqSlug: slug, prereqLabel: label } = box.dataset;
    const confirmations = { ...(state.deal.prereq_confirmations || {}) };
    const forSlug = { ...(confirmations[slug] || {}) };
    if (box.checked) forSlug[label] = true; else delete forSlug[label];
    if (Object.keys(forSlug).length) confirmations[slug] = forSlug;
    else delete confirmations[slug];
    state.deal.prereq_confirmations = confirmations;
    await scheduleSave({ prereq_confirmations: confirmations }, true);
    await flushSave();
    loadRecommendations();
  }));
  $$('[data-reco-add]').forEach((button) => button.addEventListener('click', () => {
    const selected = new Set(asArray(state.deal.isv_combo));
    const id = button.dataset.recoAdd;
    selected.has(id) ? selected.delete(id) : selected.add(id);
    state.deal.isv_combo = [...selected];
    scheduleSave({ isv_combo: state.deal.isv_combo }, true);
    saveAdoptionSnapshot();
    renderStage();
  }));
}

/**
 * 기획안 §6 ISV 확장 패키지.
 *
 * 추천 엔진의 결과(reco-panel)와 다른 층이다. 저쪽은 우리 카탈로그에서 후보를
 * 고르고, 이쪽은 **기획안이 정해 둔 묶음**을 진단 결과에 비춰 본다. 영업이 고객에게
 * "기획안의 어느 패키지에 해당하는가" 를 말할 수 있어야 한다.
 *
 * 신호가 없는 번들(AI Developer·Private AI)은 적용 기준 문장만 보여준다.
 * 42문항으로 판정할 수 없는 것을 판정한 척하지 않는다.
 */
function renderIsvBundles() {
  const bundles = asArray(state.refs.isvBundles);
  if (!bundles.length) return '';

  // 서버가 낸 문항별 응답을 그대로 읽는다. 여기서 다시 채점하지 않는다.
  const answers = new Map(asArray((state.deal.readiness_totals || {}).answers)
    .map((answer) => [answer.code, answer]));

  const scored = bundles.map((bundle) => {
    const hits = asArray(bundle.readiness_signal).map((signal) => {
      const answer = answers.get(signal.code);
      if (!answer) return null;
      const low = Number(answer.score) < 3;
      return (signal.when === 'high' ? !low : low) ? answer : null;
    }).filter(Boolean);
    return { bundle, hits };
  }).sort((a, b) => b.hits.length - a.hits.length || a.bundle.sort_order - b.bundle.sort_order);

  const selected = new Set(asArray(state.deal.isv_combo));
  const byId = new Map(state.refs.solutions.map((solution) => [solution.slug, solution]));

  const cards = scored.map(({ bundle, hits }) => {
    const members = asArray(bundle.members);
    const core = members.filter((m) => !m.is_option);
    const options = members.filter((m) => m.is_option);
    const chip = (m) => {
      const solution = byId.get(m.slug);
      // 카탈로그에 보이는 것만 추가할 수 있다. 숨김 솔루션은 이름만 보여준다.
      if (!solution) return `<span class="bundle-member muted">${escapeHtml(m.name)}</span>`;
      const picked = selected.has(solution.id);
      // data-reco-add 를 쓰지 않는다. 저 배선은 추천 패널이 그려질 때만 걸려서,
      // 추천이 실패하거나 미달 영역이 없으면 이 버튼이 죽는다.
      return `<button type="button" class="bundle-member${picked ? ' picked' : ''}"
        data-bundle-add="${escapeHtml(solution.id)}" ${isOwner() ? '' : 'disabled'}
        title="${picked ? '조합에서 빼기' : '조합에 추가'}">${escapeHtml(m.name)}</button>`;
    };

    return `<article class="bundle-card${hits.length ? ' matched' : ''}">
      <header>
        <b>${escapeHtml(bundle.name)}</b>
        ${hits.length ? `<span class="bundle-badge">진단 신호 ${hits.length}건 일치</span>` : ''}
      </header>
      <p class="bundle-value">${escapeHtml(bundle.value_prop)}</p>
      <div class="bundle-members">${core.map(chip).join('')}</div>
      ${options.length ? `<div class="bundle-members option"><small>환경별 옵션</small>${options.map(chip).join('')}</div>` : ''}
      ${hits.length
        ? `<ul class="bundle-hits">${hits.map((hit) => `<li>
            <span class="bundle-hit-code">${escapeHtml(hit.code)}</span>
            <span>${escapeHtml(hit.text)}</span>
            <b>${hit.score}점</b>
            ${hit.rubric ? `<small>“${escapeHtml(hit.rubric)}”</small>` : ''}
          </li>`).join('')}</ul>`
        : (bundle.applies_when || bundle.entry_combo)
          ? `<p class="bundle-basis">${escapeHtml(bundle.applies_when || bundle.entry_combo)}</p>` : ''}
    </article>`;
  }).join('');

  return `<section class="bundle-panel">
    <header class="bundle-panel-head">
      <div><b>기획안 ISV 확장 패키지</b>
        <p>진단 신호가 맞는 패키지를 위에 둡니다. 구성 제품을 눌러 조합에 넣을 수 있습니다.</p></div>
    </header>
    <div class="bundle-grid">${cards}</div>
  </section>`;
}

function renderSolutions() {
  const selected = new Set(asArray(state.deal.isv_combo));
  const query = state.catalogQuery.toLowerCase();
  // 판정 데이터가 없는 솔루션은 영업에게 감춘다. 콘텐츠가 껍데기라 골라도 근거를
  // 댈 수 없고, 추천에도 안 잡혀 "왜 여기 있나" 혼란만 준다.
  // 이미 조합에 들어간 것은 남긴다 — 눈앞에서 사라지면 그게 더 혼란스럽다.
  // ISSU·관리자에게는 전부 보인다(보강 대상을 봐야 하므로).
  const visible = state.refs.solutions.filter((solution) =>
    isCatalogEditor() || selected.has(solution.id) || hasJudgementData(solution));
  const filtered = visible.filter((solution) => `${solution.name} ${solution.category} ${solution.jtbd}`.toLowerCase().includes(query));
  const hiddenCount = state.refs.solutions.length - visible.length;
  const cards = filtered.map((solution) => `<label class="select-card ${selected.has(solution.id) ? 'selected' : ''}">
    <input type="checkbox" data-solution-id="${solution.id}" ${selected.has(solution.id) ? 'checked' : ''} ${disabledAttr()}>
    <h3>${escapeHtml(solution.name)}</h3><p>${escapeHtml(solution.jtbd || '카탈로그 설명 준비 중')}</p>
    <div class="card-meta"><span>급 ${solution.grade ?? '—'}</span><span>${escapeHtml(solution.scale || '규모 미정')}</span><span>${escapeHtml(solution.focal_name || '포컬 미배정')}</span>${solution.status_op === 'paused' ? '<span>준비중</span>' : ''}</div>
    ${solution.tech_note ? `<div class="tech-note">기술 확인 · ${escapeHtml(solution.tech_note)}</div>` : ''}
  </label>`).join('');
  return `${stageHeader('03', 'ISV 조합 추천', 'AI Radar의 내부 카탈로그를 딜과 연결합니다. 급·포컬·기술 제약은 내부에서만 보입니다.')}
    <div id="reco-panel" class="reco-panel"></div>
    ${renderIsvBundles()}
    <div class="catalog-toolbar"><div class="search-wrap"><i data-lucide="search"></i><input id="catalog-search" type="search" value="${escapeHtml(state.catalogQuery)}" placeholder="솔루션·카테고리 검색"></div><a class="secondary-button" href="/radar" target="_blank" rel="noopener" title="AI Radar를 새 창으로 열기"><i data-lucide="external-link"></i> AI Radar</a></div>
    <div class="selection-grid">${cards || '<div class="empty-state">검색 결과가 없습니다.</div>'}</div>
    ${hiddenCount > 0 ? `<p class="catalog-hidden-note">준비 중인 솔루션 ${hiddenCount}건은 표시하지 않았습니다.</p>` : ''}`;
}

function paintReadinessItem(code, scores) {
  const item = state.refs.readinessItems.find((entry) => entry.code === code);
  const card = $(`#rd-${CSS.escape(code)}`);
  if (!card || !item) return;
  const chosen = Number(scores[code]) || 0;
  card.classList.toggle('answered', Boolean(chosen));
  $$('[data-readiness-score]', card).forEach((chip) => {
    const picked = Number(chip.dataset.readinessScore) === chosen;
    chip.classList.toggle('picked', picked);
    chip.setAttribute('aria-pressed', String(picked));
  });
  $('[data-readiness-clear]', card)?.classList.toggle('hidden', !chosen);
  updateReadinessProgress(item.area, scores);
}

function updateReadinessProgress(area, scores) {
  const list = state.refs.readinessItems.filter((item) => item.area === area);
  const answered = list.filter((item) => scores[item.code]).length;
  const progress = $(`[data-readiness-progress="${area}"]`);
  if (progress) progress.textContent = `${answered} / ${list.length} 응답`;
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
  return `${stageHeader('04', '패키지와 딜 사이즈', '확정한 ISV 조합 위에 필요한 서비스 패키지를 얹습니다. 조정 공수는 딜별로 저장되고, 가견적은 (기준MD + 조정MD) × MD 단가로 합산됩니다.')}<div class="selection-grid">${cards}</div>${licenseMarkup()}<div id="quote-estimate" class="quote-estimate">${quoteEstimateMarkup()}</div>${dealSimMarkup()}`;
}

// 003/006 마이그레이션이 심은 단가는 데모용이다. price_is_placeholder 가 true 면
// 금액을 만들지 않는다 — 화면에 뜬 숫자가 그대로 견적서로 복사되는 것을 막는 게 목적이다.
// 컬럼이 아직 없으면 서버가 true 로 내려주므로, 마이그레이션 전에도 안전하게 동작한다.
const isPlaceholderPrice = (row) => row?.price_is_placeholder !== false;

function computeQuote() {
  const priceById = new Map(state.refs.packages.map((pkg) => [pkg.id, pkg]));
  const rows = (asArray(state.deal.packages)).map((item) => {
    const id = typeof item === 'string' ? item : item.id;
    const adjMd = (item && typeof item === 'object' && item.md != null) ? Number(item.md) || 0 : 0;
    const pkg = priceById.get(id);
    if (!pkg) return null;
    const baseMd = Number(pkg.base_md) || 0;
    const placeholder = isPlaceholderPrice(pkg);
    const unit = placeholder ? 0 : (Number(pkg.unit_price) || 0);
    const totalMd = baseMd + adjMd;
    return { id, name: pkg.name, baseMd, adjMd, totalMd, unit, placeholder, amount: placeholder ? 0 : totalMd * unit };
  }).filter(Boolean);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return {
    rows,
    total,
    hasUnpriced: rows.some((row) => !row.placeholder && row.unit === 0),
    hasPlaceholder: rows.some((row) => row.placeholder)
  };
}

function quoteEstimateMarkup() {
  const { rows, total, hasUnpriced, hasPlaceholder } = computeQuote();
  if (!rows.length) {
    return '<div class="quote-empty">패키지를 선택하면 가견적이 여기에 표시됩니다.</div>';
  }
  const lines = rows.map((row) => `<tr class="${row.placeholder ? 'unpriced' : ''}">
    <td>${escapeHtml(row.name)}</td>
    <td class="num">${row.baseMd}</td>
    <td class="num">${row.adjMd ? `+${row.adjMd}` : '0'}</td>
    <td class="num">${row.totalMd} MD</td>
    <td class="num">${row.placeholder ? '<span class="quote-muted">별도협의</span>' : (row.unit ? formatKRW(row.unit) : '미설정')}</td>
    <td class="num amount">${row.placeholder ? '<span class="quote-muted">별도협의</span>' : formatKRW(row.amount)}</td>
  </tr>`).join('');
  const headline = hasPlaceholder && total === 0 ? '별도협의' : formatKRW(total);
  return `<div class="quote-head"><h3>가견적<span> · 내부 참고용</span></h3><strong>${headline}</strong></div>
    <div class="quote-scroll"><table class="quote-table">
      <thead><tr><th>패키지</th><th class="num">기준MD</th><th class="num">조정MD</th><th class="num">합계</th><th class="num">MD 단가</th><th class="num">금액</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot><tr><td colspan="5">합계 (VAT 별도, 확정 단가만)</td><td class="num amount">${headline}</td></tr></tfoot>
    </table></div>
    ${hasPlaceholder ? '<p class="quote-note">⚠ MD 단가가 확정되지 않은 패키지는 금액에서 제외되고 <b>별도협의</b>로 표시됩니다. admin에서 실단가를 확정하세요.</p>' : ''}
    ${hasUnpriced ? '<p class="quote-note">⚠ MD 단가가 설정되지 않은 패키지가 있어 ₩0으로 계산됩니다. 단가를 설정하세요.</p>' : ''}`;
}

function renderQuoteEstimate() {
  const node = document.getElementById('quote-estimate');
  if (node) node.innerHTML = quoteEstimateMarkup();
}

/**
 * OpenAI 라이선스 계산 (기획안 Appendix C·D).
 *
 * 기본값은 Appendix D 의 표준 고객 가정이다 — 100석 × $18/월 + 개발자 20% ×
 * $150/월 = 기업당 연 $57,600. 영업이 고객 실제 값으로 바꾼다.
 *
 * ⚠ **API 는 넣지 않는다.** 기획안이 "사용량 변동성이 높은 API Consumption 은
 *   기본 목표 매출에서 제외" 라고 못 박았다. 여기 넣으면 확정 매출처럼 보인다.
 */
const LICENSE_DEFAULTS = Object.freeze({ seats: 100, seatPrice: 18, codexRatio: 20, codexPrice: 150 });

function getLicenseInput() {
  const sim = state.deal?.customer_meta?.sim || {};
  const pick = (key, min, max) => {
    const value = Number(sim[key]);
    return Number.isFinite(value) && value >= min && value <= max ? value : LICENSE_DEFAULTS[key];
  };
  return {
    seats: Math.round(pick('seats', 1, 100000)),
    seatPrice: pick('seatPrice', 0, 1000),
    codexRatio: pick('codexRatio', 0, 100),
    codexPrice: pick('codexPrice', 0, 10000)
  };
}

function computeLicense() {
  const input = getLicenseInput();
  const fx = Number(state.refs.settings?.usd_krw) || 1500;
  // 개발자 수는 내림한다. 0.6명에게 Credit 을 팔 수 없다.
  const codexSeats = Math.floor(input.seats * input.codexRatio / 100);
  const chatMonthly = input.seats * input.seatPrice;
  const codexMonthly = codexSeats * input.codexPrice;
  const monthly = chatMonthly + codexMonthly;
  return {
    ...input, fx, codexSeats, chatMonthly, codexMonthly, monthly,
    annualUsd: monthly * 12,
    annualKrw: monthly * 12 * fx
  };
}

/** 계산 결과만. 입력칸과 분리해야 타이핑 중 재렌더로 포커스를 잃지 않는다. */
function licenseSummaryMarkup() {
  const l = computeLicense();
  const money = (usd) => `$${Math.round(usd).toLocaleString('en-US')}`;
  return `<div class="lic-total">연 계약금액 <b>${formatKRWCompact(l.annualKrw)}</b>
      <small>${money(l.annualUsd)} · 1 USD = ${l.fx.toLocaleString('ko-KR')}원</small></div>
    <div class="quote-scroll"><table class="quote-table">
      <thead><tr><th>항목</th><th class="num">산식</th><th class="num">월</th><th class="num">연</th></tr></thead>
      <tbody>
        <tr><td>ChatGPT License</td><td class="num">${l.seats}석 × $${l.seatPrice}</td>
          <td class="num">${money(l.chatMonthly)}</td><td class="num amount">${money(l.chatMonthly * 12)}</td></tr>
        <tr><td>Codex Credit</td><td class="num">${l.codexSeats}명 × $${l.codexPrice}</td>
          <td class="num">${money(l.codexMonthly)}</td><td class="num amount">${money(l.codexMonthly * 12)}</td></tr>
      </tbody>
      <tfoot><tr><td colspan="2">합계 (VAT 별도)</td>
        <td class="num">${money(l.monthly)}</td>
        <td class="num amount">${formatKRW(l.annualKrw)}</td></tr></tfoot>
    </table></div>`;
}

function licenseMarkup() {
  const l = getLicenseInput();
  const field = (key, label, value, attrs, hint) => `<label class="lic-field">
    <span>${label}</span>
    <input type="number" data-license="${key}" value="${value}" ${attrs} ${isOwner() ? '' : 'disabled'}>
    <small>${hint}</small>
  </label>`;

  return `<section class="license-calc">
    <div class="quote-head"><h3>OpenAI 라이선스<span> · 시트·Codex 기준</span></h3></div>
    <div class="lic-inputs">
      ${field('seats', 'ChatGPT 시트', l.seats, 'min="1" max="100000" step="10"', '최소 2석 (Business)')}
      ${field('seatPrice', '시트 단가 ($/월)', l.seatPrice, 'min="0" max="1000" step="1"', 'Business 연간 $20 · 기획안 가정 $18')}
      ${field('codexRatio', 'Codex 사용 비율 (%)', l.codexRatio, 'min="0" max="100" step="5"', '기획안 가정 20%')}
      ${field('codexPrice', 'Codex 단가 ($/월)', l.codexPrice, 'min="0" max="10000" step="10"', 'Rate Card 참고 $100~200')}
    </div>
    <div id="license-summary">${licenseSummaryMarkup()}</div>
    <p class="quote-note">Enterprise 가격·최소 시트는 <b>OpenAI 영업 협의사항</b>입니다. 확정 가격으로 제시하지 마세요.
      사용량 변동성이 큰 <b>API 는 포함하지 않았습니다</b> — 기획안도 기본 목표 매출에서 제외했습니다.</p>
  </section>`;
}

function renderLicenseCalc() {
  const node = document.getElementById('license-summary');
  if (node) node.innerHTML = licenseSummaryMarkup();
}

/** 시트 수는 ISV 좌석 라이선스 계산과 공유한다. 두 곳에 따로 두면 값이 갈린다. */
function setLicenseField(key, value) {
  const meta = { ...(state.deal.customer_meta || {}) };
  meta.sim = { ...(meta.sim || {}), [key]: Number(value) || 0 };
  state.deal.customer_meta = meta;
  renderLicenseCalc();
  if (key === 'seats') {
    const range = document.getElementById('deal-sim-seat-range');
    const num = document.getElementById('deal-sim-seat-num');
    if (range) range.value = Math.min(Number(range.max), Math.max(Number(range.min), meta.sim.seats));
    if (num) num.value = meta.sim.seats;
    renderDealSimulator();
  }
  scheduleSave({ customer_meta: meta });
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
  const fx = Number(state.refs.settings?.usd_krw) || 1500;
  const selected = new Set(asArray(state.deal?.isv_combo));
  // Every ISV selected in STEP 03 (isv_combo) becomes a quote-list row here —
  // priced ones contribute to the totals, unpriced ones show "단가 미설정".
  const rows = (state.refs.solutions || [])
    .filter((sol) => selected.has(sol.id))
    .map((sol) => {
      if (isPlaceholderPrice(sol)) {
        return {
          id: sol.id, name: sol.name, type: sol.price_type || null, annual: 0, priced: false,
          placeholder: true, formula: '단가 미확정 · 별도협의'
        };
      }
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
        id: sol.id, name: sol.name, type: sol.price_type || null, annual, priced, placeholder: false,
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
    hasPriced: rows.some((row) => row.priced),
    hasPlaceholder: rows.some((row) => row.placeholder)
  };
}

function dealSimSummaryMarkup() {
  const { rows, license, once, mrr, total, multiplier, anySelected, hasPriced, hasPlaceholder } = computeDealSim();
  if (!anySelected) return '<div class="quote-empty">STEP 03에서 ISV 솔루션을 선택하면 견적 리스트가 만들어집니다.</div>';
  const lineRows = rows.map((row) => `<tr class="${row.priced ? '' : 'unpriced'}">
    <td>${escapeHtml(row.name)}</td>
    <td>${row.type ? (DEAL_SIM_TYPE_LABEL[row.type] || row.type) : '—'}</td>
    <td class="num">${escapeHtml(row.formula)}</td>
    <td class="num amount">${row.priced ? formatKRW(row.annual) : `<span class="quote-muted">${row.placeholder ? '별도협의' : '—'}</span>`}</td>
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
    ${hasPlaceholder ? '<p class="quote-note">⚠ 단가가 확정되지 않은 솔루션은 <b>별도협의</b>로 표시되고 합계에서 제외됩니다.</p>' : ''}
    ${!hasPriced && !hasPlaceholder ? '<p class="quote-note">선택한 솔루션에 단가가 없습니다. admin에서 가격(종류·단가/티어)을 설정하면 금액이 계산됩니다.</p>' : ''}
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
    <p class="deal-sim-seathint">좌석 수는 <b>좌석 라이선스(seat)</b> 유형에만 반영됩니다. 일회성·월 운영·고정 구간은 좌석수와 무관하게 고정입니다.</p>
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

/**
 * 카탈로그 8탭에서 피치에 쓸 것만 뽑는다.
 *
 * 파싱 규칙을 여기 한곳에 둔다 — 시드 형식이 바뀌면 한 군데만 고친다.
 * 본문이 없거나(개요만 채운 솔루션이 셋 있다) 형식이 어긋나면 **빈 배열을 낸다.**
 * "정보 없음" 같은 빈 껍데기를 문서에 넣지 않는다.
 */
const PITCH_SOURCE_LIMIT = Object.freeze({ strengths: 3, talkTracks: 2 });

/** §1 의 「차별적 비즈니스 가치」 ①~⑤. 라벨과 첫 문장만 쓴다 — 원문은 100자를 넘는다. */
function parseStrengths(section1) {
  const text = String(section1 || '');
  const at = text.indexOf('차별적 비즈니스 가치');
  if (at < 0) return [];
  return text.slice(at).split('\n')
    .filter((line) => /^\s*-\s*[①②③④⑤⑥⑦⑧⑨]/.test(line))
    .map((line) => {
      // 평문 문서라 마크다운 강조는 걷는다. 시드마다 ** 사용 여부가 다르다.
      const body = line.replace(/^\s*-\s*/, '').replace(/\*\*/g, '').trim();
      // 두 형식이 섞여 있다.
      //   "① 라벨: 설명"        012 계열
      //   "① 라벨이다. 설명…"   022·023 계열 (콜론 없이 첫 문장이 곧 라벨)
      const colon = body.indexOf(':');
      const stop = body.search(/(?<=[다요])\.\s/);
      const cut = colon >= 0 && (stop < 0 || colon < stop) ? colon : stop;
      if (cut < 0) return body;
      const label = body.slice(0, cut).trim();
      const rest = body.slice(cut + 1).trim();
      // 첫 문장만. 괄호 보충설명(예: "(국내 사용량 1위)")은 떼어 낸다.
      const first = rest.split(/(?<=[다요])\.\s|\. /)[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
      return first ? `${label} — ${first}` : label;
    })
    .slice(0, PITCH_SOURCE_LIMIT.strengths);
}

/**
 * §8.1 의 설득 화법.
 *
 * ⚠ 내부 불릿(마진 확보 전략·딜 사이즈 극대화 등)을 **여기서도 거른다.**
 *   서버의 stripInternalSections 는 역할로 가르는데, admin·curator 에게는 일부러
 *   내부 문단을 보내 준다(카탈로그에서 봐야 하니까). 하지만 피치는 PDF·Word 로
 *   내려받혀 고객에게 갈 수 있는 문서라 **역할과 무관하게** 빠져야 한다.
 *
 *   라벨 목록은 서버가 내려보낸 것(`refs.internalBulletLabels`)을 쓴다. 화면에
 *   또 적으면 단일 출처가 깨진다.
 */
function parseTalkTracks(section8) {
  const text = String(section8 || '');
  const head = text.split('8.2')[0];
  return head.split('\n')
    .filter((line) => /^\s*-\s*\*\*/.test(line))
    .map((line) => {
      const label = (line.match(/\*\*(.+?)\*\*/) || [])[1] || '';
      const body = line.replace(/^\s*-\s*\*\*.+?\*\*\s*:?\s*/, '').replace(/\*\*/g, '').trim();
      return { label: label.trim(), body };
    })
    .filter((entry) => entry.body)
    .filter((entry) => !asArray(state.refs.internalBulletLabels)
      .some((label) => entry.label.includes(label)))
    .slice(0, PITCH_SOURCE_LIMIT.talkTracks);
}

/**
 * 선택한 ISV 의 본문을 가져온다.
 *
 * reference-data 에 sections 를 싣지 않는 이유는 17종 본문을 허브 열 때마다
 * 내려보내게 되기 때문이다. 기존 `/api/solutions/:slug` 를 재사용한다 — 이미 인증을
 * 거치고 내부 문단을 걸러 준다.
 *
 * **실패해도 본문은 그대로 나온다.** 카탈로그를 못 불러왔다고 대화 가이드 전체가
 * 막히면 안 된다.
 */
async function loadPitchSources() {
  const slugs = state.refs.solutions
    .filter((s2) => asArray(state.deal?.isv_combo).includes(s2.id))
    .map((s2) => s2.slug).filter(Boolean);
  const missing = slugs.filter((slug) => !(slug in state.pitchSources));
  if (!missing.length) return;

  await Promise.all(missing.map(async (slug) => {
    try {
      const row = await api(`/api/solutions/${encodeURIComponent(slug)}`);
      state.pitchSources[slug] = {
        strengths: parseStrengths(row?.sections?.['1']),
        talkTracks: parseTalkTracks(row?.sections?.['8'])
      };
    } catch (error) {
      console.error(`Pitch source failed (${slug}):`, error.message);
      state.pitchSources[slug] = { strengths: [], talkTracks: [] };
    }
  }));

  if (state.activeStage === 4) {
    const node = document.getElementById('pitch-content');
    if (node) node.textContent = buildPitch();
  }
}

/**
 * 세일즈 대화 가이드.
 *
 * 영업이 고객 앞에서 **그대로 읽고 쓸 수 있는** 문서다. 그래서 두 가지를 지킨다.
 *
 *   ① 고객이 직접 고른 문장을 인용한다. "D2 가 2점입니다" 는 반박당하지만
 *      "품질 관리가 전혀 없고 수작업으로만 정제한다고 답하셨다" 는 반박이 어렵다.
 *   ② 없는 것을 지어내지 않는다. 진단이 없으면 없다고 쓰고, 단가가 미정이면
 *      「별도협의」로 쓴다. 고객 앞에서 못 지킬 말을 문서가 먼저 하면 안 된다.
 *
 * 근거는 전부 기획안에서 온다 — 트랙 확인 질문·함정(§7), 평가영역의 주요 우려사항
 * (Appendix A), 무상/유상 경계(§5), 라이선스 산식(Appendix C·D).
 */
function buildPitch() {
  const deal = state.deal;
  const meta = deal.customer_meta || {};
  const totals = deal.readiness_totals || {};
  const track = state.refs.tracks.find((item) => item.id === deal.track);
  const areaById = new Map(asArray(state.refs.assessmentAreas).map((a) => [a.id, a]));

  const selectedSolutions = state.refs.solutions.filter((s2) => asArray(deal.isv_combo).includes(s2.id));
  const packageMap = new Map(state.refs.packages.map((pkg) => [pkg.id, pkg]));
  const selectedPackages = asArray(deal.packages)
    .map((item) => packageMap.get(typeof item === 'string' ? item : item.id)).filter(Boolean);

  const line = (label, value) => (value ? `${label}  ${value}` : null);
  const block = (title, body) => `\n━━ ${title}\n\n${body}`;
  const bullet = (list) => list.filter(Boolean).map((t) => `· ${t}`).join('\n');

  // ── 머리말 ────────────────────────────────────────────────────
  const avg = Number(totals.average);
  const head = [
    `${deal.customer} — 세일즈 대화 가이드`,
    [
      new Date().toISOString().slice(0, 10),
      track ? `${track.id} ${track.name}` : '트랙 미정',
      Number.isFinite(avg) ? `AI 준비도 ${avg.toFixed(2)} (${totals.maturity?.name || ''} 단계)` : '진단 미실시'
    ].join('  ·  '),
    // PDF·Word 로 내려받히므로 성격을 문서 안에 박아 둔다. 아래 화법은 영업이
    // 말하는 대본이라 고객이 그대로 읽으면 어색하다.
    '⚠ 내부 준비용입니다. 고객에게 그대로 전달하지 마세요.'
  ].join('\n');

  // ── 1. 이 미팅에서 확인할 것 ──────────────────────────────────
  const asks = asArray(track?.ask);
  const opening = block('1. 이 미팅에서 확인할 것', [
    asks.length ? bullet(asks) : '· 트랙을 STEP 02 에서 확정하면 확인 질문이 나옵니다.',
    track?.warn ? `\n⚠ ${track.warn}` : ''
  ].filter(Boolean).join('\n'));

  // ── 2. 고객이 직접 답한 것 ────────────────────────────────────
  // 인용이 대화의 출발점이다. 숫자만 들이밀면 "그건 해석이죠" 로 끝난다.
  const priorities = asArray(totals.priorities).filter((p) => Number(p.score) < 3);
  const quotes = priorities.length
    ? priorities.map((p) => {
      const items = asArray(p.items).filter((i) => i.rubric).slice(0, 3);
      return [`${p.name} — ${Number(p.score).toFixed(2)} / 5`,
        items.map((i) => `   · ${i.text}\n     → "${i.rubric}" (${i.score}점)`).join('\n')]
        .filter(Boolean).join('\n');
    }).join('\n\n')
    : Number.isFinite(avg)
      ? '6대 영역 모두 3점 이상입니다. 보완이 아니라 확산 관점에서 대화를 엽니다.'
      : '진단이 아직 없습니다. STEP 02 에서 채우면 고객이 고른 문장이 여기 인용됩니다.';

  const context = block('2. 고객이 직접 답한 것 — 대화의 출발점', [
    [
      line('업종', meta.industry), line('규모', meta.companySize),
      line('도입 대상', meta.targetUsers)
    ].filter(Boolean).join('   ·   '),
    meta.notes || deal.lead_message ? `\n메모: ${meta.notes || deal.lead_message}` : '',
    `\n${quotes}`,
    totals.insight ? `\n${totals.insight}` : '',
    '\n화법 — "진단에서 이렇게 답해주셨는데, 그 부분부터 보겠습니다." 로 연다.\n'
    + '      고객이 고른 문장을 그대로 읽는 것이 가장 반박이 어렵다.'
  ].filter(Boolean).join('\n'));

  // ── 3. 권고 구성 ──────────────────────────────────────────────
  const recoReason = new Map(
    ['prepare', 'adopt', 'operate', 'unclassified']
      .flatMap((key) => asArray(state.reco?.proposal?.[key]))
      .concat(asArray(state.reco?.bundles))
      .map((item) => [item.slug || item.id, asArray(item.reasons)[0]])
  );

  const isv = selectedSolutions.length
    ? bullet(selectedSolutions.map((s2) => {
      const why = recoReason.get(s2.slug) || recoReason.get(s2.id) || s2.jtbd;
      return `${s2.name}${why ? ` — ${why}` : ''}`;
    }))
    : '· ISV 조합을 STEP 03 에서 선택하면 추천 근거와 함께 들어갑니다.';

  const freeNote = selectedPackages.flatMap((pkg) => asArray(pkg.items)
    .filter((i) => i.type === 'note' && /무상/.test(i.label))
    .map((i) => `${pkg.name}: ${i.label}`));

  const pkgs = selectedPackages.length
    ? bullet(selectedPackages.map((pkg) =>
      `${pkg.name} (${pkg.period || '기간 협의'}) — ${pkg.target || ''}`))
    : '· 서비스 패키지를 STEP 04 에서 선택해주세요.';

  const proposal = block('3. 권고 구성', [
    track ? `접근  ${track.why}` : '',
    `\n[ISV 조합]\n${isv}`,
    `\n[실행 패키지]\n${pkgs}`,
    freeNote.length ? `\n무상 범위 — ${freeNote.join(' / ')}` : ''
  ].filter(Boolean).join('\n'));

  // ── 4. 예상 딜 규모 ───────────────────────────────────────────
  const lic = computeLicense();
  const quote = computeQuote();
  const size = block('4. 예상 딜 규모 (내부 참고)', [
    `라이선스  ChatGPT ${lic.seats}석 × $${lic.seatPrice} + Codex ${lic.codexSeats}명 × $${lic.codexPrice}`,
    `          연 $${Math.round(lic.annualUsd).toLocaleString('en-US')} · ${formatKRW(lic.annualKrw)} (1 USD = ${lic.fx.toLocaleString('ko-KR')}원)`,
    quote.rows.length
      ? `서비스    ${quote.rows.reduce((sum, r) => sum + r.totalMd, 0)} MD · `
        + (quote.hasPlaceholder ? '단가 미확정으로 별도협의' : formatKRW(quote.total))
      : '서비스    패키지 미선택',
    '',
    '⚠ Enterprise 가격·최소 시트는 OpenAI 영업 협의사항입니다. 확정 금액으로 제시하지 마세요.',
    '⚠ 사용량 변동이 큰 API 는 포함하지 않았습니다.'
  ].join('\n'));

  // ── 5. 예상 질문과 대응 ───────────────────────────────────────
  // 기획안 Appendix A 의 「주요 우려사항」이 곧 고객이 실제로 묻는 것이다.
  const failing = asArray(totals.areas).length
    ? asArray(deal.assessment_totals?.areas).filter((a) => a.answered && a.ready === false)
    : [];
  const covers = (areaId) => selectedPackages
    .filter((pkg) => asArray(pkg.assessment_coverage).some((e) => e.area === areaId))
    .map((pkg) => pkg.name);

  const objections = failing.length
    ? failing.slice(0, 5).map((a) => {
      const ref = areaById.get(a.area);
      const by = covers(a.area);
      return [`Q. ${ref?.concerns || a.name}`,
        `   확인할 것 — ${ref?.checkpoints || '—'}`,
        `   대응 — ${by.length ? `${by.join(' · ')} 범위에서 다룹니다.` : '현재 선택한 구성으로는 안 덮습니다. 별도 과업으로 잡거나 구성을 바꿔야 합니다.'}`]
        .join('\n');
    }).join('\n\n')
    : '평가영역 미충족 항목이 없거나 아직 판정되지 않았습니다.';

  const pending = [...new Set(
    ['prepare', 'adopt', 'operate']
      .flatMap((key) => asArray(state.reco?.proposal?.[key]))
      .concat(asArray(state.reco?.needsConfirmation))
      .flatMap((item) => asArray(item.prerequisites?.pendingManual).map((p) => p.label))
  )];

  const risk = block('5. 예상 질문과 대응', objections);

  // ── 6. 다음 단계 ──────────────────────────────────────────────
  const next = block('6. 다음 단계', [
    pending.length ? `확인 필요 (미확정 전제)\n${bullet(pending)}\n` : '',
    bullet([
      '의사결정자·현업 오너 확인',
      'PoC 성공 KPI 와 측정 방법 합의',
      '보안·법무 검토 범위와 일정 확정',
      selectedPackages.length ? '패키지 공수·일정 확정 후 견적 확정' : '패키지 구성 확정',
      '기술 제약과 포컬 배정 재확인'
    ])
  ].filter(Boolean).join('\n'));

  // ── 요약 ──────────────────────────────────────────────────────
  // 본문에서 이미 계산한 값을 다시 쓴다. 따로 계산하면 위아래 숫자가 갈라진다.
  const weakest = asArray(totals.areas)
    .filter((a2) => Number.isFinite(Number(a2.score)))
    .sort((a2, b2) => a2.score - b2.score)[0];
  const summary = block('요약', [
    line('고객   ', [meta.industry, meta.companySize, meta.targetUsers].filter(Boolean).join(' · ')),
    line('현재   ', Number.isFinite(avg)
      ? `${totals.maturity?.name || ''} 단계 ${avg.toFixed(2)}`
        + (weakest ? ` — ${weakest.name} ${Number(weakest.score).toFixed(1)} 이 가장 낮다` : '')
      : '진단 미실시'),
    line('목표   ', track?.name ? `${track.name} — ${asArray(track.ask)[0] || ''}` : null),
    line('제안   ', [
      selectedPackages.map((pkg) => pkg.name).join(' + '),
      selectedSolutions.map((s2) => s2.name).join(' · ')
    ].filter(Boolean).join('  |  ') || '구성 미선택'),
    line('규모   ', `라이선스 연 ${formatKRWCompact(lic.annualKrw)}`
      + (quote.rows.length
        ? ` · 서비스 ${quote.rows.reduce((sum, r) => sum + r.totalMd, 0)}MD`
          + (quote.hasPlaceholder ? ' (별도협의)' : ` ${formatKRWCompact(quote.total)}`)
        : ''))
  ].filter(Boolean).join('\n'));

  // ── 부록. 솔루션별 이야기할 거리 ──────────────────────────────
  const cards = selectedSolutions.map((s2) => {
    const src = state.pitchSources[s2.slug] || {};
    const why = recoReason.get(s2.slug) || recoReason.get(s2.id) || s2.jtbd;
    const rows = [
      `${s2.name}${s2.category ? `  ·  ${s2.category}` : ''}`,
      why ? `  왜 이 고객에  ${why}` : '',
      asArray(src.strengths).length
        ? `  강점          ${src.strengths.join('\n                ')}` : '',
      asArray(src.talkTracks).length
        ? asArray(src.talkTracks)
          .map((t, i) => `  ${i === 0 ? '화법        ' : '            '}  ${t.label ? `[${t.label}] ` : ''}${t.body}`)
          .join('\n') : ''
    ];
    return rows.filter(Boolean).join('\n');
  });

  const appendix = cards.length
    ? `\n\n${'─'.repeat(56)}\n아래는 참고 자료입니다. 고객이 물을 때 펼쳐 보세요.\n`
      + block('부록. 솔루션별 이야기할 거리', cards.join('\n\n'))
    : '';

  return [head, summary, opening, context, proposal, size, risk, next].join('\n') + appendix;
}

/**
 * 내려받을 리포트.
 *
 * 단계마다 내용은 다르지만 **머리말은 같다** — 어느 파일을 열어도 어느 고객의
 * 어느 단계인지가 첫 화면에 있다. 여러 단계를 뽑아 붙여 놓았을 때 섞이지 않는다.
 *
 * 화면에 없는 숫자를 만들지 않는다. 점수는 서버가 낸 값을 그대로 쓴다.
 */
const STAGE_REPORT_TITLES = Object.freeze([
  '들어온 데이터', 'AI 준비도 진단', 'ISV 조합 추천', '패키지와 딜 사이즈', '세일즈 피치'
]);

function reportHeader(stageIndex) {
  const meta = state.deal.customer_meta || {};
  return `# ${state.deal.customer} — ${STAGE_REPORT_TITLES[stageIndex] || '딜 요약'}

| | |
|---|---|
| 단계 | STEP ${String(stageIndex + 1).padStart(2, '0')} · ${STAGE_REPORT_TITLES[stageIndex] || '—'} |
| 작성일 | ${new Date().toISOString().slice(0, 10)} |
| 업종 | ${meta.industry || '—'} |
| 조직 규모 | ${meta.companySize || '—'} |
| 도입 대상 | ${meta.targetUsers || '—'} |
| 딜 트랙 | ${state.deal.track_name || state.deal.track || '미정'} |
`;
}

/** STEP01 — 들어온 고객 맥락. 이후 모든 판단의 전제라 그대로 남긴다. */
function intakeReport() {
  const meta = state.deal.customer_meta || {};
  const label = {
    none: '별도 SWG 없음', zscaler: 'Zscaler', 'other-swg': '타사 SWG',
    low: '제한적', medium: 'PoC 예산 확보', high: '전사 확장 가능'
  };
  return `## 고객 맥락

| 항목 | 값 |
|---|---|
| 고객사 | ${state.deal.customer} |
| 업종 | ${meta.industry || '—'} |
| 조직 규모 | ${meta.companySize || '—'} |
| 도입 대상 | ${meta.targetUsers || '—'} |
| 현재 보안 환경 | ${label[meta.securityStack] || meta.securityStack || '미정'} |
| 투자 여력 | ${label[meta.investment] || meta.investment || '미정'} |
| 유입 경로 | ${sourceNames[state.deal.source] || state.deal.source || '—'} |

## 고객 상황·요청 메모

${meta.notes || state.deal.lead_message || '_아직 입력되지 않았습니다._'}`;
}

/** STEP02 — 42문항. 축 점수·성숙도·미흡 근거·문항별 응답. */
function readinessReport() {
  const totals = state.deal.readiness_totals || {};
  const scores = state.deal.readiness_scores || {};
  const customer = state.deal.readiness_customer_scores || {};
  const items = asArray(state.refs.readinessItems);
  const areaName = new Map(asArray(state.refs.readinessAreas).map((a) => [a.id, a.name]));

  if (!Number.isFinite(Number(totals.average))) {
    return '## 진단 결과\n\n_아직 응답이 없습니다. STEP 02 에서 42문항을 채워주세요._';
  }

  const areaRows = asArray(totals.areas).map((area) => {
    const score = Number(area.score);
    if (!Number.isFinite(score)) return `| ${area.area} · ${area.name} | — | 0 / ${area.total ?? '—'} | 응답 대기 |`;
    return `| ${area.area} · ${area.name} | ${score.toFixed(2)} | ${area.answered} / ${area.total ?? area.answered} | ${score < 3 ? '우선 보완' : '기준 충족'} |`;
  }).join('\n');

  const gaps = asArray(totals.priorities)
    .filter((p) => Number(p.score) < 3)
    .map((p) => `### ${p.area} · ${p.name} — ${Number(p.score).toFixed(2)}점\n\n`
      + asArray(p.items).map((item) =>
        `- **${item.code}** ${item.text} — **${item.score}점**${item.rubric ? `\n  - 고른 상태: “${item.rubric}”` : ''}`
      ).join('\n')).join('\n\n');

  const answerRows = items.map((item) => {
    const value = Number(scores[item.code]);
    const answered = Number.isFinite(value) && value > 0;
    const origin = !answered ? '—'
      : Number(customer[item.code]) === value ? '고객'
      : Number(customer[item.code]) ? '영업 수정' : '영업';
    const rubric = answered ? (asArray(item.rubric)[value - 1] || '') : '미응답';
    return `| ${item.code} | ${areaName.get(item.area) || item.area} | ${item.text} | ${answered ? `${value}점` : '—'} | ${rubric} | ${origin} |`;
  }).join('\n');

  const unanswered = items.filter((item) => !scores[item.code]);

  return `## 진단 결과

종합 **${Number(totals.average).toFixed(2)}점** · ${totals.maturity?.name || ''} 단계 (Level ${totals.maturity?.level ?? '—'})
${totals.maturity?.note ? `\n> ${totals.maturity.note}` : ''}

| 영역 | 점수 | 응답 | 판정 |
|---|---|---|---|
${areaRows}

${totals.insight || ''}

${unanswered.length
    ? `> 미응답 ${unanswered.length}개: ${unanswered.slice(0, 12).map((i) => i.code).join(', ')}`
      + (unanswered.length > 12 ? ` 외 ${unanswered.length - 12}개` : '')
      + ' — 점수는 응답한 문항만으로 계산됩니다.'
    : '모든 문항에 응답이 입력되어 있습니다.'}

${gaps ? `## 보완이 필요한 영역\n\n${gaps}` : '## 보완이 필요한 영역\n\n_3점 미만 영역이 없습니다._'}

## 문항별 응답

| 문항 | 영역 | 내용 | 점수 | 선택한 상태 | 출처 |
|---|---|---|---|---|---|
${answerRows}`;
}

/** STEP03 — 확정한 ISV 와 그 근거. 제외 사유도 남긴다. */
function solutionsReport() {
  const selected = new Set(asArray(state.deal.isv_combo));
  const chosen = state.refs.solutions.filter((solution) => selected.has(solution.id));
  const reco = state.reco;

  const rows = chosen.length
    ? chosen.map((solution) => `| ${solution.name} | ${solution.category || '—'} | ${solution.jtbd || '—'} |`).join('\n')
    : '| _아직 선택된 솔루션이 없습니다._ | | |';

  // 화면의 추천 패널과 같은 묶음을 쓴다. 여기서 따로 분류하면 문서와 화면이 갈라진다.
  const groups = RECO_GROUPS.map(({ key, path, title }) => {
    const items = (path ? path.reduce((acc, step) => acc?.[step], reco) : reco?.[key]) || [];
    if (!items.length) return '';
    return `### ${title}\n\n` + items.map((item) => {
      const reasons = asArray(item.reasons).slice(0, 3);
      return `- **${item.name}**${item.enabler ? ` (← ${item.enabler.name} 선행)` : ''}`
        + `${item.slotName ? ` — ${item.slotName}` : ''}`
        + (reasons.length ? `\n${reasons.map((r) => `  - ${r}`).join('\n')}` : '');
    }).join('\n');
  }).filter(Boolean).join('\n\n');

  const weakAreas = asArray((state.deal.readiness_totals || {}).areas)
    .filter((area) => Number(area.score) < 3)
    .map((area) => `${area.name} ${Number(area.score).toFixed(2)}`);

  const excluded = asArray(reco?.excluded).filter((x) => !asArray(x.excludedBy).some((r) => /판정 데이터/.test(r)));

  return `## 확정한 ISV 조합

| 솔루션 | 카테고리 | 해결하는 문제 |
|---|---|---|
${rows}

## 판정 근거

${weakAreas.length ? `STEP 02 진단에서 3점 미만 — ${weakAreas.join(' · ')}` : 'STEP 02 진단에서 3점 미만 영역이 없습니다.'}
${reco?.failingCategories?.length ? `\nISV 게이트 미달 영역 — ${reco.failingCategories.join(' · ')}` : ''}
${reco?.label ? `\n> ${reco.label}` : ''}

${groups ? `## 추천 후보\n\n${groups}` : ''}

${excluded.length ? `## 이 고객에게 맞지 않아 제외\n\n${excluded.map((x) => `- ${x.name} — ${asArray(x.excludedBy)[0] || '사유 미기재'}`).join('\n')}` : ''}`;
}

/** STEP04 — 패키지와 가견적. 내부 참고용이라는 표시를 문서에도 남긴다. */
function packagesReport() {
  const { rows, total, hasPlaceholder } = computeQuote();
  if (!rows.length) return '## 패키지와 가견적\n\n_아직 선택된 패키지가 없습니다._';

  const lines = rows.map((row) =>
    `| ${row.name} | ${row.baseMd} | ${row.adjMd ? `+${row.adjMd}` : '0'} | ${row.totalMd} MD `
    + `| ${row.placeholder ? '별도협의' : (row.unit ? formatKRW(row.unit) : '미설정')} `
    + `| ${row.placeholder ? '별도협의' : formatKRW(row.amount)} |`).join('\n');

  return `## 패키지와 가견적

> 내부 참고용입니다. 고객 제시 금액이 아닙니다.

| 패키지 | 기준MD | 조정MD | 합계 | MD 단가 | 금액 |
|---|---|---|---|---|---|
${lines}

**합계 (VAT 별도, 확정 단가만) — ${hasPlaceholder && total === 0 ? '별도협의' : formatKRW(total)}**

${hasPlaceholder ? '⚠ MD 단가가 확정되지 않은 패키지는 금액에서 제외되고 별도협의로 표시됩니다.' : ''}`;
}

function buildStageReport(stageIndex) {
  const body = [intakeReport, readinessReport, solutionsReport, packagesReport,
    () => `## 세일즈 피치\n\n${buildPitch()}`][stageIndex];
  return `${reportHeader(stageIndex)}\n${body ? body() : ''}`;
}

function renderPitch() {
  const actions = '<button id="copy-pitch" class="secondary-button" type="button"><i data-lucide="copy"></i> 피치 복사</button>';
  return `${stageHeader('05', '세일즈 피치 준비', '앞 단계에서 확정한 고객 맥락·트랙·ISV·패키지를 한 번에 묶은 대화 가이드입니다.', actions)}
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
  // 루브릭 칩. 저장하면 서버가 다시 채점하고 그 결과가 응답으로 돌아와
  // 축 점수와 성숙도가 갱신된다.
  $$('[data-readiness-code]').forEach((chip) => chip.addEventListener('click', () => {
    const scores = { ...(state.deal.readiness_scores || {}) };
    scores[chip.dataset.readinessCode] = Number(chip.dataset.readinessScore);
    state.deal.readiness_scores = scores;
    paintReadinessItem(chip.dataset.readinessCode, scores);
    scheduleSave({ readiness_scores: scores }, true);
  }));
  $$('[data-readiness-clear]').forEach((button) => button.addEventListener('click', () => {
    const scores = { ...(state.deal.readiness_scores || {}) };
    delete scores[button.dataset.readinessClear];
    state.deal.readiness_scores = scores;
    paintReadinessItem(button.dataset.readinessClear, scores);
    scheduleSave({ readiness_scores: scores }, true);
  }));

  // STEP02 → STEP03 인계. 넘어가면서 추천을 다시 계산한다 — 방금 고친 응답이
  // 반영되지 않은 예전 추천을 보여주면 근거와 결과가 어긋난다.
  $('#handoff-isv')?.addEventListener('click', async () => {
    await flushSave();
    selectStage(2);
    loadRecommendations();
  });
  $('#deal-track')?.addEventListener('change', (event) => {
    state.deal.track = event.target.value || null;
    scheduleSave({ track: state.deal.track }, true);
  });
  // 번들 구성 제품 → 조합. 추천 카드의 「조합에 추가」와 같은 결과를 낸다.
  $$('[data-bundle-add]').forEach((button) => button.addEventListener('click', () => {
    const selected = new Set(asArray(state.deal.isv_combo));
    const id = button.dataset.bundleAdd;
    selected.has(id) ? selected.delete(id) : selected.add(id);
    state.deal.isv_combo = [...selected];
    scheduleSave({ isv_combo: state.deal.isv_combo }, true);
    saveAdoptionSnapshot();
    renderStage();
  }));
  $$('[data-license]').forEach((input) => input.addEventListener('input', () => {
    setLicenseField(input.dataset.license, input.value);
  }));
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
    saveAdoptionSnapshot();
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
  // STEP05 에 들어오면 선택한 ISV 의 8탭을 가져온다. 이미 받은 것은 다시 안 부른다.
  if (state.activeStage === 4) void loadPitchSources();
  $('#copy-pitch')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(buildPitch());
    toast('피치 가이드를 복사했습니다.');
  });
  // 다섯 단계가 같은 버튼을 쓴다. 지금 보고 있는 단계의 내용이 나온다.
  $$('[data-report]').forEach((button) => button.addEventListener('click', () => {
    const stage = state.activeStage;
    const label = STAGE_REPORT_TITLES[stage] || '딜 요약';
    const markdown = buildStageReport(stage);
    const baseName = `${state.deal.customer || '고객'}_STEP${String(stage + 1).padStart(2, '0')}_${label}_${new Date().toISOString().slice(0, 10)}`;
    const kind = button.dataset.report;
    if (kind === 'md') window.IssuReport.markdown(markdown, baseName);
    else if (kind === 'docx') window.IssuReport.docx(markdown, baseName);
    else window.IssuReport.pdf(`${state.deal.customer} — ${label}`, markdown);
  }));
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
  const totals = state.deal?.readiness_totals || {};
  const entries = asArray(totals.areas)
    .filter((area) => Number.isFinite(Number(area.score)))
    .map((area) => [area.area, area]);
  const average = Number(totals.average);
  const heading = Number.isFinite(average)
    ? `<h3>AI 준비도 <b>${average.toFixed(2)}</b><small>${escapeHtml(totals.maturity?.name || '')}</small></h3>`
    : '<h3>AI 준비도</h3>';
  $('#readiness-card').innerHTML = `${heading}${entries.length ? entries.map(([code, value]) => {
    const score = Math.max(0, Math.min(5, Number(value.score)));
    return `<div class="mini-bar" title="${escapeHtml(value.name)}"><span>${escapeHtml(code)}</span><span class="mini-bar-track"><i style="width:${score / 5 * 100}%"></i></span><span>${score.toFixed(1)}</span></div>`;
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
      // 열어둔 딜을 그 사이 다른 사람이 claim 하면 상세 조회가 404 로 닫힌다.
      // 미배정 딜은 누구나 열 수 있으므로 정상적인 경합이다 — 워크스페이스만 비운다.
      let refreshed;
      try {
        refreshed = await api(`/api/hub/deals/${change.id}`);
      } catch (error) {
        if (state.deal?.id !== change.id) return;
        state.deal = null;
        $('#workspace').classList.add('hidden');
        $('#empty-workspace').classList.remove('hidden');
        syncDealSelection();
        toast('이 딜은 다른 담당자가 맡았습니다.');
        return;
      }
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
