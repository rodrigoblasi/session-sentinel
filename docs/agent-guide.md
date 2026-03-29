# Session Sentinel — Agent Guide

This guide is for developers building agents that interact with Claude Code sessions through Session Sentinel's REST API. It covers the concepts you need to understand, the full API reference with examples, and common integration patterns.

Session Sentinel is a control plane for Claude Code sessions. It monitors all sessions passively via JSONL filesystem watching, manages session lifecycle (create, resume, terminate) for agent-driven sessions, and notifies agents when sessions need attention. For the full architecture, see the [design spec](specs/2026-03-27-session-sentinel-design.md).

**Base URL:** `http://<host>:3100`

---

## Key Concepts

### Session vs Run

A **Session** is the logical unit — it has a stable ID (format: `ss-<ulid>`), persists across resumes, and accumulates metrics (tokens, events, transcript). A **Run** is each execution: every start or resume creates a new Run with its own token counts and owner.

Think of it like a browser tab (session) vs page loads within it (runs). Closing and reopening a tab preserves the session; each page load is a new run.

### Managed vs Unmanaged

| | Managed | Unmanaged |
|---|---------|-----------|
| **Created by** | Sentinel API (`POST /sessions`) | User in terminal |
| **Controlled by** | Sentinel (create, resume, terminate, message) | User |
| **Notifications** | Automatic (waiting, error) | Never |
| **Housekeeping** | Auto-killed after 15 min idle | Never touched |
| **Sentinel's role** | Full lifecycle control | Monitor only — observe, never interfere |

### Ownership

Every managed session has an **owner** — the agent name that created or last resumed it. The owner receives notifications when the session needs attention. Ownership transfers when a different agent resumes the session.

### Session Statuses

| Status | Meaning |
|--------|---------|
| `starting` | Session process is launching |
| `active` | Producing output (tool calls, text generation) |
| `waiting` | Blocked on user input (asked a question via AskUserQuestion) |
| `idle` | Alive but no recent activity |
| `ended` | Process exited (may be resumable — check `can_resume`) |
| `error` | Something went wrong (API error, crash) |

**Transitions:** `starting → active → waiting/idle → ended/error`. Waiting sessions return to `active` when they receive a message. Ended sessions return to `starting` on resume.

### Housekeeping

Managed sessions that are **idle for 15 minutes** (no JSONL activity) are automatically terminated. This is silent — no notification is sent. The session remains resumable (`can_resume: true`). Waiting sessions are never auto-killed — they are legitimately waiting for input.

---

## API Reference

All endpoints return JSON. Errors use `{ "error": "message" }` with appropriate HTTP status codes.

### Health

#### `GET /health`

Check if Sentinel is running.

```bash
curl http://localhost:3100/health
```

```json
{
  "status": "ok",
  "uptime": 3642.51,
  "version": "0.2.0",
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

### Sessions

#### `GET /sessions`

List sessions with optional filters.

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: `starting`, `active`, `waiting`, `idle`, `ended`, `error` |
| `type` | string | Filter by type: `managed`, `unmanaged` |
| `owner` | string | Filter by owner name |
| `project` | string | Filter by project name |
| `active` | string | Set to `true` to get only non-ended sessions |
| `limit` | number | Max number of results |

```bash
# All active sessions
curl "http://localhost:3100/sessions?active=true"

