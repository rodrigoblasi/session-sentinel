# Agent Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `docs/agent-guide.md` — a self-contained guide for developers building agents that integrate with Session Sentinel's API.

**Architecture:** Single markdown file, linear narrative: introduction → concepts → API reference → notifications → workflows → best practices. All curl examples and response shapes verified against the actual implementation in `src/api/routes.ts` and `src/shared/types.ts`.

**Tech Stack:** Markdown only. No code changes.

---

### Task 1: Introduction and Key Concepts

**Files:**
- Create: `docs/agent-guide.md`

- [ ] **Step 1: Write the introduction**

Write the opening section of `docs/agent-guide.md`:

```markdown
# Session Sentinel — Agent Guide

This guide is for developers building agents that interact with Claude Code sessions through Session Sentinel's REST API. It covers the concepts you need to understand, the full API reference with examples, and common integration patterns.

Session Sentinel is a control plane for Claude Code sessions. It monitors all sessions passively via JSONL filesystem watching, manages session lifecycle (create, resume, terminate) for agent-driven sessions, and notifies agents when sessions need attention. For the full architecture, see the [design spec](specs/2026-03-27-session-sentinel-design.md).

**Base URL:** `http://<host>:3100`

---
```

- [ ] **Step 2: Write Key Concepts section**

Add the concepts section covering session vs run, managed vs unmanaged, ownership, statuses, and housekeeping. Content must match the types in `src/shared/types.ts`:

- Session statuses: `starting`, `active`, `waiting`, `idle`, `ended`, `error` (from `SessionStatus` type)
- Session types: `managed`, `unmanaged` (from `SessionType` type)
- Ownership: `owner` field on `Session` interface
- Housekeeping: 15 min idle threshold from `HOUSEKEEP_IDLE_THRESHOLD_MS` in `src/shared/constants.ts`

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/agent-guide.md
git commit -m "docs(docs): add agent guide — introduction and key concepts"
```

---

### Task 2: API Reference — Health, Sessions, and Lifecycle

**Files:**
- Modify: `docs/agent-guide.md`

- [ ] **Step 1: Write Health endpoint**

```markdown
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
```

- [ ] **Step 2: Write Sessions retrieval endpoints**

Document `GET /sessions`, `GET /sessions/:id`, and `GET /sessions/:id/transcript`.

For `GET /sessions`, document the query parameters from `src/api/routes.ts` lines 20-28:
- `status` — filter by status (`starting`, `active`, `waiting`, `idle`, `ended`, `error`)
- `type` — filter by type (`managed`, `unmanaged`)
- `owner` — filter by owner name
- `project` — filter by project name
- `active` — set to `true` to get only non-ended sessions
- `limit` — max number of results

For `GET /sessions/:id`, show the full `SessionDetailResponse` shape from `src/shared/types.ts` lines 359-366: session, runs, events, transcript, notifications, available_actions.

For `GET /sessions/:id/transcript`, document the `limit` query param.

Include curl examples and realistic response samples for each.

- [ ] **Step 3: Write Lifecycle endpoints**

Document all four lifecycle endpoints from `src/api/routes.ts`:

**`POST /sessions`** (create) — lines 59-84:
- Required: `prompt`, `owner`
- Optional: `project`, `cwd`, `label`, `model`, `effort`, `allowedTools`, `systemPrompt`, `maxBudgetUsd`
- Returns: 201 with session object
- Note: defaults from `src/shared/constants.ts`: model=`claude-sonnet-4-6`, effort=`high`

**`POST /sessions/:id/resume`** — lines 86-107:
- Required: `prompt`, `owner`
- Optional: `model`, `effort`
- Valid from: `ended`, `error`, `idle` statuses
- Returns: 200 with session object

**`POST /sessions/:id/message`** — lines 109-125:
- Required: `message`
- Valid for: managed sessions in `waiting`, `active`, `idle` statuses
- Returns: 202 with `{ "status": "message_sent" }`

**`DELETE /sessions/:id`** — lines 127-138:
- Returns: 200 with `{ "status": "terminated" }`

Include curl examples and response samples for each.

- [ ] **Step 4: Commit**

```bash
git add docs/agent-guide.md
git commit -m "docs(docs): add API reference — health, sessions, lifecycle"
```

---

