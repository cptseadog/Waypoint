'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {join,dirname,basename}=require('node:path'),{tmpdir}=require('node:os');
const {Store}=require('../store.cjs');
test('a fresh chat configures, updates, annotates, exports and backs up persistent work',t=>{
  const dir=mkdtempSync(join(tmpdir(),'waypoint-cli-'));
  t.after(()=>{assert.equal(dirname(dir),tmpdir());assert.ok(basename(dir).startsWith('waypoint-cli-'));rmSync(dir,{recursive:true,force:true});});
  const db=join(dir,'history.sqlite'),file=join(dir,'task.json'),backup=join(dir,'backup.sqlite');
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',join(__dirname,'..','waypoint.cjs'),...args],{env:{...process.env,WAYPOINT_DB:db},encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  writeFileSync(file,JSON.stringify({id:'paper',title:'Read a paper',project:{name:'Research',kind:'research'},range:{start:1,end:3},unit:'page'}));
  const task=run('configure',file);assert.equal(task.id,'paper');
  assert.equal(run('list').length,1);assert.equal(run('show','paper').stats.total,3);
  run('note','paper','Revisit section two.');
  assert.throws(()=>run('configure',file));
  const revision=run('show','paper').revision;
  writeFileSync(file,JSON.stringify({id:'paper',title:'Read and annotate',expectedRevision:revision}));
  assert.equal(run('configure',file).title,'Read and annotate');
  const output=join(dir,'history.json');run('export',output);
  assert.equal(JSON.parse(readFileSync(output)).tasks[0].events.some(e=>e.detail==='Revisit section two.'),true);
  assert.throws(()=>run('export',output));
  run('backup',backup);assert.throws(()=>run('backup',backup));
  const restored=new Store(backup);
  try{assert.equal(restored.read().tasks[0].title,'Read and annotate');assert.equal(restored.read().tasks[0].events.length,3);}finally{restored.close();}
});
