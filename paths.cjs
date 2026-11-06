'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const LOCAL_CONFIG = path.join(__dirname, 'waypoint.local.json');
function paths() {
  const config = fs.existsSync(LOCAL_CONFIG) ? JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8').replace(/^\uFEFF/, '')) : {};
  const configured = process.env.WAYPOINT_DATA_DIR || config.dataDir;
  const dataDir = configured || path.join(__dirname, 'data');
  if (!path.isAbsolute(dataDir)) throw Error('Waypoint dataDir must be an absolute path.');
  if (configured && !fs.existsSync(dataDir)) throw Error('The configured data folder is unavailable. Mount/sync Google Drive before opening Waypoint: ' + dataDir);
  const device = os.hostname().replace(/[^a-zA-Z0-9_.-]/g, '_');
  return {
    root: __dirname, configFile: LOCAL_CONFIG, dataDir, configured: !!configured,
    stateFile: path.join(dataDir, 'state.json'),
    tasksDir: path.join(dataDir, 'tasks'),
    backupsDir: path.join(dataDir, 'backups'),
    handoffsDir: path.join(dataDir, 'handoffs'),
    logsDir: path.join(dataDir, 'logs', device),
    legacyDb: process.env.WAYPOINT_DB || null
  };
}
function setup(dataDir) {
  if (!dataDir || !path.isAbsolute(dataDir) || !fs.statSync(dataDir).isDirectory()) throw Error('Choose an existing absolute path to the synced Waypoint data folder.');
  const payload = JSON.stringify({dataDir: path.normalize(dataDir)}, null, 2) + '\n';
  fs.writeFileSync(LOCAL_CONFIG, payload, 'utf8');
  return {configFile: LOCAL_CONFIG, dataDir: path.normalize(dataDir)};
}
if (require.main === module) {
  try { console.log(JSON.stringify(paths(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {paths, setup};
