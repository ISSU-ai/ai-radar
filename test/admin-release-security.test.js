const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const usageHtml = fs.readFileSync(path.join(root, 'admin-usage.html'), 'utf8');
const radarApp = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const loginHtml = fs.readFileSync(path.join(root, 'login.html'), 'utf8');

test('usage dashboard renders stored audit fields as text, not HTML', () => {
  assert.match(usageHtml, /createTextCell\(log\.query \|\| '-'/);
  assert.match(usageHtml, /strong\.textContent = String\(label \?\? ''\)/);
  assert.match(usageHtml, /roleBadge\.textContent = log\.user_role/);
  assert.doesNotMatch(usageHtml, /innerHTML\s*=\s*`[^`]*\$\{log\.(?:query|target|user_name|user_team)/s);
  assert.doesNotMatch(usageHtml, /innerHTML\s*=\s*`[^`]*\$\{(?:k\.query|s\.target)/s);
});

test('radar escapes database content and markdown before rich-text rendering', () => {
  assert.match(radarApp, /function escapeHtml\(value\)/);
  assert.match(radarApp, /escapeHtml\(isv\.name\)/);
  assert.match(radarApp, /escapeHtml\(isv\.jtbd\)/);
  assert.match(radarApp, /return escapeHtml\(text\)\.replace\(/);
  assert.doesNotMatch(radarApp, /onclick="downloadChecklist\(/);
  assert.match(radarApp, /checklist-download-button[\s\S]*addEventListener\('click'/);
  assert.match(radarApp, /data-recommendation-id="\$\{escapeHtml\(solutionId\)\}"/);
  assert.match(radarApp, /String\(item\.id \|\| ''\) === normalisedId/);
  assert.doesNotMatch(radarApp, /Number\(isv\.id\)/);
});

test('admin ignores stale solution responses and blocks writes until selection is loaded', () => {
  const selectSolution = adminHtml.match(/async function selectSolution\(id\)[\s\S]*?\n    \/\/ Get current form data/)?.[0] || '';
  assert.match(selectSolution, /const requestSequence = \+\+selectionRequestSequence/);
  assert.match(selectSolution, /requestSequence !== selectionRequestSequence \|\| currentSelectedId !== id/);
  assert.ok(
    selectSolution.indexOf('requestSequence !== selectionRequestSequence') < selectSolution.indexOf('// Populate Forms'),
    'stale-response guard must run before the form is populated'
  );
  assert.match(adminHtml, /function requireCurrentSolution\(\)/);
  assert.match(adminHtml, /loadedSolutionId === currentSelectedId/);
  assert.match(adminHtml, /async function saveAsDraft\(\)[\s\S]*?if \(!requireCurrentSolution\(\)\) return/);
});

test('admin preserves structured industries and simulator mappings on round-trip', () => {
  assert.match(adminHtml, /function getIndustryKey\(item\)/);
  assert.match(adminHtml, /function getSimulatorMappingKey\(item\)/);
  assert.match(adminHtml, /function mergeSelectedMetadata\(originalItems, selectedKeys, keyResolver, createItem\)/);
  assert.match(adminHtml, /loadedMetadata\.industries,[\s\S]*?selectedIndustries,[\s\S]*?getIndustryKey/);
  assert.match(adminHtml, /loadedMetadata\.simulator_mappings,[\s\S]*?selectedSimulatorMappings,[\s\S]*?getSimulatorMappingKey/);
  assert.match(adminHtml, /scenario: simulatorScenarioById\[id\]/);
});

test('dedicated admin surfaces return to an allowed admin URL after login', () => {
  assert.match(adminHtml, /isHubEmbed \? '\/login\.html\?next=\/hub\?mode=admin' : '\/login\.html\?next=\/admin'/);
  assert.match(usageHtml, /\/login\.html\?next=\/admin\/usage/);
  assert.match(loginHtml, /'\/admin\/usage'/);
});
