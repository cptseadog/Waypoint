'use strict';
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const LEASE = 30000;
const iso = n => new Date(n).toISOString();
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function string(value, name, max = 1000, optional = false) {
  if (optional && value == null) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) fail(name + ' must be text (up to ' + max + ' characters).');
  return value.trim();
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value)) fail('Use an ID with 1–100 letters, numbers, dots, dashes or underscores.');
  return value;
}
function config(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Expected a task configuration object.');
  const task = {
    id: identifier(input.id || randomUUID()), title: string(input.title, 'Title', 240),
    project: { name: string(input.project?.name, 'Project name', 120), kind: input.project?.kind || 'personal' },
    activity: string(input.activity || 'Work', 'Activity', 60),
    unit: string(input.unit || 'item', 'Unit', 40),
    notes: string(input.notes, 'Notes', 20000, true),
    chatUrl: string(input.chatUrl, 'Chat link', 1000, true),
    dueDate: string(input.dueDate, 'Due date', 10, true), materials: []
  };
  if (!['course', 'research', 'personal'].includes(task.project.kind)) fail('Project kind must be course, research or personal.');
  if (task.chatUrl && !/^(codex:\/\/threads\/[a-zA-Z0-9-]+|https:\/\/[^\s]+)$/.test(task.chatUrl)) fail('Use a Codex chat link or HTTPS link.');
  if (task.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) || !Number.isFinite(Date.parse(task.dueDate)) || iso(Date.parse(task.dueDate)).slice(0,10) !== task.dueDate)) fail('Due date must be a valid YYYY-MM-DD date.');
  if (input.materials !== undefined && (!Array.isArray(input.materials) || input.materials.length > 100)) fail('Materials must be an array of at most 100 entries.');
  task.materials = (input.materials || []).map(m => ({label:string(m.label, 'Material label', 200),location:string(m.location, 'Material location', 2000)}));
  let items = input.items;
  if (input.range) {
    if (items !== undefined) fail('Supply either items or range, not both.');
    const {start, end} = input.range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > 99999 || end-start >= 2000) fail('Use an inclusive range of 1–2,000 items, numbered 1–99,999.');
    items = Array.from({length:end-start+1}, (_,i) => ({id:'item-'+(start+i),label:task.unit.charAt(0).toUpperCase()+task.unit.slice(1)+' '+(start+i)}));
  }
  if (!Array.isArray(items) || !items.length || items.length > 2000) fail('Add 1–2,000 checklist items or a numbered range.');
  task.items = items.map((item,i) => typeof item === 'string' ? {id:'item-'+(i+1),label:string(item,'Item label',500),notes:''} :
    {id:identifier(item.id || 'item-'+(i+1)), label:string(item.label,'Item label',500),notes:string(item.notes,'Item notes',5000,true)});
  if (new Set(task.items.map(i=>i.id)).size !== task.items.length) fail('Item IDs must be unique.');
  return task;
}
function event(task, type, now, detail = '') { task.events.push({id:randomUUID(),type,at:iso(now),detail}); task.updatedAt = iso(now); }
function stop(state, now, reason = 'Paused') {
  if (!state.running) return;
  const task = state.tasks.find(t=>t.id===state.running.taskId);
  const session = task.sessions.find(s=>s.id===state.running.sessionId);
  session.endedAt = iso(now);
  event(task, 'paused', now, reason);
  state.running = null;
}
function settle(state, now) {
  const running = state.running;
  if (!running) return;
  const task = state.tasks.find(t=>t.id===running.taskId);
  const item = task.items.find(i=>i.id===running.itemId);
  const end = Math.max(running.since, Math.min(now,running.lastSeen+LEASE));
  const elapsed = end-running.since;
  item.elapsedMs += elapsed;
  task.sessions.find(s=>s.id===running.sessionId).activeMs += elapsed;
  running.since = end;
  if (now >= running.lastSeen+LEASE) stop(state,end,'Timer paused after the computer slept or Waypoint stopped responding.');
}
function stats(task) {
  const done = task.items.filter(i=>i.completedAt);
  const timed = done.filter(i=>i.elapsedMs>0);
  const pending = task.items.filter(i=>!i.completedAt);
  const average = timed.length ? timed.reduce((n,i)=>n+i.elapsedMs,0)/timed.length : null;
  return {done:done.length,total:task.items.length,elapsedMs:task.items.reduce((n,i)=>n+i.elapsedMs,0),averageMs:average,
    remainingMs:!pending.length?0:average===null?null:Math.max(0,average*pending.length-pending.reduce((n,i)=>n+i.elapsedMs,0)),
    status:task.completedAt?'completed':task.startedAt?'in-progress':'planned'};
}
class Store {
  constructor(file = process.env.WAYPOINT_DB || join(__dirname,'data','waypoint.sqlite'), now = ()=>Date.now()) {
    if (file !== ':memory:') mkdirSync(dirname(file),{recursive:true});
    this.now = now;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)');
    this.db.prepare('INSERT OR IGNORE INTO workspace VALUES(1,?)').run(JSON.stringify({version:1,tasks:[],running:null}));
  }
  close() { if (!this.closed) { this.db.close(); this.closed=true; } }
  pauseAll(reason = 'Paused') { return this.transaction((state,now)=>{ stop(state,now,reason); return {}; }); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = JSON.parse(this.db.prepare('SELECT payload FROM workspace WHERE id=1').get().payload);
      const now = this.now();
      settle(state,now);
      const result = fn(state,now);
      this.db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(JSON.stringify(state));
      this.db.exec('COMMIT');
      return result;
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  tick() { return this.transaction((state,now)=>{ if(state.running) state.running.lastSeen=now; }); }
  read() { return this.transaction((state,now)=>({...state,serverTime:now,tasks:state.tasks.map(t=>({...t,stats:stats(t)}))})); }
  configure(input, expectedRevision) {
    return this.transaction((state,now)=>{
      const existing = state.tasks.find(t=>t.id===input?.id);
      if (existing && expectedRevision !== undefined && expectedRevision !== existing.revision) fail('This task changed in another chat or tab. Reload it before editing.',409);
      const merged = existing ? {...existing,...input} : input;
      if (input?.range && existing) delete merged.items;
      const normalized = config(merged);
      if (!existing) {
        const task = {...normalized,revision:1,createdAt:iso(now),updatedAt:iso(now),startedAt:null,completedAt:null,archivedAt:null,events:[],sessions:[],
          items:normalized.items.map(i=>({...i,elapsedMs:0,completedAt:null}))};
        event(task,'created',now,task.title);
        state.tasks.push(task);
        return task;
      }
      const ids = new Set(normalized.items.map(i=>i.id));
      if (existing.items.some(i=>!ids.has(i.id) && (i.elapsedMs>0 || i.completedAt || existing.sessions.some(s=>s.itemId===i.id) || existing.events.some(e=>e.type==='time-corrected'&&e.detail.itemId===i.id) || state.running?.itemId===i.id && state.running.taskId===existing.id))) fail('Keep items with recorded progress. Add a new task for a fresh revision pass.');
      const previousItems = new Map(existing.items.map(item=>[item.id,item]));
      normalized.items = normalized.items.map(i=>({...i,elapsedMs:previousItems.get(i.id)?.elapsedMs || 0,completedAt:previousItems.get(i.id)?.completedAt || null}));
      const previous = {title:existing.title,project:existing.project,activity:existing.activity,unit:existing.unit,notes:existing.notes,chatUrl:existing.chatUrl,dueDate:existing.dueDate,materials:existing.materials,items:existing.items.map(({id,label,notes})=>({id,label,notes}))};
      Object.assign(existing,normalized);
      if (existing.items.some(i=>!i.completedAt)) existing.completedAt = null; else if (!existing.completedAt) { existing.completedAt=iso(now); event(existing,'completed',now,'All remaining items complete after scope update.'); }
      existing.revision++;
      event(existing,'configured',now,{previous});
      return existing;
    });
  }
  projectAction(input) {
    const name=string(input.project?.name,'Project name',120), kind=input.project?.kind;
    if (!['course','research','personal'].includes(kind)) fail('Project kind must be course, research or personal.');
    if (!['create','archive','restore'].includes(input.type)) fail('Unknown project action.');
    return this.transaction((state,now)=>{
      const entries=state.projectStates || [];
      let project=entries.find(project=>project.name===name&&project.kind===kind);
      const exists=!!project||state.tasks.some(task=>task.project.name===name&&task.project.kind===kind);
      if (input.type==='create'&&exists) fail('A project with this name and type already exists. Choose it from the sidebar.',409);
      if (input.type!=='create'&&!exists) fail('Project not found.',404);
      if (!Number.isInteger(input.revision)||input.revision!==(project?.revision || 0)) fail('This project changed. Review its latest state and try again.',409);
      if (!project) { project={name,kind,revision:0,archivedAt:null}; entries.push(project); }
      project.archivedAt=input.type==='archive'?iso(now):null;
      project.revision++;
      state.projectStates=entries;
      return project;
    });
  }
  action(input) {
    return this.transaction((state,now)=>{
      const task = state.tasks.find(t=>t.id===input.taskId);
      if (!task) fail('Task not found.',404);
      if (input.type === 'heartbeat') {
        if (state.running?.taskId===task.id && state.running.owner===input.owner) state.running.lastSeen = now;
        return {};
      }
      if (input.type === 'pause') {
        if (state.running?.taskId===task.id && (!input.owner || state.running.owner===input.owner)) stop(state,now);
        return {};
      }
      if (!Number.isInteger(input.revision) || input.revision !== task.revision) fail('This task changed. The latest version has been loaded; try again.',409);
      if (input.type === 'delete') {
        if (input.confirmDelete !== true) fail('Confirm deletion of this task and its history.');
        if (state.running?.taskId === task.id) stop(state,now,'Task deleted');
        state.tasks = state.tasks.filter(candidate=>candidate.id!==task.id);
        return {deleted:task.id};
      }
      if (input.type === 'correct-time') {
        const item = task.items.find(i=>i.id===input.itemId);
        if (!item) fail('Choose an existing step.');
        if (!Number.isSafeInteger(input.elapsedMs) || input.elapsedMs<0 || input.elapsedMs>359999999000) fail('Enter a duration from 0 to 99,999 hours, 59 minutes, 59 seconds.');
        const reason = string(input.reason,'Correction note',1000,true);
        if (state.running?.taskId===task.id) stop(state,now,'Paused to correct recorded time');
        const previousMs = item.elapsedMs;
        item.elapsedMs = input.elapsedMs;
        if (input.elapsedMs>0) task.startedAt ||= iso(now);
        event(task,'time-corrected',now,{itemId:item.id,label:item.label,previousMs,elapsedMs:item.elapsedMs,deltaMs:item.elapsedMs-previousMs,reason});
      }
      else if (input.type === 'archive') { if(state.running?.taskId===task.id) stop(state,now); task.archivedAt=iso(now); event(task,'archived',now); }
      else if (input.type === 'restore') { task.archivedAt=null; event(task,'restored',now); }
      else if (task.archivedAt) fail('Restore this task before working on it.');
      else if (input.type === 'start') {
        const item = input.itemId ? task.items.find(i=>i.id===input.itemId) : task.items.find(i=>!i.completedAt);
        if (!item || item.completedAt) fail('Choose an unfinished item.');
        if (state.running?.taskId===task.id && state.running.itemId===item.id && state.running.owner===input.owner) return {};
        if (state.running) stop(state,now,'Switched focus');
        const session = {id:randomUUID(),itemId:item.id,startedAt:iso(now),endedAt:null,activeMs:0};
        task.sessions.push(session);
        state.running = {taskId:task.id,itemId:item.id,owner:string(input.owner,'Timer owner',100),sessionId:session.id,since:now,lastSeen:now};
        task.startedAt ||= iso(now);
        event(task,'started',now,item.label);
      } else if (input.type === 'finish') {
        const item = task.items.find(i=>i.id===input.itemId);
        if (!item || item.completedAt) fail('Choose an unfinished item.');
        const continueTimer = state.running?.taskId===task.id && state.running.itemId===item.id;
        const owner = state.running?.owner;
        if (continueTimer) stop(state,now,'Item finished');
        item.completedAt=iso(now);
        task.startedAt ||= iso(now);
        event(task,'item-completed',now,item.label);
        const next = task.items.find(i=>!i.completedAt);
        if (!next) { task.completedAt=iso(now); event(task,'completed',now); }
        else if (continueTimer) {
          const session={id:randomUUID(),itemId:next.id,startedAt:iso(now),endedAt:null,activeMs:0};
          task.sessions.push(session);
          state.running={taskId:task.id,itemId:next.id,owner,sessionId:session.id,since:now,lastSeen:now};
          event(task,'started',now,next.label);
        }
      } else if (input.type === 'undo') {
        const item = task.items.find(i=>i.id===input.itemId);
        if (!item?.completedAt) fail('Choose a completed item to reopen.');
        if(state.running?.taskId===task.id) stop(state,now,'Item reopened');
        item.completedAt=null; task.completedAt=null;
        event(task,'item-reopened',now,item.label);
      } else if (input.type === 'note') {
        event(task,'note',now,string(input.text,'Note',5000));
      } else fail('Unknown action.');
      task.revision++;
      return task;
    });
  }
  importLegacy(input) {
    const {start,end,durations,currentMs}=input || {};
    if (input?.version!==1 || !Number.isInteger(start) || !Number.isInteger(end) || start<1 || end<start || end-start>=2000 ||
        !Array.isArray(durations) || durations.length>end-start+1 || durations.some(n=>!Number.isFinite(n)||n<0) || !Number.isFinite(currentMs) || currentMs<0 ||
        (durations.length===end-start+1 && currentMs!==0)) fail('This is not a valid original page-tracker snapshot.');
    const id='legacy-'+require('node:crypto').createHash('sha256').update(JSON.stringify({start,end,durations,currentMs})).digest('hex').slice(0,16);
    return this.transaction((state,now)=>{
      if(state.tasks.some(t=>t.id===id)) fail('This snapshot has already been imported.',409);
      const task={...config({id,title:'Imported reading: pages '+start+'–'+end,project:{name:'Imported reading',kind:'personal'},activity:'Read',unit:'page',range:{start,end}}),
        revision:1,createdAt:iso(now),updatedAt:iso(now),startedAt:null,completedAt:null,archivedAt:null,events:[],sessions:[],legacy:true};
      task.items=task.items.map((item,i)=>({...item,elapsedMs:durations[i] ?? (i===durations.length?currentMs:0),completedAt:i<durations.length?iso(now):null}));
      if(durations.length || currentMs) task.startedAt=iso(now);
      if(durations.length===task.items.length) task.completedAt=iso(now);
      event(task,'imported',now,'Original completion dates are unknown. Dates shown are the import date.');
      state.tasks.push(task);
      return task;
    });
  }
}
module.exports={Store,config,stats,settle,LEASE};
