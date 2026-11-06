'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {PortableStore,handoff}=require('../portable-store.cjs');
const {createServer}=require('../server.cjs');
const config={id:'paper',title:'Read paper',project:{name:'Research',kind:'research'},unit:'page',range:{start:1,end:2}};
function temporary(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-shared-'));
  t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('waypoint-shared-'));fs.rmSync(dir,{recursive:true,force:true});});
  return dir;
}
test('portable history survives sequential device handoff without SQLite files',t=>{
  const dir=temporary(t);let now=100000;
  let a=new PortableStore(dir,()=>now);
  try{
    a.configure(config);
    a.action({type:'start',taskId:'paper',revision:1,itemId:'item-1',owner:'device-a'});
    now+=12000;
    const result=handoff(a,path.join(dir,'handoffs'));
    assert.ok(fs.existsSync(result.saved));
    assert.equal(a.read().running,null);
  }finally{a.close();}
  const b=new PortableStore(dir,()=>now+999999);
  try{
    const task=b.read().tasks[0];
    assert.equal(task.stats.elapsedMs,12000);
    b.action({type:'finish',taskId:'paper',revision:task.revision,itemId:'item-1'});
    assert.equal(b.read().tasks[0].stats.done,1);
    assert.ok(!fs.readdirSync(dir).some(name=>name.includes('.sqlite')));
  }finally{b.close();}
});
test('independent CLI/browser stores reload shared revisions before updating',t=>{
  const dir=temporary(t),a=new PortableStore(dir),b=new PortableStore(dir);
  try{
    a.configure(config);b.configure({id:'paper',title:'Updated from another chat'},1);
    assert.equal(a.read().tasks[0].title,'Updated from another chat');
    assert.throws(()=>a.configure({id:'paper',notes:'Stale'},1),/another chat/);
  }finally{a.close();b.close();}
});
test('idle reading does not rewrite synced files; malformed state is never overwritten',t=>{
  const dir=temporary(t),s=new PortableStore(dir);
  try{
    s.configure(config);const old=new Date(100000);fs.utimesSync(s.file,old,old);s.read();
    assert.equal(fs.statSync(s.file).mtimeMs,old.getTime());
    fs.writeFileSync(s.file,'{"incomplete":');
    assert.throws(()=>s.read(),/unreadable/);
    assert.equal(fs.readFileSync(s.file,'utf8'),'{"incomplete":');
  }finally{s.close();}
});
test('possible Drive conflict copies block writes and preserve both histories',t=>{
  const dir=temporary(t),s=new PortableStore(dir);
  try{
    s.configure(config);const original=fs.readFileSync(s.file);
    fs.copyFileSync(s.file,path.join(dir,'state (conflicted copy).json'));
    assert.throws(()=>s.configure({id:'paper',title:'Overwrite'},1),/conflict copy/);
    assert.deepEqual(fs.readFileSync(s.file),original);
  }finally{s.close();}
});
test('HTTP handoff pauses, saves a snapshot, and stops the server',async t=>{
  const dir=temporary(t),store=new PortableStore(dir);
  store.configure(config);
  const server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try{
    const response=await fetch(url+'/api/handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,200);const result=await response.json();
    assert.ok(fs.existsSync(result.saved));assert.match(result.message,/Saved and paused.*Reopen the launcher/);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(server.listening,false);
  }finally{server.close();store.close();}
});


test('device setup and SQLite migration use one shared folder and fail closed if history is missing',t=>{
  const dir=temporary(t),install=path.join(dir,'code'),shared=path.join(dir,'shared');
  fs.mkdirSync(install);fs.mkdirSync(shared);
  for(const name of ['waypoint.cjs','paths.cjs','store.cjs','portable-store.cjs'])fs.copyFileSync(path.join(__dirname,'..',name),path.join(install,name));
  const {execFileSync}=require('node:child_process');
  const environment={...process.env};delete environment.WAYPOINT_DB;delete environment.WAYPOINT_DATA_DIR;
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',path.join(install,'waypoint.cjs'),...args],{env:environment,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  run('setup',shared);assert.equal(run('paths').tasksDir,path.join(shared,'tasks'));
  assert.throws(()=>run('list'));assert.ok(!fs.existsSync(path.join(shared,'state.json')));
  const {Store}=require('../store.cjs');
  const source=path.join(dir,'old.sqlite'),old=new Store(source);
  old.configure(config);old.close();
  run('migrate',source);assert.equal(run('list')[0].id,'paper');
  assert.throws(()=>run('migrate',source));
  assert.throws(()=>run('init'));
  const plan=path.join(shared,'update.json');
  fs.writeFileSync(plan,JSON.stringify({id:'paper',expectedRevision:1,notes:'Continue on the next device.'}));
  run('configure',plan);assert.equal(run('show','paper').notes,'Continue on the next device.');
  const second=path.join(dir,'device-two');fs.mkdirSync(second);
  for(const name of ['waypoint.cjs','paths.cjs','store.cjs','portable-store.cjs'])fs.copyFileSync(path.join(install,name),path.join(second,name));
  const secondRun=(...args)=>JSON.parse(execFileSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',path.join(second,'waypoint.cjs'),...args],{env:environment,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  secondRun('setup',shared);assert.equal(secondRun('show','paper').notes,'Continue on the next device.');
});

test('recovery snapshots preserve actions without creating a file for every heartbeat',t=>{
  const dir=temporary(t);let now=100000;const s=new PortableStore(dir,()=>now);
  const snapshots=()=>fs.readdirSync(path.join(dir,'backups','automatic'));
  try {
    s.configure(config);
    s.action({type:'start',taskId:'paper',revision:1,itemId:'item-1',owner:'browser'});
    const initial=snapshots().length;
    for(let i=0;i<5;i++){now+=1000;s.action({type:'heartbeat',taskId:'paper',owner:'browser'});}
    // Crossing a wall-clock minute may add one timer checkpoint.
    assert.ok(snapshots().length<=initial+1);
    s.action({type:'pause',taskId:'paper',owner:'browser'});
    const copies=snapshots().map(name=>JSON.parse(fs.readFileSync(path.join(dir,'backups','automatic',name),'utf8')));
    assert.ok(copies.some(state=>state.tasks[0].items[0].elapsedMs===5000 && state.running===null));
    fs.writeFileSync(s.file,'');
    assert.throws(()=>s.read(),/state.json is empty/);
    assert.equal(fs.statSync(s.file).size,0);
    assert.ok(copies.some(state=>state.tasks[0].title==='Read paper'));
  }finally{s.close();}
});

test('shared saves never rename over existing files',t=>{
  const dir=temporary(t),file=path.join(dir,'state.json');
  t.mock.method(fs,'renameSync',()=>{throw Error('Unsafe mounted-drive replacement');});
  const {verifiedWrite}=require('../portable-store.cjs');
  verifiedWrite(file,'first');verifiedWrite(file,'second');
  assert.equal(fs.readFileSync(file,'utf8'),'second');
  assert.deepEqual(fs.readdirSync(dir),['state.json']);
});
test('failed in-place writes leave a complete recovery candidate',t=>{
  const dir=temporary(t),file=path.join(dir,'state.json');
  fs.writeFileSync(file,'old');
  const original=fs.fsyncSync;let calls=0;
  t.mock.method(fs,'fsyncSync',fd=>{if(++calls===2)throw Error('Simulated disk failure');return original(fd);});
  const {verifiedWrite}=require('../portable-store.cjs');
  assert.throws(()=>verifiedWrite(file,'new complete state'),/Recovery candidate/);
  const recovery=fs.readdirSync(dir).find(name=>name.endsWith('.recovery'));
  assert.ok(recovery);assert.equal(fs.readFileSync(path.join(dir,recovery),'utf8'),'new complete state');
});

test('active reads project time without disk writes and expiry is persisted once',t=>{
  const dir=temporary(t);let now=100000;const s=new PortableStore(dir,()=>now);
  try {
    s.configure(config);s.action({type:'start',taskId:'paper',revision:1,itemId:'item-1',owner:'browser'});
    const before=fs.readFileSync(s.file,'utf8');
    for(let i=1;i<=4;i++){now+=1000;assert.equal(s.read().tasks[0].stats.elapsedMs,i*1000);assert.equal(fs.readFileSync(s.file,'utf8'),before);}
    s.tick();assert.equal(JSON.parse(fs.readFileSync(s.file,'utf8')).tasks[0].items[0].elapsedMs,4000);
    now+=31000;assert.equal(s.read().running,null);
    const saved=fs.readFileSync(s.file,'utf8');assert.equal(JSON.parse(saved).tasks[0].items[0].elapsedMs,34000);
    now+=10000;s.read();assert.equal(fs.readFileSync(s.file,'utf8'),saved);
  } finally {s.close();}
});

test('a newly opened store can back up current projected history to SQLite',t=>{
  const dir=temporary(t);let now=100000;const writer=new PortableStore(dir,()=>now);
  writer.configure(config);writer.action({type:'start',taskId:'paper',revision:1,itemId:'item-1',owner:'browser'});writer.close();now+=2000;
  const reader=new PortableStore(dir,()=>now),file=path.join(dir,'backup.sqlite');
  try {reader.read();reader.db.prepare('VACUUM INTO ?').run(file);} finally {reader.close();}
  const {DatabaseSync}=require('node:sqlite');const backup=new DatabaseSync(file);
  try {const saved=JSON.parse(backup.prepare('SELECT payload FROM workspace WHERE id=1').get().payload);assert.equal(saved.tasks[0].id,'paper');assert.equal(saved.tasks[0].items[0].elapsedMs,2000);} finally {backup.close();}
});

test('deleted task and history stay absent after reopening portable storage',t=>{
  const dir=temporary(t);const store=new PortableStore(dir);
  store.configure(config);store.action({type:'finish',taskId:'paper',itemId:'item-1',revision:1});
  store.action({type:'delete',taskId:'paper',revision:2,confirmDelete:true});store.close();
  const reopened=new PortableStore(dir);
  try{assert.deepEqual(reopened.read().tasks,[]);assert.equal(reopened.read().running,null);assert.deepEqual(JSON.parse(fs.readFileSync(reopened.file,'utf8')).tasks,[]);}finally{reopened.close();}
});

test('corrected totals and original sessions survive reopening portable storage',t=>{
  const dir=temporary(t);let now=100000;
  const a=new PortableStore(dir,()=>now);
  try{
    a.configure(config);a.action({type:'start',taskId:'paper',revision:1,owner:'test'});now+=10000;
    a.action({type:'correct-time',taskId:'paper',revision:2,itemId:'item-1',elapsedMs:2000});
  }finally{a.close();}
  const b=new PortableStore(dir,()=>now);
  try{const task=b.read().tasks[0];assert.equal(task.stats.elapsedMs,2000);assert.equal(task.sessions[0].activeMs,10000);assert.equal(task.events.at(-1).detail.deltaMs,-8000);assert.equal(b.read().running,null);}finally{b.close();}
});

test('project organization persists across stores and produces recovery snapshots',t=>{
  const dir=temporary(t),a=new PortableStore(dir),b=new PortableStore(dir);
  try{
    a.configure(config);const backupDir=path.join(dir,'backups','automatic');const before=fs.readdirSync(backupDir).length;
    a.projectAction({type:'archive',project:config.project,revision:0});
    assert.ok(b.read().projectStates[0].archivedAt);assert.equal(fs.readdirSync(backupDir).length,before+1);
    assert.throws(()=>b.projectAction({type:'restore',project:config.project,revision:0}),/changed/);
    b.projectAction({type:'restore',project:config.project,revision:1});assert.equal(a.read().projectStates[0].archivedAt,null);
    assert.equal(fs.readdirSync(backupDir).length,before+2);
  }finally{a.close();b.close();}
  const reopened=new PortableStore(dir);try{assert.equal(reopened.read().projectStates[0].revision,2);}finally{reopened.close();}
});
test('invalid project organization is rejected without overwriting portable history',t=>{
  const dir=temporary(t),s=new PortableStore(dir);s.configure(config);s.close();
  const file=path.join(dir,'state.json');const state=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const projectStates of [null,{},[{name:'Research',kind:'research',revision:0,archivedAt:null}]]){
    const content=JSON.stringify({...state,projectStates});fs.writeFileSync(file,content);
    assert.throws(()=>new PortableStore(dir),/project organization/);assert.equal(fs.readFileSync(file,'utf8'),content);
  }
});

test('empty projects persist on disk and concurrent duplicate creation is rejected',t=>{
  const dir=temporary(t),a=new PortableStore(dir),b=new PortableStore(dir),project={name:'Empty project',kind:'personal'};
  try{
    a.projectAction({type:'create',project,revision:0});
    assert.throws(()=>b.projectAction({type:'create',project,revision:0}),/already exists/);
    assert.deepEqual(b.read().tasks,[]);
    b.projectAction({type:'archive',project,revision:1});
  }finally{a.close();b.close();}
  const reopened=new PortableStore(dir);
  try{assert.equal(reopened.read().projectStates[0].name,project.name);assert.ok(reopened.read().projectStates[0].archivedAt);assert.deepEqual(reopened.read().tasks,[]);}finally{reopened.close();}
});
