'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {Store,LEASE}=require('../store.cjs');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const base={id:'slides',title:'Revise slides and script',project:{name:'Seminar',kind:'course'},activity:'Revise',unit:'slide',range:{start:3,end:5}};
function setup(t,file=':memory:'){let now=Date.UTC(2026,9,13,12);const s=new Store(file,()=>now);t.after(()=>s.close());const task=s.configure(base);return {s,id:task.id,advance:n=>{now+=n;},act:(type,itemId,extra={})=>s.action({type,itemId,taskId:task.id,revision:s.read().tasks[0].revision,owner:'test',...extra}),read:()=>s.read().tasks[0]};}
test('inclusive range, pause excludes breaks, average and completion dates',t=>{
  const {s,advance,act,read}=setup(t);
  assert.equal(read().items.length,3);assert.equal(read().stats.remainingMs,null);
  act('start','item-3');advance(10000);act('pause');advance(600000);assert.equal(read().stats.elapsedMs,10000);
  act('start','item-3');advance(5000);act('finish','item-3');
  assert.equal(read().stats.averageMs,15000);assert.equal(read().stats.remainingMs,30000);
  advance(5000);assert.equal(read().stats.remainingMs,25000);
  act('finish','item-4');advance(5000);act('finish','item-5');
  assert.equal(read().stats.done,3);assert.ok(read().completedAt);assert.equal(s.read().running,null);
  assert.equal(read().stats.elapsedMs,25000);assert.equal(read().sessions.reduce((n,i)=>n+i.activeMs,0),25000);
});
test('undo reopens completion, preserves time and retains completion history',t=>{
  const {advance,act,read}=setup(t);
  for(const id of ['item-3','item-4','item-5']){act('start',id);advance(1000);act('finish',id);}
  const completed=read().completedAt;act('undo','item-5');
  assert.equal(read().completedAt,null);assert.equal(read().stats.elapsedMs,3000);
  assert.ok(read().events.some(e=>e.type==='completed'&&e.at===completed));
  assert.equal(read().items[2].elapsedMs,1000);
});
test('server lease caps sleep or stopped servers; repeated start does not double count',t=>{
  const {s,advance,act,read}=setup(t);act('start','item-3');advance(5000);act('start','item-3');
  assert.equal(read().sessions.length,1);advance(LEASE+100000);
  assert.equal(read().stats.elapsedMs,LEASE);
  assert.equal(s.read().running,null);
  assert.equal(read().sessions[0].endedAt,new Date(Date.UTC(2026,9,13,12)+LEASE).toISOString());
});
test('heartbeat extends only the owning timer and cannot revive expired leases',t=>{
  const {s,advance,act,read}=setup(t);act('start','item-3');advance(20000);act('heartbeat',null);
  advance(20000);act('heartbeat',null,{owner:'other'});advance(20000);
  assert.equal(read().stats.elapsedMs,50000);assert.equal(s.read().running,null);
  act('heartbeat');assert.equal(s.read().running,null);
});
test('only one task can be timed and progress is isolated',t=>{
  const {s,advance,act,read}=setup(t);s.configure({...base,id:'other'});act('start','item-3');advance(7000);
  s.action({type:'start',taskId:'other',revision:1,owner:'test'});
  advance(3000);assert.equal(read().stats.elapsedMs,7000);assert.equal(s.read().tasks[1].stats.elapsedMs,3000);
});
test('configuration preserves work, records prior metadata and rejects stale revisions',t=>{
  const {s,act,advance,read}=setup(t);act('start','item-3');advance(1000);act('finish','item-3');
  const current=read();
  s.configure({id:current.id,title:'New title',items:[...current.items,{id:'extra',label:'Rehearse'}]},current.revision);
  assert.equal(read().stats.done,1);assert.equal(read().items[0].elapsedMs,1000);
  assert.equal(read().events.at(-1).detail.previous.title,base.title);
  assert.throws(()=>s.configure({id:current.id,title:'Stale'},current.revision),/another chat/);
  assert.throws(()=>s.configure({id:current.id,items:[{id:'extra',label:'Only item'}]},read().revision),/recorded progress/);
  assert.equal(read().items.length,4);
});
test('invalid edits are atomic; stale action cannot finish twice',t=>{
  const {s,read}=setup(t);const revision=read().revision;
  assert.throws(()=>s.configure({...base,range:{start:5,end:3}},revision),/inclusive range/);
  assert.equal(read().items.length,3);
  s.action({taskId:'slides',revision,type:'finish',itemId:'item-3'});
  assert.throws(()=>s.action({taskId:'slides',revision,type:'finish',itemId:'item-4'}),/changed/);
  assert.equal(read().stats.done,1);
});
test('archiving stops time, restore keeps history, untimed work does not bias pace',t=>{
  const {s,act,advance,read}=setup(t);act('finish','item-3');assert.equal(read().stats.averageMs,null);
  act('start','item-4');advance(5000);act('archive');assert.equal(s.read().running,null);
  assert.throws(()=>act('start','item-4'),/Restore/);act('restore');assert.equal(read().stats.elapsedMs,5000);
});
test('disk persistence and two independent connections preserve changes',t=>{
  const directory=mkdtempSync(join(tmpdir(),'waypoint-test-'));
  const file=join(directory,'test.sqlite');const a=new Store(file),b=new Store(file);
  t.after(()=>{a.close();b.close();assert.equal(require('node:path').dirname(directory),tmpdir());assert.ok(require('node:path').basename(directory).startsWith('waypoint-test-'));rmSync(directory,{recursive:true,force:true});});
  a.configure(base);b.configure({...base,id:'second'});
  assert.equal(a.read().tasks.length,2);
  a.action({type:'finish',taskId:'slides',itemId:'item-3',revision:1});
  assert.equal(b.read().tasks[0].stats.done,1);
  assert.throws(()=>b.configure({id:'slides',title:'old'},1),/another chat/);
});
test('old tracker import preserves durations, identifies unknown dates, deduplicates',t=>{
  const s=new Store(':memory:');t.after(()=>s.close());
  const snapshot={version:1,start:40,end:42,durations:[12000,15000],currentMs:2000};
  const task=s.importLegacy(snapshot);
  assert.deepEqual(task.project,{name:'Imported reading',kind:'personal'});
  assert.equal(task.items[0].label,'Page 40');assert.equal(s.read().tasks[0].stats.elapsedMs,29000);
  assert.equal(s.read().tasks[0].stats.done,2);assert.equal(s.read().running,null);
  assert.match(task.events[0].detail,/unknown/);
  assert.throws(()=>s.importLegacy(snapshot),/already/);
  assert.throws(()=>s.importLegacy({...snapshot,durations:[-1]}),/valid/);
});
test('date, links, duplicate IDs and oversized ranges are validated',t=>{
  const s=new Store(':memory:');t.after(()=>s.close());
  for(const input of [{...base,dueDate:'2026-02-30'},{...base,chatUrl:'javascript:alert(1)'},{...base,range:{start:1,end:2001}},{...base,range:undefined,items:[{id:'same',label:'a'},{id:'same',label:'b'}]}])assert.throws(()=>s.configure(input));
  assert.equal(s.read().tasks.length,0);
});



