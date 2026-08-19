'use strict';

/**
 * 벤더 사이트 링크.
 *
 * 여기서 잡으려는 것은 하나다 — **우리가 만들지 않은 문자열이 `href` 로 들어가는 것.**
 * `solutions.website` 는 엑셀 붙여넣기로 들어온다(052). 화면마다 규칙을 다시 쓰면
 * 한 곳이 반드시 느슨해지므로 **한 파일만** 본다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const V = require('../lib/vendor-link');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('http · https 가 아니면 통째로 버린다', () => {
  // 화이트리스트다. 「javascript: 를 막는다」로 적으면 data:·vbscript: 가 남는다.
  for (const evil of [
    'javascript:alert(1)', 'JavaScript:alert(1)', '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox',
    'file:///etc/passwd', 'ftp://files.example.com'
  ]) {
    assert.equal(V.safeUrl(evil), '', `${evil} 이 통과했다`);
    assert.equal(V.linkHtml(evil), '', `${evil} 로 링크가 만들어졌다`);
  }
  // ⚠ 「전부 빈 값」인 고장에서도 위 검사는 통과한다. 되는 것을 같이 못박는다.
  assert.equal(V.safeUrl('https://openai.com'), 'https://openai.com/');
  assert.ok(V.linkHtml('https://openai.com').startsWith('<a '));
});

test('스킴이 없으면 https 로 채운다 — 마스터에 맨 도메인이 흔하다', () => {
  assert.equal(V.safeUrl('openai.com'), 'https://openai.com/');
  assert.equal(V.safeUrl('//openai.com'), 'https://openai.com/');
  assert.equal(V.safeUrl('www.openai.com/enterprise'), 'https://www.openai.com/enterprise');
  // 이미 https 면 건드리지 않는다.
  assert.equal(V.safeUrl('http://intra.example.com'), 'http://intra.example.com/');
});

test('빈 값·쓰레기는 링크를 만들지 않는다', () => {
  // ⚠ 반쯤 맞는 주소로 고객 앞에서 클릭하는 게 안 보이는 것보다 나쁘다.
  for (const nothing of ['', '   ', null, undefined, 'https://', 'not a url at all']) {
    assert.equal(V.safeUrl(nothing), '');
    assert.equal(V.linkHtml(nothing), '', '자리만 비어야 하는데 무언가 그렸다');
  }
});

test('새 창은 우리 창을 못 만지고, 내부 주소를 벤더에게 안 흘린다', () => {
  const html = V.linkHtml('https://openai.com');
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/, 'noreferrer 가 없으면 내부 주소가 벤더 로그에 남는다');
});

test('링크 글자는 도메인만 — 제목 옆이라 긴 주소는 제목을 덮는다', () => {
  assert.equal(V.hostLabel('https://www.openai.com/enterprise/pricing?x=1'), 'openai.com');
  assert.match(V.linkHtml('https://www.openai.com/enterprise'), />openai\.com</);
});

test('주소에 섞인 따옴표·꺾쇠로 속성을 새로 만들 수 없다', () => {
  /**
   * ⚠ 「onmouseover 라는 글자가 있나」로 검사하면 안 된다 — 주소 **안에** 그 글자가
   *   들어 있어도 퍼센트 인코딩되어 있으면 안전하다. 실제로 확인할 것은
   *   **태그에 우리가 안 만든 속성이 생겼는가**다.
   */
  const ALLOWED = ['class', 'href', 'target', 'rel', 'title', 'onclick'];
  for (const raw of [
    'https://ok.example.com/a"onmouseover="alert(1)',
    "https://ok.example.com/a'onerror='alert(1)",
    'https://ok.example.com/<img src=x onerror=alert(1)>',
    'https://ok.example.com/ onload=alert(1)'
  ]) {
    for (const opts of [undefined, { stopPropagation: true }]) {
      const html = V.linkHtml(raw, opts);
      if (!html) continue;
      const tag = html.slice(0, html.indexOf('>') + 1);
      const attrs = [...tag.matchAll(/([a-zA-Z-]+)="/g)].map((m) => m[1]);
      for (const attr of attrs) {
        assert.ok(ALLOWED.includes(attr), `${raw} 로 속성 ${attr} 이 생겼다`);
      }
      // 값 안에 생 따옴표가 남으면 그 자리에서 속성이 끊긴다.
      assert.ok(!/href="[^"]*"[^ >]/.test(tag), `${raw} 가 href 를 빠져나갔다`);
      assert.ok(!tag.includes('<a class="vendor-link" href="https://ok.example.com/a"o'),
        `${raw} 가 인코딩 없이 들어갔다`);
    }
  }
  // 인코딩이 실제로 되는지 한 번 못박아 둔다.
  assert.equal(V.safeUrl('https://ok.example.com/a"b'), 'https://ok.example.com/a%22b');
});

test('⚠ 클릭이 다른 뜻인 자리에서는 전파를 막는다', () => {
  // 카탈로그 카드는 <label> 이라 안을 클릭하면 체크박스가 켜지고, /radar 표는 행 클릭이
  // 상세를 연다. 막지 않으면 벤더 사이트로 가면서 딜에 솔루션이 딸려 들어간다.
  assert.match(V.linkHtml('openai.com', { stopPropagation: true }), /onclick="event\.stopPropagation\(\)"/);
  assert.ok(!V.linkHtml('openai.com').includes('onclick'), '기본값이 전파를 막고 있다');

  for (const [file, where] of [['app.js', '/radar 표'], ['hub.js', '허브 카탈로그 카드']]) {
    assert.match(read(file), /stopPropagation: true/, `${where} 가 클릭을 안 막는다`);
  }
});

