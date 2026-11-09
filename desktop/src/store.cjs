const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const key = id => hash(id);
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}
function read(file, fallback) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
class Store extends EventEmitter {
  constructor(root) {
    super(); this.root = root; fs.mkdirSync(root, { recursive: true });
    this.db = read(path.join(root, 'projects.json'), { projects: [] });
    for (const project of this.db.projects) {
      for (const run of this.runs(project.id)) if (['running', 'building', 'preparing'].includes(run.status)) {
        run.status = 'interrupted'; run.error = 'Приложение было закрыто во время прогона'; this.saveRun(project.id, run);
      }
    }
  }
  save() { atomic(path.join(this.root, 'projects.json'), this.db); this.emit('change'); }
  project(id) { const p = this.db.projects.find(p => p.id === id); if (!p) throw new Error('Проект не найден'); return p; }
  dir(id) { this.project(id); return path.join(this.root, 'projects', id); }
  add(input) {
    const project = this.validate(input); project.id = crypto.randomUUID(); project.createdAt = new Date().toISOString();
    this.db.projects.push(project); this.save(); return project;
  }
  validate(input) {
    const name = String(input.name || '').trim(); if (!name) throw new Error('Укажите название проекта');
    if (!['folder', 'url', 'build'].includes(input.mode)) throw new Error('Неизвестный источник');
    const source = String(input.source || '').trim(); if (!source) throw new Error('Укажите путь или URL');
    if (input.mode === 'url') { const u = new URL(source); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Нужен HTTP или HTTPS URL'); }
    else if (!path.isAbsolute(source)) throw new Error('Нужен абсолютный путь');
    const width = Number(input.width || 1440), height = Number(input.height || 900);
    if (![width, height].every(v => Number.isInteger(v) && v >= 200 && v <= 4096)) throw new Error('Размер должен быть от 200 до 4096');
    const output = String(input.output || 'storybook-static');
    if (path.isAbsolute(output) || output.split(/[\\/]/).includes('..')) throw new Error('Папка сборки должна находиться внутри проекта');
    const manager = input.manager || 'npm'; if (!['pnpm', 'npm', 'yarn'].includes(manager)) throw new Error('Неизвестный менеджер пакетов');
    const configFile = String(input.configFile || '').trim();
    if (configFile && (!path.isAbsolute(configFile) || !/\.(cjs|json)$/.test(configFile))) throw new Error('Нужен абсолютный путь к .cjs или .json конфигу');
    const filter = String(input.filter || '');
    if (filter) { try { new RegExp(filter); } catch { throw new Error('Некорректный фильтр историй'); } }
    return { name, mode: input.mode, source, width, height, output, manager, buildScript: String(input.buildScript || 'build-storybook'), configFile, filter };
  }
  update(id, input) { const p = this.project(id); Object.assign(p, this.validate(input)); this.save(); return p; }
  references(id) { return read(path.join(this.dir(id), 'references.json'), {}); }
  saveReferences(id, refs) { atomic(path.join(this.dir(id), 'references.json'), refs); }
  runs(id) {
    const dir = path.join(this.dir(id), 'runs');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(n => /^[\da-f-]{36}$/.test(n)).map(n => read(path.join(dir, n, 'run.json'), null)).filter(Boolean).sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  }
  run(id, runId) { if (!/^[\da-f-]{36}$/.test(runId)) throw new Error('Некорректный прогон'); const r = read(path.join(this.dir(id), 'runs', runId, 'run.json'), null); if (!r) throw new Error('Прогон не найден'); return r; }
  saveRun(id, run) { atomic(path.join(this.dir(id), 'runs', run.id, 'run.json'), run); this.emit('change'); }
  createRun(id) {
    const project = this.project(id), refs = this.references(id);
    const run = { id: crypto.randomUUID(), project: { ...project }, startedAt: new Date().toISOString(), status: 'preparing', total: 0, completed: 0, results: [], logs: [], error: null };
    this.saveRun(id, run);
    for (const [storyId, ref] of Object.entries(refs)) {
      const dest = this.imagePath(id, run.id, 'reference', storyId); fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(this.imagePath(id, null, 'reference', storyId), dest);
    }
    run.baseline = refs; this.saveRun(id, run); return run;
  }
  imagePath(id, runId, kind, storyId) {
    if (!['reference', 'current', 'difference'].includes(kind)) throw new Error('Неизвестный тип изображения');
    if (runId && !/^[\da-f-]{36}$/.test(runId)) throw new Error('Некорректный прогон');
    return path.join(this.dir(id), ...(runId ? ['runs', runId] : []), kind, key(storyId) + '.png');
  }
  imageURL(id, runId, kind, storyId) { return `studio://asset/${id}/${runId || 'baseline'}/${kind}/${encodeURIComponent(storyId)}`; }
  decorate(id, run) {
    return { ...run, results: run.results.map(r => ({ ...r, referenceURL: run.baseline[r.id] ? this.imageURL(id, run.id, 'reference', r.id) : null, currentURL: ['new','changed','same'].includes(r.status) ? this.imageURL(id, run.id, 'current', r.id) : null, differenceURL: r.status === 'changed' ? this.imageURL(id, run.id, 'difference', r.id) : null })) };
  }
  decide(id, runId, storyId, decision) {
    if (!['approved', 'rejected'].includes(decision)) throw new Error('Некорректное решение');
    const run = this.run(id, runId), result = run.results.find(r => r.id === storyId);
    if (!result || !['new','changed','removed'].includes(result.status)) throw new Error('Этот результат нельзя принять');
    if (result.decision === 'approved') throw new Error('Изменение уже принято');
    const refs = this.references(id);
    if ((refs[storyId]?.hash || null) !== (run.baseline[storyId]?.hash || null)) throw new Error('Эталон изменён другим прогоном. Запустите новую проверку.');
    if (decision === 'approved') {
      if (result.status === 'removed') { delete refs[storyId]; fs.rmSync(this.imagePath(id, null, 'reference', storyId), { force: true }); }
      else {
        const source = this.imagePath(id, runId, 'current', storyId), dest = this.imagePath(id, null, 'reference', storyId);
        const bytes = fs.readFileSync(source); if (hash(bytes) !== result.hash) throw new Error('Снимок повреждён');
        fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest + '.tmp', bytes); fs.renameSync(dest + '.tmp', dest);
        refs[storyId] = { id: storyId, title: result.title, name: result.name, hash: result.hash, approvedAt: new Date().toISOString(), runId, width: run.project.width, height: run.project.height };
      }
      this.saveReferences(id, refs);
    }
    result.decision = decision; result.reviewedAt = new Date().toISOString(); this.saveRun(id, run);
    return this.decorate(id, run);
  }
  gallery(id) { return Object.values(this.references(id)).map(r => ({ ...r, referenceURL: this.imageURL(id, null, 'reference', r.id) + '?v=' + r.hash })); }
}
module.exports = { Store, atomic, hash, key };