test('removing untouched pending items completes the retained checklist consistently',t=>{
  const {s,act,read}=setup(t);act('finish','item-3');
  s.configure({id:'slides',items:[read().items[0]]},read().revision);
  assert.equal(read().stats.status,'completed');assert.ok(read().completedAt);
  assert.equal(read().stats.done,read().stats.total);
});

test('server ticks sustain ten minutes without any browser requests',t=>{
  const {s,advance,act,read}=setup(t);act('start','item-3');
  for(let i=0;i<120;i++){advance(5000);s.tick();}
  assert.equal(read().stats.elapsedMs,600000);assert.ok(s.read().running);
  act('pause');advance(60000);s.tick();
  assert.equal(read().stats.elapsedMs,600000);assert.equal(s.read().running,null);
});
test('a delayed server tick caps sleep time and does not revive the session',t=>{
  const {s,advance,act,read}=setup(t);act('start','item-3');
  advance(5000);s.tick();advance(3600000);s.tick();
  assert.equal(read().stats.elapsedMs,5000+LEASE);assert.equal(s.read().running,null);
  assert.match(read().events.at(-1).detail,/computer slept/);
});

test('reorder, rename and append keep recorded progress and notes attached to item IDs',()=>{
  const s=new Store(':memory:');
  try {
    s.configure({id:'edit',title:'Edit task',project:{name:'Test'},items:[{id:'a',label:'A',notes:'A notes'},{id:'b',label:'B'}]});
    s.action({type:'finish',taskId:'edit',itemId:'a',revision:1});
    const before=s.read().tasks[0];
    s.configure({id:'edit',items:[{id:'b',label:'B renamed'},{id:'a',label:'A renamed',notes:'A notes'},{id:'c',label:'New step'}]},before.revision);
    const after=s.read().tasks[0];
    assert.equal(after.items[1].completedAt,before.items[0].completedAt);assert.equal(after.items[1].notes,'A notes');
    assert.equal(after.items[2].completedAt,null);
    assert.throws(()=>s.configure({id:'edit',items:[{id:'b',label:'B'}]},after.revision),/recorded progress/);
  } finally{s.close();}
});

