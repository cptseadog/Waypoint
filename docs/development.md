# Development and verification

Waypoint uses Node.js 24+ and built-in modules only. There is no build step. Runtime data, personal task plans, device configuration, and `.test-output/` are ignored by Git.

## Code map

| File | Responsibility |
| --- | --- |
| `public/app.js` | Rendering, task drafts, action requests, polling, and confirmation dialogs |
| `public/index.html` | Page shell and native dialogs |
| `public/style.css` | Layout, button hierarchy, interaction states, and responsive rules |
| `store.cjs` | Validation, revisions, checklist identity, timing, and task actions |
| `portable-store.cjs` | JSON state, process locking, verification, recovery snapshots, and handoff |
| `paths.cjs` | Environment overrides and per-device data paths |
| `server.cjs` | Local HTTP routes, static assets, request limits, and timer checkpoints |
| `waypoint.cjs` | Configuration, inspection, exports, backups, and migration CLI |

## Task mutation contracts

Browser mutations use `POST /api/action` with `taskId`, `type`, and the current `revision`. Item actions also supply `itemId`; timer starts require an owner. Pause and heartbeat have their own timer-owner handling. Configuration uses `POST /api/configure` with a `config` object and the current revision for an existing task. CLI configurations carry that value as `expectedRevision`.

Checklist IDs are identity, not position. The browser editor keeps IDs and item notes when reordering or renaming, and assigns new IDs to appended steps. Storage merges recorded time and completion by ID. It rejects removal of an item with recorded progress, a focus session, or an active timer reference.

Delete uses the normal action endpoint:

```json
{
  "type": "delete",
  "taskId": "example-task",
  "revision": 3,
  "confirmDelete": true
}
```

This is an illustrative request; use the task's actual revision. The response is `{"deleted":"example-task"}`. A missing confirmation is rejected with 400, a stale revision with 409, and an absent task with 404. The confirmation flag is a validation contract, not authentication or proof of human consent.

The store checks confirmation and revision before removing anything. Deleting a running task clears its timer; deleting a different task preserves the other timer. The entire task object, including sessions and events, is removed transactionally. Archived and completed tasks can also be deleted. Existing snapshots and configuration files are not purged.

The browser captures the task ID, title, and revision when the delete dialog opens. It does not silently update that revision while the user considers the confirmation. Conflict recovery requires cancellation and a fresh confirmation.

## Reads, checkpoints, and recovery

`PortableStore.read()` loads and validates state under the local process lock. It projects elapsed time in memory for display and updates the in-memory SQLite payload used by CLI backups. A normal browser poll does not rewrite the JSON history file. An expired lease falls back to a transaction so its pause is persisted.

The server checkpoints running timers every five seconds. Browser polling does not sustain the timer; the server does. Lease expiry caps sleep or crash gaps before renewal. Mutations reread the latest stored state under the lock, so projected reads do not become an authoritative write source.

Writes retain the existing verified-save and recovery-snapshot behavior. Keep the in-memory SQLite backup path covered when changing reads: a newly opened store must produce a current backup, not its initially empty in-memory database.

## HTTP and browser interaction rules

- The server binds to loopback and validates Host and Origin for local requests.
- JSON requests must be objects. Request chunks are buffered with a byte-count limit and decoded once, preserving UTF-8 characters split across chunks.
- The browser's mutation version prevents an older poll response from replacing state returned after a mutation.
- Polling pauses while a task editor or delete confirmation is open. The server timer continues independently.
- Pending actions disable mutation controls and show progress feedback. Delete requires its dedicated confirmation, rather than the generic action click handler.
- Frequent controls remain visible. Archive and Delete belong in More actions; Escape and outside clicks dismiss it.
- Preserve keyboard focus, semantic selected states, and usable touch targets when changing rendering or styling.

## Automated checks

From the repository root:

```powershell
node --test tests/*.test.cjs
node --check public/app.js
git diff --check
```

