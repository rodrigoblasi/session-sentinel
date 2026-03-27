# Sprint 1 — Foundation: Scaffolding + Monitor + Debug Dashboard

**Date:** 2026-03-27
**Status:** Approved
**Parent spec:** `docs/specs/2026-03-27-session-sentinel-design.md`
**Sprint 0 findings:** `docs/spikes/sprint0-summary.md`

---

## 1. Sprint Goal

Deliver the foundational layer of Session Sentinel: a working Session Monitor that watches Claude Code JSONL files, infers session state, persists everything to SQLite, and exposes it via a minimal debug dashboard.

After Sprint 1, the operator can see all Claude Code sessions discovered on the machine, their status, runs, sub-agents, and events — in real-time.

---

## 2. Sprint Roadmap Context

| Sprint | Scope | Depends on |
|--------|-------|------------|
| **1 (this)** | Scaffolding + SQLite + Monitor + Debug Dashboard | — |
| **2** | Session Manager + REST API (Fastify) | Sprint 1 |
| **3** | Agent Bridge + Dashboard full + WebSocket | Sprint 2 |

Each sprint builds on the previous. The API (Sprint 2) needs Monitor data to serve. The Dashboard (Sprint 3) needs the API to consume and Bridge to display notifications.

---

## 3. Deliverables

| # | Component | Deliverable |
|---|-----------|-------------|
| 1 | Scaffolding | TypeScript project with all deps and directory structure |
| 2 | SQLite | Complete schema + typed access layer |
| 3 | Session Monitor | JSONL watching + parsing + status state machine + event emitter |
| 4 | Issue #3 spike | SDK V2 `bridge_status` decision documented |
| 5 | Debug Dashboard | SvelteKit page showing Monitor state from SQLite |
| 6 | Tests | Unit + integration with real JSONL fixtures |

---

## 4. Component 1: Project Scaffolding

### Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Language |
| `vitest` | Test framework |
| `better-sqlite3` | SQLite driver (sync) |
| `@anthropic-ai/claude-agent-sdk` | Claude Code SDK (issue #3 + future Manager) |
| `svelte` + `@sveltejs/kit` | Debug dashboard |
| `eslint` | Linting |
| `tsx` | Dev runner |

### Directory structure

```
session-sentinel/
├── src/
│   ├── monitor/          # Session Monitor module
│   │   ├── watcher.ts        # fs.watch on ~/.claude/projects/
│   │   ├── parser.ts         # JSONL event parser
│   │   ├── state-machine.ts  # Session status inference
│   │   ├── run-detector.ts   # Run boundary detection
│   │   ├── subagent-detector.ts  # Sub-agent linking
│   │   └── index.ts          # Monitor orchestrator + EventEmitter
│   ├── db/               # SQLite layer
│   │   ├── schema.sql        # DDL for all tables
│   │   ├── migrations/       # Versioned migration files
│   │   ├── connection.ts     # DB initialization + connection
│   │   └── queries.ts        # Typed query functions
│   └── shared/           # Shared types and constants
│       ├── types.ts          # Session, Run, Event, SubAgent types
│       ├── constants.ts      # Status values, thresholds, event types
│       └── events.ts         # Internal event definitions (EventEmitter types)
├── dashboard/            # SvelteKit debug app
│   └── src/
│       └── routes/
│           └── +page.svelte  # Single debug page
├── sandbox/              # Test fixtures and experiments
│   ├── fixtures/             # Anonymized JSONL samples
│   └── seed.ts               # Populate DB with test data
├── tests/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .gitignore
```

### Configuration

- `tsconfig.json`: strict mode, ES2022 target, Node module resolution
- `vitest.config.ts`: test directories, coverage config
- `.gitignore`: `node_modules/`, `*.db`, `dist/`, `.svelte-kit/`

---

## 5. Component 2: SQLite Schema + Access Layer

### Tables

All tables incorporate Sprint 0 amendments (4-column tokens, new columns, new `sub_agents` table).

#### sessions

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Sentinel-generated ID (`ss-{ulid}`) |
| claude_session_id | TEXT UNIQUE | Claude Code session UUID (from JSONL path) |
| label | TEXT | Human-readable name |
| status | TEXT | starting, active, waiting, idle, ended, error |
| type | TEXT | managed, unmanaged |
| owner | TEXT | Agent name or NULL |
| cwd | TEXT | Working directory |
| project_name | TEXT | Derived from cwd |
| model | TEXT | Claude model in use |
| effort | TEXT | Effort level |
| git_branch | TEXT | Current git branch |
| git_remote | TEXT | Remote URL |
| jsonl_path | TEXT | Path to current JSONL file |
| pid | INTEGER | Process PID (managed only) |
| remote_url | TEXT | Claude Remote URL |
| last_entrypoint | TEXT | Most recent entrypoint value (handoff detection) |
| input_tokens | INTEGER DEFAULT 0 | Cumulative input tokens |
| output_tokens | INTEGER DEFAULT 0 | Cumulative output tokens |
| cache_read_tokens | INTEGER DEFAULT 0 | Cumulative cache read tokens |
| cache_create_tokens | INTEGER DEFAULT 0 | Cumulative cache creation tokens |
| pending_question | TEXT | Current question if status=waiting |
| last_output | TEXT | Last relevant result text |
| error_message | TEXT | Error string if status=error |
| can_resume | BOOLEAN DEFAULT 1 | Whether session can be resumed |
| parent_session_id | TEXT | References parent session (Phase 2) |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |
| ended_at | DATETIME | |

#### runs

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTOINCREMENT | |
| session_id | TEXT FK → sessions(id) | |
| run_number | INTEGER | Sequential per session |
| jsonl_path | TEXT | JSONL file for this run |
| start_type | TEXT | startup, resume, compact |
| type_during_run | TEXT | managed or unmanaged |
| owner_during_run | TEXT | Agent or NULL |
| model | TEXT | Model used |
| effort | TEXT | Effort level |
| remote_url | TEXT | Claude Remote URL for this run |
| sentinel_managed | BOOLEAN DEFAULT 0 | Whether Sentinel initiated this run |
| input_tokens | INTEGER DEFAULT 0 | |
| output_tokens | INTEGER DEFAULT 0 | |
| cache_read_tokens | INTEGER DEFAULT 0 | |
| cache_create_tokens | INTEGER DEFAULT 0 | |
| started_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |
| ended_at | DATETIME | |

#### sub_agents

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Agent ID from filename |
| session_id | TEXT FK → sessions(id) | Parent session |
| pattern | TEXT | regular, compact, side_question |
| agent_type | TEXT | From .meta.json (Explore, Plan, etc.) |
| description | TEXT | From .meta.json |
| jsonl_path | TEXT | Absolute path to sub-agent JSONL |
| input_tokens | INTEGER DEFAULT 0 | |
| output_tokens | INTEGER DEFAULT 0 | |
| cache_read_tokens | INTEGER DEFAULT 0 | |
| cache_create_tokens | INTEGER DEFAULT 0 | |
| started_at | DATETIME | |
| ended_at | DATETIME | |

#### session_events

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTOINCREMENT | |
| session_id | TEXT FK → sessions(id) | |
| event_type | TEXT | status_change, type_change, message_sent, notification, error, housekeep, run_started, subagent_detected |
| from_status | TEXT | Previous status |
| to_status | TEXT | New status |
| actor | TEXT | operator, agent name, system, monitor |
| detail | TEXT (JSON) | Extra context |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

#### transcript_cache

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTOINCREMENT | |
| session_id | TEXT FK → sessions(id) | |
| run_id | INTEGER FK → runs(id) | |
| turn | INTEGER | Turn number |
| role | TEXT | user, assistant, system |
| content | TEXT | Message text |
| tools_used | TEXT (JSON) | Array of tool names |
| input_tokens | INTEGER DEFAULT 0 | |
| output_tokens | INTEGER DEFAULT 0 | |
| cache_read_tokens | INTEGER DEFAULT 0 | |
| cache_create_tokens | INTEGER DEFAULT 0 | |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

#### notifications

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTOINCREMENT | |
| session_id | TEXT FK → sessions(id) | |
| channel | TEXT | discord, webhook |
| destination | TEXT | Agent thread or sentinel-log |
| trigger | TEXT | waiting, error |
| payload | TEXT (JSON) | Notification content |
| delivered | BOOLEAN DEFAULT 0 | |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

#### projects

| Column | Type | Description |
|--------|------|-------------|
| name | TEXT PK | Project name (from path basename) |
| cwd | TEXT UNIQUE | Absolute filesystem path |
| discovered_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |
| last_session_at | DATETIME | |
| session_count | INTEGER DEFAULT 0 | |
| alias | TEXT | Optional friendly name |

### Access layer (`src/db/queries.ts`)

Typed functions, not ORM. Key functions:

```
// Sessions
upsertSession(data: SessionUpsert): Session
getSession(id: string): Session | null
getSessionByClaudeId(claudeId: string): Session | null
listSessions(filters: SessionFilters): Session[]
updateSessionStatus(id: string, status: SessionStatus, detail?: object): void
updateSessionTokens(id: string, tokens: TokenDelta): void

// Runs
insertRun(data: RunInsert): Run
getCurrentRun(sessionId: string): Run | null
updateRunTokens(runId: number, tokens: TokenDelta): void
endRun(runId: number): void

// Sub-agents
upsertSubAgent(data: SubAgentUpsert): void
getSubAgents(sessionId: string): SubAgent[]

// Events
insertEvent(data: EventInsert): void
listEvents(filters: EventFilters): SessionEvent[]

// Transcript
insertTranscriptEntry(data: TranscriptInsert): void

// Projects
upsertProject(name: string, cwd: string): void

// DB lifecycle
initDb(dbPath: string): Database
```

### Migration strategy

- `src/db/schema.sql` contains the full DDL (CREATE TABLE IF NOT EXISTS)
- `src/db/migrations/` directory for future incremental migrations
- `initDb()` runs schema.sql on first start, then applies pending migrations
- Schema version tracked in a `_meta` table: `{ key: 'schema_version', value: '1' }`

---

## 6. Component 3: Session Monitor

### Architecture

```
fs.watch(~/.claude/projects/)
    ↓ file change events
Watcher (watcher.ts)
    ↓ new JSONL lines
Parser (parser.ts)
    ↓ typed events
State Machine (state-machine.ts) ←→ SQLite
Run Detector (run-detector.ts)
Sub-agent Detector (subagent-detector.ts)
    ↓ internal events
Monitor (index.ts) → EventEmitter
```

### 6.1 Watcher (`src/monitor/watcher.ts`)

- Uses `fs.watch` recursively on `~/.claude/projects/`
- Maintains a Map of watched JSONL files → last read offset (byte position)
- On change: reads only new bytes from the offset, splits into lines
- Detects new JSONL files (session discovered)
- Ignores non-JSONL files
- Handles watch errors gracefully (file deleted, directory removed)
- Configurable watch root (for testing with `sandbox/` instead of `~/.claude/`)

### 6.2 Parser (`src/monitor/parser.ts`)

Parses raw JSONL lines into typed events. Based on Sprint 0 findings (`docs/spikes/sprint0-jsonl-format.md`).

**Event type detection** (priority order from Sprint 0):

| Priority | Event Type | Signal |
|----------|-----------|--------|
| 1 | `system:api_error` | `type === 'system'` + error content |
| 2 | `assistant:error` | `message.isApiErrorMessage === true` |
| 3 | `assistant:tool_use` | `message.content[].type === 'tool_use'` |
| 4 | `assistant:tool_result` | `message.content[].type === 'tool_result'` |
| 5 | `assistant:text` | `message.role === 'assistant'` + text content |
| 6 | `user:text` | `message.role === 'user'` |
| 7 | `hook_progress` | `type === 'hook_progress'` — **SKIP** (33% of volume) |
| 8 | `result` | `type === 'result'` — final summary with tokens |
| 9 | `bridge_status` | `type === 'bridge_status'` — Claude Remote URL |

**Extracted data per event:**
- Token deltas (input, output, cache_read, cache_create)
- Tool names from tool_use events
- Pending question from `AskUserQuestion` tool_use
- Error messages from error events
- Model, cwd, git branch from session metadata
- Claude Remote URL from bridge_status
- Entrypoint field (for handoff detection)

### 6.3 Status State Machine (`src/monitor/state-machine.ts`)

Deterministic state transitions based on parsed events:

```
                 ┌─────────────────────────────┐
                 ▼                              │
starting ──→ active ──→ waiting ──→ active     │
                │          │                    │
                ▼          ▼                    │
              idle ──→  ended                   │
                │                               │
                ▼                               │
             ended ─── (resume) ───────────────┘

          error (from any state)
```

**Transition rules:**

| From | To | Trigger |
|------|----|---------|
| (new) | starting | First JSONL event for unknown session |
| starting | active | First `assistant` event |
| active | waiting | `AskUserQuestion` tool_use, no subsequent `user` event |
| waiting | active | New `user` event after question |
| active | idle | No JSONL events for 60 seconds |
| idle | active | New JSONL event |
| idle | ended | No JSONL events for 5 minutes |
| any | error | `system:api_error` or `isApiErrorMessage` |
| error | active | New successful `assistant` event |
| ended | starting | Resume detected (new run) |

**Implementation:**
- Pure function: `transition(currentStatus, event) → newStatus | null`
- Returns `null` if no transition applies
- Every transition persists to `session_events` table
- Idle and ended detection via periodic timer (not event-driven)

### 6.4 Run Detector (`src/monitor/run-detector.ts`)

Detects run boundaries within a single JSONL file. Based on Sprint 0 finding: one JSONL = one session, runs are segments within it.

**Primary signal:** `SessionStart:resume` hook event (Sprint 0 validated this as most reliable)

**Secondary signals (confirmation):**
- Conversation ID change in event metadata
- Gap in JSONL timestamps > 30 seconds followed by startup pattern

**On new run detected:**
- Insert new `runs` record with `start_type` (startup, resume, compact)
- End the previous run (`ended_at`)
- Check `entrypoint` field for handoff detection:
  - Previous run `entrypoint: sdk-cli` + new run `entrypoint: cli` → managed→unmanaged transition
  - Previous run `entrypoint: cli` + new run `entrypoint: sdk-cli` → unmanaged→managed transition

### 6.5 Sub-agent Detector (`src/monitor/subagent-detector.ts`)

Identifies sub-agent JSONL files and links them to parent sessions. Based on Sprint 0 finding: filesystem path is the sole reliable linking mechanism.

**Detection:**
- New JSONL file appears in a subdirectory of an existing session's conversation directory
- Filename patterns (from Sprint 0):
  - Regular sub-agent: `{agentId}.jsonl` in conversation dir
  - Compact: appears during context window compression
  - Side question: tool-dispatched queries

**Linking:**
- Parent session ID = conversation directory UUID
- Read `.meta.json` in same directory for `agent_type` and `description`
- Insert into `sub_agents` table

**Token rollup:**
- Sub-agent tokens are tracked independently
- Parent session's cumulative tokens include sub-agent totals

### 6.6 Monitor Orchestrator (`src/monitor/index.ts`)

Wires all components together. Single entry point.

```typescript
class SessionMonitor extends EventEmitter {
  constructor(config: MonitorConfig)
  start(): void       // Begin watching
  stop(): void        // Stop watching, cleanup
  getStats(): MonitorStats  // Files watched, sessions active/idle/ended
}

interface MonitorConfig {
  watchRoot: string       // Default: ~/.claude/projects/
  dbPath: string          // Default: ./sentinel.db
  idleThresholdMs: number // Default: 60_000
  endedThresholdMs: number // Default: 300_000
  pollIntervalMs: number  // Default: 5_000 (for idle/ended checks)
}
```

**Emitted events:**

| Event | Payload | When |
|-------|---------|------|
| `session:discovered` | `{ session }` | New JSONL file → new session |
| `session:status_changed` | `{ session, from, to }` | State machine transition |
| `session:question_detected` | `{ session, question }` | AskUserQuestion found |
| `session:activity` | `{ session, event }` | Any meaningful JSONL event |
| `run:started` | `{ session, run }` | New run boundary detected |
| `run:ended` | `{ session, run }` | Run completed |
| `subagent:detected` | `{ session, subagent }` | Sub-agent JSONL found |
| `monitor:error` | `{ error, context }` | Internal error (non-fatal) |

---

## 7. Component 4: Issue #3 — SDK V2 `bridge_status` Spike

**Goal:** Determine if sessions created via SDK V2 (`createSession`/`send`) produce `bridge_status` events in JSONL.

**Location:** `sandbox/spike-bridge-status/`

### Tests

| Test | Action | Expected |
|------|--------|----------|
| 1 | Create V2 session, send message, check JSONL for `bridge_status` | Document: present or absent |
| 2 | If Test 1 fails: create V2 session with `--remote-control` flag, check JSONL | Document: present or absent |
| 3 | Create V1 session (`query`), check JSONL for `bridge_status` | Absent (confirms Sprint 0 baseline) |

### Decision matrix (from issue #3)

| V2 without flag? | V2 with flag? | Action |
|---|---|---|
| Yes | — | No changes needed |
| No | Yes | SessionDriver passes `--remote-control` on session creation |
| No | No | Accept `remote_url = NULL` for managed; operator uses `claude --resume` + Claude Remote manually |

### Deliverable

- Update `docs/spikes/sprint0-claude-remote.md` section 3.2 with results
- Comment on issue #3 with decision
- Update `SessionDriver` interface in `src/shared/types.ts` based on finding

---

## 8. Component 5: Debug Dashboard

Minimal SvelteKit app for validating Monitor output during development.

### Scope

**One page** with three sections:

1. **Sessions table** — all sessions from SQLite, columns: status (badge), label/project, type, owner, model, tokens (formatted), runs count, last activity (relative time). Sortable by column.

2. **Recent events** — last 50 events from `session_events`, columns: timestamp (relative), event type, session label, from→to status, actor. Auto-scrolls to newest.

3. **Monitor stats** — files being watched, sessions by status (active/waiting/idle/ended/error), total tokens today.

### Technical approach

- SvelteKit app in `dashboard/` directory
- Server-side: imports `src/db/queries.ts` directly (no API layer)
- Auto-refresh: polls SQLite every 3 seconds (simple `setInterval` + fetch)
- Styling: minimal CSS, functional not pretty. Status badges with color coding.
- No authentication, no WebSocket, no complex state management

### Not in scope for debug dashboard

- Session drill-down/detail view (Sprint 3)
- Actions (kill, resume) (Sprint 2+)
- Event filtering (Sprint 3)
- Responsive design (Sprint 3)

---

## 9. Component 6: Tests

### Test fixtures

Located in `sandbox/fixtures/`. Anonymized copies of real JSONL files covering:

| Fixture | Scenario |
|---------|----------|
| `session-startup.jsonl` | Fresh session from startup to active |
| `session-with-question.jsonl` | Session that hits AskUserQuestion (waiting state) |
| `session-with-resume.jsonl` | Session with resume boundary (multiple runs) |
| `session-with-error.jsonl` | Session that encounters API error |
| `session-with-subagent.jsonl` | Session that spawns sub-agents |
| `session-with-bridge.jsonl` | Session with bridge_status event (Claude Remote URL) |
| `session-idle-ended.jsonl` | Session that goes idle then ends |

### Unit tests (`tests/unit/`)

| File | Tests |
|------|-------|
| `parser.test.ts` | Event type classification, token extraction, field extraction, hook_progress skipping |
| `state-machine.test.ts` | All transitions, invalid transitions rejected, edge cases |
| `run-detector.test.ts` | Run boundary detection, start_type classification, handoff detection |
| `subagent-detector.test.ts` | Filesystem linking, .meta.json parsing, pattern identification |
| `queries.test.ts` | CRUD operations, filters, token updates, upsert idempotency |

### Integration tests (`tests/integration/`)

| File | Tests |
|------|-------|
| `monitor.test.ts` | Full Monitor: watch directory → parse JSONL → state transitions → SQLite records → events emitted |
| `watcher.test.ts` | File watching: new file detection, incremental reads, deleted file handling |

### Test strategy

- Fixtures are static files — tests don't need real Claude Code sessions
- Integration tests use a temporary directory and in-memory SQLite
- No mocks for SQLite (use real `better-sqlite3` in tests)
- Target: all state machine transitions and parser paths covered

---

## 10. Issue Breakdown

Sprint 1 will be tracked as GitHub issues. Suggested order (respects dependencies):

| Order | Issue title | Type | Depends on | Labels |
|-------|------------|------|------------|--------|
| 1 | `chore(infra): scaffold TypeScript project with dependencies` | chore | — | module: infra, sprint: 1 |
| 2 | `feat(db): implement SQLite schema and access layer` | feat | #1 scaffold | module: infra, sprint: 1 |
| 3 | `spike(monitor): verify bridge_status in SDK V2 sessions` | spike | #1 scaffold | module: monitor, sprint: 1 (existing #3) |
| 4 | `feat(monitor): implement JSONL parser and event classification` | feat | #2 db | module: monitor, sprint: 1 |
| 5 | `feat(monitor): implement session status state machine` | feat | #4 parser | module: monitor, sprint: 1 |
| 6 | `feat(monitor): implement run boundary and sub-agent detection` | feat | #4 parser | module: monitor, sprint: 1 |
| 7 | `feat(monitor): implement watcher and Monitor orchestrator` | feat | #5 state machine, #6 detection | module: monitor, sprint: 1 |
| 8 | `feat(dashboard): implement debug dashboard` | feat | #7 monitor | module: dashboard, sprint: 1 |

Total: 8 issues (1 existing + 7 new). Executed sequentially per CLAUDE.md discipline.

---

## 11. Acceptance Criteria (Sprint 1 complete when)

- [ ] Project scaffolds and builds without errors (`npm run build`)
- [ ] All SQLite tables created, access layer passes unit tests
- [ ] Issue #3 resolved and decision documented
- [ ] Monitor discovers sessions from `~/.claude/projects/` JSONL files
- [ ] Monitor correctly infers session status via state machine
- [ ] Monitor detects run boundaries and sub-agents
- [ ] Monitor events are emitted and can be consumed
- [ ] Debug dashboard shows sessions, events, and monitor stats from live data
- [ ] All tests pass (`npm test`)
- [ ] No manual intervention needed — Monitor starts and runs autonomously