# Waiting sessions for a specific owner
curl "http://localhost:3100/sessions?status=waiting&owner=my-agent"
```

```json
[
  {
    "id": "ss-01JQXYZ1234567890ABCDEF",
    "claude_session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "label": "fix-auth-test",
    "status": "active",
    "type": "managed",
    "owner": "my-agent",
    "cwd": "/home/user/my-project",
    "project_name": "my-project",
    "model": "claude-sonnet-4-6",
    "effort": "high",
    "git_branch": "feat/auth-fix",
    "git_remote": null,
    "jsonl_path": "/home/user/.claude/projects/.../session.jsonl",
    "pid": 12345,
    "remote_url": null,
    "last_entrypoint": "cli",
    "input_tokens": 15200,
    "output_tokens": 8400,
    "cache_read_tokens": 3200,
    "cache_create_tokens": 1100,
    "pending_question": null,
    "last_output": null,
    "error_message": null,
    "can_resume": true,
    "parent_session_id": null,
    "created_at": "2026-03-29T10:30:00.000Z",
    "updated_at": "2026-03-29T10:35:12.000Z",
    "ended_at": null
  }
]
```

#### `GET /sessions/:id`

Full session detail with runs, events, transcript, notifications, and available actions.

```bash
curl http://localhost:3100/sessions/ss-01JQXYZ1234567890ABCDEF
```

```json
{
  "session": { "id": "ss-01JQXYZ...", "status": "waiting", "..." : "..." },
  "runs": [
    {
      "id": 1,
      "session_id": "ss-01JQXYZ...",
      "run_number": 1,
      "start_type": "startup",
      "type_during_run": "managed",
      "owner_during_run": "my-agent",
      "model": "claude-sonnet-4-6",
      "input_tokens": 15200,
      "output_tokens": 8400,
      "started_at": "2026-03-29T10:30:00.000Z",
      "ended_at": null
    }
  ],
  "events": [
    {
      "id": 1,
      "session_id": "ss-01JQXYZ...",
      "event_type": "status_change",
      "from_status": "active",
      "to_status": "waiting",
      "actor": "monitor",
      "detail": null,
      "created_at": "2026-03-29T10:35:00.000Z"
    }
  ],
  "transcript": [
    {
      "id": 1,
      "session_id": "ss-01JQXYZ...",
      "turn": 1,
      "role": "user",
      "content": "Fix the failing test in src/auth.ts",
      "tools_used": null,
      "input_tokens": 500,
      "output_tokens": 0,
      "created_at": "2026-03-29T10:30:01.000Z"
    }
  ],
  "notifications": [
    {
      "id": 1,
      "session_id": "ss-01JQXYZ...",
      "channel": "discord_owner",
      "destination": "#my-agent",
      "trigger": "waiting",
      "payload": "{...}",
      "delivered": true,
      "created_at": "2026-03-29T10:35:01.000Z"
    }
  ],
  "available_actions": ["send_message", "terminate"]
}
```

#### `GET /sessions/:id/transcript`

Session transcript entries. Supports a `limit` query parameter to restrict the number of entries returned.

```bash
curl "http://localhost:3100/sessions/ss-01JQXYZ.../transcript?limit=10"
```

### Session Lifecycle

These endpoints require the Session Manager to be running. If it's not available, they return `503 Service Unavailable`.

#### `POST /sessions`

Create a new managed session.

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `prompt` | yes | string | Initial task/prompt for the session |
| `owner` | yes | string | Agent name that owns this session |
| `project` | no | string | Project name (resolved via registry) |
| `cwd` | no | string | Working directory (absolute path) |
| `label` | no | string | Human-readable label for identification |
| `model` | no | string | Model to use (default: `claude-sonnet-4-6`) |
| `effort` | no | string | Effort level (default: `high`) |
| `allowedTools` | no | string[] | List of allowed tool names |
| `systemPrompt` | no | string | Custom system prompt |
| `maxBudgetUsd` | no | number | Maximum spend for this session |

Provide either `project` or `cwd` to specify where the session runs. If neither is provided, the session runs in the Sentinel's own working directory.

```bash
curl -X POST http://localhost:3100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Fix the failing test in src/auth.ts",
    "owner": "my-agent",
    "cwd": "/home/user/my-project",
    "label": "fix-auth-test"
  }'
```

Returns `201 Created` with the session object.

#### `POST /sessions/:id/resume`

Resume an ended, errored, or idle session.

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `prompt` | yes | string | New prompt for the resumed session |
| `owner` | yes | string | Agent resuming (becomes new owner) |
| `model` | no | string | Override model for this run |
| `effort` | no | string | Override effort for this run |

The session must be in `ended`, `error`, or `idle` status with `can_resume: true`.

```bash
curl -X POST http://localhost:3100/sessions/ss-01JQXYZ.../resume \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Continue — the config change is deployed, retry the test",
    "owner": "my-agent"
  }'
```

Returns `200 OK` with the updated session object.

#### `POST /sessions/:id/message`

Send a message to a running managed session. Use this to answer questions when a session is `waiting`.

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `message` | yes | string | Message to send to the session |

The session must be managed and in `waiting`, `active`, or `idle` status.

```bash
curl -X POST http://localhost:3100/sessions/ss-01JQXYZ.../message \
  -H "Content-Type: application/json" \
  -d '{ "message": "Yes, proceed with the refactor" }'