test('화면과 서버가 같은 파일을 본다 — 규칙을 두 번 적지 않는다', () => {
  assert.match(read('server.js'), /require\('\.\/lib\/vendor-link'\)/, '서버가 자체 검사를 만들었다');
  for (const [file, marker] of [
    ['app.js', /window\.IssuVendorLink/],
    ['hub.js', /window\.IssuVendorLink/],
    ['admin.html', /window\.IssuVendorLink/]
  ]) {
    assert.match(read(file), marker, `${file} 이 lib 을 안 쓴다`);
  }
  // 화면이 스스로 <a> 를 짜면 이 검사가 무의미해진다.
  for (const file of ['app.js', 'hub.js']) {
    const src = read(file);
    assert.ok(!/href="\$\{[^}]*website/.test(src), `${file} 이 직접 href 를 만든다`);
  }
});

test('브라우저에서 <script> 로 불러도 죽지 않는다', () => {
  // node require 는 통과하고 브라우저에서만 터지는 종류다. 이 저장소에서 두 번 데였다.
  const context = { console, URL };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read('lib/vendor-link.js'), context, { filename: 'vendor-link.js' });
  assert.ok(context.IssuVendorLink, 'window.IssuVendorLink 가 안 생겼다');
  // ⚠ 「막는지」만 보면 안 된다. 전부 빈 값을 돌려주는 고장에서도 통과한다 —
  //   실제로 URL 을 컨텍스트에 안 넣어 그런 상태였다. 되는 것도 같이 확인한다.
  assert.equal(context.IssuVendorLink.safeUrl('javascript:alert(1)'), '');
  assert.equal(context.IssuVendorLink.safeUrl('openai.com'), 'https://openai.com/');
  assert.match(context.IssuVendorLink.linkHtml('openai.com'), /href="https:\/\/openai\.com\/"/);
});

test('세 화면에서 스크립트가 열린다 — 빠뜨리면 프로덕션에서만 404 다', () => {
  const server = read('server.js');
  assert.match(server, /'\/lib\/vendor-link\.js': \{ file: 'lib\/vendor-link\.js'/, '공개 경로에 없다');
  // /radar 는 hub 서피스에서 서비스되고 그 서피스가 /lib/ 을 이미 연다.
  const surface = server.slice(server.indexOf('const allowed = {'), server.indexOf('if (!allowed)'));
  assert.match(surface, /hub: [^\n]*startsWith\('\/lib\/'\)/);
  assert.match(surface, /admin: [^\n]*startsWith\('\/lib\/'\)/);
  // 화면이 실제로 부르는가. app.js·hub.js 보다 먼저 와야 한다.
  for (const [file, after] of [['index.html', '/app.js'], ['hub.html', '/hub.js']]) {
    const src = read(file);
    assert.ok(src.indexOf('/lib/vendor-link.js') > 0, `${file} 이 스크립트를 안 부른다`);
    assert.ok(src.indexOf('/lib/vendor-link.js') < src.indexOf(after),
      `${file} 에서 ${after} 보다 늦게 로드된다`);
  }
  assert.match(read('admin.html'), /src="\/lib\/vendor-link\.js"/);
});

test('052 미적용 구간에도 카탈로그가 죽지 않는다', () => {
  // 컬럼 하나 때문에 화면 전체가 500 이 되면 안 된다.
  const server = read('server.js');
  assert.match(server, /const hasIdentity = await hasColumn\('solutions', 'website'\)/);
  assert.match(server, /\.\.\.\(hasIdentity \? \['name_kr', 'website'\] : \[\]\)/);
  assert.match(server, /'sections_internal', 'price_is_placeholder', 'list_price', 'name_kr', 'website'/,
    '상세 조회에서 선택 컬럼으로 등록되지 않았다');
  assert.match(read('routes/hub.js'), /hasIdentity \? 's\.name_kr, s\.website,' : ''/);
});

test('저장할 때도 같은 규칙으로 거른다', () => {
  // 화면이 걸러 주긴 하지만, **거르는 곳이 하나뿐이면 그 하나가 언젠가 빠진다.**
  const server = read('server.js');
  const fn = server.slice(server.indexOf('async function persistIdentity'), server.indexOf('/**\n * sections_internal'));
  assert.match(fn, /safeVendorUrl\(raw\)/, '저장 경로가 검사를 안 한다');
  assert.match(fn, /error\.status = 400/, '못 쓰는 주소를 조용히 버린다');
  assert.match(fn, /hasColumn\('solutions', 'website'\)/);
  // 위치 인자 큰 쿼리에 끼워 넣으면 $N 이 어긋나 엉뚱한 컬럼에 값이 들어간다.
  assert.ok(!/INSERT INTO solutions \([^)]*website/.test(server), 'INSERT 에 끼워 넣었다');
  // 400 이 500 으로 삼켜지면 넣은 사람은 서버가 죽은 줄 안다.
  assert.equal((server.match(/if \(err\.status === 400\) return res\.status\(400\)/g) || []).length, 2);
});

test('목업에도 주소가 있다 — 없으면 로컬에서만 안 보인다', () => {
  const mock = read('scripts/mock-ui-server.js');
  assert.match(mock, /website: 'https:\/\/openai\.com'/);
  // 스킴 없는 값과 못 쓰는 값을 일부러 섞어 둔다. 걸러지는 걸 눈으로 봐야 한다.
  assert.match(mock, /website: 'slack\.com'/, '스킴 없는 값이 없다');
  assert.match(mock, /website: 'javascript:alert\(1\)'/, '걸러지는 모양을 볼 표본이 없다');
});
