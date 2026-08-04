'use strict';

/**
 * 랜딩(/).
 *
 * 진단은 여기서 하지 않는다. 고객이 답하는 진단은 /readiness 42문항 하나뿐이고,
 * 이 페이지는 그 입구와 오퍼링 목록만 맡는다.
 *
 * 예전에는 여기서 21문항(FQA)을 직접 받았다. 21문항은 ISV 전제조건 판정용이라
 * 고객이 아니라 영업이 답해야 하는 문항이었고, 그래서 허브(STEP02)로 옮겼다.
 * 겹치는 13개는 030 bridge 가 42문항 응답에서 자동으로 채운다.
 */

const $ = (selector, root = document) => root.querySelector(selector);

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

/**
 * 6대 영역과 영역별 문항 수.
 *
 * 목록을 여기 적지 않고 /readiness 와 같은 API 에서 받는다. 베껴 두면 문항을
 * 늘렸을 때 랜딩만 옛 숫자를 말한다 — 고객이 "42문항" 을 보고 들어갔는데 49문항이
 * 나오는 식이다.
 */
function renderAreas(data) {
  $('#item-count').textContent = data.items.length;
  $('#area-preview').innerHTML = data.areas.map((area) => {
    const count = data.items.filter((item) => item.area === area.id).length;
    return `<article class="area-chip">
      <b>${escapeHtml(area.id)}</b>
      <span>${escapeHtml(area.name)}</span>
      <small>${count}문항</small>
    </article>`;
  }).join('');
}

function renderPackages(packages) {
  $('#package-list').innerHTML = packages.map((pkg, index) => `<article class="package"><small>${String(index + 1).padStart(2, '0')} · ${escapeHtml(pkg.period || '기간 협의')}</small><h3>${escapeHtml(pkg.name)}</h3><p>${escapeHtml(pkg.target || '')}</p><ul>${(pkg.items || []).map((item) => `<li>${escapeHtml(item.label)}</li>`).join('')}</ul></article>`).join('');
}

async function initOffering() {
  window.lucide?.createIcons();

  // 둘을 따로 처리한다. 한쪽이 실패해도 나머지는 보여야 한다 — 오퍼링 목록이
  // 안 뜬다고 진단 입구까지 닫을 이유가 없다.
  const [areas, packages] = await Promise.allSettled([
    getJson('/api/hub/public/readiness-items'),
    getJson('/api/hub/public/packages')
  ]);

  if (areas.status === 'fulfilled') {
    renderAreas(areas.value);
  } else {
    // 원문 메시지를 그대로 뿌리면 DB 내부가 고객 화면에 드러난다.
    console.error('Offering bootstrap failed:', areas.reason?.message);
    $('#area-preview').innerHTML = '<div class="loading">진단 문항을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>';
  }

  if (packages.status === 'fulfilled') {
    renderPackages(packages.value);
  } else {
    console.error('Package load failed:', packages.reason?.message);
    $('#package-list').innerHTML = '<div class="loading">오퍼링 정보를 불러오지 못했습니다.</div>';
  }

  window.lucide?.createIcons();
}

document.addEventListener('DOMContentLoaded', initOffering);
