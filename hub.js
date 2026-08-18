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
  // 회의록(050). 목록은 머리말만이고 본문은 열 때 따로 받는다 — 다섯 건이면 수만 자다.
  notes: [],
  noteDraft: null,
  // 「근거 가져오기」를 누른 칸. 회의록 창에서 발췌하면 여기로 꽂힌다.
  pinTarget: null,
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
  // 삭제 창은 닫기 속성이 다르다. 위 위임이 #new-deal-dialog 를 하드코딩해 닫으므로
  // 같은 속성을 쓰면 취소 버튼이 엉뚱한 창을 닫는다.
  $$('[data-close-delete-dialog]').forEach((button) => button.addEventListener('click', () => $('#delete-deal-dialog').close()));
  // 회의록 창. 닫기 속성이 또 다른 이유는 위임이 창을 하드코딩해 닫기 때문이다 —
  // data-close-dialog 를 그대로 쓰면 엉뚱한 창이 닫힌다(삭제 창에서 겪은 그 문제).
  $('#open-notes')?.addEventListener('click', openNotesDialog);
  $$('[data-close-notes]').forEach((button) => button.addEventListener('click', () => {
    state.pinTarget = null;
    $('#notes-dialog').close();
  }));
  $('#notes-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note]');
    if (button) void openNote(button.dataset.note);
  });
  $('#note-new')?.addEventListener('click', () => fillNoteEditor(null));
  $('#note-save')?.addEventListener('click', () => void saveNote());
  $('#note-delete')?.addEventListener('click', () => void deleteNote());
  $('#note-pin')?.addEventListener('click', pinSelectionToField);
  $('#delete-deal-button').addEventListener('click', () => {
    if (!state.deal) return;
    $('#delete-deal-customer').textContent = state.deal.customer;
    $('#delete-deal-error').textContent = '';
    $('#delete-deal-dialog').showModal();
  });
  $('#confirm-delete-deal').addEventListener('click', () => void deleteDeal());
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
    // new·msp 는 클라이언트 필터다. 목록에 LIMIT 이 없고 배지 때문에 어차피
    // msp_status 가 응답에 실려 있어서 서버 필터가 얻는 게 없다.
    const clientFilters = {
      new: (deal) => deal.source === 'portal' && !deal.owner_id,
      msp: (deal) => deal.msp_status === 'yes'
    };
    const clientFilter = clientFilters[state.dealFilter];
    state.deals = clientFilter ? deals.filter(clientFilter) : deals;
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
    // MSP 는 yes 일 때만 띄운다. 「확인 필요」를 전 딜에 띄우면 소음이 되어 아무도 안 본다.
    // 스팸 신호는 회색이다. 「걸렀다」가 아니라 「한 번 보라」는 뜻이라 눈에 덜 띄어야 한다.
    const spam = Number(deal.spam_count) > 0
      ? `<span class="spam-tag">확인 필요 ${deal.spam_count}</span>` : '';
    // ⚠ 정체 칩은 **본인 딜에만** 띄운다. 목록은 담당자 게이트가 없어 승인된 전 직원이
    // 보는데, 남의 딜이 빨간 것까지 보이면 「내 딜이 빨간 걸 다들 보네」가 된다.
    // 채택 초기에 감시 도구로 한 번 읽히면 되돌리는 데 몇 배가 든다.
    // 관리자도 목록에서는 안 본다 — 예외를 두면 그 예외가 곧 그 인식이다.
    // 딜을 열면(담당자·admin·미배정) 상세와 컨텍스트 카드에서 그대로 본다.
    const mine = deal.owner_id && deal.owner_id === state.user?.id;
    const tags = (deal.msp_status === 'yes' ? '<span class="msp-tag">MSP</span>' : '') + spam
      + (mine ? stallChipsMarkup(deal) : '');
    return `<button class="deal-card ${selected ? 'selected' : ''}" type="button" data-deal-id="${deal.id}" aria-current="${selected ? 'true' : 'false'}">
      <span class="deal-card-head"><span class="deal-card-customer"><strong>${escapeHtml(deal.customer)}</strong>${isNew ? '<span class="new-tag">신규</span>' : ''}</span><span class="track-badge" data-track="${escapeHtml(deal.track || '')}">${escapeHtml(deal.track || '미정')}</span></span>
      <span class="deal-card-sub">${escapeHtml(sub)}</span>
      ${tags ? `<span class="deal-card-tags">${tags}</span>` : ''}
      <span class="deal-card-foot"><span class="deal-stage-summary"><span class="stage-dots">${dots}</span><span class="deal-stage-label">${deal.stage + 1} · ${escapeHtml(stageLabel)}</span></span><span class="deal-owner">${escapeHtml(deal.owner_name || '미배정')}</span></span>
    </button>`;
  }).join('');
  list.scrollTop = scrollTop;
  window.lucide?.createIcons();
}

/**
 * 새 딜. **딜이 두 개씩 만들어지던 자리다.**
 *
 * ⚠ `event.currentTarget` 은 **첫 await 뒤 null 이 된다.** 이벤트 디스패치가 끝났기
 *   때문이다. 예전 코드는 await 뒤에 currentTarget.reset() 을 불러 TypeError 가 났고,
 *   그게 catch 로 떨어지면서 **딜은 만들어졌는데 화면은 실패한 것처럼 굴었다** —
 *   토스트도 없고, 목록도 안 늘고, 딜도 안 열렸다. 영업은 "안 됐네" 하고 한 번 더
 *   눌렀고 그래서 둘이 됐다. readiness.js 의 submitLead 가 이 함정을 이미 적어 뒀다.
 *
 * ⚠ 제출 버튼도 잠근다. 응답이 오는 동안 버튼이 살아 있으면 두 번 눌린다 —
 *   서버는 같은 요청 둘을 그대로 둘 다 만든다(고객사가 같아도 다른 딜일 수 있어서
 *   서버가 임의로 합칠 수 없다).
 */
