'use strict';

/**
 * curator(ISSU) 역할의 경계를 고정한다.
 *
 * curator 는 카탈로그를 편집하되 회원 승인·실단가 확정·롤백은 못 한다. 이 경계가
 * 프론트 숨김이 아니라 서버 미들웨어와 필드 단위 가드로 서 있는지 검사한다.
 * 라우트 하나만 실수로 catalogEditorOnly 로 바뀌어도 여기서 잡혀야 한다.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '013_curator_role.sql'), 'utf8');

/** `app.<verb>('<path>', ... )` 한 줄에서 어떤 authz 미들웨어를 쓰는지 뽑는다. */
function routeGuards() {
  const guards = new Map();
  for (const m of source.matchAll(/app\.(get|post|put|patch|delete)\('(\/api\/admin[^']*)'([^\n]*)/g)) {
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    const rest = m[3];
    guards.set(key, rest.includes('catalogEditorOnly') ? 'catalogEditorOnly'
      : rest.includes('adminOnly') ? 'adminOnly' : 'NONE');
  }
  return guards;
}

test('모든 /api/admin 라우트가 authz 미들웨어를 가진다', () => {
  for (const [route, guard] of routeGuards()) {
    assert.notEqual(guard, 'NONE', `${route} 에 authz 미들웨어가 없다`);
  }
});

test('회원 승인·설정·실단가·롤백·감사로그는 admin 전용이다', () => {
  const adminOnlyRoutes = [
    'GET /api/admin/profiles',
    'PATCH /api/admin/profiles/:id',
    'GET /api/admin/settings',
    'PATCH /api/admin/settings',
    'PATCH /api/admin/packages/:id',
    'POST /api/admin/solutions/:id/rollback',
    'GET /api/admin/usage'
  ];
  const guards = routeGuards();
  for (const route of adminOnlyRoutes) {
    assert.equal(guards.get(route), 'adminOnly', `${route} 는 admin 전용이어야 한다`);
  }
});

test('솔루션 등록·수정·발행은 curator 도 가능하다', () => {
  const editorRoutes = [
    'POST /api/admin/solutions',
    'PUT /api/admin/solutions/:id',
    'POST /api/admin/solutions/:id/publish',
    'DELETE /api/admin/solutions/:id',
    'GET /api/admin/solutions/:id/versions',
    'GET /api/admin/focal-contacts',
    'POST /api/admin/focal-contacts'
  ];
  const guards = routeGuards();
  for (const route of editorRoutes) {
    assert.equal(guards.get(route), 'catalogEditorOnly', `${route} 는 curator 도 써야 한다`);
  }
});

test('가격 필드는 admin 만 바꾼다 — 세 경로 전부 막혀 있다', () => {
  // 생성·수정·발행 어느 경로로도 curator 가 단가를 넣을 수 없어야 한다.
  const priceGuards = source.match(/const canEditPrice = isAdminUser\(req\.user\)/g) || [];
  assert.equal(priceGuards.length, 3, 'POST·PUT·publish 세 곳에 가격 가드가 있어야 한다');
  assert.match(source, /if \(actor && !isAdminUser\(actor\)\) return; \/\/ 실단가 확정은 admin 만/);
});

test('내부 본문(opinion·sections_internal)은 curator 에게 열려 있다', () => {
  // ISSU 가 등록할 때 마진 코멘트까지 한 번에 쓰도록 열기로 결정했다.
  // 042 로 COMMON 에도 선택 컬럼(list_price)이 생겨 목록이 필터를 거친다.
  // viewer 가 ADMIN_ONLY 를 못 받는다는 규약은 그대로다.
  assert.match(source, /if \(!isCatalogEditor\(\{ role \}\)\) return common;/);
  assert.match(source, /return \[\.\.\.common, \.\.\.\(await keep\(SOLUTION_COLUMNS_ADMIN_ONLY\)\)\]/);
  assert.match(source, /const canSeeInternal = isCatalogEditor\(req\.user\)/);
  // viewer 에게는 여전히 런타임 제거가 걸려 있어야 한다.
  assert.match(source, /stripInternalSections\(row\.sections\)/);
});

test('역할 판정은 배열도 받는다 (페이지·자산 게이트 공용)', () => {
  assert.match(source, /const CATALOG_EDITOR_ROLES = Object\.freeze\(\['admin', 'curator'\]\)/);
  assert.match(source, /const roleAllowed = \(user, required\)/);
  assert.match(source, /Array\.isArray\(required\) \? required\.includes\(user\?\.role\)/);
});

test('회원 편집 API 가 curator 값을 받는다', () => {
  assert.match(source, /\['admin', 'curator', 'viewer'\]\.includes\(req\.body\?\.role\)/);
  assert.match(adminHtml, /value="curator"/);
});

test('admin 화면이 curator 에게 관리자 전용 요소를 감춘다', () => {
  // 서버가 실제 경계지만, 눌러도 403 만 나는 버튼을 보여주지 않는다.
  assert.match(adminHtml, /function applyRoleRestrictions\(\)/);
  assert.match(adminHtml, /data-tab="members" data-role-admin/);
  assert.match(adminHtml, /data-tab="packages" data-role-admin/);
  assert.match(adminHtml, /\['admin', 'curator'\]\.includes\(window\.currentUserRole\)/);
});

test('013 은 enum 추가를 트랜잭션 밖에서 한다', () => {
  // ALTER TYPE ... ADD VALUE 로 추가한 값은 같은 트랜잭션에서 쓸 수 없다.
  const alterIndex = migration.indexOf("alter type app_role add value");
  const beginIndex = migration.indexOf('begin;');
  assert.ok(alterIndex > 0, 'enum 추가 구문이 없다');
  assert.ok(alterIndex < beginIndex, 'enum 추가는 begin; 앞에 있어야 한다');
});