### Task 3: API Reference — Report, Events, Projects, WebSocket

**Files:**
- Modify: `docs/agent-guide.md`

- [ ] **Step 1: Write Report endpoint**

Document `GET /report` from `src/api/routes.ts` lines 142-167. Response shape matches `ReportResponse` in `src/shared/types.ts` lines 378-384:

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
  "needs_attention": [],
  "active_sessions": [],
  "recent_events": [],
  "by_project": {
    "wow-bot": { "active": 1, "waiting": 0, "ended_today": 3 },
    "session-sentinel": { "active": 1, "waiting": 1, "ended_today": 5 }
  }
}
```

- [ ] **Step 2: Write Events and Projects endpoints**

Document `GET /events` with filters (`session_id`, `event_type`, `limit`) from `src/api/routes.ts` lines 171-180.

Document `GET /projects` from line 184. Response is an array of project objects.

Include curl examples for both.

- [ ] **Step 3: Write WebSocket section**

Document `ws://host:3100/ws` with the four event types from `src/shared/types.ts` lines 388-392:
- `session_update` — session discovered or activity
- `status_change` — session status transition (includes `from` and `to`)
- `event` — new session event
- `notification` — notification sent

Include a connection example using `wscat`.

- [ ] **Step 4: Commit**

```bash
git add docs/agent-guide.md
git commit -m "docs(docs): add API reference — report, events, projects, websocket"
```

---

### Task 4: Notification Model

**Files:**
- Modify: `docs/agent-guide.md`

- [ ] **Step 1: Write Notification Model section**

Document the notification system from the consumer's perspective, based on `src/bridge/index.ts` and `src/shared/types.ts` lines 318-328.

Content:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/agent-guide.md
git commit -m "docs(docs): add notification model section"
```

---

### Task 5: Common Workflows

**Files:**
- Modify: `docs/agent-guide.md`

- [ ] **Step 1: Write workflow — Create a session and monitor it**

```markdown
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
```

- [ ] **Step 2: Write workflow — Handle a waiting notification**

```markdown
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
```

- [ ] **Step 3: Write workflow — Resume an ended session**

```markdown
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
```

- [ ] **Step 4: Write workflow — Check what needs attention**

```markdown
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
```

- [ ] **Step 5: Commit**

```bash
git add docs/agent-guide.md
git commit -m "docs(docs): add common workflows section"
```

---

### Task 6: Best Practices and Final Review

**Files:**
- Modify: `docs/agent-guide.md`

- [ ] **Step 1: Write Best Practices section**

```markdown
## Best Practices

- **Use `GET /report` for overview** instead of polling individual sessions. It returns everything you need in one call: summary stats, sessions needing attention, active sessions, and recent events.

- **Use WebSocket for real-time updates** instead of polling. Connect to `ws://host:3100/ws` and react to `status_change` events. Polling is fine for periodic checks, but WebSocket is better for responsiveness.

- **Let housekeeping handle idle sessions.** Managed sessions idle for 15 minutes are automatically terminated and remain resumable. Don't manually terminate sessions unless you have a specific reason (e.g., the task is complete, or you want to free resources immediately).

- **Always provide a meaningful `owner`** when creating or resuming sessions. This is how Sentinel routes notifications to the right agent. Use a consistent name for your agent (e.g., `"openclaw"`, `"deploy-bot"`).

- **Use `label` for identification.** Labels appear in the dashboard and make sessions easy to find. Use descriptive labels like `"fix-auth-test"` or `"refactor-api-layer"`.

- **Check `available_actions` before acting.** The session detail response includes an `available_actions` array. Check it before attempting lifecycle operations — it tells you exactly what's valid for the current session state.

- **Don't flood the API.** For typical agent workflows, check `GET /report` every 30-60 seconds or use WebSocket. Don't poll `GET /sessions/:id` in a tight loop.
```

- [ ] **Step 2: Review the complete document**

Read through the entire `docs/agent-guide.md` and verify:
- All endpoint paths match `src/api/routes.ts`
- All field names match `src/shared/types.ts`
- Curl examples are syntactically correct
- Response samples are realistic
- No broken markdown formatting
- No placeholder text

- [ ] **Step 3: Commit**

```bash
git add docs/agent-guide.md
git commit -m "docs(docs): add best practices and finalize agent guide — closes #21"
```
