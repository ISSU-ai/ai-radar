'use strict';

/**
 * 벤더 웹사이트 링크.
 *
 * ⚠ **여기 있는 이유는 보안이다.** `solutions.website` 는 엑셀 붙여넣기로 들어온
 *   문자열이라 우리가 만든 값이 아니다. 그대로 `href` 에 넣으면 `javascript:` 한 줄로
 *   화면이 남의 것이 된다. 화면마다 규칙을 다시 쓰면 한 곳이 반드시 빠진다 —
 *   /radar 와 /hub 가 같은 파일을 본다.
 *
 * 지키는 것 셋:
 *   ① **http · https 만 통과시킨다.** 나머지 스킴은 통째로 버린다
 *   ② `noopener noreferrer` — 새 창이 우리 창을 조작하지 못하게, 그리고 내부 주소가
 *      벤더 사이트 로그에 남지 않게 한다
 *   ③ 링크 글자는 **도메인만** 쓴다. 제목 옆이라 긴 주소를 그대로 두면 제목을 덮는다
 *
 * ⚠ 052 주석과 같은 경고: 마스터에서 **다른 회사 도메인이 들어온 사례**가 있다
 *   (Couchbase → contentsquare.com). 여기서 걸러지지 않는다 — 형식만 본다.
 *   맞는 회사인지는 사람이 본다.
 */
(function wrap(global) {
  const HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/[&<>"']/g, (ch) => HTML[ch]);

  /**
   * 쓸 수 있는 주소면 정규화해서 돌려주고, 아니면 빈 문자열.
   * **모르면 링크를 안 만든다** — 반쯤 맞는 주소로 고객 앞에서 클릭하는 게 더 나쁘다.
   */
  function safeUrl(raw) {
    const value = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!value) return '';

    let candidate = value;
    if (/^\/\//.test(value)) candidate = `https:${value}`;
    else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) candidate = value;   // 스킴이 이미 있다
    else candidate = `https://${value}`;                              // `openai.com` 같은 맨 도메인

    let url;
    try {
      url = new URL(candidate);
    } catch (error) {
      return '';
    }
    // ⚠ 화이트리스트다. 「javascript: 를 막는다」로 적으면 data:·vbscript: 가 남는다.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname) return '';
    return url.href;
  }

  /** 링크에 보일 글자. `https://www.openai.com/enterprise` → `openai.com` */
  function hostLabel(raw) {
    const href = safeUrl(raw);
    if (!href) return '';
    try {
      return new URL(href).hostname.replace(/^www\./i, '');
    } catch (error) {
      return '';
    }
  }

  /**
   * 제목 옆에 붙일 `<a>` 한 덩이. 주소가 없거나 못 쓰면 **빈 문자열** — 자리만 비고
   * 화면은 멀쩡하다.
   */
  function linkHtml(raw, options) {
    const href = safeUrl(raw);
    if (!href) return '';
    const opts = options || {};
    const label = hostLabel(raw);
    const cls = opts.className || 'vendor-link';
    // ⚠ 이 링크는 **클릭이 다른 뜻을 갖는 자리**에 들어간다 — 카탈로그 카드는 label
    //   이라 클릭하면 체크박스가 켜지고, /radar 표는 행 클릭이 상세를 연다. 막지 않으면
    //   벤더 사이트로 가면서 딜에 솔루션이 딸려 들어간다.
    const guard = opts.stopPropagation ? ' onclick="event.stopPropagation()"' : '';
    return `<a class="${esc(cls)}" href="${esc(href)}" target="_blank"`
      + ` rel="noopener noreferrer" title="${esc(href)}"${guard}>${esc(label)}</a>`;
  }

  const api = { safeUrl, hostLabel, linkHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.IssuVendorLink = api;
})(typeof window === 'undefined' ? globalThis : window);
