'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../store.cjs'),{createServer}=require('../server.cjs');
test('HTTP create/read/export, traversal protection, origin and mutation validation',async t=>{
  const store=new Store(':memory:');const server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const response=await post('/api/configure',{config:{id:'talk',title:'Revise slides',project:{name:'Research',kind:'research'},items:['Slide 2','Slide 8']}});
  assert.equal(response.status,200);
  assert.equal((await (await fetch(base+'/api/state')).json()).tasks[0].title,'Revise slides');
  assert.equal((await fetch(base+'/.git/config')).status,404);
  assert.equal((await fetch(base+'/data/waypoint.sqlite')).status,404);
  assert.equal((await post('/api/action',{},{Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(base+'/api/action',{method:'POST',body:'{}'})).status,415);
  assert.equal((await post('/api/configure',{config:{id:'talk',title:'Unversioned update'}})).status,409);
  const exported=await fetch(base+'/api/export');assert.match(exported.headers.get('content-disposition'),/attachment/);
  assert.equal((await exported.json()).tasks.length,1);
  const home=await fetch(base+'/');assert.equal(home.status,200);assert.match(await home.text(),/Waypoint/);
});

test('HTTP rejects non-object requests and preserves UTF-8 across request chunks',async t=>{
  const http=require('node:http');const store=new Store(':memory:'),server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const port=server.address().port;
  for(const value of [null,[],42]){
    const response=await fetch('http://127.0.0.1:'+port+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    assert.equal(response.status,400);
  }
  const title='Read café 日本語';const bytes=Buffer.from(JSON.stringify({config:{title,project:{name:'Test'},items:['One']}}));
  const split=bytes.indexOf(Buffer.from('é'))+1;
  const result=await new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:'/api/configure',method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    });req.on('error',reject);req.write(bytes.subarray(0,split));setTimeout(()=>req.end(bytes.subarray(split)),20);
  });
  assert.equal(result.status,200);assert.equal(result.body.title,title);
});

test('HTTP delete requires confirmation and removes the task from state and exports',async t=>{
  const store=new Store(':memory:'),server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const post=body=>fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const task=store.configure({id:'disposable',title:'Delete me',project:{name:'Test'},items:['One']});
  const action={type:'delete',taskId:task.id,revision:task.revision};
  assert.equal((await post(action)).status,400);assert.equal(store.read().tasks.length,1);
  assert.equal((await post({...action,revision:0,confirmDelete:true})).status,409);
  assert.equal((await post({...action,confirmDelete:true})).status,200);
  for(const route of ['/api/state','/api/export'])assert.deepEqual((await (await fetch(base+route)).json()).tasks,[]);
});

test('HTTP time correction validates revisions and exports corrected totals with history',async t=>{
  const store=new Store(':memory:'),server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base='http://127.0.0.1:'+server.address().port;
  store.configure({id:'time',title:'Time correction',project:{name:'Test'},items:['Page 35']});
  const post=body=>fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const body={type:'correct-time',taskId:'time',itemId:'item-1',revision:1,elapsedMs:600000};
  assert.equal((await post({...body,elapsedMs:-1})).status,400);
  assert.equal((await post(body)).status,200);assert.equal((await post(body)).status,409);
  const task=(await (await fetch(base+'/api/export')).json()).tasks[0];
  assert.equal(task.items[0].elapsedMs,600000);assert.equal(task.events.at(-1).type,'time-corrected');
});

test('HTTP project archiving persists organization, rejects stale changes, and exports metadata',async t=>{
  const store=new Store(':memory:'),server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base='http://127.0.0.1:'+server.address().port,project={name:'Research',kind:'research'};
  store.configure({id:'project-task',title:'Keep my history',project,items:['One']});
  const post=body=>fetch(base+'/api/project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({type:'archive',project,revision:0})).status,200);
  assert.equal((await post({type:'restore',project,revision:0})).status,409);
  assert.equal((await post({type:'archive',project:{name:'Unknown',kind:'research'},revision:0})).status,404);
  assert.equal((await post({type:'delete',project,revision:1})).status,400);
  const exported=await (await fetch(base+'/api/export')).json();assert.ok(exported.projectStates[0].archivedAt);assert.equal(exported.tasks[0].archivedAt,null);
  assert.equal((await post({type:'restore',project,revision:1})).status,200);
});

test('HTTP project creation exports empty projects and returns duplicate conflicts',async t=>{
  const store=new Store(':memory:'),server=createServer(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const input={type:'create',project:{name:'Independent',kind:'personal'},revision:0};
  const post=body=>fetch(base+'/api/project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post(input)).status,200);
  assert.equal((await post(input)).status,409);
  const exported=await (await fetch(base+'/api/export')).json();
  assert.deepEqual(exported.tasks,[]);assert.deepEqual(exported.projectStates,[{...input.project,revision:1,archivedAt:null}]);
});
