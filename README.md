# Waypoint

A local progress tracker for reading, revision, research, and other work. Built for EIO oral exam preparation and useful for other step-by-step work. Data stays local by default; a synced data folder remains an option for sequential device handoff.

## Open

Clone or download the repository into a folder of your choice. From that folder, double-click **Open Waypoint.cmd** on Windows, or run `node server.cjs`. Open http://127.0.0.1:4317.

Node.js **24 or newer** is required. The Windows launcher can use a bundled Codex runtime when available. No npm dependencies, accounts, API keys, or build step are needed.

The launcher starts a hidden local server and opens the browser. Running it again reopens the same workspace. Use **Workspace tools → Save & stop server** to pause, save a handoff snapshot, and stop the server. The app does not manage or report Google Drive's upload/download status.

## Where files live

- Code and Git: your cloned Waypoint repository
- Local data: **data/** inside the repository by default (ignored by Git), or the folder configured on this device
- Current history: **state.json** in the data folder
- Task configurations: **tasks/** in the data folder
- Handoff snapshots: **handoffs/** in the data folder
- Backups: **backups/** in the data folder
- Launcher logs: **logs/<computer-name>/** in the data folder

The ignored **waypoint.local.json** in the code folder stores this device's data-folder path. It is installation configuration, not work history. Other devices configure their own mount path. Application tests use temporary data, never your actual history.

Run `node waypoint.cjs paths` to discover the actual locations. WAYPOINT_DATA_DIR overrides the configured data folder. WAYPOINT_DB is a legacy SQLite override for tests or migration; leave it unset for normal use. PORT changes the default port, 4317.

A configured data directory and its state.json must exist. If the folder or history is unavailable, Waypoint fails instead of silently starting an empty workspace. For a deliberately new empty workspace only, use setup followed by `node waypoint.cjs init`. Existing SQLite history uses migrate instead.

## Optional: continue on another device

The default data folder is local and does not sync. To use this workflow later, first move the complete data folder to a synced location and run setup for that location.

Use **one device at a time**, including chats that modify tasks.

1. On the current device, click **Workspace tools → Save & stop server**. Waypoint pauses the timer, saves an immutable JSON snapshot in handoffs/, and closes its server.
2. Wait for Google Drive to finish syncing the folder on both devices. Make it available offline if using streamed Drive files.
3. On the next computer, install/copy the Waypoint source and Node.js 24+. Run this once from its code folder:

```powershell
node waypoint.cjs setup 'PATH-TO-YOUR-SYNCED-WAYPOINT-DATA-FOLDER'
```

4. Launch Waypoint there. Verify that the expected tasks and latest progress are present before continuing. If they are missing, wait for Drive sync.
5. Repeat the handoff when returning to the first computer.

The code can be installed at a different local path on another device. Do not copy waypoint.local.json to a device with a different Drive mount path. A phone/tablet can inspect the synced JSON history/snapshots through Drive; running the full app requires a computer with Node.js.

This is sequential file synchronization, not simultaneous multi-device editing. Local locks coordinate browser/CLI processes on one computer only. Drive does not provide a distributed transaction lock. Detected state conflict copies block saving and are preserved for reconciliation.

## Everyday workflow

1. Choose **+ New projects** in the sidebar to create a project, then **New task** to add its first task. You can also enter a new project directly in the task form. Choose a numbered range or checklist; both range endpoints are included.
2. Use the **▶ / ⏸** button beside the page or step title to start/resume or pause its timer. The long **Finished this…** button always completes the displayed step.
3. Completing a step while timing continues focus on the next unfinished step. Completing it while paused leaves timing paused. Checklist checkboxes also record completion; reopening retains recorded time.
4. Choose **Edit task** to update metadata and add, rename, or reorder steps. Only steps without recorded progress can be removed.
5. Drag a project onto **Archived projects** to archive it, or back into **Your projects** to restore it. The sidebar **⋯** menu offers the same actions for keyboard and touch. Task progress and timers are preserved.
6. Use **More actions** for task Archive, Restore, or Delete. Delete names the task and requires confirmation before removing its workspace history.

| Filter | Tasks shown |
| --- | --- |
| Active tasks | Unfinished, unarchived tasks, including tasks not yet started |
| All tasks | All tasks, including completed and archived tasks |
| Archived | Archived tasks only |

Search and the selected project further narrow the list. **Workspace** returns to active tasks across all projects; **History** opens all task statuses across all projects. Task selection keeps your current project.

Read the [user guide](docs/user-guide.md) for editing, conflict recovery, deletion, keyboard behavior, and troubleshooting. The [development guide](docs/development.md) describes implementation contracts and verification.

## Configure from a chat outside this project

Give it the standalone **AGENT.md** guide. Replace the example installation path below with the `root` returned by `node waypoint.cjs paths`:

> Read `C:\projects\waypoint\AGENT.md` and configure Waypoint for this task. Use the materials and course/research context in this chat, create a useful checklist, and give me the task link.

The guide contains absolute-path commands, the complete task shape, verification, updates, and device handoff. A chat can stay in its original project. AGENTS.md remains the instruction file for chats working inside this repository.

The chat reads and interprets the materials with its available tools. Waypoint stores references and progress; it does not call an AI service or read the source documents itself.

```powershell
node waypoint.cjs paths
node waypoint.cjs list
node waypoint.cjs show TASK_ID
$WaypointPaths = node waypoint.cjs paths | ConvertFrom-Json
node waypoint.cjs configure (Join-Path $WaypointPaths.tasksDir 'my-task.json')
node waypoint.cjs note TASK_ID "Revisit the explanation of the results."
```

For a new task, provide id, title, project (name and kind), activity, unit, and either items or range. See examples/ or AGENT.md for complete JSON. Optional fields include notes, materials, chatUrl, and dueDate. Templates are never loaded automatically.

Keep item IDs stable. For an existing task, read show and include its current revision as expectedRevision in the input. An update may contain only changed metadata; if it supplies items, provide the full desired checklist. Recorded items cannot be removed. A new revision pass should get a new task ID. Stale changes are rejected.

Direct task link: http://127.0.0.1:4317/#TASK_ID. The sidebar can import task JSON from another chat. Personal configuration files belong in the configured tasks/ folder, ignored by Git.

## Storage, backup, and recovery

The authoritative state is **state.json**, saved under a local process lock with a complete recovery candidate, an in-place write, flush, and read-back verification. This avoids rename-over-existing, which failed in the Windows rclone mount cache. Interrupted writes can leave an incomplete state.json; the complete candidate remains alongside it as .state.json-<UUID>.recovery for manual recovery. Each CLI/browser transaction rereads the current file under a local process lock. Browser reads project elapsed time without rewriting it; expired timers are persisted as paused. Invalid JSON and detected conflict copies are not silently reset or overwritten.

SQLite is used only in memory to reuse the tested transaction logic in normal JSON storage mode. The app does not sync a live SQLite database or WAL sidecars. The old on-disk database and its pre-migration backup are preserved under backups/. See [SQLite's backup cautions](https://www.sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active) for why a live database should not be copied by a generic sync process.

**Export history** downloads readable JSON containing tasks, item durations, sessions, events, and metadata. The CLI also exports JSON or creates a consistent SQLite recovery snapshot:

```powershell
$WaypointPaths = node waypoint.cjs paths | ConvertFrom-Json
node waypoint.cjs export (Join-Path $WaypointPaths.backupsDir 'history.json')
node waypoint.cjs backup (Join-Path $WaypointPaths.backupsDir 'history.sqlite')
```

Neither command overwrites an existing output file. Handoff snapshots are created automatically with unique filenames. Waypoint also keeps immutable recovery snapshots in backups/automatic for task actions and about once per minute during focus. These capture proposed saves before publishing state.json; inspect them before recovery, since a failed save may also have produced a snapshot. They are retained until you choose to remove older ones. Saves are read back to verify that the mounted folder retained their contents. This does not verify cloud synchronization.

To recover JSON: stop Waypoint on every device; preserve the current state.json and any conflict copies elsewhere; restore a verified handoff/export snapshot as state.json; if using a synced folder, let synchronization finish before restarting one device. Keep the displaced files until the restored history has been checked. Do not edit the current state file by hand.

To migrate a verified SQLite backup into an empty data folder, configure that folder, then run `node waypoint.cjs migrate ABSOLUTE_BACKUP.sqlite`. Migration refuses to overwrite an existing state.json and preserves the source database.

The files are plaintext and stay in the configured local data folder. If you choose a synced folder later, its sync application handles synchronization; Waypoint does not authenticate to Drive or transmit files through a separate service. The local HTTP server binds only to 127.0.0.1 and never serves arbitrary data or project files.

## Timing and estimates

Only one step across the workspace runs at a time. Starting another session pauses the previous one. Viewing another task does not switch the timer.

While running, the local server checkpoints elapsed time every five seconds. Timing continues when the browser tab is hidden, throttled, or closed. Use Pause for breaks and Workspace tools → Save & stop server for handoff. A 30-second server lease caps counting after computer sleep, a server crash, or a prolonged stall; it is checked before renewal, so waking the computer does not add the entire sleep interval. Restarting after lease expiry leaves the task paused.

Remaining estimate = mean time of timed completed steps × unfinished step count − time already spent on unfinished steps, clamped to zero. Untimed completions are excluded. The first two completed steps are labeled early estimates. Different types of work may vary considerably.

## Import the original page tracker

If you used an earlier browser-based page tracker, its browser storage is not automatically accessible to Waypoint. Open that tracker from its original location and browser profile.

Open that tracker in the original browser and use its developer console:

```javascript
// Find the key used by your tracker, then substitute it below.
Object.keys(localStorage).filter(key => key.includes('page-tracker'))
copy(localStorage.getItem('YOUR_TRACKER_STORAGE_KEY'))
```

Save the copied JSON, then use **Import task / old tracker**, or `node waypoint.cjs import-legacy SNAPSHOT.json`. Use the storage key shown by your tracker. A null result means the session is absent from that browser.

Import preserves ranges/times and rejects duplicates. New imports go into a generic Imported reading project; use Edit task to choose your project. Existing tasks keep their current projects. It uses the import date for completion because the old tracker did not record dates, and it labels that limitation in history.

## Development

```powershell
node --test tests/*.test.cjs
node --check public/app.js
```

For restricted Windows shells that report EPERM resolving D:\, use Node's --preserve-symlinks and --preserve-symlinks-main flags (or NODE_OPTIONS with those flags).

- store.cjs: task validation, timer, history, SQLite transaction model.
- portable-store.cjs: verified JSON saves, local locking, handoff, state validation.
- paths.cjs: per-device configuration and data paths.
- server.cjs and public/: HTTP and browser interface.
- waypoint.cjs: task configuration, setup, migration, export/backup CLI.
- AGENT.md: standalone external-chat handoff.
- docs/research.md: project exploration and design references.

Tests cover timing, stale changes, deletion, persistence, original tracker import, CLI operations, portable history, read-only timer projection, SQLite backups, Unicode request handling, conflict preservation, and handoff shutdown. Cross-device tests simulate sequential clients; actual Google Drive replication must be confirmed through Drive on the other device.

See [docs/development.md](docs/development.md) for isolated browser testing and the interaction regression checklist.

Forgot to pause? Use **More actions → Correct recorded time…** to revise a page or step’s total time. Corrections update totals and estimates while retaining the before/after values in Activity log. See the [user guide](docs/user-guide.md#correct-a-recorded-duration).

## Public sharing

Runtime data, personal task configurations, device paths, and review artifacts are ignored by Git. Use fictional examples in tracked documentation and screenshots. See [the public-sharing guide](docs/public-sharing.md) for a pre-publication check and an optional clean-history shell workflow. Changing tracked files does not remove earlier commits or their author metadata.
