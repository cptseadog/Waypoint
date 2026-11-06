'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {Store}=require('./store.cjs');
const {PortableStore,createStore,validateState,verifiedWrite}=require('./portable-store.cjs');
const {paths,setup}=require('./paths.cjs');
const [command,arg,extra]=process.argv.slice(2);
const usage='Waypoint\n  node waypoint.cjs paths\n  node waypoint.cjs init\n  node waypoint.cjs setup ABSOLUTE_DATA_FOLDER\n  node waypoint.cjs list\n  node waypoint.cjs show TASK_ID\n  node waypoint.cjs configure FILE.json\n  node waypoint.cjs note TASK_ID "What changed"\n  node waypoint.cjs export OUTPUT.json\n  node waypoint.cjs backup OUTPUT.sqlite\n  node waypoint.cjs migrate SOURCE.sqlite\n  node waypoint.cjs import-legacy SNAPSHOT.json\n  node server.cjs';
if(!command || command==='help'){console.log(usage);process.exit(0);}
let store;
try {
  let result;
  if(command==='setup') result=setup(arg);
  else if(command==='paths') result=paths();
  else if(command==='init') { const p=paths(); if(fs.existsSync(p.stateFile))throw Error('History already exists; init never replaces it.'); store=new PortableStore(p.dataDir);result={saved:p.stateFile}; }
  else if(command==='migrate') {
    const p=paths();
    if(p.legacyDb)throw Error('Unset WAYPOINT_DB before migrating into portable storage.');
    if(!arg || !fs.existsSync(arg))throw Error('Choose an existing SQLite database to migrate.');
    if(fs.existsSync(p.stateFile))throw Error('Shared state.json already exists. Migration never overwrites history.');
    const source=new Store(arg);
    try{
      source.pauseAll('Paused for migration to shared storage');
      const state=JSON.parse(source.db.prepare('SELECT payload FROM workspace WHERE id=1').get().payload);
      validateState(state);
      fs.mkdirSync(p.dataDir,{recursive:true});
      verifiedWrite(p.stateFile,JSON.stringify(state,null,2)+'\n');
      result={saved:p.stateFile,tasks:state.tasks.length};
    }finally{source.close();}
  } else {
    store=createStore();
    if(command==='list') result=store.read().tasks.map(t=>({id:t.id,title:t.title,project:t.project,status:t.stats.status,archivedAt:t.archivedAt,completedAt:t.completedAt,progress:t.stats.done+'/'+t.stats.total,activeMs:t.stats.elapsedMs}));
    else if(command==='show') {result=store.read().tasks.find(t=>t.id===arg);if(!result)throw Error('Task not found.');}
    else if(command==='configure') {
      const input=JSON.parse(fs.readFileSync(arg,'utf8').replace(/^\uFEFF/,''));
      const revision=input.expectedRevision;delete input.expectedRevision;
      const existing=store.read().tasks.find(t=>t.id===input.id);
      if(existing && revision===undefined)throw Error('Updating an existing task requires expectedRevision from the show command. This protects changes from other chats.');
      result=store.configure(input,revision);
    } else if(command==='note') {
      const task=store.read().tasks.find(t=>t.id===arg); if(!task)throw Error('Task not found.');
      result=store.action({type:'note',taskId:arg,revision:task.revision,text:extra});
    } else if(command==='export') {
      if(!arg)throw Error('Choose an output JSON file.');
      fs.writeFileSync(arg,JSON.stringify(store.read(),null,2)+'\n',{flag:'wx'});result={saved:arg};
    } else if(command==='backup') {
      if(!arg)throw Error('Choose a new backup SQLite file.');
      store.read();store.db.prepare('VACUUM INTO ?').run(arg);result={saved:arg};
    } else if(command==='import-legacy') result=store.importLegacy(JSON.parse(fs.readFileSync(arg,'utf8').replace(/^\uFEFF/,'')));
    else throw Error(usage);
  }
  console.log(JSON.stringify(result,null,2));
} catch(error){console.error(error.message);process.exitCode=1;} finally{store?.close();}
