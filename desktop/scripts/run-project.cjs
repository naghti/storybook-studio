const path=require('node:path'),os=require('node:os');const assets=process.env.STUDIO_APP_DIR||path.join(__dirname,'..');const {Store}=require(path.join(assets,'src/store.cjs'));const {Runner}=require(path.join(assets,'src/runner.cjs'));
const store=new Store(process.env.STUDIO_DATA_DIR||path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'storybook-studio'));
const runner=new Runner(store);const project=store.project(process.argv[2]||store.db.projects[0].id);
let last=0;store.on('change',()=>{if(!runner.active)return;const r=runner.active.run;if(r.completed-last>=50||r.status==='error'){last=r.completed;console.log(JSON.stringify({status:r.status,completed:r.completed,total:r.total,error:r.error}));}});
const run=runner.start(project.id);runner.promise.then(()=>{const final=store.run(project.id,run.id);const counts=final.results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});console.log(JSON.stringify({runId:run.id,status:final.status,total:final.total,completed:final.completed,counts,error:final.error}));process.exitCode=final.status==='completed'&&!counts.error?0:1;});
process.on('SIGINT',()=>runner.cancel());