test('deletion requires confirmation and a current revision, then removes task history and its timer',t=>{
  const {s,act,advance,read}=setup(t);
  act('start','item-3');advance(5000);act('pause');act('note',undefined,{text:'Private task note'});act('start','item-4');
  const task=read(),snapshot=s.read();
  assert.throws(()=>s.action({type:'delete',taskId:task.id,revision:task.revision}),/Confirm deletion/);
  assert.throws(()=>s.action({type:'delete',taskId:task.id,revision:task.revision-1,confirmDelete:true}),/changed/);
  assert.deepEqual(s.read(),snapshot);
  assert.deepEqual(s.action({type:'delete',taskId:task.id,revision:task.revision,confirmDelete:true}),{deleted:task.id});
  assert.equal(s.read().running,null);assert.deepEqual(s.read().tasks,[]);
  s.tick();assert.deepEqual(s.read().tasks,[]);
  assert.throws(()=>s.action({type:'delete',taskId:task.id,revision:task.revision,confirmDelete:true}),/not found/);
});

test('deleting an archived task leaves another task and its running timer intact',t=>{
  const {s,act}=setup(t);act('archive');
  s.configure({id:'other',title:'Keep me',project:{name:'Other'},items:['One']});
  s.action({type:'start',taskId:'other',revision:1,owner:'other'});
  const before=s.read(),deleted=before.tasks.find(task=>task.id==='slides');
  s.action({type:'delete',taskId:deleted.id,revision:deleted.revision,confirmDelete:true});
  const after=s.read();assert.deepEqual(after.running,before.running);assert.deepEqual(after.tasks,[before.tasks.find(task=>task.id==='other')]);
});

test('time corrections settle and pause, preserve sessions and completion, and update estimates',t=>{
  const {s,act,advance,read}=setup(t);
  act('start','item-3');advance(10000);act('finish','item-3');advance(5000);
  const completed=read().items[0].completedAt;
  act('correct-time','item-3',{elapsedMs:3000,reason:'Forgot to pause'});
  let task=read();assert.equal(s.read().running,null);
  assert.equal(task.stats.elapsedMs,8000);assert.equal(task.stats.averageMs,3000);assert.equal(task.stats.remainingMs,1000);
  assert.equal(task.items[0].completedAt,completed);assert.equal(task.sessions.reduce((n,s)=>n+s.activeMs,0),15000);
  assert.deepEqual(task.events.at(-1).detail,{itemId:'item-3',label:'Slide 3',previousMs:10000,elapsedMs:3000,deltaMs:-7000,reason:'Forgot to pause'});
  act('correct-time','item-4',{elapsedMs:0});
  act('start','item-4');advance(2000);act('pause');assert.equal(read().items[1].elapsedMs,2000);
  act('archive');act('correct-time','item-3',{elapsedMs:12000});
  task=read();assert.ok(task.archivedAt);assert.equal(task.stats.elapsedMs,14000);
});
test('invalid and stale corrections are atomic and cannot stop another timer',t=>{
  const {s,act,advance,read}=setup(t);act('start','item-3');advance(1000);
  const before=s.read();
  for(const elapsedMs of [-1,1.5,Infinity,NaN,'1000',null,360000000000])assert.throws(()=>act('correct-time','item-3',{elapsedMs}),/duration/);
  assert.throws(()=>act('correct-time','missing',{elapsedMs:0}),/existing step/);
  assert.throws(()=>act('correct-time','item-3',{elapsedMs:0,reason:42}),/Correction note/);
  assert.throws(()=>s.action({type:'correct-time',taskId:'slides',itemId:'item-3',elapsedMs:0,revision:1}),/changed/);
  assert.deepEqual(s.read(),before);
  s.configure({...base,id:'other'});s.action({type:'start',taskId:'other',revision:1,owner:'other'});
  const running=s.read().running;act('correct-time','item-3',{elapsedMs:0});assert.deepEqual(s.read().running,running);
  act('correct-time','item-5',{elapsedMs:1000});act('correct-time','item-5',{elapsedMs:0});
  assert.throws(()=>s.configure({id:'slides',items:read().items.filter(i=>i.id!=='item-5')},read().revision),/recorded progress/);
});

