# Project Session Sentinel — Design Spec

**Date:** 2026-03-27
**Status:** Draft — pending user review
**Repo:** https://github.com/rodrigoblasi/session-sentinel
**Replaces:** claude-code-gateway (discontinued, kept as learning reference)

---

## 1. What is Session Sentinel?

A control plane for development agent sessions. It monitors, manages, and brokers interactions between human operators, AI agents (OpenClaw ecosystem), and Claude Code sessions.

**Today:** Focused on Claude Code sessions.
**Future:** Extensible to other agent runtimes (Codex, Gemini CLI, etc.). The name and architecture are vendor-agnostic by design.

### Core responsibilities

1. **Monitor** — Observes all Claude Code sessions passively via JSONL filesystem watching. Never interferes with unmanaged sessions.
2. **Manage** — Creates, resumes, terminates managed sessions. Housekeeping (auto-kill idle sessions).
3. **Bridge** — Notifies agents when sessions need attention. Delivers rich context for agent decision-making.
4. **Control Plane** — REST API, WebSocket real-time updates, dashboard UI for the operator.

---

## 2. Session Mode: Interactive Only

The old Gateway used `claude --print` (one-shot mode): each message spawned a new process, executed, and exited. This prevented real conversation flow, natural input waiting, and true session continuity.

**Sentinel uses interactive sessions exclusively.** Managed sessions run `claude` (without `--print`), keeping the process alive with stdin/stdout open. This means:

- The session is a real, persistent conversation — like the user's terminal experience
- The session can naturally wait for input (status=waiting)
- Messages are sent via stdin to the living process, not by spawning new processes
- Resume works naturally via `claude --resume`
- The Session Manager maintains the process lifecycle, not per-turn spawn/kill

This is a fundamental architectural change from the old Gateway and must be understood from the start. The exact CLI flags and interaction model depend on Sprint 0 investigation (SDK study).

### Claude Remote — enabled by default

Claude Remote (`--remote-control`) is a recent Claude Code feature that exposes a web interface for observing and interacting with a session via browser. The operator already enables this by default in their terminal.

**Sentinel policy:** All managed sessions are created with Claude Remote enabled. This provides:

- **Operator visibility** — Dashboard can link directly to the Claude Remote URL for any session. Click and see exactly what's happening, interact if needed.
- **Alternative interaction path** — Beyond stdin via API, the operator (or potentially an agent) can interact via the Claude Remote web interface.
- **Debug tool** — When something looks wrong in a session, the operator can open Claude Remote to see the full conversation in real-time.

The Claude Remote URL for each session should be captured and stored (in the `sessions` table) and exposed in the API response and dashboard UI. Sprint 0 should investigate how to programmatically obtain the Claude Remote URL from a spawned session.

---

## 3. Key Concepts

### Session vs Run

The core data model separates **Sessions** (logical units) from **Runs** (executions):

- **Session** — A stable entity representing a task/objective. Persists across resumes. Has a Sentinel-generated ID (`ss-*`), accumulated metrics, and a lifecycle.
- **Run** — Each time a session is started, resumed, or reassumed. Each Run has its own JSONL file, token counts, owner, type, start/end time.

This solves the identity problem from the old Gateway where 1 JSONL = 1 session, making resumes and handoffs confusing.

### Managed vs Unmanaged

| Type | Who controls | Sentinel can | Notifications |
|------|-------------|-------------|---------------|
| **managed** | Sentinel (via agent request) | monitor, interact (stdin), kill, housekeep | Automatic to owner |
| **unmanaged** | User (terminal) | monitor only | None |

A session can transition between types:
- User opens terminal → unmanaged
- Agent resumes via Sentinel → managed (new Run, new owner)
- User takes over in terminal → unmanaged
- Different agent resumes → managed (new Run, new owner)

### Ownership

Every managed session has an **owner** — the agent that created or last resumed it. Ownership determines notification routing. When ownership changes (different agent resumes, or user takes over), the notification target changes accordingly.

---

## 4. Architecture

### Modules

