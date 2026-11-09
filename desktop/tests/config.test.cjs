const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadConfig, validateConfig, storySettings, targetSettings } = require('../src/config.cjs');
const { Store } = require('../src/store.cjs');
const { Runner } = require('../src/runner.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('standard projects work without a configuration and do not wait for API requests', t => {
  const config = loadConfig({ mode: 'folder', source: fixture(t) });
  assert.equal(config.file, null);
  assert.equal(config.prepare, undefined);
  assert.equal(targetSettings(config.capture).studioNetwork, 'assets');
  assert.deepEqual(config.capture.ignoreRequests, []);
});
test('JSON auto-discovery, explicit CJS configuration and edits are picked up on the next run', t => {
  const root = fixture(t), json = path.join(root, 'storybook-studio.config.json');
  fs.writeFileSync(json, JSON.stringify({ version: 1, capture: { readySelector: '#ready' } }));
  assert.equal(loadConfig({ mode: 'build', source: root }).capture.readySelector, '#ready');
  const custom = path.join(root, 'external.cjs');
  fs.writeFileSync(custom, 'module.exports = { version: 1, concurrency: 2 };');
  const project = { mode: 'url', source: 'http://localhost:6006', configFile: custom };
  assert.equal(loadConfig(project).concurrency, 2);
  fs.writeFileSync(custom, 'module.exports = { version: 1, concurrency: 3 };');
  assert.equal(loadConfig(project).concurrency, 3);
});
test('bad configuration fails explicitly and cannot silently fall back to defaults', () => {
  for (const input of [{ version: 2 }, { version: 1, capture: { typo: true } }, { version: 1, capture: { network: 'anything' } }, { version: 1, capture: { ignoreRequests: ['['] } }, { version: 1, concurrency: 0 }]) assert.throws(() => validateConfig(input));
  assert.throws(() => loadConfig({ mode: 'url', source: 'http://localhost', configFile: '/missing/config.cjs' }), /Конфиг/);
});
test('optional rules apply only to matching IDs, preserve defaults, and respect an explicit skip', () => {
  const config = validateConfig({ version: 1, capture: { settleMs: 100 }, stories: [{ match: '^async-', capture: { readySelector: '[data-ready]' } }] });
  assert.equal(storySettings(config, { id: 'async-button--default' }).capture.readySelector, '[data-ready]');
  assert.equal(storySettings(config, { id: 'button--default' }).capture.readySelector, '');
  assert.equal(storySettings(config, { id: 'async-button--default' }).capture.settleMs, 100);
  assert.equal(storySettings(config, { id: 'button--default', parameters: { loki: { skip: true } } }).skip, true);
});
test('external prepare runs in an isolated build copy; it does not change source files', async t => {
  const root = fixture(t), source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'marker.txt'), 'original');
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ scripts: { 'build-storybook': 'node -e "process.exit(0)"' } }));
  const configFile = path.join(root, 'settings.cjs');
  fs.writeFileSync(configFile, `module.exports = { version: 1, prepare: async ({ workspace, run }) => { await run(process.execPath, ['-e', "require('fs').writeFileSync('marker.txt', 'prepared')"]); } };`);
  const store = new Store(path.join(root, 'data'));
  const project = store.add({ name: 'Example', mode: 'build', source, configFile, manager: 'npm' });
  const runner = new Runner(store), run = store.createRun(project.id);
  runner.active = { project, run, config: loadConfig(project), cancelled: false };
  const built = await runner.build(project, run);
  assert.equal(fs.readFileSync(path.join(source, 'marker.txt'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(built.workspace, 'marker.txt'), 'utf8'), 'prepared');
});
