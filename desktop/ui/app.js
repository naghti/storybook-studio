const $ = selector => document.querySelector(selector);
const call = (action,payload) => window.studio.call(action,payload);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={same:'Совпадает',new:'Новый',changed:'Изменён',removed:'Удалён',error:'Ошибка',approved:'Принят',rejected:'Отклонён',completed:'Завершён',running:'Снимаю истории',building:'Сборка Storybook',preparing:'Подготовка',cancelled:'Отменён',interrupted:'Прерван'};
const S={state:{projects:[]},projectId:localStorage.getItem('projectId'),runId:null,run:null,runs:[],gallery:[],tab:'runs',filter:'review',search:'',limit:60,reviewId:null,view:'side',native:false,busy:false,pending:false};
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),6000);}
function safe(fn){return async (...args)=>{try{return await fn(...args);}catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}};}
function plural(n,words){const v=n%100;return words[v>=11&&v<=19?2:n%10===1?0:n%10>=2&&n%10<=4?1:2];}
function pill(status){return `<span class="pill ${status}">${escapeHTML(labels[status]||status)}</span>`;}
function date(value){return new Date(value).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}
function project(){return S.state.projects.find(p=>p.id===S.projectId);}
async function refresh(){
 if(S.busy){S.pending=true;return;} S.busy=true;
 try{
  S.state=await call('state');if(!project()){S.projectId=S.state.projects[0]?.id;S.runId=null;}
  if(S.projectId){
   S.runs=await call('runs',{id:S.projectId});if(!S.runs.some(r=>r.id===S.runId))S.runId=S.runs[0]?.id;
   S.run=S.runId?await call('run',{id:S.projectId,runId:S.runId}):null;
   if(S.tab==='gallery')S.gallery=await call('gallery',{id:S.projectId});
  }
  render();
 }finally{S.busy=false;if(S.pending){S.pending=false;void safe(refresh)();}}
}
function render(){
 $('#projects').innerHTML=S.state.projects.map(p=>`<button class="project-item ${p.id===S.projectId?'active':''}" data-project="${p.id}"><span class="project-avatar">${escapeHTML(p.name.slice(0,1).toUpperCase())}</span><span><strong>${escapeHTML(p.name)}</strong><small>${p.referenceCount} ${plural(p.referenceCount,['эталон','эталона','эталонов'])}${S.state.active?.projectId===p.id?' · идёт прогон':''}</small></span></button>`).join('');
 const p=project();$('#empty').classList.toggle('hidden',!!p);$('#workspace').classList.toggle('hidden',!p);$('#settings').classList.toggle('hidden',!p);$('#run').classList.toggle('hidden',!p);
 if(!p)return;
 $('#project-title').textContent=p.name;$('#project-path').textContent=p.source;$('#project-path').title=p.source;$('#source-type').textContent={build:'◈ Сборка проекта',folder:'▣ Готовая сборка',url:'↗ Storybook по URL'}[p.mode];$('#baseline-count').textContent=p.referenceCount;
 $('#run').disabled=!!S.state.active;$('#run').title=S.state.active?'Дождитесь завершения текущего прогона':'';
 $('#cancel').classList.toggle('hidden',S.state.active?.projectId!==S.projectId);$('#settings').disabled=S.state.active?.projectId===S.projectId;
 $('#run-view').classList.toggle('hidden',S.tab!=='runs');$('#filters').classList.toggle('hidden',S.tab!=='runs');$('#logs-panel').classList.toggle('hidden',S.tab!=='runs'||!S.run);
 $('.toolbar .tabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.tab===S.tab));
 $('#run-select').innerHTML=S.runs.map(r=>`<option value="${r.id}" ${r.id===S.runId?'selected':''}>${escapeHTML(date(r.startedAt))} · ${escapeHTML(labels[r.status])} · ${r.completed}/${r.total}</option>`).join('');
 $('#run-select').disabled=!S.runs.length;$('#no-runs').classList.toggle('hidden',!!S.run);$('#stats').innerHTML='';$('#run-state').innerHTML='';$('#run-error').classList.add('hidden');$('#run-progress').classList.add('hidden');
 if(S.run){
  const r=S.run,counts=r.results.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),pending=r.results.filter(x=>['changed','new','removed'].includes(x.status)&&!x.decision).length;
  $('#run-state').innerHTML=r.status==='completed'&&r.results.some(x=>['new','changed','removed'].includes(x.status)&&x.decision!=='approved')?'<span class="pill changed">Завершён · есть изменения</span>':pill(r.status);$('#stats').innerHTML=[[r.completed+'/'+r.total,'Проверено',''],[counts.same||0,'Совпадают','same'],[pending,'Ждут решения','changed'],[counts.new||0,'Новых снимков',''],[counts.error||0,'Ошибок','error']].map(([n,t,c])=>`<div class="stat ${c}"><strong>${n}</strong><span>${t}</span></div>`).join('');
  $('#run-error').classList.toggle('hidden',!r.error);$('#run-error').textContent=r.error||'';
  const active=['running','building','preparing'].includes(r.status);$('#run-progress').classList.toggle('hidden',!active);$('#progress-fill').style.width=(r.total?r.completed/r.total*100:8)+'%';
  $('#logs').textContent=r.logs.join('\n');
 }
 renderResults();
 if($('#review-dialog').open)renderReview();
}
function allResults(){return S.tab==='gallery'?S.gallery.map(r=>({...r,status:'same',decision:'approved'})):(S.run?.results||[]);}
function filtered(){return allResults().filter(r=>`${r.title} ${r.name}`.toLowerCase().includes(S.search.toLowerCase())).filter(r=>S.tab==='gallery'||S.filter==='all'||(S.filter==='review'?['new','changed','removed'].includes(r.status)&&!r.decision:r.status===S.filter)).sort((a,b)=>(a.title+' '+a.name).localeCompare(b.title+' '+b.name));}
function renderResults(){
 const results=filtered();$('#result-count').textContent=results.length+' '+plural(results.length,['история','истории','историй']);
 $('#filters').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.filter===S.filter));
 if(!results.length){$('#results').innerHTML=`<div class="result-empty">${S.tab==='gallery'?'Пока нет принятых эталонов. Запустите прогон и подтвердите новые снимки.':S.filter==='review'?'Нет снимков, ожидающих решения.<br>Все результаты доступны во вкладке «Все».':'Нет подходящих историй.'}</div>`;return;}
 $('#results').innerHTML=results.slice(0,S.limit).map(r=>`<button class="result-card" data-story="${escapeHTML(r.id)}"><div class="thumbnail">${(r.currentURL||r.referenceURL)?`<img loading="lazy" src="${escapeHTML(r.currentURL||r.referenceURL)}" alt="${escapeHTML(r.name)}">`:'<span class="placeholder">▧</span>'}</div><div class="card-content"><div class="component-label" title="${escapeHTML(r.title)}">${escapeHTML(r.title)}</div><div class="card-bottom"><strong>${escapeHTML(r.name)}</strong>${pill(r.decision||r.status)}</div></div></button>`).join('')+(results.length>S.limit?'<button id="load-more" class="secondary load-more">Показать ещё 60</button>':'');
}
function openReview(id){S.reviewIds=filtered().map(r=>r.id);S.reviewId=id;S.view='side';S.native=false;$('#review-message').classList.add('hidden');renderReview();$('#review-dialog').showModal();}
function renderReview(){
 const r=allResults().find(r=>r.id===S.reviewId);if(!r)return;
 $('#review-component').textContent=r.title;$('#review-title').textContent=r.name;$('#review-status').innerHTML=pill(r.decision||r.status);
 const reviewable=S.tab==='runs'&&['new','changed','removed'].includes(r.status)&&r.decision!=='approved';
 $('#approve').classList.toggle('hidden',!reviewable);$('#reject').classList.toggle('hidden',!reviewable);$('#approve').textContent=r.status==='removed'?'Подтвердить удаление':'Подтвердить';
 const panel=(label,url)=>`<section class="image-panel"><h3>${label}</h3>${url?`<img src="${escapeHTML(url)}" alt="${label}">`:'<div class="missing">Нет снимка</div>'}</section>`;
 let content;
 if(S.tab==='gallery')content=panel('СОХРАНЁННЫЙ ЭТАЛОН',r.referenceURL);
 else if(S.view==='side')content=panel('ЭТАЛОН НА МОМЕНТ ПРОГОНА',r.referenceURL)+panel('НОВЫЙ СНИМОК',r.currentURL);
 else if(S.view==='diff')content=r.differenceURL?panel('РАЗЛИЧИЯ ВЫДЕЛЕНЫ КРАСНЫМ',r.differenceURL):'<div class="result-empty">'+(r.status==='same'?'Снимки совпадают пиксель в пиксель.':'Для этого результата нет изображения различий.')+'</div>';
 else content=r.referenceURL&&r.currentURL?`<div class="comparison-overlay"><img src="${escapeHTML(r.referenceURL)}" alt="Эталон"><img id="overlay-current" src="${escapeHTML(r.currentURL)}" alt="Новый снимок" style="opacity:${Number($('#opacity').value)/100}"></div>`:'<div class="result-empty">Наложение доступно, когда есть оба снимка.</div>';
 if($('#comparison').dataset.signature!==r.id+S.tab+S.view+S.native+String(r.currentURL)+String(r.referenceURL)){$('#comparison').innerHTML=content;$('#comparison').dataset.signature=r.id+S.tab+S.view+S.native+String(r.currentURL)+String(r.referenceURL);}
 $('#comparison').classList.toggle('native-size',S.native);$('#zoom').textContent=S.native?'Вписать в окно':'Масштаб 1:1';$('#opacity-label').classList.toggle('hidden',S.view!=='overlay');
 $('.review-toolbar .tabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.view===S.view));
 const items=S.reviewIds,index=items.indexOf(r.id);$('#prev-result').disabled=index<=0;$('#next-result').disabled=index<0||index>=items.length-1;
 if(r.error){$('#review-message').textContent=r.error;$('#review-message').classList.remove('hidden');}
}
async function showProject(edit=false){
 const form=$('#project-form');form.reset();S.editing=edit?S.projectId:null;$('#dialog-title').textContent=edit?'Настройки проекта':'Новый проект';$('#form-error').classList.add('hidden');
 if(edit){const p=project();for(const name of ['name','mode','source','manager','buildScript','output','configFile','width','height','filter'])form.elements[name].value=p[name]??'';}
 changeMode();$('#project-dialog').showModal();
}
function changeMode(){const mode=$('#project-form').elements.mode.value;$('#build-fields').classList.toggle('hidden',mode!=='build');$('#browse').classList.toggle('hidden',mode==='url');}
async function decide(decision){
 $('#approve').disabled=true;$('#reject').disabled=true;
 try{S.run=await call('decide',{id:S.projectId,runId:S.runId,storyId:S.reviewId,decision});toast(decision==='approved'?'Эталон обновлён':'Изменение отклонено. Эталон сохранён.');await refresh();}
 catch(error){$('#review-message').textContent=error.message;$('#review-message').classList.remove('hidden');}
 finally{$('#approve').disabled=false;$('#reject').disabled=false;}
}
$('#projects').addEventListener('click',safe(async e=>{const button=e.target.closest('[data-project]');if(!button)return;S.projectId=button.dataset.project;localStorage.setItem('projectId',S.projectId);S.runId=null;S.limit=60;await refresh();}));
$('#add-project').onclick=$('#empty-add').onclick=()=>showProject();$('#settings').onclick=()=>showProject(true);
$('#close-project').onclick=$('#cancel-project').onclick=()=>$('#project-dialog').close();
$('#project-form').elements.mode.onchange=changeMode;
$('#browse').onclick=safe(async()=>{const selected=await call('pick');if(!selected)return;const form=$('#project-form');form.elements.source.value=selected;const info=await call('inspect',{path:selected});$('#build-scripts').innerHTML=info.scripts.map(s=>`<option value="${escapeHTML(s)}">`).join('');if(!form.elements.name.value)form.elements.name.value=info.name||selected.split('/').pop();if(['pnpm','npm','yarn'].includes(info.manager))form.elements.manager.value=info.manager;if(info.buildScript)form.elements.buildScript.value=info.buildScript;});
$('#browse-config').onclick=safe(async()=>{const selected=await call('pickConfig');if(selected)$('#project-form').elements.configFile.value=selected;});
$('#project-form').onsubmit=async e=>{e.preventDefault();try{const input=Object.fromEntries(new FormData(e.target));const p=S.editing?await call('update',{id:S.editing,project:input}):await call('add',input);S.projectId=p.id;S.runId=null;localStorage.setItem('projectId',p.id);$('#project-dialog').close();await refresh();}catch(error){$('#form-error').textContent=error.message;$('#form-error').classList.remove('hidden');}};
$('#run').onclick=safe(async()=>{$('#run').disabled=true;try{const r=await call('start',{id:S.projectId});S.runId=r.id;S.tab='runs';S.filter='all';S.limit=60;}finally{await refresh();}});
$('#cancel').onclick=safe(()=>call('cancel'));$('#open-data').onclick=safe(()=>call('openData'));
$('.toolbar .tabs').onclick=safe(async e=>{if(!e.target.dataset.tab)return;S.tab=e.target.dataset.tab;S.limit=60;await refresh();});
$('#run-select').onchange=safe(async e=>{S.runId=e.target.value;S.limit=60;await refresh();});
$('#search').oninput=e=>{S.search=e.target.value;S.limit=60;renderResults();};
$('#filters').onclick=e=>{if(!e.target.dataset.filter)return;S.filter=e.target.dataset.filter;S.limit=60;renderResults();};
$('#results').onclick=e=>{if(e.target.id==='load-more'){S.limit+=60;renderResults();return;}const card=e.target.closest('[data-story]');if(card)openReview(card.dataset.story);};
$('#close-review').onclick=()=>$('#review-dialog').close();
$('.review-toolbar .tabs').onclick=e=>{if(e.target.dataset.view){S.view=e.target.dataset.view;renderReview();}};
$('#opacity').oninput=e=>{if($('#overlay-current'))$('#overlay-current').style.opacity=Number(e.target.value)/100;};
$('#zoom').onclick=()=>{S.native=!S.native;renderReview();};
for(const [id,offset] of [['prev-result',-1],['next-result',1]])$('#'+id).onclick=()=>{const items=S.reviewIds,index=items.indexOf(S.reviewId);if(items[index+offset]){S.reviewId=items[index+offset];$('#review-message').classList.add('hidden');renderReview();}};
$('#approve').onclick=()=>decide('approved');$('#reject').onclick=()=>decide('rejected');
window.studio.onChange(safe(refresh));void safe(refresh)();
