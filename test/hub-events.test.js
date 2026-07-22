'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'routes', 'hub.js'), 'utf8');

test('hub fans database notifications out through one bounded listener', () => {
  assert.match(source, /const eventStreams = new Set\(\)/);
  assert.match(source, /const ensureDealListener = async/);
  assert.match(source, /client\.on\('error', onError\)/);
  assert.match(source, /broadcastDealChange\(message\.payload\)/);
  assert.match(source, /eventStreams\.add\(res\)/);
  assert.match(source, /if \(!eventStreams\.size\) void stopDealListener\(\)/);
  assert.match(source, /router\.dispose = async/);
  assert.doesNotMatch(source, /router\.get\('\/events'[\s\S]*?client = await pool\.connect\(\)/);
});