```
┌─────────────────────────────────────────────────────────┐
│                   Session Sentinel                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Session     │  │   Session    │  │    Agent      │  │
│  │   Monitor     │──│   Manager    │  │    Bridge     │  │
│  │              │  │              │  │              │  │
│  │  fs.watch    │  │  spawn/kill  │  │  notify      │  │
│  │  JSONL parse │  │  resume      │  │  context     │  │
│  │  events      │  │  housekeep   │  │  delivery    │  │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘  │
│         │                                     │          │
│         └──────────┐  ┌──────────────────────┘          │
│                    ▼  ▼                                   │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Control Plane                       │    │
│  │   REST API (Fastify) + WebSocket + Dashboard    │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                                │
│  ┌──────────┐  ┌───────┴──────┐  ┌──────────────┐      │
│  │  SQLite   │  │ OpenTelemetry│  │  Agent Docs  │      │
│  │ persist   │  │ traces/logs  │  │ CLAUDE.md    │      │
│  └──────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────┘
```

- **Session Monitor** — Watches `~/.claude/projects/` filesystem. Discovers sessions automatically. Incremental JSONL tail. Extracts status, tokens, transcript, pending questions. Emits internal events (session_discovered, status_changed, question_detected, activity_update). Never interferes.
- **Session Manager** — Creates, resumes, terminates managed sessions. Sends messages via stdin. Housekeeping: auto-kills managed sessions idle beyond threshold. Only acts on managed sessions.
- **Agent Bridge** — Interface between external agents and Sentinel. Automatic notifications for managed sessions (zero config). Rich context delivery when queried. Uses existing `agent-notify.sh` script + Discord.
- **Control Plane** — REST API (Fastify), WebSocket for real-time dashboard updates, SvelteKit dashboard UI.

### Cross-cutting concerns

- **SQLite** (better-sqlite3) — Sessions, events, transcript cache, notifications. Survives restarts.
- **OpenTelemetry** — Traces, metrics, structured logs. Exportable to Grafana/Jaeger.
- **Agent Docs** — CLAUDE.md, OpenAPI spec, examples. Agents learn to use the system from docs.

### Data flow

```
~/.claude/projects/**/*.jsonl
    ↓ fs.watch
Session Monitor
    ↓ internal events (EventEmitter)
    ├── Session Manager → Claude Code CLI (spawn/kill)
    ├── Agent Bridge → Agents via Discord (notify)
    └── Control Plane → Operator via Browser (serve)
            │
            └── Everything persists to SQLite + OpenTelemetry
```

---

## 5. Data Model (SQLite)

### sessions

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Sentinel-generated ID (`ss-*`) |
| claude_session_id | TEXT | Claude Code session UUID (from JSONL) |
| label | TEXT | Human-readable name |
| status | TEXT | starting, active, waiting, idle, stale, ended, error |
| type | TEXT | managed, unmanaged |
| owner | TEXT | Agent name (jarvis, moon, mars) or NULL (unmanaged) |
| cwd | TEXT | Working directory |
| project_name | TEXT | Derived from cwd |
| model | TEXT | Claude model in use |
| effort | TEXT | Effort level |
| git_branch | TEXT | Current git branch |
| git_remote | TEXT | Remote URL |
| jsonl_path | TEXT | Path to current JSONL file |
| pid | INTEGER | Process PID (managed only) |
| remote_url | TEXT | Claude Remote URL (managed, if available) |
| input_tokens | INTEGER | Cumulative input tokens |
| output_tokens | INTEGER | Cumulative output tokens |
| cache_hits | INTEGER | Cumulative cache read tokens |
| pending_question | TEXT | Current question if status=waiting |
| last_output | TEXT | Last relevant result text |
| error_message | TEXT | Error string if status=error |
| can_resume | BOOLEAN | Whether session can be resumed |
| created_at | DATETIME | Session first seen |
| updated_at | DATETIME | Last activity |
| ended_at | DATETIME | When session ended |

