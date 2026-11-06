# Using Waypoint

Waypoint keeps a task's checklist, focus time, notes, and activity history together. You can manage tasks directly in the browser; using a chat to prepare a task is optional.

## Open your workspace

Run **Open Waypoint.cmd** and open [Waypoint](http://127.0.0.1:4317). History lives in the configured data folder, defaulting to `data/` inside the installation directory. Run `node waypoint.cjs paths` to find the actual location. The launcher reuses a running server.

After UI updates, refresh the browser to load the new controls. If the page reports that it is disconnected, reopen the launcher. Closing a browser tab does not stop a running focus timer.

## Create projects

Choose **+ New projects** under Your projects. Enter a name and type, then choose **Create project**. Projects can be empty; they remain available after restarting or deleting their last task. A matching name and type cannot be created twice. Different types may share a name.

Select a project to see its tasks. **New task** uses that project automatically. Choosing an existing name in the task form also selects its type when the name is unambiguous. **Workspace** returns to active tasks across every project, and **History** opens the global activity view. Clicking a task keeps the current project; Back and refresh preserve the navigation context.

On narrow screens, expand **Projects** to create, select, or organize a project. Infrequent controls—chat setup, import, export, and saving/stopping the server—live under **Workspace tools**.

## Create and find tasks

Choose **New task** and enter a task name, project name and type, activity, and unit. Use a numbered range for consecutive pages or slides, or select a checklist and enter one step per line. Numbered ranges include both endpoints. Add materials as `label | path or URL`, one per line. A target date and chat link are optional.

The sidebar groups tasks by project. Search matches task names, project names, and activities. Filters work within the selected project and search:

- **Active tasks**: unfinished tasks that are not archived, including tasks ready to start.
- **All tasks**: every task, including completed and archived tasks.
- **Archived**: archived tasks only.
- **History**: tasks of every status, with the activity log selected.

Opening an external task link selects the task without project or search restrictions. Selecting a task inside Waypoint preserves your project. Deleted tasks no longer have a workspace entry.

## Focus and record progress

The **▶** button beside the page or step title starts or resumes its timer. While timing, it becomes **⏸** to pause. Hover over it for its action label; keyboard and screen-reader users receive the same label. Pausing keeps the selected page visible, including when you focused a later page from the checklist. Each unfinished checklist row also has a **Focus** button for selecting that particular step. The currently timed row shows an **In focus** badge.

Only one step can run across the workspace. Starting another pauses the previous one; simply viewing another task does not change the timer.

The long **Finished this…** button always completes the displayed step, whether the timer is running or paused. It stays in the same place with the same label. If timing is running, completion automatically begins the next unfinished step; if paused, completion leaves timing paused. Checklist completion buttons also work without starting a timer. Reopening a completed step retains its recorded time and completion history; it does not start timing automatically.

Use **⏸** beside the title for breaks. Timing continues while the computer is awake and the server is running, even when the browser is closed or another application is in use. A server lease limits counting after sleep or a stalled server. See [timing and estimates](../README.md#timing-and-estimates) for details.

Dates display in the browser's time zone. Target dates are planning information, not reminders.

## Edit a task

Choose **Edit task** to change its name, project, activity, unit, notes, materials, or target date. The editor remains available after work starts.

For an existing checklist:

- Edit a step's label directly.
- Use the up/down buttons to reorder it.
- Choose **Add step** to append a new step.
- Use **Remove** for a step that has no completion, elapsed time, or recorded focus session.

Progress and item notes stay attached to the same step when it is renamed or moved. A step with recorded work cannot be removed, even after its completion is reopened. Create a new task for another reading or revision pass rather than repurposing an old recorded step.

Save applies the draft; Cancel or Escape discards it before saving begins. While a save is in progress, controls indicate that the app is saving and prevent duplicate submissions.

If another tab or chat changes the task during editing, Waypoint rejects the stale save. **Discard draft and load latest task** explicitly discards your draft and opens the current version. Reapply the intended changes there.

## Archive, restore, or delete

Open **More actions** beside Edit task. Infrequent actions are kept in this dropdown, away from the focus and completion buttons. Escape or a click outside closes the dropdown.

| Action | Result | Reversible in the app? |
| --- | --- | --- |
| Archive task | Stops that task's timer and moves it out of Active tasks; retains all history | Yes, with Restore task |
| Restore task | Makes an archived task available again; does not start its timer | Yes, by archiving again |
| Delete task… | Opens a confirmation; confirming removes the task and its workspace history and stops its timer | No |

The delete confirmation names the task and explains that its progress, focus sessions, notes, and activity log will be removed. **Cancel** is initially focused. Cancel or Escape dismisses the confirmation before deletion begins. You must choose **Delete task and history** to submit the deletion.

If the task changes while confirmation is open, deletion is rejected. Cancel, review the updated task, and open Delete again. Deleting one task does not stop another task's timer.

Deletion removes the task from the current workspace and subsequent exports. Existing backups, previous exports, task configuration JSON files, and referenced source documents remain on disk. It is not a secure erasure of those separate files. Importing an old configuration can create a task again; it does not restore that task's deleted progress. Workspace snapshot recovery is described in the [README](../README.md#storage-backup-and-recovery).

## Notes, materials, and interaction cues

**Materials & notes** shows the task's notes, source references, dates, and chat link. Web links open their destinations; local paths can be copied into File Explorer. **Activity log** shows the task's history and lets you add a contextual note.

Actions use buttons with visible boundaries. Primary focus actions are filled; ordinary actions are outlined; destructive actions are red. Links to other destinations remain links. Selected filters and checklist states are exposed to assistive technology. Buttons have keyboard-focus indicators, and action results appear in the status banner.

The layout adapts to narrower windows, including larger checklist touch targets and wrapping task controls. Projects and Workspace tools remain accessible at tablet and phone widths.

## Common questions

- **Where did an archived task go?** Choose Archived or All tasks, then check the project and search filters.
- **Why is Remove disabled for a step?** That step has recorded work. Its history is protected from accidental removal.
- **Why does Delete require confirmation again?** The task changed after the confirmation opened. Review the latest state before deleting it.
- **Why are the new buttons missing?** Refresh the page. Server-code changes also require a server restart; frontend changes load on refresh.
- **Why is the estimate unavailable?** Complete a timed step first. Untimed completions do not establish a reading or working pace.
- **Does Save & stop server sync my files?** No. It pauses, saves a snapshot, and stops the server. This installation uses local storage; optional synchronization must be configured separately.

## Correct a recorded duration

If you forgot to pause, open the task and choose **More actions → Correct recorded time…**. Select the page or step, enter the **total** time you actually spent in hours, minutes, and seconds, optionally add a reason, and choose **Save correction**. Enter zero to clear its recorded time. Cancel or Escape leaves the time unchanged.

This option is kept away from the everyday focus buttons. It works on unfinished, completed, and archived tasks. Saving pauses any timer on that task; use **▶** beside the title when ready to continue. A timer on another task is unaffected. Opening or cancelling the dialog does not pause a running timer.

The task total, per-step time, and pace estimates use the corrected duration. Completion marks and dates remain unchanged. **Activity log** shows the old and new times and your reason; original focus sessions remain as historical records. To undo a mistake, reopen the correction dialog and enter the previous duration shown in the log. If another tab changes the task, cancel the dialog, review the latest state, and reopen it before saving.

## Organize projects with Archived projects

Drag a project name onto **Archived projects** in the sidebar. You can drop on its heading even when the group is collapsed. To restore a project, expand Archived projects and drag its name back into **Your projects**, including its heading or list. The destination highlights when it can accept the project. Dropping elsewhere or cancelling the drag leaves the grouping unchanged.

For keyboard or touch, use the small **⋯** beside a project and choose **Archive project** or **Restore project**. On a mouse device, this menu appears on hover or keyboard focus. Escape closes it. Project organization controls stay in the sidebar so everyday work stays uncluttered.

Project archiving organizes the sidebar only. Tasks retain their completion and individual archive states, notes, timing, and history. A running timer continues. **Workspace** and **History** include both project groups, and the task filters still work as before. Selecting a project clears the search and selects All tasks so its tasks are immediately visible.

Grouping is saved in your local data folder and survives restarts. Adding a task to an archived project keeps that project in Archived projects until you restore it. If another tab changes the grouping first, Waypoint loads the latest state and asks you to review before retrying.
