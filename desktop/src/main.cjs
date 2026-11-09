const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { Runner } = require('./runner.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'studio',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const root=process.env.STUDIO_DATA_DIR||path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'storybook-studio');
app.setPath('userData',path.join(root,'electron'));
let win,store,runner,quitting=false;
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{win?.show();win?.focus();});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(()=>{
  store=new Store(root);runner=new Runner(store);
  protocol.handle('studio',async request=>{
    const url=new URL(request.url);
    try {
      let file;
      if(url.hostname==='ui') {
        const name=url.pathname.slice(1)||'index.html';if(!['index.html','app.js','style.css','icon.svg'].includes(name))return new Response('Not found',{status:404});
        file=path.join(__dirname,'../ui',name);
      } else if(url.hostname==='asset') {
        const [projectId,runId,kind,...rest]=url.pathname.slice(1).split('/');
        const storyId=decodeURIComponent(rest.join('/'));
        file=store.imagePath(projectId,runId==='baseline'?null:runId,kind,storyId);
      } else return new Response('Not found',{status:404});
      return await net.fetch(pathToFileURL(file).href);
    }catch{return new Response('Not found',{status:404});}
  });
  win=new BrowserWindow({width:1480,height:980,minWidth:1000,minHeight:700,title:'Storybook Studio',backgroundColor:'#0d1119',icon:path.join(__dirname,'../ui/icon.svg'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('studio://ui/'))event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.on('close',event=>{
    if(runner.active&&!quitting) {
      event.preventDefault();
      dialog.showMessageBox(win,{type:'question',buttons:['Продолжить прогон','Остановить и закрыть'],defaultId:0,cancelId:0,message:'Сейчас выполняется прогон',detail:'Завершённые результаты сохранятся. Незавершённые снимки не будут приняты.'}).then(async ({response})=>{if(response===1){quitting=true;runner.cancel();await runner.promise;app.quit();}});
    }
  });
  let timer;
  store.on('change',()=>{if(timer)return;timer=setTimeout(()=>{timer=null;if(!win.isDestroyed())win.webContents.send('studio:change');},150);});
  ipcMain.handle('studio:call',async (event,action,payload={})=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith('studio://ui/'))throw new Error('Недопустимый источник запроса');
    switch(action) {
      case 'state': return {projects:store.db.projects.map(p=>({...p,referenceCount:Object.keys(store.references(p.id)).length})),active:runner.active?{projectId:runner.active.project.id,runId:runner.active.run.id}:null,dataRoot:root};
      case 'add': return store.add(payload);
      case 'update': if(runner.active?.project.id===payload.id)throw new Error('Дождитесь завершения прогона');return store.update(payload.id,payload.project);
      case 'pick': {const selected=await dialog.showOpenDialog(win,{properties:['openDirectory'],title:'Выберите папку Storybook или проекта'});return selected.canceled?null:selected.filePaths[0];}
      case 'pickConfig': {const selected=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Storybook Studio config',extensions:['cjs','json']}],title:'Выберите конфиг проекта'});return selected.canceled?null:selected.filePaths[0];}
      case 'inspect': {const file=path.join(payload.path,'package.json');if(!fs.existsSync(file))return {scripts:[]};const pkg=JSON.parse(fs.readFileSync(file,'utf8'));const scripts=Object.keys(pkg.scripts||{});const manager=pkg.packageManager?.split('@')[0]||(fs.existsSync(path.join(payload.path,'pnpm-lock.yaml'))?'pnpm':fs.existsSync(path.join(payload.path,'yarn.lock'))?'yarn':'npm');return {name:pkg.name,scripts,manager,buildScript:['build-storybook','storybook:build'].find(s=>scripts.includes(s))};}
      case 'runs': return store.runs(payload.id).map(({results,baseline,logs,...run})=>({...run,counts:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})}));
      case 'run': return store.decorate(payload.id,store.run(payload.id,payload.runId));
      case 'gallery': return store.gallery(payload.id);
      case 'start': return runner.start(payload.id);
      case 'cancel': runner.cancel();return true;
      case 'decide': return store.decide(payload.id,payload.runId,payload.storyId,payload.decision);
      case 'openData': await shell.openPath(root);return true;
      default: throw new Error('Неизвестная команда');
    }
  });
  win.loadURL('studio://ui/index.html');
});
