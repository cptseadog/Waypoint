'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash, randomUUID} = require('node:crypto');
const {Store, config, stats, settle, LEASE} = require('./store.cjs');
const {paths} = require('./paths.cjs');
function failure(message, status = 409) { return Object.assign(new Error(message), {status}); }
function validateState(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.tasks) || !Object.hasOwn(state, 'running')) throw failure('The shared state file is invalid. Restore a verified backup; it has not been overwritten.');
  const ids = new Set();
  const timestamp = v => v === null || typeof v === 'string' && Number.isFinite(Date.parse(v));
  const nonnegative = n => Number.isFinite(n) && n >= 0;
  if (state.projectStates !== undefined) {
    if (!Array.isArray(state.projectStates)) throw failure('Invalid project organization.');
    const projects=new Set();
    for (const project of state.projectStates) {
      if (!project || typeof project.name!=='string' || !project.name.trim() || project.name.length>120 || !['course','research','personal'].includes(project.kind) || !Number.isInteger(project.revision) || project.revision<1 || !timestamp(project.archivedAt)) throw failure('Invalid project organization.');
      const key=JSON.stringify([project.kind,project.name]);
      if (projects.has(key)) throw failure('Duplicate project organization.');
      projects.add(key);
    }
  }
  for (const task of state.tasks) {
    config(task);
    if (ids.has(task.id) || !Number.isInteger(task.revision) || task.revision < 1 || !Array.isArray(task.events) || !Array.isArray(task.sessions)) throw failure('Invalid task history in shared state.');
    ids.add(task.id);
    for (const key of ['createdAt','updatedAt','startedAt','completedAt','archivedAt']) if (!timestamp(task[key])) throw failure('Invalid task date in shared state.');
    if (!task.createdAt || !task.updatedAt) throw failure('Missing task dates in shared state.');
    for (const item of task.items) if (!nonnegative(item.elapsedMs) || !timestamp(item.completedAt)) throw failure('Invalid item progress in shared state.');
    if (!!task.completedAt !== task.items.every(i => !!i.completedAt)) throw failure('Inconsistent completion state.');
    for (const event of task.events) if (typeof event.id !== 'string' || typeof event.type !== 'string' || !timestamp(event.at) || !event.at) throw failure('Invalid activity log.');
    for (const session of task.sessions) if (typeof session.id !== 'string' || !task.items.some(i=>i.id===session.itemId) || !nonnegative(session.activeMs) || !timestamp(session.startedAt) || !session.startedAt || !timestamp(session.endedAt)) throw failure('Invalid focus session.');
  }
  if (state.running !== null) {
    const r = state.running, task = state.tasks.find(t => t.id === r?.taskId);
    const item = task?.items.find(i => i.id === r.itemId);
    const session = task?.sessions.find(s => s.id === r.sessionId);
    if (!task || !item || item.completedAt || !session || session.endedAt || typeof r.owner !== 'string' || !nonnegative(r.since) || !nonnegative(r.lastSeen)) throw failure('Invalid running timer in shared state.');
  }
  return state;
}
function verifiedWrite(file, content) {
  // rclone on Windows can silently lose rename-over-existing saves. Write the
  // existing file in place under our process lock, retaining a complete recovery
  // candidate until flush and read-back verification both succeed.
  const recovery = path.join(path.dirname(file), '.' + path.basename(file) + '-' + randomUUID() + '.recovery');
  let fd;
  try {
    fd = fs.openSync(recovery, 'wx');
    fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    if (fs.readFileSync(recovery, 'utf8') !== content) throw failure('Recovery save verification failed; the current workspace was not replaced.');
    fd = fs.openSync(file, 'w');
    fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    if (fs.readFileSync(file, 'utf8') !== content) throw failure('The data folder changed the saved file. Recover the complete candidate: ' + recovery);
    fs.unlinkSync(recovery);
  } catch (error) {
    error.message += ' Recovery candidate: ' + recovery;
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
// This lock coordinates CLI and browser processes on THIS computer only.
// Google Drive is asynchronous; device handoff must be sequential.
function lockFor(file) {
  const key = process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  const name = 'waypoint-' + createHash('sha256').update(key).digest('hex').slice(0,24) + '.lock';
  const lock = path.join(os.tmpdir(), name);
  const started = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lock, 'wx');
      try { fs.writeFileSync(fd, JSON.stringify({pid:process.pid})); }
      finally { fs.closeSync(fd); }
      return () => fs.unlinkSync(lock);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
        try { process.kill(owner.pid, 0); }
        catch (check) { if (check.code === 'ESRCH') { fs.unlinkSync(lock); continue; } }
      } catch (check) {
        if (check.code === 'ENOENT') continue;
        // An incomplete lock is left untouched: a process may be writing it.
      }
      if (Date.now() - started > 5000) throw failure('Another Waypoint process is saving. Try again after it finishes.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}
class PortableStore extends Store {
  constructor(directory, now) {
    super(':memory:', now);
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, {recursive:true});
    this.file = path.join(this.directory, 'state.json');
    const release = lockFor(this.file);
    try {
      if (!fs.existsSync(this.file)) {
        // Never silently initialize over an unmigrated original workspace.
        if (fs.existsSync(path.join(this.directory,'waypoint.sqlite'))) throw failure('Migrate the existing SQLite history before using portable storage.');
        verifiedWrite(this.file, JSON.stringify({version:1,tasks:[],running:null}, null, 2) + '\n');
      }
      this.load();
    } catch (error) { this.close(); throw error; }
    finally { release(); }
  }
  load() {
    const conflicting = fs.readdirSync(this.directory).find(name => /^state.*\.json$/i.test(name) && name !== 'state.json');
    if (conflicting) throw failure('A possible Drive conflict copy exists: ' + conflicting + '. Preserve both versions and reconcile before continuing.');
    const content = fs.readFileSync(this.file, 'utf8');
    if (!content.trim()) throw failure('The shared state.json is empty (0 bytes or whitespace). Recover a verified snapshot from backups/automatic or handoffs; do not initialize a new workspace.');
    let state;
    try { state = JSON.parse(content.replace(/^\uFEFF/, '')); }
    catch { throw failure('The shared state file is unreadable. Wait for Drive to finish syncing or restore a backup; nothing has been overwritten.'); }
    validateState(state);
    return {content, state};
  }
  read() {
    // Project elapsed time without rewriting history on every browser poll.
    // Expired leases still use a transaction so the pause is durable.
    let expired;
    const release = lockFor(this.file);
    try {
      const {state} = this.load(), now = this.now();
      expired = state.running && now >= state.running.lastSeen + LEASE;
      if (!expired) {
        settle(state, now);
        // CLI SQLite backups use this in-memory database after reading.
        this.db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(JSON.stringify(state));
        return {...state,serverTime:now,tasks:state.tasks.map(task=>({...task,stats:stats(task)}))};
      }
    } finally { release(); }
    return super.read();
  }
  transaction(fn) {
    const release = lockFor(this.file);
    try {
      const {content, state} = this.load();
      const before = JSON.stringify(state);
      this.db.prepare('UPDATE workspace SET payload=? WHERE id=1').run(before);
      const result = super.transaction(fn);
      const after = this.db.prepare('SELECT payload FROM workspace WHERE id=1').get().payload;
      if (after !== before) {
        if (fs.readFileSync(this.file, 'utf8') !== content) throw failure('Drive changed the history during this save. Wait for sync, then reload before trying again.');
        const next = JSON.parse(after);
        const saved = JSON.stringify(next, null, 2) + '\n';
        // Keep immutable recovery points for actions and once per minute during focus.
        // Separate files survive later replacement or truncation of state.json.
        const key = JSON.stringify([next.tasks.map(t => [t.id,t.revision,t.events.length]),next.projectStates || [],next.running?.sessionId || null,next.running ? Math.floor(Date.now()/60000) : null]);
        if (key !== this.checkpointKey) {
          const directory = path.join(this.directory, 'backups', 'automatic');
          fs.mkdirSync(directory, {recursive:true});
          const snapshot = path.join(directory, new Date().toISOString().replace(/[:.]/g,'-') + '-' + randomUUID() + '.json');
          const fd = fs.openSync(snapshot, 'wx');
          try { fs.writeFileSync(fd, saved, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
          if (fs.readFileSync(snapshot, 'utf8') !== saved) throw failure('Recovery snapshot verification failed. The workspace was not replaced.');
          this.checkpointKey = key;
        }
        if (fs.readFileSync(this.file, 'utf8') !== content) throw failure('Drive changed the history during this save. Preserve recovery snapshots and reload after sync.');
        verifiedWrite(this.file, saved);
      }
      return result;
    } finally { release(); }
  }
}
function createStore() {
  const p = paths();
  if (p.legacyDb) return new Store(p.legacyDb);
  if (p.configured && !fs.existsSync(p.stateFile)) throw failure('The configured shared state.json is missing. Wait for Drive to sync, or use migrate for existing SQLite history. Use init only for a deliberately new, empty workspace.');
  return new PortableStore(p.dataDir);
}
function handoff(store, directory = paths().handoffsDir) {
  store.pauseAll('Paused for device handoff');
  const snapshot = store.read();
  fs.mkdirSync(directory, {recursive:true});
  const file = path.join(directory, new Date().toISOString().replace(/[:.]/g,'-') + '-' + randomUUID().slice(0,8) + '.json');
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', {flag:'wx'});
  return {saved:file, message:'Saved and paused. Reopen the launcher to continue. If you use a synced data folder on another device, wait for synchronization on both devices before switching.'};
}
module.exports = {PortableStore, createStore, handoff, validateState, verifiedWrite};