async function createDeal(event) {
  event.preventDefault();
  const formEl = event.currentTarget;
  const form = new FormData(formEl);
  const button = $('button[type="submit"]', formEl);
  $('#new-deal-error').textContent = '';
  if (button?.disabled) return;
  if (button) button.disabled = true;
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
    formEl.reset();
    toast('새 딜을 만들었습니다.');
    await loadDeals();
    await openDeal(deal.id, { historyMode: 'push' });
  } catch (error) {
    $('#new-deal-error').textContent = error.message;
  } finally {
    if (button) button.disabled = false;
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

/**
 * 열어 둔 딜을 닫고 목록 화면으로 돌린다.
 *
 * 이 정리가 여러 곳에 흩어져 있으면 반드시 어긋난다 — 실제로 SSE 분기에는
 * **대기 중인 저장을 비우는 코드가 빠져 있었다.** 그 상태로 딜이 닫히면 700ms 뒤
 * 타이머가 사라진 딜에 PATCH 를 쏜다.
 */
function closeWorkspace(message) {
  state.deal = null;
  state.reco = null;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.pendingPatch = {};
  state.pendingDealId = null;
  $('#workspace').classList.add('hidden');
  $('#empty-workspace').classList.remove('hidden');
  // ?deal= 을 남겨 두면 새로고침할 때 없는 딜을 다시 연다.
  history.replaceState({ hubList: true, hubDetail: false, dealId: null }, '', '/hub');
  syncDealSelection();
  if (message) toast(message);
}

/**
 * 딜 삭제. 서버는 soft delete 이고 고객 담당자 4종은 함께 지운다.
 *
 * 요청 **전에** 대기 중인 저장을 비운다. 안 그러면 지운 뒤 타이머가 터져 404 PATCH 가
 * 나가고 "딜을 찾을 수 없습니다" 토스트가 뜬금없이 뜬다.
 */
async function deleteDeal() {
  const dealId = state.deal?.id;
  if (!dealId) return;
  try { await flushSave(); } catch (_error) { /* 어차피 지울 딜이다 */ }
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.pendingPatch = {};
  state.pendingDealId = null;

  $('#delete-deal-error').textContent = '';
  try {
    const result = await api(`/api/hub/deals/${dealId}`, { method: 'DELETE' });
    $('#delete-deal-dialog').close();
    closeWorkspace(result?.message || '딜을 삭제했습니다.');
    await loadDeals();
  } catch (error) {
    $('#delete-deal-error').textContent = error.message;
  }
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
  renderStallSummary();
  $('#context-mzc-sales').textContent = deal.mzc_sales || '—';
  $('#context-msp').textContent = MSP_LABELS[deal.msp_status] || MSP_LABELS.unknown;
  $('#context-timeline').textContent = timelineLabel((deal.customer_meta || {}).timeline) || '—';
  // 직함은 여기서 보여준다. 목록(GET /deals)에는 안 싣는다 — 그 응답은 담당자가
  // 아닌 전 직원이 보고, 「고객사 · CTO」는 사실상 특정 개인을 가리킨다.
  $('#context-contact').textContent = [deal.customer_contact_name, deal.customer_contact_title,
    deal.customer_contact_dept].filter(Boolean).join(' · ') || '—';
  $('#claim-button').classList.toggle('hidden', Boolean(deal.owner_id));
  $('#delete-deal-button').classList.toggle('hidden', !isOwner());
  void loadNotes();
  renderStageRail();
  renderStage();
  renderReadiness();
  syncDealSelection();
  window.lucide?.createIcons();
}

/**
 * 단계 자막. **PIPELINE_STAGES 와 개수가 같아야 한다** — 051 로 여섯 번째가 늘었을 때
 * 여기가 다섯 개라 「undefined」가 화면에 찍혔다. 없으면 빈 칸으로 두고 절대 undefined 를
 * 그리지 않는다.
 */
const STAGE_SUBTITLES = Object.freeze([
  '리드·고객 맥락', '42문항·성숙도', '카탈로그·포컬', '패키지·공수', '제안 스크립트', '근거·브리프'
]);

function renderStageRail() {
  const rail = $('#stage-rail');
  rail.innerHTML = state.refs.stages.map((label, index) => `<button type="button" class="stage-button ${index === state.activeStage ? 'active' : ''} ${index < state.deal.stage ? 'done' : ''}" data-stage="${index}" aria-current="${index === state.activeStage ? 'step' : 'false'}">
    <span>${index + 1}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(STAGE_SUBTITLES[index] || '')}</small></div>
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

const STAGE_RENDERERS = [renderIntake, renderFqa, renderSolutions, renderPackages, renderPitch, renderHandoff];

/**
 * 남의 딜·미배정 딜은 모든 입력이 disabled 다. 규칙은 맞지만 **이유가 화면에 없어서**
 * 「전부 회색인데 고장 났나」로 읽힌다. 실제로 첫 사용에서 여기서 멈춘다.
 */
function readOnlyNoticeMarkup() {
  if (!state.deal || isOwner()) return '';
  return state.deal.owner_id
    ? `<div class="readonly-banner"><i data-lucide="lock"></i>
        <span><b>${escapeHtml(state.deal.owner_name || '다른 담당자')}</b>의 딜이라 읽기 전용입니다. 내용은 볼 수 있습니다.</span></div>`
    : `<div class="readonly-banner claimable"><i data-lucide="user-plus"></i>
        <span><b>아직 담당자가 없는 딜입니다.</b> 우상단 <b>「담당하기」</b>를 누르면 수정할 수 있습니다.</span></div>`;
}

function renderStage() {
  const stage = state.activeStage;
  const content = $('#stage-content');
  const carryMessages = [
    '포탈·미팅·시트에서 들어온 고객 맥락을 정리하며 시작합니다.',
    '↑ 들어온 데이터의 고객 맥락을 이어서 AI 준비도 진단을 시작합니다.',
    '↑ 진단 점수와 트랙을 이어서 ISV 조합을 확정합니다.',
    '↑ 선택한 ISV 조합을 이어서 패키지와 공수를 구성합니다.',
    '↑ 앞 단계의 고객·진단·조합·패키지를 한 번에 이어받습니다.',
    '↑ 여기까지의 근거를 배포팀이 이어받습니다. 미팅에서만 알 수 있는 것을 채웁니다.'
  ];
  // Never let a render exception leave the step blank/stuck: on error, show a
  // message and log the real error instead of silently aborting mid-render.
  try {
    const carryBadge = $('#carry-badge')?.querySelector('span');
    if (carryBadge) carryBadge.textContent = carryMessages[stage] || '';
    const renderer = STAGE_RENDERERS[stage];
    content.innerHTML = readOnlyNoticeMarkup() + (renderer ? renderer() : '');
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
 *
 * 이메일까지 여기서 보여준다. 예전에는 편집 가능한 「고객 연락처」 칸이 리드 이메일을
 * 미리 채워 놓아서, 영업이 한 글자만 건드리면 개인정보가 customer_meta 로 복사됐다.
 */
function portalContactMarkup() {
  const name = [state.deal.lead_contact_name, state.deal.lead_contact_title].filter(Boolean).join(' ');
  const parts = [name, state.deal.lead_contact_phone, state.deal.lead_contact];
  if (!parts.some(Boolean)) return '';
  return `<div class="field full"><label>포탈 담당자 <small>(고객 입력 · 편집 불가)</small></label>
    <div class="readonly-value">${escapeHtml(parts.filter(Boolean).join(' · '))}</div></div>
    <p class="field-note">고객이 동의와 함께 남긴 원본이라 딜로 복사하지 않습니다. 영업이 확인한 담당자는 아래에 직접 입력합니다.</p>`;
}

/**
 * 041 이전에 customer_meta.contact 로 저장된 값 중 이메일이 아니어서 못 옮긴 것.
 * 전화번호나 "내선 301" 이 들어 있어 어느 칸으로 가야 할지 우리가 모른다.
 * 눈앞에서 사라지지 않게 읽기 전용으로 남긴다. 0건이 되면 이 함수를 지운다.
 */
function legacyContactMarkup(meta) {
  if (!meta.contact) return '';
  return `<div class="field"><label>이전 연락처 <small>(이관 대상)</small></label>
    <div class="readonly-value">${escapeHtml(meta.contact)}</div></div>`;
}

/** 정체 판정 기준일. 영업 리더 확정 전 잠정값이라 여기 한 곳만 고치면 된다. */
const STALL_DAYS = Object.freeze({ inflowWarn: 30, inflowLate: 60, stageWarn: 14, stageLate: 30 });

/**
 * F/U 가 필요한 딜인가. 시계가 **두 개**다 — 요청 원문이 둘 다 말한다.
 * "유입된 지 오래됐는데 단계에서 너무 오래 안 넘어가면".
 *
 * updated_at 은 쓰지 않는다. 메모 한 글자에도 갱신되므로 모든 딜이 늘 신선해 보인다.
 * inquiry_date 가 없으면 created_at 을 쓰되 **라벨을 「등록」으로 바꾼다** — 없는 것을
 * 있는 척하면 안 된다. stage_changed_at 이 없으면(041 이전 딜) 단계 시계는 안 그린다.
 */
function stallState(deal) {
  const days = (value) => {
    if (!value) return null;
    const at = new Date(value).getTime();
    return Number.isFinite(at) ? Math.floor((Date.now() - at) / 86400000) : null;
  };
  const inflowFrom = deal?.inquiry_date || deal?.created_at;
  const inflowDays = days(deal?.inquiry_date ? `${deal.inquiry_date}T00:00:00` : deal?.created_at);
  const stageDays = days(deal?.stage_changed_at);
  const rank = (value, warn, late) =>
    (value == null ? 0 : value >= late ? 2 : value >= warn ? 1 : 0);
  return {
    inflowDays,
    inflowLabel: deal?.inquiry_date ? '유입' : '등록',
    inflowLevel: rank(inflowDays, STALL_DAYS.inflowWarn, STALL_DAYS.inflowLate),
    stageDays,
    stageLevel: rank(stageDays, STALL_DAYS.stageWarn, STALL_DAYS.stageLate),
    known: Boolean(inflowFrom)
  };
}

const STALL_CLASS = ['', 'warn', 'late'];
const STALL_LEVEL_NAME = ['정상', '주의', '지연'];

/**
 * 칩에 붙는 설명. 숫자를 여기 다시 적지 않고 STALL_DAYS 에서 만든다 —
 * 기준을 고쳤는데 설명만 옛 숫자로 남으면 화면이 거짓말을 한다.
 *
 * title 이 아니라 data-hint 로 넘긴다. 네이티브 툴팁은 1초쯤 기다려야 뜨고
 * 줄바꿈·폭을 못 잡아서 "마우스를 올려도 아무 반응이 없다"로 읽힌다.
 */
function stallHint(kind, level) {
  const [warn, late] = kind === 'inflow'
    ? [STALL_DAYS.inflowWarn, STALL_DAYS.inflowLate]
    : [STALL_DAYS.stageWarn, STALL_DAYS.stageLate];
  return `현재 ${STALL_LEVEL_NAME[level]}\n`
    + `판정 기준\n`
    + `  0~${warn - 1}일   정상\n`
    + `  ${warn}일 이상   주의\n`
    + `  ${late}일 이상   지연`;
}

function stallChipsMarkup(deal) {
  const stall = stallState(deal);
  const chips = [];
  if (stall.inflowDays != null) {
    const head = stall.inflowLabel === '유입'
      ? `문의가 들어온 지 ${stall.inflowDays}일`
      : `딜을 만든 지 ${stall.inflowDays}일 (문의 시점 미입력)`;
    chips.push(`<span class="stall-chip ${STALL_CLASS[stall.inflowLevel]}" tabindex="0" data-hint="${escapeHtml(`${head}\n\n${stallHint('inflow', stall.inflowLevel)}`)}">${stall.inflowLabel} ${stall.inflowDays}일</span>`);
  }
  if (stall.stageDays != null) {
    chips.push(`<span class="stall-chip ${STALL_CLASS[stall.stageLevel]}" tabindex="0" data-hint="${escapeHtml(`현재 단계에 머문 지 ${stall.stageDays}일\n\n${stallHint('stage', stall.stageLevel)}`)}">단계 ${stall.stageDays}일</span>`);
  }
  return chips.join('');
}

/**
 * 결과 링크 열람(048). 정체 시계 옆에 붙는 **세 번째 시계**다 —
 * 「안 열었다」와 「열었는데 3주째 안 움직인다」는 다음 행동이 다르다.
 *
 * ⚠ 「보냄 → 열람」이라고 쓰지 않는다. 발송 수단이 아직 없어서(MAIL_PROVIDER_URL 미정)
 *   **보냈는지를 우리가 모른다.** 지금 아는 것은 링크가 만들어졌다는 것과 열렸는지뿐이라
 *   거기까지만 말한다. 발송 기록이 생기면 「미발송」 상태가 여기 하나 늘어난다.
 */
function resultOpenState(deal) {
  // 044 이전 리드는 링크 자체가 없다. 「미열람」이라고 쓰면 안 연 것처럼 보인다.
  if (!deal || deal.lead_result_open_count == null) return null;
  const days = (value) => {
    const at = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(at) ? Math.floor((Date.now() - at) / 86400000) : null;
  };
  const count = Number(deal.lead_result_open_count) || 0;
  if (!deal.lead_result_opened_at) return { opened: false, count: 0 };
  return {
    opened: true,
    count,
    firstDays: days(deal.lead_result_opened_at),
    lastDays: days(deal.lead_result_last_opened_at || deal.lead_result_opened_at)
  };
}

const dayPhrase = (value) => (value == null ? '' : value === 0 ? '오늘' : `${value}일 전`);

function resultOpenChipMarkup(deal) {
  const open = resultOpenState(deal);
  if (!open) return '';
  if (!open.opened) {
    return `<span class="stall-chip" tabindex="0" data-hint="${escapeHtml(
      '고객이 진단 결과 링크를 아직 열지 않았습니다.\n\n'
      + '링크를 보낸 기록은 아직 남기지 않습니다 —\n'
      + '메일 발송 수단이 붙기 전까지는 「안 보냈다」와\n'
      + '「보냈는데 안 열었다」를 구분할 수 없습니다.')}">결과 미열람</span>`;
  }
  const again = open.count > 1 ? ` · ${open.count}회` : '';
  return `<span class="stall-chip opened" tabindex="0" data-hint="${escapeHtml(
    `처음 ${dayPhrase(open.firstDays)} · 마지막 ${dayPhrase(open.lastDays)} · 모두 ${open.count}회\n\n`
    + '30분 안의 재조회는 한 번으로 셉니다(새로고침).\n'
    + '다시 열어 봤다면 관심이 살아 있다는 신호입니다.')}">결과 열람 ${dayPhrase(open.lastDays)}${again}</span>`;
}