### runs

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| session_id | TEXT FK | References sessions(id) |
| run_number | INTEGER | Sequential run number for this session |
| jsonl_path | TEXT | JSONL file for this run |
| type_during_run | TEXT | managed or unmanaged during this run |
| owner_during_run | TEXT | Agent or NULL during this run |
| model | TEXT | Model used during this run |
| effort | TEXT | Effort level during this run |
| input_tokens | INTEGER | Tokens for this run |
| output_tokens | INTEGER | Tokens for this run |
| cache_hits | INTEGER | Cache read tokens for this run |
| started_at | DATETIME | Run start |
| ended_at | DATETIME | Run end |

### session_events

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| session_id | TEXT FK | References sessions(id) |
| event_type | TEXT | status_change, type_change, message_sent, notification, error, housekeep |
| from_status | TEXT | Previous status |
| to_status | TEXT | New status |
| actor | TEXT | Who caused it (operator, agent name, system) |
| detail | JSON | Extra context |
| created_at | DATETIME | When it happened |

### transcript_cache

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| session_id | TEXT FK | References sessions(id) |
| run_id | INTEGER FK | References runs(id) |
| turn | INTEGER | Turn number |
| role | TEXT | user, assistant, system |
| content | TEXT | Message text |
| tools_used | JSON | Array of tool names |
| tokens | INTEGER | Tokens for this turn |
| created_at | DATETIME | When it happened |

### notifications

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| session_id | TEXT FK | References sessions(id) |
| channel | TEXT | discord, webhook, etc |
| destination | TEXT | Agent thread or sentinel-log |
| trigger | TEXT | waiting, error |
| payload | JSON | Notification content sent |
| delivered | BOOLEAN | Whether delivery succeeded |
| created_at | DATETIME | When sent |

---

## 6. Notification Model

### Rules

1. **Managed session = automatic notification.** Zero config. When Session Manager creates or resumes a session, notifications are built-in.
2. **Unmanaged session = no notification.** Monitor records everything in SQLite. Visible on dashboard. If you want notifications, resume via Sentinel (becomes managed).
3. **Notifications follow the current owner.** Ownership changes when a different agent resumes. Previous owner stops receiving.

### Dual delivery

Every notification is sent to **two destinations simultaneously**:

1. **Owner's Discord thread** (e.g., #jarvis, #moon, #mars) — Wakes up the agent. The agent reads, interprets, and acts.
2. **#sentinel-log channel** — Audit/debug. Operator sees everything that was sent, even if the agent doesn't react.

### Notification content

The notification already includes hints so the agent knows what to investigate:
- Session ID and label
- Status that triggered the notification (waiting, error)
- Project name and branch
- Brief context (pending question for waiting, error message for error)
- API endpoint to get full details

### Delivery mechanism

Uses existing `agent-notify.sh` script from the OpenClaw ecosystem. Script to be reviewed and adapted for Sentinel's notification format.

---

## 7. API Design

### Principles

- **Few endpoints** — Agents don't need to memorize many routes
- **Rich responses** — Each response carries enough context for the agent to act without extra calls
- **Documentation first** — OpenAPI spec, agent guide, examples

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Sentinel status, uptime, version, session counts by status |
| GET | `/sessions` | List sessions with filters |
| GET | `/sessions/:id` | Full session detail with runs, transcript, context, available actions |
| GET | `/sessions/:id/transcript` | Parsed transcript by turn |
| POST | `/sessions` | Create new managed session |
| POST | `/sessions/:id/resume` | Resume ended session (creates new Run, changes owner/type) |
| POST | `/sessions/:id/message` | Send message to managed session |
| DELETE | `/sessions/:id` | Terminate managed session |
| GET | `/report` | Environment snapshot — summary for agent situational awareness |
| GET | `/events` | Global event log with filters |
| WS | `/ws` | Real-time updates for dashboard |

### Key filters on GET /sessions

- `?status=waiting` — by status
- `?type=managed` — by type
- `?owner=jarvis` — agent's own sessions
- `?project=wow-bot` — by project
- `?needs_attention=true` — sessions needing action (waiting/error)
- `?active=true` — only live sessions
- `?can_resume=true` — ended sessions that can be resumed (for handoff scenarios)
- `?since=2h` — time window

