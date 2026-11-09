const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createChromeDockerTarget } = require('@loki/target-chrome-docker');
const { createPixelmatchDiffer } = require('@loki/diff-pixelmatch');
const { hash } = require('./store.cjs');
const { loadConfig, storySettings, targetSettings } = require('./config.cjs');
const IMAGE = 'yukinying/chrome-headless-browser-stable@sha256:626c200c0a94e7ee87cc883e4ae6d5f47a4639c31e316e76f4c684bdf4be9934';
const FLAGS = '--headless --disable-gpu --hide-scrollbars --no-sandbox --disable-partial-raster --disable-skia-runtime-opts --run-all-compositor-stages-before-draw --force-color-profile=srgb'.split(' ');
function serve(root) {
  root = fs.realpathSync(root);
  const mime = { '.js':'text/javascript', '.html':'text/html', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.ttf':'font/ttf' };
  const server = http.createServer((req,res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      const real = fs.realpathSync(file);
      if (!real.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const data = fs.readFileSync(real); res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',()=>resolve({ url:`http://127.0.0.1:${server.address().port}`, close:()=>new Promise(r=>{server.close(r);server.closeAllConnections();}) })); });
}
class Runner {
  constructor(store) { this.store=store; this.active=null; }
  log(text) { const a=this.active; if (!a) return; a.run.logs.push(String(text).slice(-4000)); a.run.logs=a.run.logs.slice(-150); this.persist(); }
  persist() {
    if (!this.active) return;
    // Preserve review decisions made while the worker is producing more screenshots.
    const a=this.active, saved=this.store.run(a.project.id,a.run.id);
    const decisions=new Map(saved.results.map(r=>[r.id,r]));
    for(const result of a.run.results) {const prior=decisions.get(result.id); if(prior?.decision) {result.decision=prior.decision;result.reviewedAt=prior.reviewedAt;} }
    this.store.saveRun(a.project.id,a.run);
  }
  start(id) {
    if(this.active) throw new Error('Другой прогон уже выполняется');
    const project={...this.store.project(id)},config=loadConfig(project),run=this.store.createRun(id);
    run.configuration={file:config.file,capture:config.capture,concurrency:config.concurrency,threshold:config.threshold,stories:config.stories};
    this.store.saveRun(id,run);
    this.active={project,config,run,cancelled:false,child:null,target:null};
    this.promise=this.execute().finally(()=>{this.active=null;this.store.emit('change');});
    return run;
  }
  cancel() { if(!this.active)return;this.active.cancelled=true;this.log('Отмена прогона…');if(this.active.child){try{process.kill(-this.active.child.pid,'SIGTERM');}catch{}} if(this.active.target)void this.active.target.stop().catch(()=>{}); }
  check() { if(this.active.cancelled)throw new Error('Прогон отменён'); }
  command(command,args,cwd) {
    this.check(); return new Promise((resolve,reject)=>{
      const child=spawn(command,args,{cwd,detached:true,env:{...process.env,CI:'1',STORYBOOK_DISABLE_TELEMETRY:'1'}});this.active.child=child;
      child.stdout.on('data',d=>this.log(d.toString()));child.stderr.on('data',d=>this.log(d.toString()));
      child.once('error',reject);child.once('exit',code=>{this.active.child=null;code===0?resolve():reject(new Error(`Команда ${command} завершилась с кодом ${code}`));});
    });
  }
  async build(project, run) {
    const workspace=path.join(this.store.dir(project.id),'workspaces',run.id);this.active.workspace=workspace;
    const ignored=new Set(['.git','node_modules','storybook-static','.loki','dist','.next','.cache','coverage']);
    const source=fs.realpathSync(project.source);
    if(this.store.root.startsWith(source+path.sep))throw new Error('Папка проекта не должна содержать хранилище приложения');
    this.log('Создаю изолированную копию проекта…');
    await fsp.cp(source,workspace,{recursive:true,filter:file=>!path.relative(source,file).split(path.sep).some(p=>ignored.has(p))});
    if(fs.existsSync(path.join(source,'node_modules')))await fsp.symlink(path.join(source,'node_modules'),path.join(workspace,'node_modules'),'dir');
    this.check();
    if(this.active.config.prepare) {
      this.log(`Подготовка из внешнего конфига: ${this.active.config.file}`);
      try {
        await this.active.config.prepare({workspace,source,run:(command,args=[])=>this.command(command,args,workspace),log:message=>this.log(message)});
      } catch (error) {
        throw new Error(`Ошибка prepare в ${this.active.config.file}: ${error.message}`);
      }
    }
    const pkg=JSON.parse(await fsp.readFile(path.join(workspace,'package.json'),'utf8'));
    if(!pkg.scripts?.[project.buildScript])throw new Error(`В package.json нет scripts.${project.buildScript}`);
    await this.command(project.manager,['run',project.buildScript],workspace);
    this.check();return {folder:path.join(workspace,project.output),workspace};
  }
  async execute() {
    const a=this.active,{project,run,config}=a; let server;
    const originalSignals=new Set(process.listeners('SIGINT'));
    try {
      let url=project.source;
      this.log(config.file?`Конфиг: ${config.file}`:'Стандартные настройки; внешний конфиг не задан');
      if(project.mode!=='build'&&config.prepare)throw new Error('prepare доступен только для сборки исходного проекта');
      if(project.mode==='build') {run.status='building';this.persist();const built=await this.build(project,run);url=built.folder;}
      if(project.mode!=='url') {
        if(!fs.existsSync(path.join(url,'iframe.html')) || !fs.existsSync(path.join(url,'index.json')))throw new Error('В папке нет iframe.html и index.json. Выберите готовую сборку Storybook.');
        server=await serve(url);url=server.url;
      }
      url=url.replace(/\/$/,'');this.check();run.status='preparing';this.log('Запускаю Chrome в Docker…');
      a.target=createChromeDockerTarget({baseUrl:url,chromeDockerImage:IMAGE,chromeFlags:FLAGS,dockerNet:'host'});
      await a.target.prepare();this.check();await a.target.start();this.check();
      const indexResponse=await fetch(url+'/index.json',{signal:AbortSignal.timeout(30000)});
      if(!indexResponse.ok)throw new Error('Не удалось получить index.json');
      const index=await indexResponse.json();
      const indexed=Object.values(index.entries||{}).filter(s=>s.type==='story');
      const allStories=await a.target.getStorybook();this.check();
      const ids=new Set(allStories.map(s=>s.id));
      const missing=indexed.filter(s=>!ids.has(s.id));
      if(missing.length)throw new Error(`Loki не получил ${missing.length} историй из индекса: ${missing.slice(0,3).map(s=>s.id).join(', ')}`);
      let filter;try {filter=project.filter?new RegExp(project.filter,'i'):null;}catch{throw new Error('Некорректный фильтр историй');}
      const stories=allStories.filter(s=>(!filter||filter.test(`${s.kind} ${s.story}`))&&!storySettings(config,s).skip);
      if(!stories.length)throw new Error('Нет историй для проверки');
      run.total=stories.length;run.status='running';this.persist();
      const differ=createPixelmatchDiffer({threshold:config.threshold,includeAA:true});let cursor=0;
      const worker=async()=>{
        while(cursor<stories.length&&!a.cancelled) {
          const story=stories[cursor++];const result={id:story.id,title:story.kind,name:story.story,status:'error',decision:null};
          try {
            const {capture}=storySettings(config,story);
            const bytes=await a.target.captureScreenshotForStory(story.id,{chromeLoadTimeout:capture.timeoutMs,chromeSelector:capture.selector}, {width:project.width,height:project.height,deviceScaleFactor:1,...targetSettings(capture)},story.parameters||{});
            if(!Buffer.isBuffer(bytes)||!bytes.length)throw new Error('Браузер не вернул снимок');
            const current=this.store.imagePath(project.id,run.id,'current',story.id);await fsp.mkdir(path.dirname(current),{recursive:true});await fsp.writeFile(current,bytes);result.hash=hash(bytes);
            result.status=run.baseline[story.id]?(await differ(this.store.imagePath(project.id,run.id,'reference',story.id),current,this.store.imagePath(project.id,run.id,'difference',story.id),0)?'same':'changed'):'new';
          } catch(error) {result.error=error.message;}
          if(a.cancelled)break;
          run.results.push(result);run.completed++;this.persist();
        }
      };
      await Promise.all(Array.from({length:config.concurrency},worker));this.check();
      if(!filter)for(const ref of Object.values(run.baseline))if(!ids.has(ref.id))run.results.push({id:ref.id,title:ref.title,name:ref.name,status:'removed',decision:null});
      run.status=run.results.some(r=>r.status==='error')?'error':'completed';run.finishedAt=new Date().toISOString();this.persist();
    } catch(error) {run.status=a.cancelled?'cancelled':'error';run.error=error.message;run.finishedAt=new Date().toISOString();this.persist();}
    finally {
      if(a.target)await a.target.stop().catch(error=>this.log(error.message));
      if(server)await server.close();
      if(a.workspace)await fsp.rm(a.workspace,{recursive:true,force:true}).catch(()=>{});
      for(const listener of process.listeners('SIGINT'))if(!originalSignals.has(listener))process.removeListener('SIGINT',listener);
    }
  }
}
module.exports={Runner,serve,IMAGE};