```

Returns `202 Accepted` with `{ "status": "message_sent" }`.

#### `DELETE /sessions/:id`

Terminate a running managed session.

```bash
curl -X DELETE http://localhost:3100/sessions/ss-01JQXYZ...
```

Returns `200 OK` with `{ "status": "terminated" }`.

### Report & Analytics

#### `GET /report`

Environment snapshot — the single best endpoint for agents to understand the current state.

```bash
curl http://localhost:3100/report
```

```json
{
  "summary": {
    "total_sessions": 12,
    "active": 2,
    "waiting": 1,
    "idle": 0,
    "ended_today": 8,
    "errors_today": 1,
    "total_tokens_today": 245000
  },
  "needs_attention": [
    { "id": "ss-01JQABC...", "status": "waiting", "project_name": "wow-bot", "pending_question": "Which database migration strategy?" }
  ],
  "active_sessions": [
    { "id": "ss-01JQDEF...", "status": "active", "project_name": "session-sentinel" }
  ],
  "recent_events": [
    { "id": 42, "session_id": "ss-01JQABC...", "event_type": "status_change", "from_status": "active", "to_status": "waiting", "actor": "monitor", "created_at": "2026-03-29T10:35:00.000Z" }
  ],
  "by_project": {
    "wow-bot": { "active": 1, "waiting": 1, "ended_today": 3 },
    "session-sentinel": { "active": 1, "waiting": 0, "ended_today": 5 }
  }
}
```

### Events

#### `GET /events`

Global event log with optional filters.

| Parameter | Type | Description |
|-----------|------|-------------|
| `session_id` | string | Filter events for a specific session |
| `event_type` | string | Filter by event type (e.g., `status_change`, `session_created`, `housekeep`) |
| `limit` | number | Max number of results (default: all) |

```bash
# Recent events across all sessions
curl "http://localhost:3100/events?limit=20"

# Events for a specific session
curl "http://localhost:3100/events?session_id=ss-01JQXYZ..."
```

```json
[
  {
    "id": 42,
    "session_id": "ss-01JQXYZ...",
    "event_type": "status_change",
    "from_status": "active",
    "to_status": "waiting",
    "actor": "monitor",
    "detail": null,
    "created_at": "2026-03-29T10:35:00.000Z"
  }
]
```

### Projects

#### `GET /projects`

List known projects. Projects are auto-discovered from session working directories.

```bash
curl http://localhost:3100/projects
```

```json
[
  {
    "name": "my-project",
    "cwd": "/home/user/my-project",
    "discovered_at": "2026-03-28T09:00:00.000Z",
    "last_session_at": "2026-03-29T10:30:00.000Z",
    "session_count": 5,
    "alias": null
  }
]
```

### WebSocket

#### `ws://<host>:3100/ws`

Real-time event stream. Connect once and receive all session events as they happen.

```bash
wscat -c ws://localhost:3100/ws
```

Four event types are broadcast:

**`session_update`** — A session was discovered or had activity:
```json
{ "type": "session_update", "session": { "id": "ss-01JQXYZ...", "status": "active", "..." : "..." } }
```

**`status_change`** — A session changed status:
```json
{ "type": "status_change", "sessionId": "ss-01JQXYZ...", "from": "active", "to": "waiting" }
```

**`event`** — A new session event was recorded:
```json
{ "type": "event", "event": { "id": 42, "session_id": "ss-01JQXYZ...", "event_type": "status_change", "..." : "..." } }
```

**`notification`** — A notification was sent:
```json
{ "type": "notification", "sessionId": "ss-01JQXYZ...", "trigger": "waiting", "destination": "#my-agent" }
```

---

## Notification Model

Notifications are automatic for managed sessions — no configuration needed. Sentinel notifies the session owner when a session enters `waiting` or `error` status.

### Triggers

Only two statuses trigger notifications:
- **waiting** — the session asked a question (via AskUserQuestion) and is blocked until someone responds
- **error** — an API error, crash, or unrecoverable failure

Other status changes (active, idle, ended) do not trigger notifications. Housekeeping auto-kills are silent.

### Delivery

Each notification is delivered to two destinations:
1. **Owner's Discord thread** (`#<owner-name>`) — wakes the agent that owns the session
2. **#sentinel-log** — audit channel for the operator

### Payload

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Session ID (e.g., `ss-01JQXYZ...`) |
| `label` | string\|null | Session label if provided at creation |
| `status` | string | Trigger status: `waiting` or `error` |
| `project` | string\|null | Project name |
| `gitBranch` | string\|null | Git branch at time of notification |
| `pendingQuestion` | string\|null | The question the session is asking (only for `waiting`) |
| `errorMessage` | string\|null | Error details (only for `error`) |
| `waitingSince` | string\|null | ISO 8601 timestamp when waiting started |
| `apiUrl` | string | Direct link to session detail endpoint |

### Viewing Notification History

The `GET /sessions/:id` detail response includes a `notifications` array with the full delivery log:

```bash
curl http://localhost:3100/sessions/ss-01JQXYZ... | jq '.notifications'
```