/* ── 회의록 (050) ──────────────────────────────────────────────────────────
 * **단계에 속하지 않는다.** 진단 중에도 견적 중에도 참조하는 딜 전체의 재료다.
 *
 * ⚠ customer_meta.notes(「고객 상황·요청 메모」)와 **저장소가 다르다.** 그쪽은 고객용
 *   키트에 그대로 실리고, 여기는 내부용이다. 섞으면 내부 대화가 고객에게 간다.
 *
 * ⚠ 목록은 머리말만 받는다. 본문은 열 때 한 건씩 받는다.
 */
const NOTE_KIND_OPTIONS = Object.freeze([
  ['meeting', '미팅'], ['call', '통화'], ['mail', '메일'], ['visit', '방문']
]);
const noteKindLabel = (value) => (NOTE_KIND_OPTIONS.find(([key]) => key === value) || [])[1] || '미팅';

/** 오늘 날짜. 새 회의록의 기본값 — 대개 미팅한 날 적는다. */
const today = () => new Date().toISOString().slice(0, 10);

async function loadNotes() {
  state.notes = [];
  renderNotesSummary();
  if (!state.deal) return;
  try {
    state.notes = await api(`/api/hub/deals/${state.deal.id}/notes`);
  } catch (error) {
    // 050 미적용 구간에는 503 이 온다. 딜 화면은 그대로 열려야 한다.
    console.error('[hub] 회의록을 불러오지 못했습니다:', error.message);
  }
  renderNotesSummary();
  if ($('#notes-dialog')?.open) renderNotesList();
}

function renderNotesSummary() {
  const node = document.getElementById('notes-summary');
  if (!node) return;
  const notes = asArray(state.notes);
  if (!notes.length) {
    node.innerHTML = '<span class="notes-empty">아직 없습니다</span>';
    return;
  }
  node.innerHTML = `<b>${notes.length}건</b> · 마지막 ${escapeHtml(notes[0].met_on)}`;
}

function renderNotesList() {
  const list = document.getElementById('notes-list');
  if (!list) return;
  const notes = asArray(state.notes);
  if (!notes.length) {
    list.innerHTML = '<p class="notes-empty">회의록이 없습니다. 오른쪽에 붙여넣고 저장하세요.</p>';
    return;
  }
  list.innerHTML = notes.map((note) => `<button type="button" class="note-item ${state.noteDraft?.id === note.id ? 'active' : ''}" data-note="${escapeHtml(note.id)}">
    <span class="note-date">${escapeHtml(note.met_on)} <em>${escapeHtml(note.kind_label)}</em></span>
    <span class="note-title">${escapeHtml(note.title || '(제목 없음)')}</span>
    <span class="note-preview">${escapeHtml(note.preview)}</span>
    <span class="note-len">${note.length.toLocaleString('en-US')}자</span>
  </button>`).join('');
}

/** 편집칸을 채운다. 새 회의록이면 오늘 날짜로 시작한다. */
function fillNoteEditor(note) {
  state.noteDraft = note;
  $('#note-met-on').value = note?.met_on || today();
  $('#note-kind').value = note?.kind || 'meeting';
  $('#note-title').value = note?.title || '';
  $('#note-body').value = note?.body || '';
  $('#notes-error').textContent = '';
  $('#note-delete').classList.toggle('hidden', !note?.id);
  renderNotesList();
}

async function openNote(id) {
  try {
    fillNoteEditor(await api(`/api/hub/deals/${state.deal.id}/notes/${id}`));
  } catch (error) {
    $('#notes-error').textContent = error.message;
  }
}

