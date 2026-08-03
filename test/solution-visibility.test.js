'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const serverSource = read('server.js');
const hubSource = read('routes/hub.js');
const adminSource = read('admin.html');

/**
 * is_hidden 은 "데이터는 두되 영업 화면에서만 감춘다"는 스위치다.
 * 새는 곳이 하나라도 있으면 감춘 솔루션이 영업 앞에 다시 나타나므로,
 * 노출 경로 전부에 필터가 걸려 있는지 구조로 확인한다.
 */

test('영업 노출 경로 세 곳 모두 is_hidden 을 거른다', () => {
  // 1) /radar 탐색기·매트릭스가 쓰는 목록
  assert.match(serverSource, /conditions\.push\('is_hidden = false'\)/);
  // 2) 추천 엔진 후보
  assert.match(hubSource, /const hiddenFilter[\s\S]{0,160}?is_hidden = false/);
  assert.match(hubSource, /\$\{hiddenFilter\}/);
  // 3) 허브 카탈로그
  assert.match(hubSource, /const refHiddenFilter[\s\S]{0,160}?is_hidden = false/);
  assert.match(hubSource, /\$\{refHiddenFilter\}/);
});

test('상세 조회도 막는다 — 목록에서만 가리면 슬러그로 열린다', () => {
  const detail = serverSource.slice(
    serverSource.indexOf("app.get('/api/solutions/:slug'"),
    serverSource.indexOf("app.get('/api/solutions/:slug'") + 1200
  );
  assert.match(detail, /AND is_hidden = false/);
  assert.match(detail, /!canSeeInternal/, '카탈로그 편집자는 볼 수 있어야 한다');
});

test('컬럼이 없는 구간에도 쿼리가 깨지지 않는다', () => {
  // 스키마는 수동 적용이라 코드가 먼저 배포되는 구간이 있다 (server.js 의 hasColumn 주석).
  // 가드 없이 SQL 에 박으면 그 구간 내내 500 이 난다.
  assert.match(serverSource, /hasHidden = await hasColumn\('solutions', 'is_hidden'\)/);
  assert.match(serverSource, /if \(hasHidden && !showHidden\)/);

  for (const name of ['hiddenFilter', 'refHiddenFilter']) {
    const at = hubSource.indexOf(`const ${name}`);
    assert.ok(at > 0, `${name} 이 있어야 한다`);
    const decl = hubSource.slice(at, at + 200);
    assert.match(decl, /hasColumn\('solutions', 'is_hidden'\)/, `${name} 은 hasColumn 으로 가려야 한다`);
    assert.match(decl, /:\s*''/, `${name} 은 컬럼이 없으면 빈 문자열이어야 한다`);
  }
});

test('토글은 양방향이다 — is_archived 의 편도 문제를 반복하지 않는다', () => {
  const at = serverSource.indexOf("app.patch('/api/admin/solutions/:id/visibility'");
  assert.ok(at > 0, '노출 토글 엔드포인트가 있어야 한다');
  const route = serverSource.slice(at, at + 2200);

  assert.match(route, /catalogEditorOnly/, '카탈로그 편집자만 바꿀 수 있어야 한다');
  assert.match(route, /typeof hidden !== 'boolean'/, 'boolean 이 아니면 거절해야 한다');
  assert.match(route, /is_archived = \$/, '아카이브 복구도 같은 자리에서 되어야 한다');
  assert.match(route, /auditLog\(/, '누가 감췄는지 남겨야 한다');
  assert.match(route, /020 마이그레이션/, '컬럼 미적용을 503 으로 알려야 한다');
});

test('아카이브 복구가 화면에서 도달 가능하다', () => {
  // API 에 복구 분기만 만들어 두면 소용이 없다. 목록이 is_archived = false 로 거르면
  // 되돌릴 행 자체가 없어 누를 수가 없다 — 실제로 그 상태였다.
  const at = serverSource.indexOf("app.get('/api/solutions'");
  const route = serverSource.slice(at, at + 1400);
  assert.match(route, /const showArchived = canSeeInternal && String\(include_archived\) === '1'/);
  assert.match(route, /if \(!showArchived\) conditions\.push\('is_archived = false'\)/);
  assert.ok(!/conditions = \['is_archived = false'\]/.test(route),
    '무조건 거르면 어드민도 아카이브를 못 본다');

  assert.match(adminSource, /include_archived=1/);
  assert.match(adminSource, /isv\.is_archived \? \{ archived: false \}/,
    '아카이브된 행은 복구부터 보내야 한다');
  assert.match(adminSource, /archive-restore/, '복구 아이콘으로 구분돼야 한다');
});

test('어드민 목록은 숨긴 것까지 조회한다', () => {
  // include_hidden 없이 조회하면 감춘 순간 화면에서 사라져 되돌릴 방법이 없다.
  assert.match(adminSource, /fetch\('\/api\/solutions\?include_hidden=1&include_archived=1'\)/);
  assert.match(serverSource, /const showHidden = canSeeInternal && String\(include_hidden\) === '1'/);
  assert.match(adminSource, /toggleSolutionVisibility/);
  // 아이콘이 세 상태(아카이브/숨김/노출)를 구분해야 무엇을 누르는지 알 수 있다
  assert.match(adminSource, /isv\.is_archived \? 'archive-restore'/);
  assert.match(adminSource, /isv\.is_hidden \? 'eye-off' : 'eye'/);
});

test('include_hidden 은 카탈로그 편집자에게만 열린다', () => {
  const at = serverSource.indexOf("app.get('/api/solutions'");
  const route = serverSource.slice(at, at + 900);
  // canSeeInternal 없이 include_hidden 만 보면 영업이 쿼리스트링으로 숨김을 뚫는다
  assert.match(route, /canSeeInternal && String\(include_hidden\)/);
});

test('020 은 스키마만, 021 은 1회성 시드로 갈라져 있다', () => {
  const schema = read('db/migrations/020_solution_visibility.sql');
  assert.match(schema, /add column if not exists is_hidden/);
  assert.ok(!/^\s*update solutions set is_hidden/mi.test(schema),
    '020 에 시드가 섞이면 재실행 때 어드민이 켠 상태를 덮어쓴다');

  const seed = read('db/migrations/021_seed_visible_catalog.sql');
  assert.match(seed, /update solutions/);
  for (const slug of [
    'anthropic-claude', 'openai-enterprise', 'articul8',
    'portal26', 'check-point', 'zscaler', 'new-relic', 'cohere'
  ]) {
    assert.ok(seed.includes(`'${slug}'`), `노출 목록에 ${slug} 가 있어야 한다`);
  }

  const runner = read('scripts/apply-migrations.js');
  assert.ok(!runner.includes('021_seed_visible_catalog.sql'),
    '021 은 1회성 시드라 자동 실행 목록에서 빠져야 한다');
});