### Rich session detail (GET /sessions/:id)

Response includes five context blocks:

1. **Identity** — id, label, project, cwd, branch, model, effort
2. **Current state** — status, pending_question, error_message, last_output, can_resume
3. **Project context** — other sessions in same project, today's project activity
4. **Session history** — runs timeline (who operated, when, tokens), recent transcript
5. **Available actions** — what the agent can do now (send_message, resume, terminate), resume CLI command for operator

### Environment report (GET /report)

A single endpoint that gives an agent (or the operator) a full snapshot of the environment. Designed for the scenario: "give me a general overview, what's going on?"

Response:

```json
{
  "summary": {
    "total_sessions": 12,
    "active": 3,
    "waiting": 1,
    "idle": 2,
    "ended_today": 6,
    "errors_today": 0,
    "total_tokens_today": 450000
  },
  "needs_attention": [
    { "id": "ss-...", "label": "feat/auth", "project": "wow-bot", "status": "waiting", "pending_question": "Should I proceed with...", "owner": "jarvis", "waiting_since": "2m ago" }
  ],
  "active_sessions": [
    { "id": "ss-...", "label": "refactor/db", "project": "sentinel", "status": "active", "owner": "moon", "tokens": 120000, "duration": "31m" }
  ],
  "recent_events": [
    { "timestamp": "...", "type": "status_change", "session": "feat/auth", "detail": "active → waiting" },
    { "timestamp": "...", "type": "housekeep", "session": "old-task", "detail": "auto-killed (idle 15m)" }
  ],
  "by_project": {
    "wow-bot": { "active": 1, "waiting": 1, "ended_today": 3 },
    "sentinel": { "active": 1, "ended_today": 2 },
    "finance-app": { "idle": 1, "ended_today": 1 }
  }
}
```

This is the endpoint the agent calls when the operator says "give me a report". One call, full picture. The agent reads this and can immediately tell the operator:
- What needs attention right now
- What's running and for whom
- How the day's been (volume, tokens, errors)
- Which projects have activity

### Scale consideration

50-100 sessions per day. Listing returns **summary** (lightweight). Detail returns **full context** (rich). Filters prevent agent from drowning in irrelevant sessions.

---

## 8. Dashboard UI

### Level 1 — Overview (Table)

All sessions in a sortable, filterable table. Columns: status badge, label, project, branch, type, owner, tokens, duration, last activity. Real-time via WebSocket. Filters at the top.

### Level 2 — Drill-down (Detail Panel)

Click a session to see:
- **Metadata** — status, type, owner, model, effort, project, branch, total tokens, total duration, number of runs
- **Current state** — pending question (if waiting), last output, error message
- **Runs timeline** — chronological list of all runs with who operated, duration, tokens
- **Actions** — terminate session, view resume CLI command, view full transcript, view sent notifications

### Event log

Always visible in the UI. Shows transitions, notifications, housekeeping actions. Can be filtered globally or by session. Shows: timestamp, event type, session label, from→to status, actor.

### Operator actions via UI

- Kill a managed session
- View resume command for CLI (if can_resume)
- View notification history for a session
- Filter/search sessions

---

## 9. Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js + TypeScript | Familiar, ecosystem, async I/O |
| HTTP Framework | Fastify | Schema validation, WebSocket plugin, OpenTelemetry plugin |
| Database | SQLite via better-sqlite3 | Sync, fast, zero-config, survives restarts |
| Frontend | SvelteKit | Like Claude Karma — SSR, lightweight, reactive |
| Real-time | WebSocket (Fastify plugin) | Dashboard live updates |
| Observability | OpenTelemetry SDK | Traces + metrics + structured logs, export to Grafana/Jaeger |
| Tests | Vitest | Unit + integration |
| Deploy | systemd on homeserver01 | Same as current Gateway |

---

## 10. Project Infrastructure

- **Repository:** https://github.com/rodrigoblasi/session-sentinel (public)
- **Issue tracking:** GitHub Issues
- **Planning:** GitHub Projects (Kanban view)
- **CI/CD:** GitHub Actions (lint, test, build)
- **Notifications (dev):** agent-notify.sh + Discord (existing OpenClaw infra)

