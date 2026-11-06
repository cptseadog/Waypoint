# GitHub exploration — October 13, 2026

Reviewed before implementing Waypoint. These are conceptual references; Waypoint does not copy their code or introduce their dependencies.

| Project | Relevant approach | Decision for Waypoint |
| --- | --- | --- |
| [Super Productivity](https://github.com/super-productivity/super-productivity) | Tasks and projects combined with time tracking; local data and exports. Its [data guide](https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/4.23-Managing-Your-Data.md) describes active/archive history and structured JSON. | Keep a durable task identity, project metadata, focus time, archived work, and exportable history together. |
| [ActivityWatch](https://github.com/ActivityWatch/activitywatch) | Local activity collection and a record of time spent, with privacy as a central concern. | Store history on disk locally. Use explicit user-started timing for pages and revision steps. |
| [Taskwarrior](https://github.com/GothenburgBitFactory/taskwarrior) | Command-line task management. | Provide a small CLI so a new chat can configure or inspect tasks without editing application code. |

## Why extend the original timer?

The original interaction fits the user's work: finish one page, see the next one, and estimate the remaining time. A full task-management suite would introduce much more interface and infrastructure than this workflow needs. The missing pieces are multiple tasks, flexible units, durable metadata/history, and configuration by a chat.

Waypoint therefore uses Node.js built-ins plus SQLite, with no third-party packages. Both the browser and CLI use the same storage layer. The later Google Drive extension publishes atomic JSON state for sequential device handoff, while keeping the transaction model in an in-memory SQLite database. Configuration files reference materials; the chat reads and interprets them using its own tools.

Each task has a project, checklist, start/completion dates, item timing, focus sessions, and an activity log. A fresh revision pass creates a new task, preserving previous passes.

## Chat setup reference

OpenAI's [AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md) describes repository instructions for Codex. Waypoint supplies a short project instruction file that directs configuration requests to the CLI. Chats outside this project can explicitly read the standalone AGENT.md guide, which provides absolute-path commands and the configuration workflow. There is no automatic discovery of unrelated chats or their materials.