If a restricted Windows shell reports `EPERM` resolving `D:\`, use:

```powershell
node --preserve-symlinks --preserve-symlinks-main --test tests/*.test.cjs
node --preserve-symlinks --preserve-symlinks-main --check public/app.js
```

HTTP tests require permission to connect to loopback. A connection-level `EACCES` is an environment restriction, not an HTTP assertion result; rerun with appropriate local network access.

The suite covers storage and HTTP contracts, including confirmed deletion, stale rejection, active-timer cleanup, other-task isolation, absence after reopening and export, read-only timer projection, and fresh-process SQLite backups. The current implementation passed 42 automated tests during the November 5, 2026 review. Browser checks below are manual verification, not part of that automated suite.

## Isolated browser checks

Use a separate, disposable data directory and a separate port. Do not create test tasks in the user's configured workspace. `WAYPOINT_DATA_DIR` and `PORT` are inherited by the test server; set them only in its launch shell. Initialize only a new, deliberately empty test directory. Do not run `setup` to switch the user's per-device configuration for tests.

Example in a dedicated PowerShell terminal:

```powershell
$waypointTestDir = Join-Path $env:TEMP ('waypoint-ui-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $waypointTestDir | Out-Null
$env:WAYPOINT_DATA_DIR = $waypointTestDir
$env:PORT = '4318'
node --preserve-symlinks --preserve-symlinks-main waypoint.cjs init
node --preserve-symlinks --preserve-symlinks-main server.cjs
```

Open `http://127.0.0.1:4318` and verify:

1. Create range and checklist tasks; save metadata and inspect success feedback.
2. Complete a step, then rename and reorder it, append a step, and remove an untouched step. Confirm the recorded step retains its completion and cannot be removed.
3. Start and pause using the icon beside the current step. Confirm the long Finished this… button keeps its label and location, and keyboard focus stays on the control used. Focus a later checklist step, pause, and refresh: that step must remain selected. Finish while paused (no timer starts), finish while running (the next unfinished step starts), and finish the last step (no timer control remains).
4. Archive and restore; verify Active tasks, All tasks, Archived, project selection, and search together.
5. Open More actions with mouse and keyboard; close it with Escape and an outside click.
6. Open Delete; verify the task name, warning, and initial Cancel focus. Cancel or Escape must leave the task intact. Exercise confirmed deletion only on a disposable test task, then verify the list, history, and timer state.
7. Change a task from a second tab or CLI while its editor or delete dialog is open. Verify stale submissions are rejected and require explicit reload or reconfirmation.
8. Inspect desktop, tablet, and narrow phone layouts for overflow, reachable utility controls, readable buttons, and dialog actions. Restore any temporary viewport override afterward.

Stop the isolated server when finished. Refresh the real workspace only after UI changes are ready; restart its server when server-side code changes, accounting for any running timer. Keep screenshots and generated test data outside tracked files.

## Recorded-time corrections

`POST /api/action` accepts `{type:"correct-time", taskId, itemId, revision, elapsedMs, reason?}`. The duration must be an integer number of milliseconds from zero through 359999999000 (99,999:59:59); the UI accepts whole seconds. The optional reason is at most 1,000 characters. Invalid input returns 400; stale revision returns 409.

Within the normal storage transaction, settle elapsed focus first, validate the request, pause only the target task’s timer, then replace the selected item’s `elapsedMs`. Increment the task revision and append a `time-corrected` event with `itemId`, `label`, `previousMs`, `elapsedMs`, `deltaMs`, and `reason`. Completion and archive status remain unchanged; a positive correction establishes `startedAt` if absent. Corrected items remain protected from scope removal, even when corrected back to zero.

Session `activeMs` and timestamps retain the original observed timing. For ordinary tasks, item totals equal session time plus accumulated correction deltas. Legacy imports also have their original imported baseline. Reports should use item totals for corrected time; do not sum raw sessions as corrected totals. No state migration is needed.

The dialog snapshots the task revision, suspends polling updates, validates duration fields, and disables controls while saving. Stale saves require reopening; there is no automatic overwrite or retry. Test correction of a running step, cancellation, changing the selected step, zero duration, and a concurrent update. Automated coverage includes totals/estimates, preserved history, timer isolation, validation, stale rejection, portable reopening, and HTTP export.

The current step is the running item, otherwise the last session’s item if unfinished, otherwise the first unfinished item. Both the title and per-step time use this selection. The long completion control always dispatches `finish`; the adjacent play/pause control dispatches `start` or `pause`. Existing storage semantics determine whether completion continues timing.

## Project organization

`POST /api/project` accepts `{type:"create"|"archive"|"restore", project:{name,kind}, revision}`. Project identity is the exact name and kind pair used by task configurations. The workspace optionally stores `projectStates`, an array of `{name,kind,revision,archivedAt}`. Existing files without it remain valid; revision zero represents a project with no organization record. Create uses revision zero and rejects an existing name/type pair with 409, including task-derived projects. Archive/restore accept either a task-derived project or a metadata entry; unknown projects return 404. Malformed input returns 400, and stale or missing revisions return 409.

Archive/restore updates only project metadata within the normal transaction. It never archives tasks or pauses a timer. Task revisions and history are unchanged, apart from ordinary timer settlement. Root metadata is included in exports, automatic recovery snapshot keys, portable validation, and browser polling comparisons. Task configuration does not override project organization. The sidebar and task-form suggestions use the union of task projects and metadata entries. Explicitly created projects remain visible with zero tasks, including after deleting their last task. No placeholder tasks or migration are required.

The sidebar splits projects into the main list and a collapsible Archived projects group. Selecting a project clears search and uses All tasks. Project names are native draggable controls: drop onto Archived projects to archive, or into Your projects to restore. A small sidebar disclosure offers equivalent keyboard/touch actions. No project management panel appears in the main workspace. Workspace and History provide global views of both groups. Browser checks cover archive, restore, keyboard disclosure, refresh persistence, and a 390px layout. Storage/HTTP tests cover task/timer preservation, project identity, concurrent revisions, persistence, recovery snapshots, validation, and export.

Project drag handling captures the source project key and revision at drag start and accepts only the opposite group. Both dragenter and dragover acknowledge valid destinations, including quick drags across nested labels. Polling cannot replace the sidebar during a drag. A drop operates on its captured source, independent of the currently selected project; external drags and same-group drops are ignored. Drag end clears highlights, and completion returns keyboard focus to the moved project. Browser checks cover both native drag directions, collapsed targets, non-target drops, and the keyboard menu.

## Navigation and project creation review

The sidebar New projects action opens a labeled native dialog. Creation is transactional; duplicate or invalid input preserves the draft. Polling skips open dialogs and discards responses overtaken by a mutation. Navigation uses History API state to retain project context for task selection and reload. Empty project links use `#project/<encoded kind:name>`; ordinary `#TASK_ID` links remain supported. Workspace and History explicitly reset project and search scope. Empty views distinguish a project with no tasks from search/filter results with no matches.

Browser review: create an empty project, refresh it, reject a duplicate, add a task with prefilled project/type, select the task and refresh without leaving the project, recover from an empty search, use Back, archive by keyboard and restore by native drag, and check 390px navigation. The automated suite contains 45 tests, including empty-project persistence, concurrent duplicate rejection, last-task deletion, HTTP creation and export. UI checks use disposable data on port 4318.
