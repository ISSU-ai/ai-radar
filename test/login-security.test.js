'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'login.html'), 'utf8');

test('login return path is same-origin and restricted to known application entrypoints', () => {
  assert.match(source, /new URL\(requestedPath \|\| '\/hub', window\.location\.origin\)/);
  assert.match(source, /destination\.origin === window\.location\.origin/);
  assert.match(source, /allowedPaths\.has\(destination\.pathname\)/);
  assert.doesNotMatch(source, /requestedPath\.startsWith\('\/'\)/);
  assert.match(source, /new Set\(\['\/hub', '\/radar', '\/about', '\/admin', '\/admin\/usage'\]\)/);
  assert.doesNotMatch(source, /allowedPaths[^\n]+['"]\/['"]/);
});