async function saveNote() {
  const payload = {
    met_on: $('#note-met-on').value,
    kind: $('#note-kind').value,
    title: $('#note-title').value,
    body: $('#note-body').value
  };
  const id = state.noteDraft?.id;
  try {
    const saved = await api(`/api/hub/deals/${state.deal.id}/notes${id ? `/${id}` : ''}`,
      { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    await loadNotes();
    fillNoteEditor(saved);
    toast(id ? '회의록을 저장했습니다.' : '회의록을 추가했습니다.');
  } catch (error) {
    $('#notes-error').textContent = error.message;
  }
}

async function deleteNote() {
  const id = state.noteDraft?.id;
  if (!id) return;
  try {
    await api(`/api/hub/deals/${state.deal.id}/notes/${id}`, { method: 'DELETE' });
    await loadNotes();
    fillNoteEditor(null);
    toast('회의록을 지웠습니다.');
  } catch (error) {
    $('#notes-error').textContent = error.message;
  }
}

function openNotesDialog() {
  const select = $('#note-kind');
  if (select && !select.options.length) {
    select.innerHTML = NOTE_KIND_OPTIONS.map(([value, label]) =>
      `<option value="${value}">${label}</option>`).join('');
  }
  // 담당자가 아니면 읽기만. 딜 편집과 같은 규칙이다.
  ['#note-met-on', '#note-kind', '#note-title', '#note-body', '#note-save', '#note-delete', '#note-new']
    .forEach((selector) => { const node = $(selector); if (node) node.disabled = !isOwner(); });
  fillNoteEditor(null);
  renderNotesList();
  // 「근거 가져오기」로 열렸으면 발췌 줄을 띄운다. 그냥 열었으면 안 보인다.
  const pin = $('#notes-pin-row');
  if (pin) {
    pin.classList.toggle('hidden', !state.pinTarget);
    const label = HANDOFF_FIELDS.find((f) => f.key === state.pinTarget)?.label || '';
    const target = $('#notes-pin-target');
    if (target) target.textContent = label;
  }
  $('#notes-dialog').showModal();
  window.lucide?.createIcons();
}

/**
 * 원문에서 드래그한 문장을 인계 칸에 꽂는다.
 *
 * ⚠ **출처가 없으면 안 꽂는다.** 되짚을 수 없는 인용은 근거가 아니라 그냥 옮겨 적은
 *   문장이다 — lib/meeting-notes.js 의 buildQuote 와 같은 규칙을 화면에서도 지킨다.
 *
 * ⚠ 인용은 **복사한다.** 원문 참조만 두면 원문이 고쳐졌을 때 근거가 조용히 바뀐다.
 */
const QUOTE_LIMIT = 400;
function pinSelectionToField() {
  const field = state.pinTarget;
  const note = state.noteDraft;
  const raw = String(window.getSelection?.() || '').replace(/\s+/g, ' ').trim();
  if (!field) return;
  if (!note?.id || !note?.met_on) {
    $('#notes-error').textContent = '먼저 왼쪽에서 회의록을 고르세요.';
    return;
  }
  if (!raw) {
    $('#notes-error').textContent = '원문에서 가져올 문장을 드래그한 뒤 눌러주세요.';
    return;
  }
  saveHandoff((next) => {
    const entry = next[field] && typeof next[field] === 'object' ? next[field] : {};
    next[field] = {
      value: entry.value || '',
      quote: {
        quote: raw.length > QUOTE_LIMIT ? `${raw.slice(0, QUOTE_LIMIT)}…` : raw,
        note_id: note.id, met_on: note.met_on,
        note_title: note.title || '', source: 'human'
      }
    };
  });
  state.pinTarget = null;
  $('#notes-dialog').close();
  renderStage();
  toast('근거를 가져왔습니다.');
}

/** 계산 결과만. 입력칸과 분리해야 문의 시점을 고칠 때 포커스를 잃지 않는다. */
function stallSummaryMarkup() {
  const open = resultOpenChipMarkup(state.deal);
  const chips = stallChipsMarkup(state.deal);
  if (!chips) {
    return `<span class="stall-chip">문의 시점을 넣으면 F/U 시점이 계산됩니다.</span>${open}`;
  }
  const stall = stallState(state.deal);
  const note = stall.stageDays == null
    ? ' <span class="stall-chip">단계 이동 기록은 다음 이동부터 쌓입니다.</span>' : '';
  return chips + open + note;
}

/**
 * 정체 표시를 **두 곳에 같이** 갱신한다 — STEP01 입력칸 옆과 우측 컨텍스트 카드.
 *
 * 컨텍스트 카드는 다섯 단계 내내 보이고 STEP01 것은 문의 시점을 고칠 때의 즉시
 * 피드백이다. 갱신을 부르는 쪽에 맡기면 한쪽만 옛 숫자로 남는다.
 */
function renderStallSummary() {
  const node = document.getElementById('stall-summary');
  if (node) node.innerHTML = stallSummaryMarkup();
  const context = document.getElementById('context-stall');
  if (context) context.innerHTML = state.deal ? (stallChipsMarkup(state.deal) || '—') : '—';
  const opened = document.getElementById('context-result-open');
  if (opened) opened.innerHTML = state.deal ? (resultOpenChipMarkup(state.deal) || '—') : '—';
}

const MSP_LABELS = Object.freeze({ yes: 'MSP 운영 중', no: '미운영', unknown: '확인 필요' });

/** 도입 희망 시기(045). 진단 폼과 같은 값이라야 고객이 고른 것이 그대로 보인다. */
const TIMELINE_OPTIONS = Object.freeze([
  ['3m', '3개월 안'], ['6m', '6개월 안'], ['1y', '1년 안'], ['unknown', '아직 미정']
]);
const timelineLabel = (value) =>
  (TIMELINE_OPTIONS.find(([key]) => key === value) || [])[1] || '';

/** 문의 제품 선택 칩. 카탈로그에서 내려간 id 도 조용히 감추지 않는다. */
function inquiryProductChipsMarkup() {
  const picked = asArray(state.deal?.inquiry_products);
  if (!picked.length) return '<span class="inquiry-chip unknown">선택 안 함</span>';
  const byId = new Map(state.refs.solutions.map((item) => [item.id, item]));
  return picked.map((id) => (byId.has(id)
    ? `<span class="inquiry-chip">${escapeHtml(byId.get(id).name)}</span>`
    : '<span class="inquiry-chip unknown">카탈로그에 없는 제품</span>')).join('');
}

/**
 * 문의 제품 체크박스. STEP03 의 후보 카드를 재사용하지 않는다 —
 * 거기는 판정 데이터 없는 솔루션을 감추는데, 문의 제품에는 그 규칙이 **틀리다.**
 * 고객이 판정 데이터 없는 제품을 물어본 것 자체가 카탈로그 보강 신호다.
 */
function inquiryProductsMarkup() {
  const picked = new Set(asArray(state.deal?.inquiry_products));
  const boxes = state.refs.solutions.map((item) => `<label><input type="checkbox"
    data-inquiry-product="${escapeHtml(item.id)}" ${picked.has(item.id) ? 'checked' : ''} ${disabledAttr()}>${escapeHtml(item.name)}</label>`).join('');
  return `<details class="inquiry-products">
    <summary>문의 제품 <span id="inquiry-product-chips">${inquiryProductChipsMarkup()}</span></summary>
    <div class="inquiry-picks">${boxes || '<span class="field-note">카탈로그를 불러오는 중입니다.</span>'}</div>
  </details>`;
}

/** 요약만 갈아끼운다. renderStage() 를 부르면 <details> 가 접히고 스크롤이 튄다. */
function renderInquiryProductChips() {
  const node = document.getElementById('inquiry-product-chips');
  if (node) node.innerHTML = inquiryProductChipsMarkup();
}

/**
 * 접수 시점의 스팸 의심 신호(046). **판정이 아니라 신호다.**
 *
 * 왜 걸렸는지 보여줘야 영업이 고르고, 기준이 헛돌 때 우리가 고칠 수 있다.
 * 개수만 보여주면 "스팸 점수 0.7" 과 다를 게 없다.
 */
function spamSignalMarkup() {
  const signals = asArray(state.deal?.lead_spam_signals);
  if (!signals.length) return '';
  return `<div class="field full"><label>접수 확인 필요 <small>(자동 감지 · 참고용)</small></label>
    <div class="readonly-value spam-note">${signals.map((s2) =>
      `<span>${escapeHtml(s2.label)}${s2.hit ? ` — ${escapeHtml(s2.hit)}` : ''}</span>`).join('')}</div>
    <p class="field-note">자동 감지라 틀릴 수 있습니다. 실제 문의라면 그대로 진행하고, 아니면 우상단에서 딜을 삭제하세요.</p></div>`;
}

function renderIntake() {
  const meta = state.deal.customer_meta || {};
  const deal = state.deal;
  const mspOption = (value) =>
    `<option value="${value}" ${(deal.msp_status || 'unknown') === value ? 'selected' : ''}>${MSP_LABELS[value]}</option>`;
  return `${stageHeader('01', '들어온 데이터', '포탈·미팅·시트에서 들어온 고객 맥락을 한곳에 정리합니다. 이 정보는 이후 모든 단계에 그대로 이어집니다.')}
    <div class="field-group"><h3>고객사</h3><div class="form-grid">
      <div class="field"><label for="deal-customer">고객사</label><input id="deal-customer" type="text" data-deal-field="customer" value="${escapeHtml(deal.customer)}" ${disabledAttr()}></div>
      <div class="field"><label for="deal-industry">업종</label><input id="deal-industry" type="text" data-meta-field="industry" value="${escapeHtml(meta.industry || '')}" placeholder="금융 / 제조 / 공공" ${disabledAttr()}></div>
      <div class="field"><label for="deal-company-size">조직 규모</label><select id="deal-company-size" data-meta-field="companySize" ${disabledAttr()}><option value="">선택</option>${companySizeOptions(meta.companySize)}</select></div>
      <div class="field"><label for="deal-target-users">도입 대상</label><input id="deal-target-users" type="text" data-meta-field="targetUsers" value="${escapeHtml(meta.targetUsers || '')}" placeholder="예: 전사 2,000명 / 개발조직 200명" ${disabledAttr()}></div>
    </div></div>

    <div class="field-group"><h3>고객 담당자</h3><div class="form-grid">
      ${portalContactMarkup()}
      <div class="field"><label for="deal-contact-name">이름</label><input id="deal-contact-name" type="text" data-deal-field="customer_contact_name" value="${escapeHtml(deal.customer_contact_name || '')}" placeholder="예: 김디지털" ${disabledAttr()}></div>
      <div class="field"><label for="deal-contact-dept">소속 부서</label><input id="deal-contact-dept" type="text" data-deal-field="customer_contact_dept" value="${escapeHtml(deal.customer_contact_dept || '')}" placeholder="예: 디지털혁신본부" ${disabledAttr()}></div>
      <div class="field"><label for="deal-contact-title">직함</label><input id="deal-contact-title" type="text" data-deal-field="customer_contact_title" value="${escapeHtml(deal.customer_contact_title || '')}" placeholder="예: 상무 / 팀장" ${disabledAttr()}></div>
      <div class="field"><label for="deal-contact-email">이메일</label><input id="deal-contact-email" type="email" data-deal-field="customer_contact_email" value="${escapeHtml(deal.customer_contact_email || '')}" placeholder="name@company.com" ${disabledAttr()}></div>
      ${legacyContactMarkup(meta)}
      ${spamSignalMarkup()}
    </div></div>

    <div class="field-group"><h3>딜 관리 (MZC)</h3><div class="form-grid">
      <div class="field"><label for="deal-mzc-sales">MZC Sales</label><input id="deal-mzc-sales" type="text" data-deal-field="mzc_sales" value="${escapeHtml(deal.mzc_sales || '')}" placeholder="담당 코어세일즈" ${disabledAttr()}></div>
      <div class="field"><label for="deal-msp">MSP 여부</label><select id="deal-msp" data-deal-field="msp_status" ${disabledAttr()}>${mspOption('unknown')}${mspOption('yes')}${mspOption('no')}</select></div>
      <div class="field"><label for="deal-inquiry-date">문의 유입 시점</label><input id="deal-inquiry-date" type="date" data-deal-field="inquiry_date" value="${escapeHtml(deal.inquiry_date || '')}" ${disabledAttr()}></div>
      <div class="field"><label for="deal-timeline">도입 희망 시기</label><select id="deal-timeline" data-meta-field="timeline" ${disabledAttr()}><option value="">미정</option>${TIMELINE_OPTIONS.map(([value, label]) =>
        `<option value="${value}" ${meta.timeline === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>유입 경로</label><div class="readonly-value">${escapeHtml(sourceNames[deal.source] || deal.source || '—')}</div></div>
      <div id="stall-summary" class="stall-summary">${stallSummaryMarkup()}</div>
    </div></div>

    <div class="field-group"><h3>문의 내용</h3><div class="form-grid">
      ${inquiryProductsMarkup()}
      <div class="field"><label for="deal-security-stack">보안 게이트웨이 <small>(영업 확인)</small></label><select id="deal-security-stack" data-meta-field="securityStack" ${disabledAttr()}><option value="">미정</option><option value="none" ${meta.securityStack === 'none' ? 'selected' : ''}>별도 SWG 없음</option><option value="existing" ${meta.securityStack === 'existing' ? 'selected' : ''}>있으나 제품 미확인 (고객 응답)</option><option value="managed" ${meta.securityStack === 'managed' ? 'selected' : ''}>AI 전용 정책까지 운영 (고객 응답)</option><option value="zscaler" ${meta.securityStack === 'zscaler' ? 'selected' : ''}>Zscaler</option><option value="other-swg" ${meta.securityStack === 'other-swg' ? 'selected' : ''}>타사 SWG</option></select></div>
      <div class="field"><label for="deal-investment">투자 여력</label><select id="deal-investment" data-meta-field="investment" ${disabledAttr()}><option value="">미정</option><option value="low" ${meta.investment === 'low' ? 'selected' : ''}>제한적</option><option value="medium" ${meta.investment === 'medium' ? 'selected' : ''}>PoC 예산 확보</option><option value="high" ${meta.investment === 'high' ? 'selected' : ''}>전사 확장 가능</option></select></div>
      <div class="field full"><label for="deal-notes">고객 상황·요청 메모 <small>(고객에게 그대로 전달됩니다)</small></label><textarea id="deal-notes" data-meta-field="notes" ${disabledAttr()} placeholder="미팅에서 확인한 문제, 의사결정자, 일정 등을 적어주세요.">${escapeHtml(meta.notes || state.deal.lead_message || '')}</textarea>
      <p class="field-note">이 칸은 <b>고객용 키트에 그대로 실립니다.</b> 내부 판단·미팅 원문은 우측 「회의록」에 적으세요.</p></div>
    </div></div>`;
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
/**
 * 응답이 하나도 없는 딜에 **먼저 보여주는 것.**
 *
 * 영업이 직접 만든 딜은 아홉 칸이 전부 비어서 시작한다. 그 상태로 STEP02 에 들어오면
 * **42문항짜리 벽**을 만나고 거기서 끝난다 — 실제 채택이 여기서 멈춘다.
 *
 * 이 시스템의 정상 경로는 **고객이 진단을 답하고 들어오는 것**이다. 영업이 42개를
 * 대신 찍는 건 차선책이라, 화면이 그 순서를 먼저 말해야 한다.
 */
function readinessInviteMarkup() {
  const link = `${location.origin}/readiness`;
  return `<section class="rd-invite">
    <div>
      <b>아직 진단 응답이 없습니다.</b>
      <p>이 딜은 <b>고객이 42문항을 답하면 저절로 채워집니다</b> — 축 점수·우선 개선 영역·
         추천 후보가 한 번에 들어옵니다. 링크를 고객에게 보내주세요.</p>
      <code>${escapeHtml(link)}</code>
    </div>
    <div class="rd-invite-actions">
      <button type="button" id="copy-readiness-link" class="primary-button" data-link="${escapeHtml(link)}"><i data-lucide="link"></i> 링크 복사</button>
      <a class="ghost-button" href="/readiness" target="_blank" rel="noopener"><i data-lucide="external-link"></i> 미리 보기</a>
    </div>
    <p class="field-note">미팅에서 직접 확인한 값이 있으면 아래 「직접 채우기」를 펼쳐 넣어도 됩니다.</p>
  </section>`;
}

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
  // 고객 응답이든 영업이 넣은 값이든, 하나라도 있으면 「채우는 중」이라 문항을 펼친다.
  const answered = Object.keys(state.deal.readiness_scores || {}).length > 0;
  const trackOptions = state.refs.tracks.map((track) => `<option value="${track.id}" ${state.deal.track === track.id ? 'selected' : ''}>${track.id} · ${escapeHtml(track.name)}</option>`).join('');
  return `${stageHeader('02', 'AI 준비도 진단', '6대 영역 42문항으로 고객의 현재 수준을 확인합니다. 고객이 진단 링크로 답하면 여기가 저절로 채워집니다.')}
    ${renderReadinessPanel()}
    <div class="field" style="margin-bottom:18px"><label for="deal-track">딜 트랙</label><select id="deal-track" ${disabledAttr()}><option value="">트랙 선택</option>${trackOptions}</select></div>
    ${renderReadinessGaps()}
    ${answered ? `<div class="rd-groups">${renderReadinessQuestions()}</div>`
    // 응답이 없으면 42문항을 접는다. 펼쳐 두면 그게 「지금 할 일」로 보인다.
    : `${readinessInviteMarkup()}
      <details class="rd-manual"><summary>직접 채우기 <small>(42문항)</small></summary>
        <div class="rd-groups">${renderReadinessQuestions()}</div>
      </details>`}`;
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

/**
 * 고객이 물어봤는데 조합에 안 들어간 제품.
 *
 * 문의 ≠ 제안이라 자동으로 넣지 않는다. 다만 **물어본 걸 빼고 제안하면 대화가
 * 어긋나므로** 한 줄로 알려 준다. 자동 추가·경고 배지까지는 만들지 않는다.
 */
function inquiryGapMarkup() {
  const inCombo = new Set(asArray(state.deal?.isv_combo));
  const byId = new Map(state.refs.solutions.map((item) => [item.id, item]));
  const missing = asArray(state.deal?.inquiry_products)
    .filter((id) => !inCombo.has(id))
    .map((id) => byId.get(id)?.name || id);
  if (!missing.length) return '';
  return `<p class="catalog-hidden-note">고객이 물어본 제품 중 조합에 없는 것 — ${escapeHtml(missing.join(', '))}</p>`;
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
    ${inquiryGapMarkup()}
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

/**
 * 좌석 수를 화면 세 곳에 한꺼번에 반영한다.
 *
 * 라이선스 입력칸 · 시뮬레이터 바 · 시뮬레이터 숫자칸이 전부 같은
 * `customer_meta.sim.seats` 를 읽는다. **한 곳만 갱신하면 저장은 됐는데 눈에는
 * 안 보인다** — 그 상태로 PDF 를 뽑으면 화면에서 본 금액과 문서 금액이 갈린다.
 * 갱신을 부르는 쪽에 맡기지 않고 여기 한 곳에 모은다.
 *
 * `source` 는 지금 사람이 만지고 있는 칸이다. 그 칸의 value 를 되쓰면 커서가 튄다.
 */
function syncSeatInputs(seats, source) {
  const range = document.getElementById('deal-sim-seat-range');
  const num = document.getElementById('deal-sim-seat-num');
  const licenseInput = $('[data-license="seats"]');
  if (source !== 'range' && range) range.value = Math.min(Number(range.max), Math.max(Number(range.min), seats));
  if (source !== 'num' && num) num.value = seats;
  if (source !== 'license' && licenseInput) licenseInput.value = seats;
  renderLicenseCalc();
  renderDealSimulator();
}

/** 시트 수는 ISV 좌석 라이선스 계산과 공유한다. 두 곳에 따로 두면 값이 갈린다. */
function setLicenseField(key, value) {
  const meta = { ...(state.deal.customer_meta || {}) };
  meta.sim = { ...(meta.sim || {}), [key]: Number(value) || 0 };
  state.deal.customer_meta = meta;
  if (key === 'seats') syncSeatInputs(meta.sim.seats, 'license');
  else renderLicenseCalc();
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
  syncSeatInputs(seats, source);
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
 * §5 유즈케이스. 「- **UC1. …**」 라벨과 바로 아래 「기대효과」 한 줄만 뽑는다.
 *
 * 고객 문서에 들어갈 것이라 본문을 통째로 넣지 않는다 — 카탈로그 한 절이 수백 자라
 * 그대로 붙이면 읽히지 않는다. 「무엇을 / 무엇이 좋아지나」 두 줄이면 된다.
 */
function parseUseCases(section5) {
  const lines = String(section5 || '').split('\n');
  const out = [];
  lines.forEach((line, index) => {
    const label = line.match(/^\s*-\s*\*\*(UC\d+[.\s][^*]*)\*\*/);
    if (!label) return;
    const effect = (lines[index + 1] || '').match(/기대효과\s*[:：]\s*(.+)$/);
    out.push({ label: label[1].trim(), effect: effect ? effect[1].trim() : '' });
  });
  return out.slice(0, 2);
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
  // 조합(우리가 제안한 것)과 문의 제품(고객이 물어본 것)을 **둘 다** 받는다.
  // 고객용 키트가 「문의하신 제품」 절을 쓰려면 조합에 없는 것도 있어야 한다.
  const wanted = new Set([
    ...asArray(state.deal?.isv_combo),
    ...asArray(state.deal?.inquiry_products)
  ]);
  const slugs = state.refs.solutions
    .filter((s2) => wanted.has(s2.id))
    .map((s2) => s2.slug).filter(Boolean);
  const missing = slugs.filter((slug) => !(slug in state.pitchSources));
  if (!missing.length) return;

  await Promise.all(missing.map(async (slug) => {
    try {
      const row = await api(`/api/solutions/${encodeURIComponent(slug)}`);
      state.pitchSources[slug] = {
        strengths: parseStrengths(row?.sections?.['1']),
        talkTracks: parseTalkTracks(row?.sections?.['8']),
        // 고객용 키트가 쓴다. 화법(talkTracks)은 영업 대본이라 **거기 안 들어간다**.
        useCases: parseUseCases(row?.sections?.['5']),
        listPrice: (row?.list_price && typeof row.list_price === 'object') ? row.list_price : {}
      };
    } catch (error) {
      console.error(`Pitch source failed (${slug}):`, error.message);
      state.pitchSources[slug] = { strengths: [], talkTracks: [], useCases: [], listPrice: {} };
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
    // 직함이 있으면 Top-down 딜인지 여기서 드러난다. 제안 톤이 달라진다.
    line('\n담당', [deal.customer_contact_name, deal.customer_contact_title,
      deal.customer_contact_dept].filter(Boolean).join(' · ')),
    line('\n문의', inquiryProductNames().join(' · ')),
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

  // 레퍼런스. 미팅에서 반드시 나오는 질문이라 대화 가이드에도 넣는다.
  // 실명은 서버가 승인된 것만 내려보낸다(047).
  const cases = asArray(state.reco?.caseStudies);
  const reference = cases.length ? block('5-1. 비슷한 사례', cases.map((item) =>
    `${item.customer} — ${item.headline}`
    + (item.outcome ? `\n   ${item.outcome}` : '')).join('\n')) : '';

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
    line('고객   ', [meta.industry, meta.companySize, meta.targetUsers,
      [deal.customer_contact_name, deal.customer_contact_title].filter(Boolean).join(' ')
    ].filter(Boolean).join(' · ')),
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

  return [head, summary, opening, context, proposal, size, risk, reference, next].join('\n') + appendix;
}

/**
 * 내려받을 리포트.
 *
 * 단계마다 내용은 다르지만 **머리말은 같다** — 어느 파일을 열어도 어느 고객의
 * 어느 단계인지가 첫 화면에 있다. 여러 단계를 뽑아 붙여 놓았을 때 섞이지 않는다.
 *
 * 화면에 없는 숫자를 만들지 않는다. 점수는 서버가 낸 값을 그대로 쓴다.
 */
/**
 * 아직 확인 안 된 것들. 지금 **네 곳에 흩어져 있다.**
 *
 * 인계 문서의 핵심 절이 될 자리라 미리 한 곳에 모아 둔다(~/CC/deployment-Brief 의
 * evidence_item.status='open' 에 해당한다). **고객용 키트에는 안 쓴다** — 고객에게
 * "우리가 아직 모르는 것" 목록을 보내는 문서가 아니다.
 */
function collectOpenItems() {
  const deal = state.deal || {};
  const totals = deal.readiness_totals || {};
  const open = [];

  const unansweredCount = Number(totals.totalCount || 0) - Number(totals.answeredCount || 0);
  if (unansweredCount > 0) open.push(`42문항 중 ${unansweredCount}개가 미응답입니다.`);

  asArray(deal.assessment_totals?.unanswered).forEach((area) => {
    const ref = asArray(state.refs.assessmentAreas).find((a) => a.id === area);
    open.push(`평가영역 ${area}${ref ? ` ${ref.name}` : ''} — 아직 확인되지 않았습니다.`);
  });

  // 미확인 전제. STEP05 가 이미 같은 방식으로 모으고 있어 그 경로를 그대로 쓴다.
  const confirmed = deal.prereq_confirmations && typeof deal.prereq_confirmations === 'object'
    ? deal.prereq_confirmations : {};
  ['prepare', 'adopt', 'operate']
    .flatMap((key) => asArray(state.reco?.proposal?.[key]))
    .concat(asArray(state.reco?.needsConfirmation))
    .forEach((item) => {
      asArray(item.prerequisites?.pendingManual).forEach((prereq) => {
        if (!confirmed[item.slug || item.id]?.[prereq.label]) {
          open.push(`${item.name} 전제 미확인 — ${prereq.label}`);
        }
      });
    });

  const quote = computeQuote();
  if (quote.hasPlaceholder) open.push('서비스 MD 단가가 확정되지 않아 금액이 별도협의입니다.');

  return open;
}

/**
 * 고객용 핸드오프 키트. 미팅 뒤에 **고객에게 보내는** 문서다.
 *
 * ⚠ 내부 문구를 지우는 방식이 아니다. **애초에 안 부른다.** 플래그 하나로 내부용과
 *   갈라 쓰면 언젠가 반드시 샌다 — 이 함수는 opinion·tech_note·급·포컬·MZC Sales·
 *   MSP·정체 시계·우리 단가·담당자 연락처를 **읽지 않는다.**
 *
 * ⚠ 금액은 실단가가 확정될 때까지 「별도협의」로만 나간다. 지금 시스템의 MD 단가는
 *   전부 price_is_placeholder 다.
 */
function buildCustomerKit() {
  const deal = state.deal;
  const meta = deal.customer_meta || {};
  const totals = deal.readiness_totals || {};
  const byId = new Map(state.refs.solutions.map((item) => [item.id, item]));
  const bySlug = (slug) => state.pitchSources[slug] || {};

  const block = (title, body) => `\n## ${title}\n\n${body}`;
  const bullet = (list) => list.filter(Boolean).map((t) => `- ${t}`).join('\n');

  // ── 1. 진단 결과 ────────────────────────────────────────────
  const avg = Number(totals.average);
  const areaRows = asArray(totals.areas)
    .map((a) => `| ${a.name} | ${Number(a.score).toFixed(2)} / 5 | ${a.score < 3 ? '보완 필요' : a.score < 4 ? '보통' : '양호'} |`)
    .join('\n');

  // 고객이 고른 문장을 그대로 인용한다. 숫자만 보내면 "그건 해석이죠" 로 끝난다.
  const priorities = asArray(totals.priorities).map((p, index) =>
    `### ${index + 1}순위 · ${p.name} (${Number(p.score).toFixed(2)} / 5)\n\n`
    + asArray(p.items).map((item) =>
      `- **${item.code}** ${item.text}\n  - ${item.score}점 — ${item.rubric}`
      + (item.fix ? `\n  - **무엇부터** ${item.fix}` : '')).join('\n')).join('\n\n');

  const diagnosis = Number.isFinite(avg)
    ? `| | |\n|---|---|\n| 종합 점수 | **${avg.toFixed(2)} / 5.00** |`
      + (totals.maturity ? `\n| 성숙도 | **Level ${totals.maturity.level}. ${totals.maturity.name}** — ${totals.maturity.note} |` : '')
      + (areaRows ? `\n\n| 영역 | 점수 | 판정 |\n|---|---|---|\n${areaRows}` : '')
      + (totals.insight ? `\n\n${totals.insight}` : '')
      + (priorities ? `\n\n### 우선 개선 영역\n\n${priorities}` : '')
    : '_진단이 아직 완료되지 않았습니다._';

  // ── 2. 이렇게 이해했습니다 ──────────────────────────────────
  const context = bullet([
    meta.industry && `업종 — ${meta.industry}`,
    meta.companySize && `조직 규모 — ${meta.companySize}`,
    meta.targetUsers && `도입 대상 — ${meta.targetUsers}`
  ]) || '_확인된 내용이 없습니다._';
  const notes = meta.notes || deal.lead_message;

  // ── 3. 문의하신 제품 ────────────────────────────────────────
  // 041 의 inquiry_products. 고객이 물어본 것이라 조합(isv_combo)과 다를 수 있다.
  const asked = asArray(deal.inquiry_products).map((id) => byId.get(id)).filter(Boolean)
    .map((item) => {
      const src = bySlug(item.slug);
      const price = src.listPrice || {};
      const lines = [`### ${item.name}${item.category ? ` · ${item.category}` : ''}`];
      if (item.jtbd) lines.push(item.jtbd);
      if (asArray(src.strengths).length) {
        lines.push('', ...asArray(src.strengths).map((text) => `- ${text}`));
      }
      if (asArray(src.useCases).length) {
        lines.push('', '**활용 예**', ...asArray(src.useCases)
          .map((uc) => `- ${uc.label}${uc.effect ? ` — ${uc.effect}` : ''}`));
      }
      // 벤더 공시가만. 우리 단가(unit_price)는 넣지 않는다.
      if (price.status === 'published' && asArray(price.items).length) {
        lines.push('', '**벤더 공시가**', ...asArray(price.items).slice(0, 4).map((row) =>
          `- ${row.plan} — ${row.amount === null || row.amount === undefined
            ? '견적' : `${row.currency || ''} ${Number(row.amount).toLocaleString('en-US')} / ${row.unit || ''}`}`
          + (row.terms ? ` (${row.terms})` : '')));
        if (price.source) lines.push(`  출처 ${price.source}`);
      } else if (price.status === 'quote') {
        lines.push('', '**가격** — 공시가가 없어 별도 견적이 필요합니다.');
      }
      return lines.join('\n');
    }).join('\n\n');

  // ── 4. 권고 구성 ────────────────────────────────────────────
  const packageMap = new Map(state.refs.packages.map((pkg) => [pkg.id, pkg]));
  const chosenPackages = asArray(deal.packages)
    .map((item) => packageMap.get(typeof item === 'string' ? item : item.id)).filter(Boolean);
  const combo = asArray(deal.isv_combo).map((id) => byId.get(id)).filter(Boolean);

  const proposal = [
    combo.length ? `**구성 제품**\n${bullet(combo.map((item) =>
      `${item.name}${item.jtbd ? ` — ${item.jtbd}` : ''}`))}` : '',
    chosenPackages.length ? `\n**실행 범위**\n${bullet(chosenPackages.map((pkg) =>
      `${pkg.name} (${pkg.period || '기간 협의'})${pkg.target ? ` — ${pkg.target}` : ''}`))}` : ''
  ].filter(Boolean).join('\n') || '_구성을 확정하는 중입니다._';

  // ── 5. 예상 규모 ────────────────────────────────────────────
  const lic = computeLicense();
  const quote = computeQuote();
  const totalMd = quote.rows.reduce((sum, row) => sum + row.totalMd, 0);
  const size = [
    `라이선스 — ChatGPT ${lic.seats}석 기준 연 ${formatKRW(lic.annualKrw)} (1 USD = ${lic.fx.toLocaleString('ko-KR')}원)`,
    totalMd ? `서비스 — 약 ${totalMd} MD · **금액은 범위 확정 후 별도 산정합니다.**` : '',
    '',
    '※ Enterprise 가격과 최소 시트는 OpenAI 협의사항이라 확정 금액이 아닙니다.',
    '※ 사용량 변동이 큰 API 는 포함하지 않았습니다.'
  ].filter(Boolean).join('\n');

  // ── 레퍼런스 ────────────────────────────────────────────────
  // 매칭이 0건이면 절 자체가 안 나온다. 억지로 붙인 사례가 안 붙인 것보다 나쁘다.
  // 실명 여부는 서버가 이미 갈라서 보낸다 — 화면은 customer 를 그대로 쓴다.
  const caseStudies = asArray(state.reco?.caseStudies).map((item) =>
    `### ${item.headline}\n\n${[
      item.customer ? `**${item.customer}**` : '',
      item.situation, item.what_we_did, item.outcome
    ].filter(Boolean).join('\n\n')}`).join('\n\n');

  const openCount = collectOpenItems().length;

  return `# ${deal.customer} — AI 도입 검토 정리

| | |
|---|---|
| 작성일 | ${new Date().toISOString().slice(0, 10)} |
| 고객사 | ${deal.customer} |
${block('1. 진단 결과', diagnosis)}
${block('2. 이렇게 이해했습니다', context + (notes ? `\n\n${notes}` : ''))}
${asked ? block('3. 문의하신 제품', asked) : ''}
${block('4. 권고 구성', proposal)}
${caseStudies ? block('5. 비슷한 사례', caseStudies) : ''}
${block(caseStudies ? '6. 예상 규모' : '5. 예상 규모', size)}
${block(caseStudies ? '7. 다음 단계' : '6. 다음 단계', bullet([
  '이 정리 내용에 빠지거나 다른 부분을 알려주세요.',
  openCount ? '함께 확인이 필요한 항목이 있어 다음 미팅에서 여쭙겠습니다.' : '',
  '범위가 정해지면 일정과 금액을 확정해 드립니다.'
]))}

---

진단 결과는 자가 진단 기반의 참고용입니다.
실제 실행 범위는 데이터·보안·업무 환경을 함께 검토해 확정합니다.`;
}

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
/** 문의 제품 이름. 카탈로그에서 내려간 id 는 조용히 감추지 않는다. */
function inquiryProductNames() {
  const byId = new Map(state.refs.solutions.map((item) => [item.id, item]));
  return asArray(state.deal?.inquiry_products)
    .map((id) => byId.get(id)?.name || `${id} (카탈로그에 없음)`);
}

/** 문서용 정체 한 줄. 화면 칩과 같은 계산을 쓴다 — 두 번 계산하면 숫자가 갈린다. */
function stallReportLine() {
  const stall = stallState(state.deal);
  const parts = [];
  if (stall.inflowDays != null) parts.push(`${stall.inflowLabel} ${stall.inflowDays}일 경과`);
  if (stall.stageDays != null) parts.push(`현재 단계 ${stall.stageDays}일`);
  return parts.join(' · ') || '문의 시점 미입력';
}

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
| 문의 유입 시점 | ${state.deal.inquiry_date || '—'} |
| 도입 희망 시기 | ${timelineLabel(meta.timeline) || '—'} |
| 문의 제품 | ${inquiryProductNames().join(' · ') || '—'} |

## 고객 담당자

| 항목 | 값 |
|---|---|
| 이름 | ${state.deal.customer_contact_name || '—'} |
| 소속 부서 | ${state.deal.customer_contact_dept || '—'} |
| 직함 | ${state.deal.customer_contact_title || '—'} |
| 이메일 | ${state.deal.customer_contact_email || '—'} |

## 딜 관리 (MZC)

| 항목 | 값 |
|---|---|
| MZC Sales | ${state.deal.mzc_sales || '—'} |
| MSP 여부 | ${MSP_LABELS[state.deal.msp_status] || MSP_LABELS.unknown} |
| 진행 상황 | ${stallReportLine()} |

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

/**
 * 인계 산출물. **문서 규칙은 lib/handoff-doc.js 한 곳에 있다** — 화면이 따로 짜면
 * 영업이 보는 문서와 검사가 보는 문서가 갈린다.
 *
 * 넷을 한 번에 낸다 — 브리프 · 인터뷰 가이드 · 근거 격차 요약 · 스냅샷 JSON.
 * 셋은 사람이 읽고 하나는 배포 단계(deployment-Brief)가 읽는다.
 */
function handoffContext() {
  return {
    deal: state.deal,
    handoff: handoffOf(),
    notes: asArray(state.notes),
    openItems: collectOpenItems(),
    today: new Date().toISOString().slice(0, 10)
  };
}

function exportHandoff() {
  const lib = window.IssuHandoff;
  if (!lib) { toast('인계 문서 모듈을 불러오지 못했습니다.'); return; }
  const ctx = handoffContext();
  const base = `${state.deal.customer || '고객'}_${ctx.today}`;
  const recommendation = lib.recommendApproach(ctx);
  const full = { ...ctx, recommendation };

  // ⚠ **문서 셋을 한 장으로 이어 붙인다.** IssuReport.pdf 는 팝업을 열어 인쇄하는데
  //   브라우저가 팝업을 하나만 허용한다 — 따로 부르면 둘째부터 조용히 막힌다.
  //   PRINT_CSS 의 h1:not(:first-of-type) 이 각 문서를 새 페이지에서 시작시킨다.
  const paper = [
    lib.buildBrief(full),
    lib.buildInterviewGuide(full),
    lib.buildEvidenceSummary(full)
  ].join('\n\n');
  window.IssuReport.pdf(`${state.deal.customer} — 배포 인계 (브리프·인터뷰·근거격차)`, paper);
  // 스냅샷만 따로 내려받는다. 사람이 읽는 문서가 아니라 배포 단계가 읽는 데이터라
  // PDF 로 만들면 쓸 수 없다.
  downloadJson(lib.buildHandoffExport(full), `${base}_handoff`);

  toast(`인계 브리프를 만들었습니다 (PDF 3부 + 스냅샷). 권고 — ${recommendation.label}`);
}

/** 스냅샷은 사람이 읽는 문서가 아니라 배포 단계가 읽는다. JSON 그대로 내려받는다. */
function downloadJson(data, baseName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ── STEP 06 · 배포 인계 (051) ────────────────────────────────────────────
 * Deployment Brief §A 14필드 중 **시스템이 모르는 여섯 칸**만 받는다. 나머지는
 * 진단·구성·문의 제품·전제에서 끌어온다 — 이미 아는 것을 다시 물으면 아무도 안 채운다.
 *
 * ⚠ **비어 있는 것이 정상이다.** 미팅 전에는 채울 수가 없다. 「미입력」을 경고로
 *   그리면 안 된다 — 못 채운 칸은 인터뷰 질문으로 바뀌어 나간다.
 *
 * ⚠ 값 옆에 **근거(회의록 인용)** 를 같이 둔다. 값만 남기면 인계받은 사람이 전부
 *   다시 묻고, 그러면 인계 문서가 시간을 아끼는 게 아니라 한 벌 더 만드는 일이 된다.
 */
const HANDOFF_FIELDS = Object.freeze([
  { key: 'workflow', brief: 4, label: '우선 워크플로',
    hint: '무엇을 · 누가 · 얼마나 자주 · 사람이 어디서 검토하는가',
    placeholder: '예: 신규 계약 검토 요약. 법무 12명, 주 40건. 최종 발송 전 팀장 승인.' },
  { key: 'pilotGroup', brief: 2, label: '초기 사용자 그룹',
    hint: '규모와 조직 범위, 그리고 확정 여부',
    placeholder: '예: 법무팀 12명 (확정) / 재무팀 30명은 검토 중' },
  { key: 'successCriteria', brief: 6, label: '성공 기준',
    hint: '기준값 → 목표값 → 측정 방법',
    placeholder: '예: 요약 작성 40분 → 25분, 4주간 품질 검토 예외 증가 없음' },
  { key: 'stakeholders', brief: 7, label: '이해관계자',
    hint: '경영진 스폰서 · 비즈니스 성과 책임자 · 워크스페이스 관리자',
    placeholder: '예: 스폰서 CFO / 성과 책임 법무팀장 / 워크스페이스 IT인프라팀' },
  { key: 'scope', brief: 8, label: '범위 경계',
    hint: '포함 / 제외 / 나중에 볼 것',
    placeholder: '예: 포함 — 계약 요약. 제외 — 법률 자문·외부 발송. 보류 — 타 언어' },
  { key: 'nextSteps', brief: 14, label: '즉시 다음 단계',
    hint: '조치 · 책임자 · 기한',
    placeholder: '예: 8/28 보안 검토 회의 (IT 김OO) / 9/5 파일럿 계정 발급' }
]);

/** 사용사례 품질 점검 (문서2 §F). 판정만 받는다 — 여섯 줄이라 부담이 없다. */
const QUALITY_CHECKS = Object.freeze([
  { key: 'realWorkflow', label: '실제 워크플로', question: '사람들이 지금 실제로 하는 업무인가?' },
  { key: 'frequency', label: '빈도 · 업무 마찰', question: '검증을 정당화할 만큼 자주 발생하거나 부담이 큰가?' },
  { key: 'observable', label: '관찰 가능성', question: '첫 합의 기간 안에 유용성·품질을 관찰할 수 있는가?' },
  { key: 'pilotFit', label: '초기 사용자 적합성', question: '대상 사용자가 접근 가능하고 피드백을 줄 수 있는가?' },
  { key: 'dependencies', label: '관리 가능한 의존성', question: '소스·정책·접근·거버넌스 의존성이 감당 가능한가?' },
  { key: 'decisionBasis', label: '후속 의사결정 근거', question: '진행·개선·범위조정·중단을 정할 근거가 나오는가?' }
]);
/** 문서 원문 표기 그대로(§F). */
const QUALITY_LEVELS = Object.freeze([['met', '충족'], ['partial', '부분 충족'], ['unmet', '미충족']]);

const handoffOf = () => (state.deal?.handoff && typeof state.deal.handoff === 'object'
  ? state.deal.handoff : {});

/** 꽂힌 인용. 회의록이 지워졌으면 **버리지 않고 끊겼다고 표시한다.** */
function quoteMarkup(anchor) {
  if (!anchor?.quote) return '';
  const alive = asArray(state.notes).some((note) => note.id === anchor.note_id);
  const where = `${anchor.met_on} ${anchor.note_title || '회의록'}`;
  return `<div class="handoff-quote ${alive ? '' : 'orphan'}">
    <blockquote>${escapeHtml(anchor.quote)}</blockquote>
    <span>${escapeHtml(where)}${alive ? '' : ' · 원문이 삭제됨'}</span>
    <button type="button" class="link-button" data-clear-quote="${escapeHtml(anchor.__key || '')}" ${disabledAttr()}>근거 지우기</button>
  </div>`;
}

function renderHandoff() {
  const handoff = handoffOf();
  const fields = HANDOFF_FIELDS.map((field) => {
    const entry = handoff[field.key] && typeof handoff[field.key] === 'object' ? handoff[field.key] : {};
    const anchor = entry.quote ? { ...entry.quote, __key: field.key } : null;
    return `<div class="field full handoff-field">
      <label for="handoff-${field.key}">${escapeHtml(field.label)}
        <small>Brief §A ${field.brief} · ${escapeHtml(field.hint)}</small></label>
      <textarea id="handoff-${field.key}" data-handoff-field="${field.key}" rows="3"
        placeholder="${escapeHtml(field.placeholder)}" ${disabledAttr()}>${escapeHtml(entry.value || '')}</textarea>
      ${quoteMarkup(anchor)}
      <button type="button" class="link-button pin-quote" data-pin-quote="${field.key}" ${disabledAttr()}>
        <i data-lucide="quote"></i> 회의록에서 근거 가져오기</button>
    </div>`;
  }).join('');

  const quality = handoff.quality && typeof handoff.quality === 'object' ? handoff.quality : {};
  const checks = QUALITY_CHECKS.map((check) => `<tr>
    <th scope="row">${escapeHtml(check.label)}<small>${escapeHtml(check.question)}</small></th>
    ${QUALITY_LEVELS.map(([value, label]) => `<td><label class="quality-radio">
      <input type="radio" name="quality-${check.key}" value="${value}"
        data-quality="${check.key}" ${quality[check.key] === value ? 'checked' : ''} ${disabledAttr()}>
      <span>${label}</span></label></td>`).join('')}
  </tr>`).join('');

  return `${stageHeader('06', '배포 인계', 'ChatGPT Deployment Brief 가 요구하는 것 중 미팅에서만 알 수 있는 것을 채웁니다. 비워 두면 인터뷰 질문으로 바뀌어 나갑니다.',
    '<button id="handoff-brief" class="primary-button" type="button"><i data-lucide="file-output"></i> 인계 브리프 4종</button>')}
    <div id="handoff-progress" class="handoff-progress">${handoffProgressMarkup()}</div>
    <div class="field-group"><h3>근거 여섯 칸</h3><div class="form-grid">${fields}</div></div>
    <div class="field-group"><h3>사용 사례 품질 점검 <small>(Brief §F)</small></h3>
      <div class="quality-scroll"><table class="quality-table">
        <thead><tr><th scope="col">기준</th>${QUALITY_LEVELS.map(([, label]) =>
          `<th scope="col">${label}</th>`).join('')}</tr></thead>
        <tbody>${checks}</tbody>
      </table></div>
      <p class="field-note">판정만 남깁니다. <b>여섯 칸을 안 채우고 체크만 하면 준비된 것이 아닙니다</b> — 위 진행도는 칸만 셉니다.</p>
    </div>`;
}

/** 여섯 칸 중 몇 개가 찼는지. **체크박스는 안 센다** — 섞으면 빈 딜이 준비된 것처럼 보인다. */
function handoffProgressMarkup() {
  const handoff = handoffOf();
  const filled = HANDOFF_FIELDS.filter((f) => String(handoff[f.key]?.value || '').trim());
  const sourced = filled.filter((f) => handoff[f.key]?.quote?.note_id);
  const missing = HANDOFF_FIELDS.filter((f) => !String(handoff[f.key]?.value || '').trim());
  return `<b>${filled.length} / ${HANDOFF_FIELDS.length}</b> 칸 · 근거 있는 칸 ${sourced.length}`
    + (missing.length
      ? ` <span class="handoff-missing">남은 것 — ${missing.map((f) => escapeHtml(f.label)).join(' · ')}</span>`
      : ' <span class="handoff-done">여섯 칸이 모두 찼습니다.</span>');
}

function renderHandoffProgress() {
  const node = document.getElementById('handoff-progress');
  if (node) node.innerHTML = handoffProgressMarkup();
}

/** 인계 칸 저장. 값과 근거가 같은 객체라 통째로 보낸다. */
function saveHandoff(mutate) {
  const next = JSON.parse(JSON.stringify(handoffOf()));
  mutate(next);
  state.deal.handoff = next;
  scheduleSave({ handoff: next });
}

function renderPitch() {
  // 「고객용 키트」는 피치와 **다른 문서**다. 피치는 영업 대본(내부 준비용)이고
  // 키트는 고객에게 보내는 것이라, 버튼을 나란히 두되 산출물을 섞지 않는다.
  const actions = '<button id="customer-kit" class="primary-button" type="button"><i data-lucide="send"></i> 고객용 키트</button>'
    + '<button id="copy-pitch" class="secondary-button" type="button"><i data-lucide="copy"></i> 피치 복사</button>';
  return `${stageHeader('05', '세일즈 피치 준비', '앞 단계에서 확정한 고객 맥락·트랙·ISV·패키지를 한 번에 묶은 대화 가이드입니다.', actions)}
    <div id="pitch-content" class="pitch-box">${escapeHtml(buildPitch())}</div>`;
}

function bindStageEvents() {
  $$('[data-deal-field]').forEach((input) => input.addEventListener('input', () => {
    state.deal[input.dataset.dealField] = input.value;
    scheduleSave({ [input.dataset.dealField]: input.value });
  }));
  // 배포 인계(051). 값만 바꾸고 renderStage() 를 안 부른다 — 부르면 타이핑 중
  // 포커스를 잃는다. 진행도는 좁은 갱신 함수로 따로 고친다.
  $$('[data-handoff-field]').forEach((input) => input.addEventListener('input', () => {
    const key = input.dataset.handoffField;
    saveHandoff((next) => {
      const entry = next[key] && typeof next[key] === 'object' ? next[key] : {};
      next[key] = entry.quote ? { value: input.value, quote: entry.quote } : { value: input.value };
    });
    renderHandoffProgress();
  }));
  $$('[data-quality]').forEach((radio) => radio.addEventListener('change', () => {
    saveHandoff((next) => {
      const quality = next.quality && typeof next.quality === 'object' ? next.quality : {};
      next.quality = { ...quality, [radio.dataset.quality]: radio.value };
    });
  }));
  // 「근거 가져오기」 → 회의록 창을 열고 발췌를 기다린다.
  // 인계 산출물 셋 + 스냅샷. 규칙은 lib/handoff-doc.js 한 곳에 있다.
  $('#handoff-brief')?.addEventListener('click', () => exportHandoff());
  $('#copy-readiness-link')?.addEventListener('click', async (event) => {
    await navigator.clipboard.writeText(event.currentTarget.dataset.link);
    toast('진단 링크를 복사했습니다. 고객에게 보내주세요.');
  });
  $$('[data-pin-quote]').forEach((button) => button.addEventListener('click', () => {
    state.pinTarget = button.dataset.pinQuote;
    openNotesDialog();
  }));
  $$('[data-clear-quote]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.clearQuote;
    saveHandoff((next) => {
      if (next[key]) delete next[key].quote;
    });
    renderStage();
  }));
  // 문의 제품. renderStage() 를 부르지 않는다 — 부르면 <details> 가 접히고 스크롤이 튄다.
  $$('[data-inquiry-product]').forEach((box) => box.addEventListener('change', () => {
    const picked = $$('[data-inquiry-product]').filter((item) => item.checked)
      .map((item) => item.dataset.inquiryProduct);
    state.deal.inquiry_products = picked;
    renderInquiryProductChips();
    scheduleSave({ inquiry_products: picked }, true);
  }));
  // 문의 시점을 고치면 정체 계산이 달라진다. 그 줄만 다시 그린다.
  // 위 data-deal-field 핸들러가 같은 요소에 먼저 걸려 state 를 갱신한 뒤 여기가 돈다.
  $('#deal-inquiry-date')?.addEventListener('input', renderStallSummary);

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
  // 고객용 키트. 리포트 버튼과 같은 경로(IssuReport)로 내보내되 내용은 다른 문서다.
  $('#customer-kit')?.addEventListener('click', () => {
    // PDF 만 낸다. 고객에게 보내는 문서라 편집 가능한 형식으로 주지 않는다 —
    // Word 로 주면 우리 문구가 고쳐진 채로 돌아다닌다.
    window.IssuReport.pdf(`${state.deal.customer} — AI 도입 검토 정리`, buildCustomerKit());
    const open = collectOpenItems();
    // 아직 확인 안 된 것이 있으면 알려 준다. 문서에는 안 들어가지만 영업은 알아야 한다.
    toast(open.length
      ? `고객용 키트를 만들었습니다. 미확인 ${open.length}건은 문서에 넣지 않았습니다.`
      : '고객용 키트를 만들었습니다.');
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
        // 삭제는 DB 상 UPDATE(soft delete)라 change.operation 으로 구분이 안 된다.
        // ⚠ operation 을 읽으려 하지 말 것. 대신 목록 존재 여부로 가른다 —
        //   GET /deals 는 소유자 게이트가 없어서 「남이 claim」이면 목록에 남고
        //   「삭제」면 빠진다. 위에서 loadDeals() 를 이미 돌렸으므로 최신이다.
        const stillListed = state.deals.some((deal) => deal.id === change.id);
        closeWorkspace(stillListed ? '이 딜은 다른 담당자가 맡았습니다.' : '이 딜은 삭제되었습니다.');
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
