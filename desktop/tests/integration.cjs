const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { Store } = require('../src/store.cjs');
const { Runner, serve } = require('../src/runner.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-integration-'));
const store = new Store(root), runner = new Runner(store);
const report = [];
async function run(project) {
  const started = runner.start(project.id);
  await runner.promise;
  return store.run(project.id, started.id);
}
async function verify(name, expected) {
  const source = path.join(__dirname, 'fixtures', name, 'storybook-static');
  const staticServer = await serve(source);
  const proxy = http.createServer((req, res) => {
    // A real, permanently pending fetch; no story-specific setting is passed to the runner.
    if (req.url === '/nested/pending') return;
    if (!req.url.startsWith('/nested/')) return res.writeHead(404).end();
    const request = http.get(staticServer.url + req.url.slice('/nested'.length), response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    request.on('error', () => res.writeHead(502).end());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const configFile = path.join(root, name + '.json');
    fs.writeFileSync(configFile, JSON.stringify({ version: 1, capture: { timeoutMs: 10000 } }));
    // The first run uses the public defaults, without any project configuration.
    const project = store.add({ name, mode: 'url', source: `http://127.0.0.1:${proxy.address().port}/nested` });
    const first = await run(project);
    console.log(name, first.results.map(r => ({ id: r.id, status: r.status, error: r.error })));
    assert.equal(first.total, expected.total);
    assert.equal(first.results.filter(r => r.status === 'new').length, expected.valid);
    assert.equal(first.results.filter(r => r.status === 'error').length, expected.errors);
    assert.ok(first.results.filter(r => r.id.endsWith('--with-play')).every(r => r.status === 'new'));
    if (name.startsWith('html')) {
      assert.equal(first.results.find(r => r.id.endsWith('--permanent-loading')).status, 'new');
      assert.ok(!first.results.some(r => r.id.endsWith('--skipped')));
    }
    for (const result of first.results.filter(r => r.status === 'new')) store.decide(project.id, first.id, result.id, 'approved');
    fs.writeFileSync(configFile, JSON.stringify({ version: 1, capture: { timeoutMs: 10000 }, stories: [{ match: '--broken(?:-play|-image)?$', skip: true }] }));
    store.update(project.id, { ...project, configFile });
    const second = await run(project);
    assert.equal(second.status, 'completed', second.error);
    assert.equal(second.results.length, expected.valid);
    assert.ok(second.results.every(r => r.status === 'same'));
    if (name === 'html9') {
      fs.writeFileSync(configFile, JSON.stringify({ version: 1, capture: { timeoutMs: 10000 }, stories: [
        { match: '--broken(?:-play|-image)?$', skip: true },
        { match: '--permanent-loading$', capture: { network: 'all', timeoutMs: 1000 } },
        { match: '--default$', capture: { readySelector: '[data-never-ready]', timeoutMs: 1000 } },
      ] }));
      const strict = await run(project);
      assert.equal(strict.results.filter(r => r.status === 'error').length, 2);
      assert.equal(strict.results.find(r => r.id.endsWith('--with-play')).status, 'same');
      assert.equal(store.gallery(project.id).length, expected.valid);
    }
    const screenshot = first.results.find(r => r.id.endsWith('--with-play'));
    fs.copyFileSync(store.imagePath(project.id, first.id, 'current', screenshot.id), path.join(__dirname, '../artifacts', name + '-play.png'));
    report.push({ fixture: name, detectedErrors: expected.errors, repeatMatches: expected.valid, permanentFetch: name.startsWith('html') ? 'passed' : undefined });
  } finally {
    await new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); });
    await staticServer.close();
  }
}
(async () => {
  fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
  try {
    await verify('html9', { total: 6, valid: 3, errors: 3 });
    await verify('html10', { total: 6, valid: 3, errors: 3 });
    await verify('vue8', { total: 3, valid: 2, errors: 1 });
    await verify('react8', { total: 3, valid: 2, errors: 1 });
    fs.writeFileSync(path.join(__dirname, '../artifacts/compatibility.json'), JSON.stringify(report, null, 2));
    console.log('Real Storybook compatibility passed:', report);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