---

## 11. Sprint 0 — Investigation

Before implementation, these investigations must happen:

1. **Claude Code SDK/JSONL study** — Document how sessions, resumes, and sub-agents are represented in JSONL files. Use Claude Karma as reference implementation. Align the Session + Runs model with actual Claude Code behavior.
2. **Sub-agent detection** — When Claude Code spawns sub-agents (via Agent tool), new JSONL files are created. Sentinel must identify these as children of the parent session, not independent sessions. (Migrated from old Gateway issue #17)
3. **SDK interactive support** — Investigate Claude Code SDK for programmatic session interaction beyond stdin. (Migrated from old Gateway issue #18)
4. **agent-notify.sh review** — Review and adapt the existing notification script for Sentinel's format.
5. **Claude Remote integration** — How to programmatically obtain the Claude Remote URL from a spawned session. How to detect if remote control is available. Whether agents can interact via Claude Remote programmatically.
6. **Managed→unmanaged handoff detection** — How does Sentinel detect that a user has taken over a managed session in the terminal? Possible signals: PID change, stdin no longer controlled by Sentinel, new JSONL activity without Sentinel-initiated action. Needs investigation.

---

## 12. Documentation Deliverables

### Agent Guide (CLAUDE.md)

A document that lives in the repo and in projects that use Sentinel. Teaches agents:
- What Sentinel is and how it works
- Available endpoints with curl examples
- How to interpret notifications
- How to decide: respond, escalate, or ignore
- How to create/resume/terminate sessions
- Best practices (don't flood with calls)

### OpenAPI Spec

Formal API specification published at `GET /docs`:
- Typed request/response schemas
- Inline examples
- Field descriptions
- Can become MCP tool spec in the future

---

## 13. Housekeeping Rules

### Why this matters

With interactive sessions, every idle session is a **live process consuming memory and resources**. The old Gateway used `--print` (process dies per turn), so this wasn't a problem. Now it's critical — poorly managed housekeeping with 50-100 sessions/day will degrade the server.

### Resource management strategy

The core principle: **a session that isn't being used should not be a running process.** Sessions can always be resumed, so killing idle sessions is safe and expected.

### Default rules (v1 — intentionally simple)

| Rule | Scope | Threshold | Action |
|------|-------|-----------|--------|
| Idle auto-kill | managed only | 15 min no activity | SIGTERM → status=ended, can_resume=true |
| Unmanaged | never killed | — | Monitor only, report in dashboard |

**Flow:** active → idle (no activity) → ended (15 min auto-kill, silent)

**No stale notifications.** Housekeeping is an internal Sentinel decision, not an agent concern. Notifications are exclusively for sessions that need agent action (waiting, error). Sending notifications for stale/idle sessions would create noise, potential loops, and undermine the principle that a notification = wake-up call for real action.

### What "no activity" means

No new JSONL events. The session is alive but nothing is happening — no tool calls, no assistant output, no user input. An active session producing output is never killed, regardless of how long it runs.

### Known areas for future refinement

These will emerge from real usage and should become issues when observed:

- **Per-project or per-session thresholds** — Some tasks are legitimately long-running (large refactors). May need configurable overrides.
- **Cost-aware rules** — Sessions with high token consumption might deserve longer idle thresholds (expensive to re-establish context).
- **Time-of-day rules** — Sessions left running overnight could have different thresholds than daytime sessions.
- **Concurrent session limits** — Maximum number of live managed processes. New session creation blocked or oldest idle killed when limit reached.
- **Grace period after notification** — How long to wait between stale notification and auto-kill, in case the agent is about to respond.

These are explicitly **not designed now**. The v1 rule (15 min idle = kill) is the starting point. PDCA from real operation will surface which refinements matter.

### Housekeeping for DB records

- Ended sessions stay in SQLite indefinitely (cheap storage, valuable history)
- Configurable retention if needed in the future
- Transcript cache may need periodic cleanup for very long-lived sessions

---

## 14. Project Registry

The Sentinel needs to resolve project names to filesystem paths. When an agent says "open a session in wow-bot", the system must know where that project lives.

### Approach: auto-populated registry with manual override

The Sentinel already monitors `~/.claude/projects/` which contains references to every project that has had Claude Code sessions. This provides automatic discovery of project→path mappings.

Additionally, a simple config or API allows manual registration for projects that haven't had sessions yet.

### How it works

- `POST /sessions` accepts **either** `project` (name) **or** `cwd` (absolute path)
- If `project` is provided, Sentinel resolves it to a `cwd` via the registry
- Registry auto-populates from discovered sessions (every session has a cwd → project_name mapping)
- Manual override via config for edge cases

### API addition

| Method | Path | Description |
|--------|------|-------------|
| GET | `/projects` | List known projects with paths, session counts, last activity |

This endpoint serves dual purpose:
- Agent can check "what projects exist?" before creating a session
- Dashboard can show a projects overview
- The response includes: project name, path, active sessions count, total sessions count, last activity

### Data model addition

**projects** table (SQLite):

| Column | Type | Description |
|--------|------|-------------|
| name | TEXT PK | Project name (derived from path basename or manually set) |
| cwd | TEXT UNIQUE | Absolute filesystem path |
| discovered_at | DATETIME | When first seen |
| last_session_at | DATETIME | Last session activity in this project |
| session_count | INTEGER | Total sessions ever |
| alias | TEXT | Optional friendly name (if basename is not clear enough) |

---

## 15. Deployment & Ecosystem Decisions

### Deployment: systemd (not Docker, for now)

Sentinel runs on a single homeserver via systemd, same as the old Gateway. Docker adds complexity (volume mounts for `~/.claude/projects/`, Claude CLI inside container, process spawning) that doesn't solve a real problem today. The architecture (Fastify, SQLite, configurable paths) does not prevent future containerization.

**Future Docker consideration:** When Sentinel is stable and if a Docker Compose setup with Grafana + Jaeger for observability makes sense, containerization becomes a natural sprint issue. Not a blocker for v1.

### Relationship with Claude Karma

Claude Karma is an existing tool that monitors Claude Code sessions with rich detail. During Sentinel's early development, Karma serves as a **fallback for debug** when Sentinel doesn't yet expose enough session detail.

The roadmap:
1. **Now:** Karma runs alongside Sentinel. Operator uses Karma for deep session debug that Sentinel doesn't cover yet.
2. **Gradually:** Sentinel incorporates the session detail capabilities that are useful for its mission (agent context, operator visibility).
3. **Eventually:** Sentinel is self-sufficient. Karma is no longer needed for the Sentinel workflow.

Not everything Karma does is relevant to Sentinel. Sentinel incorporates what serves its mission (session monitoring, context delivery, operator visibility), not the full Karma feature set.

### No existing tool covers this use case

The combination of passive session awareness, agent notification/wake-up, human-agent handoff with ownership tracking, and rich context delivery for agent decision-making does not exist in any current tool. General-purpose orchestrators (n8n, Temporal, Airflow) don't understand coding sessions. Claude Karma monitors but doesn't manage or bridge to agents. The Claude Code SDK is a library, not a service. Sentinel fills this gap.

---

## 16. Out of Scope (for now)

- Multi-vendor agent runtime support (Codex, Gemini CLI) — architecture supports it, implementation is Claude Code only
- Authentication/authorization on the API — single-user, local network
- Distributed deployment — single homeserver
- Docker containerization — systemd for v1, Docker considered when stable
- MCP server integration — future consideration

---

## 17. Success Criteria

1. Agent (OpenClaw) can create and resume sessions via API without manual intervention
2. Agent receives automatic notifications on Discord when managed session needs attention
3. Agent gets rich context in a single API call to decide how to act
4. Dashboard shows all sessions with real-time updates, drill-down, event log
5. Session identity is clear: resumes create new Runs, not new Sessions
6. Sub-agent sessions are correctly identified as children
7. Housekeeping keeps resource usage under control automatically
8. Documentation enables new agents to use Sentinel without human guidance
