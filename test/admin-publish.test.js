'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('admin publishes edited form data through one endpoint', () => {
  const publishClient = adminSource.match(/async function commitPublish\(\)[\s\S]*?\n    function showToast/)?.[0] || '';
  assert.match(publishClient, /body: JSON\.stringify\(data\)/);
  assert.match(publishClient, /\/publish`/);
  assert.doesNotMatch(publishClient, /method: 'PUT'/);
});

test('publish and rollback update content and snapshots transactionally', () => {
  const publishRoute = serverSource.match(/app\.post\('\/api\/admin\/solutions\/:id\/publish'[\s\S]*?\n\}\);\n\n\/\/ DELETE/)?.[0] || '';
  assert.match(publishRoute, /client = await pool\.connect\(\)/);
  assert.match(publishRoute, /await client\.query\('begin'\)/);
  assert.match(publishRoute, /UPDATE solutions[\s\S]*?RETURNING \*/);
  assert.match(publishRoute, /INSERT INTO solution_versions/);
  assert.match(publishRoute, /await client\.query\('commit'\)/);
  assert.match(publishRoute, /await client\.query\('rollback'\)/);

  const rollbackRoute = serverSource.match(/app\.post\('\/api\/admin\/solutions\/:id\/rollback'[\s\S]*?\n\}\);\n\napp\.get\('\/api\/admin\/usage'/)?.[0] || '';
  assert.match(rollbackRoute, /SELECT version FROM solutions WHERE id = \$1 FOR UPDATE/);
  assert.match(rollbackRoute, /await client\.query\('commit'\)/);
  assert.match(rollbackRoute, /await client\.query\('rollback'\)/);
});
