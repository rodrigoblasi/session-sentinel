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

Full session detail with runs, events, transcript, notifications, and available actions. Events are limited to the 50 most recent — use `GET /events?session_id=:id` for the full log.

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
  "available_actions": ["send_message", "terminate", "resume"]
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

Either `project` or `cwd` must be provided. If both are omitted, the request returns `400` with `{ "error": "Either project or cwd must be provided" }`. If `project` is provided but not found in the registry, the request also returns `400`. Projects are auto-discovered from prior session activity — use `GET /projects` to see known names.

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

> **Note:** `summary.ended_today` and `summary.errors_today` are filtered to the current UTC date. `by_project[x].ended_today` currently reflects all sessions with ended status for that project regardless of date — this inconsistency will be fixed in a future release.

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

Real-time event stream. Connect once and receive session events as they happen. Connections are not automatically re-established after a disconnect — implement reconnect logic with backoff if using WebSocket for continuous monitoring. For periodic checks, polling `GET /report` is simpler and more resilient.

```bash
wscat -c ws://localhost:3100/ws
```

Two event types are currently broadcast:

**`session_update`** — A session was discovered or had activity:
```json
{ "type": "session_update", "session": { "id": "ss-01JQXYZ...", "status": "active", "..." : "..." } }
```

**`status_change`** — A session changed status:
```json
{ "type": "status_change", "sessionId": "ss-01JQXYZ...", "from": "active", "to": "waiting" }
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

Each notification is delivered to two destinations via the `agent-notify.sh` script:
1. **Owner's Discord channel** (`#<owner-name>`) — wakes the agent that owns the session
2. **#sentinel-log** — audit channel for the operator

The notification arrives as a Discord message containing the session ID, status, project, branch, and either the pending question (for `waiting`) or error details (for `error`), plus an `apiUrl` link to the session detail endpoint.

The `owner` value you provide when creating or resuming a session must match a Discord channel name known to `agent-notify.sh`. If the channel doesn't exist, the notification delivery will fail silently (recorded as `delivered: false` in the notification log).

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

---

## Common Workflows

### 1. Create a session and monitor it

```bash
# Create a managed session
curl -X POST http://localhost:3100/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Fix the failing test in src/auth.ts",
    "owner": "my-agent",
    "cwd": "/home/user/my-project",
    "label": "fix-auth-test"
  }'
# Returns 201 with session object — note the "id" field

# Poll for status changes
curl http://localhost:3100/sessions/ss-01JQXYZ...

# Or connect via WebSocket for real-time updates
wscat -c ws://localhost:3100/ws
# Receive: {"type":"status_change","sessionId":"ss-01JQXYZ...","from":"starting","to":"active"}
```

### 2. Handle a waiting notification

When your agent receives a notification that a session is `waiting`:

```bash
# 1. Get full session context
curl http://localhost:3100/sessions/ss-01JQXYZ... | jq '{
  question: .session.pending_question,
  project: .session.project_name,
  branch: .session.git_branch,
  actions: .available_actions
}'

# 2. Respond to the question
curl -X POST http://localhost:3100/sessions/ss-01JQXYZ.../message \
  -H "Content-Type: application/json" \
  -d '{ "message": "Yes, proceed with the refactor" }'
# Returns 202 — session will resume processing
```

### 3. Resume an ended session

```bash
# Check if the session can be resumed
curl http://localhost:3100/sessions/ss-01JQXYZ... | jq '{
  status: .session.status,
  can_resume: .session.can_resume,
  actions: .available_actions
}'

# Resume with a new prompt
curl -X POST http://localhost:3100/sessions/ss-01JQXYZ.../resume \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Continue where you left off — the test should now pass after the config change",
    "owner": "my-agent"
  }'
# Returns 200 with updated session object
```

### 4. Check what needs attention

```bash
# Quick overview — summary + sessions needing action
curl http://localhost:3100/report | jq '{
  summary: .summary,
  needs_attention: [.needs_attention[] | {id, status, project: .project_name, question: .pending_question}]
}'

# Or filter for specific states
curl "http://localhost:3100/sessions?status=waiting"
curl "http://localhost:3100/sessions?active=true&owner=my-agent"
```

---

## Best Practices

- **Use `GET /report` for overview** instead of polling individual sessions. It returns everything you need in one call: summary stats, sessions needing attention, active sessions, and recent events.

- **Use WebSocket for real-time updates** instead of polling. Connect to `ws://host:3100/ws` and react to `status_change` events. Polling is fine for periodic checks, but WebSocket is better for responsiveness.

- **Let housekeeping handle idle sessions.** Managed sessions idle for 15 minutes are automatically terminated and remain resumable. Don't manually terminate sessions unless you have a specific reason (e.g., the task is complete, or you want to free resources immediately).

- **Always provide a meaningful `owner`** when creating or resuming sessions. This is how Sentinel routes notifications to the right agent. Use a consistent name for your agent (e.g., `"openclaw"`, `"deploy-bot"`).

- **Use `label` for identification.** Labels appear in the dashboard and make sessions easy to find. Use descriptive labels like `"fix-auth-test"` or `"refactor-api-layer"`.

- **Check `available_actions` before acting.** The session detail response includes an `available_actions` array with possible values: `send_message`, `terminate`, and `resume`. Check it before attempting lifecycle operations — it tells you exactly what's valid for the current session state.

- **Don't flood the API.** For typical agent workflows, check `GET /report` every 30-60 seconds or use WebSocket. Don't poll `GET /sessions/:id` in a tight loop.