test('project archive and restore preserve task history, timer, and task archive states',t=>{
  const {s,act,read}=setup(t);act('start','item-3');
  s.configure({...base,id:'archived-task'});s.action({type:'archive',taskId:'archived-task',revision:1});
  const before=s.read();const project={name:'Seminar',kind:'course'};
  assert.deepEqual(s.projectAction({type:'archive',project,revision:0}),{...project,revision:1,archivedAt:new Date(before.serverTime).toISOString()});
  assert.deepEqual(s.read().tasks,before.tasks);assert.deepEqual(s.read().running,before.running);
  assert.throws(()=>s.projectAction({type:'restore',project,revision:0}),/changed/);
  s.projectAction({type:'restore',project,revision:1});
  assert.equal(s.read().projectStates[0].archivedAt,null);assert.equal(s.read().projectStates[0].revision,2);
  assert.deepEqual(s.read().tasks,before.tasks);assert.deepEqual(s.read().running,before.running);
});
test('project organization uses name and kind, validates input, and survives task configuration',t=>{
  const {s}=setup(t);const project={name:'Seminar',kind:'course'};
  s.configure({...base,id:'personal',project:{name:'Seminar',kind:'personal'}});
  for(const input of [{type:'delete',project,revision:0},{type:'archive',project},{type:'archive',project:{name:'Seminar',kind:'invalid'},revision:0}])assert.throws(()=>s.projectAction(input));
  assert.throws(()=>s.projectAction({type:'archive',project:{name:'Missing',kind:'course'},revision:0}),/not found/);
  s.projectAction({type:'archive',project,revision:0});
  s.configure({...base,id:'new'});s.configure({id:'slides',title:'Updated title'},1);
  assert.equal(s.read().projectStates.length,1);assert.equal(s.read().projectStates[0].kind,'course');assert.ok(s.read().projectStates[0].archivedAt);
  s.projectAction({type:'archive',project:{name:'Seminar',kind:'personal'},revision:0});assert.equal(s.read().projectStates.length,2);
});

test('independent projects can be created, archived, and reused without placeholder tasks',t=>{
  const {s}=setup(t),project={name:'New research',kind:'research'};
  const before=s.read().tasks;
  assert.deepEqual(s.projectAction({type:'create',project,revision:0}),{...project,revision:1,archivedAt:null});
  assert.deepEqual(s.read().tasks,before);
  const snapshot=s.read();
  assert.throws(()=>s.projectAction({type:'create',project,revision:0}),/already exists/);
  assert.throws(()=>s.projectAction({type:'create',project:{name:'Seminar',kind:'course'},revision:0}),/already exists/);
  assert.throws(()=>s.projectAction({type:'create',project:{name:'',kind:'course'},revision:0}));
  assert.throws(()=>s.projectAction({type:'create',project:{name:'Other',kind:'course'}}),/changed/);
  assert.deepEqual(s.read(),snapshot);
  s.projectAction({type:'archive',project,revision:1});
  s.projectAction({type:'restore',project,revision:2});
  const task=s.configure({id:'new-project-task',title:'First task',project,items:['One']});
  s.action({type:'delete',taskId:task.id,revision:task.revision,confirmDelete:true});
  assert.deepEqual(s.read().projectStates,[{...project,revision:3,archivedAt:null}]);
});
