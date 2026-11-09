const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {serve}=require('../src/runner.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-ui-'));const fixture=path.join(root,'storybook');fs.mkdirSync(fixture);
const entries={'button--primary':{id:'button--primary',title:'Components/Button',name:'Primary',type:'story',importPath:'./button.js'},'card--default':{id:'card--default',title:'Components/Card',name:'Default',type:'story',importPath:'./card.js'}};
fs.writeFileSync(path.join(fixture,'index.json'),JSON.stringify({v:5,entries}));
function writeFixture(color){fs.writeFileSync(path.join(fixture,'iframe.html'),`<!doctype html><html><head><style>body{font:18px sans-serif;padding:30px;background:#f3f5fa}button{background:${color};color:white;border:0;border-radius:12px;padding:20px 40px;font-size:20px}article{background:white;border-radius:16px;padding:35px;width:360px;box-shadow:0 10px 30px #0001}</style></head><body><div id="storybook-root"></div><script>const id=new URL(location.href).searchParams.get('id');document.querySelector('#storybook-root').innerHTML=id==='button--primary'?'<h1>Button</h1><button>Continue</button>':'<article><h1>Project overview</h1><p>All systems operational</p></article>';window.__STORYBOOK_PREVIEW__={ready:async()=>{},extract:async()=>(${JSON.stringify(entries)}),currentRender:{phase:'finished'}};</script></body></html>`);}
writeFixture('#6366f1');let app,server;const errors=[];
async function launch(){app=await electron.launch({executablePath:process.env.STUDIO_EXECUTABLE,args:process.env.STUDIO_EXECUTABLE?['--no-sandbox']:[path.join(__dirname,'..'),'--no-sandbox'],env:{...process.env,STUDIO_DATA_DIR:path.join(root,'data')},timeout:60000});const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('#add-project');return page;}
async function completed(page){await page.waitForFunction(()=>document.querySelector('#run-state').textContent.includes('Завершён'),{},{timeout:120000});}
async function add(page,name,mode,source){await page.locator('#add-project').click();await page.locator('[name=name]').fill(name);await page.locator('[name=mode]').selectOption(mode);await page.locator('[name=source]').fill(source);await page.locator('#project-form button[type=submit]').click();await page.waitForFunction(name=>document.querySelector('#project-title').textContent===name,name);}
(async()=>{
 try{
  let page=await launch();await add(page,'Design System','folder',fixture);await page.locator('#run').click();await completed(page);
  assert.equal(await page.locator('.result-card').count(),2);await page.locator('[data-filter="review"]').click();await page.locator('[data-story="button--primary"]').click();await page.locator('#approve').click();await page.waitForFunction(()=>document.querySelector('#review-status').textContent.includes('Принят'));
  await page.locator('#next-result').click();assert.equal(await page.locator('#review-title').textContent(),'Default');await page.locator('#reject').click();await page.waitForFunction(()=>document.querySelector('#review-status').textContent.includes('Отклонён'));await page.locator('#close-review').click();
  const firstProject=await page.evaluate(()=>window.studio.call('state').then(s=>s.projects[0]));assert.equal(firstProject.referenceCount,1);
  writeFixture('#e87937');await page.locator('#run').click();await completed(page);await page.locator('[data-story="button--primary"]').click();await page.locator('[data-view=diff]').click();await page.waitForFunction(()=>document.querySelector('#comparison img')?.naturalWidth>0);await page.screenshot({path:path.join(__dirname,'../artifacts/difference.png')});
  await page.locator('[data-view=overlay]').click();await page.locator('#opacity').fill('65');await page.locator('#reject').click();await page.waitForFunction(()=>document.querySelector('#review-status').textContent.includes('Отклонён'));await page.locator('#approve').click();await page.waitForFunction(()=>document.querySelector('#review-status').textContent.includes('Принят'));await page.locator('#close-review').click();
  await page.locator('[data-story="card--default"]').click();await page.locator('#approve').click();await page.waitForFunction(()=>document.querySelector('#review-status').textContent.includes('Принят'));await page.locator('#close-review').click();
  await page.locator('#run').click();await completed(page);assert.equal(await page.locator('.pill.same').count(),2);
  await page.locator('[data-tab=gallery]').click();await page.waitForFunction(()=>document.querySelectorAll('.result-card').length===2);await page.waitForFunction(()=>Array.from(document.querySelectorAll('.thumbnail img')).every(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:path.join(__dirname,'../artifacts/gallery.png')});
  const configFile=path.join(root,'capture.json');fs.writeFileSync(configFile,JSON.stringify({version:1,capture:{readySelector:'#storybook-root'}}));
  await page.locator('#settings').click();await page.locator('[name=configFile]').fill(configFile);await page.locator('#project-form button[type=submit]').click();await page.locator('#project-dialog').waitFor({state:'hidden'});
  await page.locator('#run').click();await completed(page);assert.equal(await page.locator('.pill.same').count(),2);
  for(let i=0;i<22;i++)entries['extra--'+i]={id:'extra--'+i,title:'Components/Extra',name:'Variant '+i,type:'story',importPath:'./extra.js'};
  fs.writeFileSync(path.join(fixture,'index.json'),JSON.stringify({v:5,entries}));writeFixture('#e87937');
  server=await serve(fixture);await add(page,'Second project','url',server.url);assert.equal(await page.locator('#baseline-count').textContent(),'0');await page.locator('#run').click();
  await page.waitForSelector('.result-card');assert.ok(await page.evaluate(()=>window.studio.call('state').then(s=>!!s.active)));
  await page.locator('.result-card').first().click();await page.locator('#approve').click();await page.waitForFunction(()=>document.querySelector('#review-status').textContent.includes('Принят'));await page.locator('#close-review').click();
  await completed(page);assert.equal(await page.locator('.pill.new').count(),23);
  await page.locator('#run').click();await page.locator('#cancel').click();await page.waitForFunction(()=>document.querySelector('#run-state').textContent.includes('Отменён'),{},{timeout:30000});await page.waitForFunction(()=>!document.querySelector('#run').disabled);
  await app.close();page=await launch();await page.waitForFunction(()=>document.querySelectorAll('.project-item').length===2);assert.equal(errors.length,0,errors.join('\n'));
  assert.equal(await page.evaluate(()=>window.studio.call('state').then(s=>s.projects[0].configFile)),configFile);
  console.log('UI passed: two projects, folder and URL runs, external configuration, live approval, accept/reject, diff, overlay, gallery, cancellation, persistent history.');
 }finally{await app?.close();await server?.close();await fsp.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
