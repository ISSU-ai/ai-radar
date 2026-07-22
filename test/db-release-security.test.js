'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '002_release_hardening.sql'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

test('release migration closes PostgREST access to hub and legacy radar data', () => {
  for (const relation of [
    'offering_fqa_items', 'leads', 'deals', 'solutions', 'profiles',
    'solution_versions', 'solution_chunks', 'audit_log'
  ]) {
    assert.match(migration, new RegExp(`\\b${relation}\\b`));
  }
  assert.match(migration, /revoke all on all sequences in schema public/);
  assert.match(migration, /alter default privileges for role postgres in schema public/);
  assert.match(migration, /revoke execute on function handle_new_user\(\)/);
});

test('local SQLite snapshots cannot be added again', () => {
  assert.match(gitignore, /^\/radar\.db$/m);
  assert.match(gitignore, /^\/radar\.db-\*$/m);
});
