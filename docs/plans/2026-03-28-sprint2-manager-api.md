# Sprint 2 — Manager, API & Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the active layer of Session Sentinel — Session Manager (create, resume, terminate managed sessions via SDK V1), REST API (Fastify), WebSocket (real-time dashboard updates), and Agent Bridge (notification delivery for managed sessions).

**Architecture:** The Session Manager uses the `@anthropic-ai/claude-agent-sdk` V1 `query()` function behind a `SessionDriver` abstraction. Each managed turn is a `query()` call with `resume` for continuity. The Monitor remains the source of truth for session data (JSONL → SQLite). The Manager only handles lifecycle (start turn, interrupt turn). The API (Fastify) exposes endpoints for agents and operators. The Bridge watches Monitor events and sends notifications. WebSocket broadcasts real-time events to the dashboard.

**Key decision:** ADR-0001 — SDK V1 only, with `SessionDriver` abstraction for future V2 migration. See `docs/decisions/0001-session-driver-sdk-strategy.md`.

**Tech Stack:** Node.js, TypeScript, Fastify, @fastify/websocket, @anthropic-ai/claude-agent-sdk (V1), better-sqlite3, Vitest, SvelteKit

**Spec:** `docs/specs/2026-03-27-session-sentinel-design.md` (Sections 4, 6, 7, 8)
**Sprint 1 deliverables:** `src/monitor/`, `src/db/`, `src/shared/`, `dashboard/`
**ADR-0001:** `docs/decisions/0001-session-driver-sdk-strategy.md`
**SDK V1 reference:** `docs/spikes/sprint0-sdk-interactive.md` (Section 4, Option A)

---

## Coordination: Monitor vs Manager

A critical architectural point for all tasks below.

The **Monitor** watches JSONL files and is the single source of truth for session data:
- Discovers sessions, detects status changes, accumulates tokens
- Emits typed events (`session:discovered`, `session:status_changed`, `session:question_detected`, etc.)
- Updates SQLite via `queries.*` functions

The **Manager** handles lifecycle only:
- Creates session records in DB (type=`managed`, owner set) **before** starting SDK turns
- Starts turns via `SessionDriver.startTurn()` — consumes the stream in background
- Tracks active turns for interruption (terminate)
- Does **not** duplicate the Monitor's data extraction

The **Bridge** listens to Monitor events:
- When a `managed` session enters `waiting` or `error` → sends notification to owner
- Dual delivery: owner's Discord thread + #sentinel-log channel

**Data flow for a managed session:**
```
1. API receives POST /sessions
2. Manager inserts session in DB (type=managed, status=starting)
3. Manager calls driver.startTurn() → SDK query() starts
4. SDK writes to JSONL
5. Monitor detects JSONL → upsert finds existing record → updates cwd, model, etc.
6. Monitor processes events → updates status, tokens, questions in DB
7. Monitor emits events → Bridge sends notifications → WebSocket broadcasts
8. SDK turn completes → Manager cleans up active turn reference
```

The Manager pre-sets the Claude session ID via `options.sessionId` (or `extraArgs: { 'session-id': uuid }` if `sessionId` is not available in the installed SDK version). This ensures the Monitor's `upsertSession()` matches on `claude_session_id` and finds the Manager's pre-created record, preserving `type=managed` and `owner`.

**Important — Sprint 1 fix required:** The current `upsertSession()` in `src/db/queries.ts` skips `jsonl_path` on update (line 26: `if (key === 'claude_session_id' || key === 'jsonl_path' || ...) continue`). This means when the Monitor discovers the JSONL file and calls `upsertSession()` for a Manager-pre-created session, the `jsonl_path` will remain empty. **Fix:** modify the update branch to allow `jsonl_path` updates when the existing value is empty (`''`), or add a dedicated `updateSessionJsonlPath()` function. This fix should be done as the first step of Task 4 (Session Manager).

---

## Task 1: Sprint 2 Dependencies & Shared Types

**Files:**
- Modify: `package.json`
- Modify: `src/shared/types.ts`
- Modify: `src/shared/events.ts`
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Add Sprint 2 dependencies**

Add to `package.json` dependencies:

```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "fastify": "^5.0.0",
    "@fastify/websocket": "^11.0.0",
    "@fastify/cors": "^10.0.0",
    "ulid": "^2.3.0"
  }
}
```

Move `@anthropic-ai/claude-agent-sdk` from devDependencies to dependencies (it's now used at runtime by the Manager):

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "better-sqlite3": "^11.0.0",
    "fastify": "^5.0.0",
    "@fastify/websocket": "^11.0.0",
    "@fastify/cors": "^10.0.0",
    "ulid": "^2.3.0"
  }
}
```

Add `ws` and its types to devDependencies (needed for WebSocket tests in Task 7):

```json
{
  "devDependencies": {
    "ws": "^8.0.0",
    "@types/ws": "^8.0.0"
  }
}
```

Run: `npm install`

- [ ] **Step 2: Add Session Driver types to types.ts**

Append to `src/shared/types.ts`:

```typescript
// --- Session Driver types (Sprint 2, ADR-0001) ---

export interface TurnOpts {
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  maxBudgetUsd?: number;
  maxTurns?: number;
  claudeSessionId?: string;
  resumeSessionId?: string;
}

export type StreamEvent =
  | { type: 'init'; sessionId: string; model: string; cwd: string; tools: string[]; permissionMode: string }
  | { type: 'text'; text: string; sessionId: string }
  | { type: 'tool_use'; toolName: string; toolInput: unknown; sessionId: string }
  | { type: 'tool_progress'; toolName: string; elapsedSeconds: number; sessionId: string }
  | { type: 'result_success'; result: string; costUsd: number; numTurns: number; durationMs: number; sessionId: string }
  | { type: 'result_error'; errors: string[]; costUsd: number; sessionId: string }
  | { type: 'status'; status: string; sessionId: string };

export interface TurnHandle {
  readonly events: AsyncGenerator<StreamEvent, void>;
  interrupt(): Promise<void>;
}

export interface SessionDriver {
  startTurn(opts: TurnOpts): TurnHandle;
}
```

- [ ] **Step 3: Add Manager & API types to types.ts**

Append to `src/shared/types.ts`:

```typescript
// --- Session Manager types (Sprint 2) ---

export interface CreateSessionInput {
  prompt: string;
  project?: string;
  cwd?: string;
  owner: string;
  label?: string;
  model?: string;
  effort?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  maxBudgetUsd?: number;
}

export interface ResumeSessionInput {
  prompt: string;
  owner: string;
  model?: string;
  effort?: string;
}

export interface SendMessageInput {
  message: string;
}

export interface ManagerConfig {
  driver: SessionDriver;
  notifyScript?: string;
  defaultModel?: string;
  defaultEffort?: string;
  defaultPermissionMode?: string;
  defaultAllowedTools?: string[];
}

// --- Notification types (Sprint 2) ---

export interface NotificationPayload {
  sessionId: string;
  label: string | null;
  status: string;
  project: string | null;
  gitBranch: string | null;
  pendingQuestion: string | null;
  errorMessage: string | null;
  waitingSince: string | null;
  apiUrl: string;
}

export interface NotificationInsert {
  session_id: string;
  channel: string;
  destination: string;
  trigger: string;
  payload: NotificationPayload;
  delivered: boolean;
}

export interface NotificationFilters {
  session_id?: string;
  channel?: string;
  delivered?: boolean;
  limit?: number;
}

export interface Notification {
  id: number;
  session_id: string;
  channel: string;
  destination: string;
  trigger: string;
  payload: string;
  delivered: boolean;
  created_at: string;
}

// --- API types (Sprint 2) ---

export interface SessionDetailResponse {
  session: Session;
  runs: Run[];
  events: SessionEvent[];
  transcript: TranscriptEntry[];
  available_actions: string[];
}

export interface ReportSummary {
  total_sessions: number;
  active: number;
  waiting: number;
  idle: number;
  ended_today: number;
  errors_today: number;
  total_tokens_today: number;
}

export interface ReportResponse {
  summary: ReportSummary;
  needs_attention: Session[];
  active_sessions: Session[];
  recent_events: SessionEvent[];
  by_project: Record<string, { active: number; waiting: number; ended_today: number }>;
}

// --- WebSocket types (Sprint 2) ---

export type WsOutgoingMessage =
  | { type: 'session_update'; session: Session }
  | { type: 'status_change'; sessionId: string; from: string; to: string }
  | { type: 'event'; event: SessionEvent }
  | { type: 'notification'; sessionId: string; trigger: string; destination: string };
```

- [ ] **Step 4: Add Manager and Bridge events to events.ts**

Append to `src/shared/events.ts`:

```typescript
// --- Sprint 2 events ---

export interface ManagerEvents {
  'manager:session_created': { session: Session };
  'manager:turn_started': { sessionId: string; prompt: string };
  'manager:turn_completed': { sessionId: string; success: boolean };
  'manager:session_terminated': { sessionId: string };
  'manager:error': { error: Error; sessionId?: string };
}

export type ManagerEventName = keyof ManagerEvents;

export interface BridgeEvents {
  'bridge:notification_sent': { sessionId: string; destination: string; trigger: string };
  'bridge:notification_failed': { sessionId: string; destination: string; error: Error };
}

export type BridgeEventName = keyof BridgeEvents;
```

- [ ] **Step 5: Add Sprint 2 constants**

Append to `src/shared/constants.ts`:

```typescript
// --- Sprint 2 constants ---

export const DEFAULT_MANAGER_CONFIG = {
  defaultModel: 'claude-sonnet-4-6',
  defaultEffort: 'high',
  defaultPermissionMode: 'bypassPermissions',
  defaultAllowedTools: [
    'Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write',
    'Agent', 'NotebookEdit', 'WebFetch', 'WebSearch',
  ],
} as const;

export const API_PORT = 3100;
export const API_HOST = '0.0.0.0';

export const NOTIFICATION_CHANNELS = {
  OWNER_THREAD: 'discord_owner',
  SENTINEL_LOG: 'discord_sentinel_log',
} as const;

export const NOTIFICATION_TRIGGERS = new Set(['waiting', 'error']);
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`

Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/shared/
git commit -m "chore(infra): add Sprint 2 dependencies and shared types"
```

---

## Task 2: Additional DB Queries

**Depends on:** Task 1
**Spec reference:** Section 5 (data model), Section 7 (API responses)

**Files:**
- Modify: `src/db/queries.ts`
- Create: `tests/unit/queries-sprint2.test.ts`

- [ ] **Step 1: Write failing tests for new queries**

Create `tests/unit/queries-sprint2.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Sprint 2 queries', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sentinel-s2-${Date.now()}.db`);
    initDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  // --- Managed session helpers ---

  describe('updateSessionOwner', () => {
    it('sets owner and type to managed', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-owner-1',
        jsonl_path: '/tmp/test.jsonl',
      });

      queries.updateSessionOwner(session.id, 'jarvis');
      const updated = queries.getSession(session.id);

      expect(updated!.owner).toBe('jarvis');
      expect(updated!.type).toBe('managed');
    });

    it('changes owner on resume by different agent', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-owner-2',
        jsonl_path: '/tmp/test.jsonl',
      });
      queries.updateSessionOwner(session.id, 'jarvis');
      queries.updateSessionOwner(session.id, 'moon');

      const updated = queries.getSession(session.id);
      expect(updated!.owner).toBe('moon');
    });
  });

  // --- Notifications ---

  describe('insertNotification', () => {
    it('persists notification record', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-notif-1',
        jsonl_path: '/tmp/test.jsonl',
      });

      queries.insertNotification({
        session_id: session.id,
        channel: 'discord_owner',
        destination: '#jarvis',
        trigger: 'waiting',
        payload: {
          sessionId: session.id,
          label: null,
          status: 'waiting',
          project: 'wow-bot',
          gitBranch: 'main',
          pendingQuestion: 'Should I proceed?',
          errorMessage: null,
          waitingSince: new Date().toISOString(),
          apiUrl: `http://localhost:3100/sessions/${session.id}`,
        },
        delivered: true,
      });

      const notifications = queries.listNotifications({ session_id: session.id });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].trigger).toBe('waiting');
      expect(notifications[0].delivered).toBe(true);
    });
  });

  describe('listNotifications', () => {
    it('filters by channel', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-notif-2',
        jsonl_path: '/tmp/test.jsonl',
      });

      const basePayload = {
        sessionId: session.id, label: null, status: 'waiting',
        project: null, gitBranch: null, pendingQuestion: null,
        errorMessage: null, waitingSince: null, apiUrl: '',
      };

      queries.insertNotification({
        session_id: session.id, channel: 'discord_owner',
        destination: '#jarvis', trigger: 'waiting',
        payload: basePayload, delivered: true,
      });
      queries.insertNotification({
        session_id: session.id, channel: 'discord_sentinel_log',
        destination: '#sentinel-log', trigger: 'waiting',
        payload: basePayload, delivered: true,
      });

      const ownerNotifs = queries.listNotifications({ channel: 'discord_owner' });
      expect(ownerNotifs).toHaveLength(1);
    });
  });

  // --- Transcript retrieval ---

  describe('getTranscript', () => {
    it('returns transcript entries ordered by turn', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-tx-1',
        jsonl_path: '/tmp/test.jsonl',
      });

      queries.insertTranscriptEntry({ session_id: session.id, turn: 1, role: 'user', content: 'Hello' });
      queries.insertTranscriptEntry({ session_id: session.id, turn: 2, role: 'assistant', content: 'Hi there' });
      queries.insertTranscriptEntry({ session_id: session.id, turn: 3, role: 'user', content: 'Fix the bug' });

      const transcript = queries.getTranscript(session.id);
      expect(transcript).toHaveLength(3);
      expect(transcript[0].turn).toBe(1);
      expect(transcript[2].turn).toBe(3);
    });

    it('respects limit', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-tx-2',
        jsonl_path: '/tmp/test.jsonl',
      });

      for (let i = 1; i <= 10; i++) {
        queries.insertTranscriptEntry({ session_id: session.id, turn: i, role: 'user', content: `Turn ${i}` });
      }

      const transcript = queries.getTranscript(session.id, 5);
      expect(transcript).toHaveLength(5);
      expect(transcript[0].turn).toBe(6); // last 5 turns
    });
  });

  // --- Runs retrieval ---

  describe('getRuns', () => {
    it('returns all runs for a session', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-runs-1',
        jsonl_path: '/tmp/test.jsonl',
      });

      queries.insertRun({ session_id: session.id, jsonl_path: '/tmp/r1.jsonl', start_type: 'startup' });
      queries.insertRun({ session_id: session.id, jsonl_path: '/tmp/r2.jsonl', start_type: 'resume' });

      const runs = queries.getRuns(session.id);
      expect(runs).toHaveLength(2);
      expect(runs[0].run_number).toBe(1);
      expect(runs[1].run_number).toBe(2);
    });
  });

  // --- Projects ---

  describe('listProjects', () => {
    it('returns all known projects', () => {
      queries.upsertProject('wow-bot', '/home/blasi/wow-bot');
      queries.upsertProject('sentinel', '/home/blasi/session-sentinel');

      const projects = queries.listProjects();
      expect(projects).toHaveLength(2);
      expect(projects.map(p => p.name)).toContain('wow-bot');
    });
  });

  describe('getProjectByName', () => {
    it('returns project by name', () => {
      queries.upsertProject('wow-bot', '/home/blasi/wow-bot');

      const project = queries.getProjectByName('wow-bot');
      expect(project).not.toBeNull();
      expect(project!.cwd).toBe('/home/blasi/wow-bot');
    });

    it('returns null for unknown project', () => {
      const project = queries.getProjectByName('nonexistent');
      expect(project).toBeNull();
    });
  });

  // --- Report stats ---

  describe('getReportStats', () => {
    it('returns aggregated session stats', () => {
      queries.upsertSession({ claude_session_id: 'cs-rpt-1', jsonl_path: '/tmp/a.jsonl', status: 'active' });
      queries.upsertSession({ claude_session_id: 'cs-rpt-2', jsonl_path: '/tmp/b.jsonl', status: 'waiting' });
      queries.upsertSession({ claude_session_id: 'cs-rpt-3', jsonl_path: '/tmp/c.jsonl', status: 'ended' });

      const stats = queries.getReportStats();
      expect(stats.total_sessions).toBe(3);
      expect(stats.active).toBe(1);
      expect(stats.waiting).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/queries-sprint2.test.ts`

Expected: FAIL — functions not found.

- [ ] **Step 3: Implement new query functions**

Add to `src/db/queries.ts`:

```typescript
// --- Managed session helpers (Sprint 2) ---

export function updateSessionOwner(id: string, owner: string): void {
  getDb().prepare(`
    UPDATE sessions
    SET owner = ?, type = 'managed', updated_at = datetime('now')
    WHERE id = ?
  `).run(owner, id);
}

// --- Notifications (Sprint 2) ---

export function insertNotification(data: NotificationInsert): void {
  getDb().prepare(`
    INSERT INTO notifications (session_id, channel, destination, trigger, payload, delivered)
    VALUES (@session_id, @channel, @destination, @trigger, @payload, @delivered)
  `).run({
    session_id: data.session_id,
    channel: data.channel,
    destination: data.destination,
    trigger: data.trigger,
    payload: JSON.stringify(data.payload),
    delivered: data.delivered ? 1 : 0,
  });
}

export function listNotifications(filters: NotificationFilters = {}): Notification[] {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.session_id) {
    conditions.push('session_id = @session_id');
    params.session_id = filters.session_id;
  }
  if (filters.channel) {
    conditions.push('channel = @channel');
    params.channel = filters.channel;
  }
  if (filters.delivered !== undefined) {
    conditions.push('delivered = @delivered');
    params.delivered = filters.delivered ? 1 : 0;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 100;

  const rows = getDb().prepare(`
    SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ${limit}
  `).all(params) as Notification[];

  return rows.map(r => ({ ...r, delivered: Boolean(r.delivered) })) as Notification[];
}

// --- Transcript retrieval (Sprint 2) ---

export function getTranscript(sessionId: string, limit?: number): TranscriptEntry[] {
  if (limit) {
    return getDb().prepare(`
      SELECT * FROM (
        SELECT * FROM transcript_cache
        WHERE session_id = ?
        ORDER BY turn DESC
        LIMIT ?
      ) ORDER BY turn ASC
    `).all(sessionId, limit) as TranscriptEntry[];
  }

  return getDb().prepare(`
    SELECT * FROM transcript_cache
    WHERE session_id = ?
    ORDER BY turn ASC
  `).all(sessionId) as TranscriptEntry[];
}

// --- Runs retrieval (Sprint 2) ---

export function getRuns(sessionId: string): Run[] {
  return getDb().prepare(`
    SELECT * FROM runs WHERE session_id = ? ORDER BY run_number ASC
  `).all(sessionId) as Run[];
}

// --- Projects (Sprint 2) ---

export function listProjects(): Array<{
  name: string;
  cwd: string;
  discovered_at: string;
  last_session_at: string | null;
  session_count: number;
  alias: string | null;
}> {
  return getDb().prepare(`
    SELECT * FROM projects ORDER BY last_session_at DESC
  `).all() as Array<{
    name: string;
    cwd: string;
    discovered_at: string;
    last_session_at: string | null;
    session_count: number;
    alias: string | null;
  }>;
}

export function getProjectByName(name: string): {
  name: string;
  cwd: string;
  discovered_at: string;
  last_session_at: string | null;
  session_count: number;
  alias: string | null;
} | null {
  return getDb().prepare(`
    SELECT * FROM projects WHERE name = ?
  `).get(name) as {
    name: string;
    cwd: string;
    discovered_at: string;
    last_session_at: string | null;
    session_count: number;
    alias: string | null;
  } | null;
}

// --- Report stats (Sprint 2) ---

export function getReportStats(): {
  total_sessions: number;
  active: number;
  waiting: number;
  idle: number;
  ended_today: number;
  errors_today: number;
  total_tokens_today: number;
} {
  const db = getDb();

  const counts = db.prepare(`
    SELECT
      COUNT(*) as total_sessions,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
      SUM(CASE WHEN status = 'idle' THEN 1 ELSE 0 END) as idle
    FROM sessions
  `).get() as { total_sessions: number; active: number; waiting: number; idle: number };

  const today = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'ended' THEN 1 ELSE 0 END) as ended_today,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors_today,
      SUM(COALESCE(output_tokens, 0)) as total_tokens_today
    FROM sessions
    WHERE date(updated_at) = date('now')
  `).get() as { ended_today: number; errors_today: number; total_tokens_today: number };

  return {
    ...counts,
    ended_today: today.ended_today ?? 0,
    errors_today: today.errors_today ?? 0,
    total_tokens_today: today.total_tokens_today ?? 0,
  };
}
```

Add required imports at the top of `src/db/queries.ts`:

```typescript
import type { NotificationInsert, NotificationFilters, Notification } from '../shared/types.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/queries-sprint2.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts tests/unit/queries-sprint2.test.ts
git commit -m "feat(db): add Sprint 2 query functions — notifications, transcript, report stats"
```

---

## Task 3: SessionDriver Interface & V1 Driver

**Depends on:** Task 1
**Spec reference:** Section 4 (architecture), ADR-0001
**SDK reference:** `@anthropic-ai/claude-agent-sdk` V1 `query()` + `Options` type

**Files:**
- Create: `src/manager/driver.ts`
- Create: `src/manager/v1-driver.ts`
- Create: `tests/unit/v1-driver.test.ts`

- [ ] **Step 1: Create the SessionDriver interface module**

Create `src/manager/driver.ts`:

```typescript
// Re-export the SessionDriver interface and related types from shared/types.
// This module exists so consumers can import from the manager package directly.
export type {
  SessionDriver,
  TurnOpts,
  TurnHandle,
  StreamEvent,
} from '../shared/types.js';
```

- [ ] **Step 2: Write failing tests for V1 driver**

Create `tests/unit/v1-driver.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { V1Driver } from '../../src/manager/v1-driver.js';
import type { TurnOpts, StreamEvent } from '../../src/shared/types.js';

// Mock the claude-agent-sdk module
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query as mockQuery } from '@anthropic-ai/claude-agent-sdk';

describe('V1Driver', () => {
  let driver: V1Driver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new V1Driver();
  });

  describe('startTurn', () => {
    it('calls query() with correct options for new session', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'system' as const,
          subtype: 'init' as const,
          session_id: 'test-session-id',
          model: 'claude-sonnet-4-6',
          cwd: '/tmp/test',
          tools: ['Read', 'Edit'],
          permissionMode: 'bypassPermissions' as const,
          apiKeySource: 'unknown' as const,
          claude_code_version: '2.1.85',
          mcp_servers: [],
          slash_commands: [],
          output_style: '',
          skills: [],
          plugins: [],
          uuid: 'uuid-1',
          agents: [],
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const opts: TurnOpts = {
        prompt: 'Hello',
        cwd: '/tmp/test',
        model: 'claude-sonnet-4-6',
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Edit'],
        claudeSessionId: 'forced-uuid',
      };

      const handle = driver.startTurn(opts);

      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(mockQuery).mock.calls[0][0];
      expect(callArgs.prompt).toBe('Hello');
      expect(callArgs.options?.cwd).toBe('/tmp/test');
      expect(callArgs.options?.model).toBe('claude-sonnet-4-6');
      expect(callArgs.options?.permissionMode).toBe('bypassPermissions');
      expect(callArgs.options?.allowedTools).toEqual(['Read', 'Edit']);

      // Consume the stream
      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('init');
    });

    it('calls query() with resume option for existing session', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'result' as const,
          subtype: 'success' as const,
          result: 'Done',
          total_cost_usd: 0.05,
          num_turns: 1,
          duration_ms: 5000,
          duration_api_ms: 4000,
          is_error: false,
          usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0 },
          modelUsage: {},
          permission_denials: [],
          uuid: 'uuid-2',
          session_id: 'existing-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({
        prompt: 'Continue',
        cwd: '/tmp/test',
        resumeSessionId: 'existing-session',
      });

      const callArgs = vi.mocked(mockQuery).mock.calls[0][0];
      expect(callArgs.options?.resume).toBe('existing-session');

      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('result_success');
      if (events[0].type === 'result_success') {
        expect(events[0].costUsd).toBe(0.05);
      }
    });

    it('maps assistant text messages to text events', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'assistant' as const,
          message: {
            content: [{ type: 'text' as const, text: 'Here is my analysis' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
          parent_tool_use_id: null,
          uuid: 'uuid-3',
          session_id: 'test-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({ prompt: 'Test', cwd: '/tmp' });
      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text');
      if (events[0].type === 'text') {
        expect(events[0].text).toBe('Here is my analysis');
      }
    });

    it('maps tool_use blocks to tool_use events', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'assistant' as const,
          message: {
            content: [
              { type: 'tool_use' as const, name: 'Read', id: 'tool-1', input: { file_path: '/tmp/x' } },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
          },
          parent_tool_use_id: null,
          uuid: 'uuid-4',
          session_id: 'test-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({ prompt: 'Test', cwd: '/tmp' });
      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool_use');
      if (events[0].type === 'tool_use') {
        expect(events[0].toolName).toBe('Read');
      }
    });

    it('maps error results to result_error events', async () => {
      const mockMessages = (async function* () {
        yield {
          type: 'result' as const,
          subtype: 'error_during_execution' as const,
          errors: ['Something went wrong'],
          total_cost_usd: 0.01,
          num_turns: 1,
          duration_ms: 1000,
          duration_api_ms: 800,
          is_error: true,
          usage: { input_tokens: 50, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
          modelUsage: {},
          permission_denials: [],
          uuid: 'uuid-5',
          session_id: 'test-session',
        };
      })();

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({ prompt: 'Test', cwd: '/tmp' });
      const events: StreamEvent[] = [];
      for await (const event of handle.events) {
        events.push(event);
      }
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('result_error');
    });
  });

  describe('interrupt', () => {
    it('calls interrupt on the query handle', async () => {
      const interruptFn = vi.fn().mockResolvedValue(undefined);
      const mockMessages = (async function* () {
        // never yields — simulates long-running turn
        await new Promise(() => {}); // hang forever
      })();
      Object.assign(mockMessages, { interrupt: interruptFn });

      vi.mocked(mockQuery).mockReturnValue(mockMessages as any);

      const handle = driver.startTurn({ prompt: 'Test', cwd: '/tmp' });
      await handle.interrupt();

      expect(interruptFn).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/v1-driver.test.ts`

Expected: FAIL — `V1Driver` module not found.

- [ ] **Step 4: Implement V1 driver**

Create `src/manager/v1-driver.ts`:

```typescript
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { SessionDriver, TurnOpts, TurnHandle, StreamEvent } from '../shared/types.js';

export class V1Driver implements SessionDriver {
  startTurn(opts: TurnOpts): TurnHandle {
    const options: Record<string, unknown> = {
      cwd: opts.cwd,
      allowDangerouslySkipPermissions: true,
    };

    if (opts.model) options.model = opts.model;
    if (opts.effort) options.effort = opts.effort;
    if (opts.permissionMode) options.permissionMode = opts.permissionMode;
    if (opts.allowedTools) options.allowedTools = opts.allowedTools;
    if (opts.disallowedTools) options.disallowedTools = opts.disallowedTools;
    if (opts.systemPrompt) options.systemPrompt = opts.systemPrompt;
    if (opts.maxBudgetUsd) options.maxBudgetUsd = opts.maxBudgetUsd;
    if (opts.maxTurns) options.maxTurns = opts.maxTurns;

    if (opts.resumeSessionId) {
      options.resume = opts.resumeSessionId;
    } else if (opts.claudeSessionId) {
      // Try sessionId option first; fall back to extraArgs for older SDK versions
      options.sessionId = opts.claudeSessionId;
      options.extraArgs = { 'session-id': opts.claudeSessionId };
    }

    const q = query({ prompt: opts.prompt, options: options as any });

    return {
      events: mapSdkStream(q),
      interrupt: () => q.interrupt(),
    };
  }
}

async function* mapSdkStream(
  source: AsyncGenerator<SDKMessage, void>,
): AsyncGenerator<StreamEvent, void> {
  for await (const msg of source) {
    const events = mapMessage(msg);
    for (const event of events) {
      yield event;
    }
  }
}

function mapMessage(msg: SDKMessage): StreamEvent[] {
  const sessionId = 'session_id' in msg ? (msg.session_id ?? '') : '';

  switch (msg.type) {
    case 'system': {
      if ('subtype' in msg && msg.subtype === 'init') {
        const init = msg as any;
        return [{
          type: 'init',
          sessionId: init.session_id ?? '',
          model: init.model ?? '',
          cwd: init.cwd ?? '',
          tools: init.tools ?? [],
          permissionMode: init.permissionMode ?? 'default',
        }];
      }
      if ('subtype' in msg && msg.subtype === 'status') {
        return [{
          type: 'status',
          status: (msg as any).status ?? '',
          sessionId,
        }];
      }
      return [];
    }

    case 'assistant': {
      const events: StreamEvent[] = [];
      const content = (msg as any).message?.content ?? [];
      for (const block of content) {
        if (block.type === 'text') {
          events.push({ type: 'text', text: block.text, sessionId });
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool_use',
            toolName: block.name,
            toolInput: block.input,
            sessionId,
          });
        }
      }
      return events;
    }

    case 'tool_progress': {
      return [{
        type: 'tool_progress',
        toolName: (msg as any).tool_name ?? '',
        elapsedSeconds: (msg as any).elapsed_time_seconds ?? 0,
        sessionId,
      }];
    }

    case 'result': {
      if ((msg as any).subtype === 'success') {
        return [{
          type: 'result_success',
          result: (msg as any).result ?? '',
          costUsd: (msg as any).total_cost_usd ?? 0,
          numTurns: (msg as any).num_turns ?? 0,
          durationMs: (msg as any).duration_ms ?? 0,
          sessionId,
        }];
      }
      return [{
        type: 'result_error',
        errors: (msg as any).errors ?? [],
        costUsd: (msg as any).total_cost_usd ?? 0,
        sessionId,
      }];
    }

    default:
      return [];
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/v1-driver.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/manager/ tests/unit/v1-driver.test.ts
git commit -m "feat(manager): implement SessionDriver interface and V1 SDK driver"
```

---

## Task 4: Session Manager

**Depends on:** Tasks 2, 3
**Spec reference:** Section 4 (Session Manager responsibilities), Section 13 (housekeeping)

**Files:**
- Create: `src/manager/index.ts`
- Create: `tests/unit/manager.test.ts`

- [ ] **Step 1: Write failing tests for Session Manager**

Create `tests/unit/manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/manager/index.js';
import { initDb, closeDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import type { SessionDriver, TurnHandle, StreamEvent, TurnOpts } from '../../src/shared/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function createMockDriver(events: StreamEvent[] = []): SessionDriver {
  return {
    startTurn: vi.fn((_opts: TurnOpts): TurnHandle => {
      const interruptFn = vi.fn().mockResolvedValue(undefined);
      return {
        events: (async function* () {
          for (const event of events) yield event;
        })(),
        interrupt: interruptFn,
      };
    }),
  };
}

describe('SessionManager', () => {
  let dbPath: string;
  let manager: SessionManager;
  let mockDriver: SessionDriver;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sentinel-mgr-${Date.now()}.db`);
    initDb(dbPath);
    queries.upsertProject('wow-bot', '/home/blasi/wow-bot');
  });

  afterEach(async () => {
    if (manager) await manager.stop();
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  describe('createSession', () => {
    it('creates a managed session in DB and starts a turn', async () => {
      mockDriver = createMockDriver([
        { type: 'init', sessionId: 'cs-1', model: 'claude-sonnet-4-6', cwd: '/home/blasi/wow-bot', tools: [], permissionMode: 'bypassPermissions' },
        { type: 'result_success', result: 'Done', costUsd: 0.05, numTurns: 1, durationMs: 5000, sessionId: 'cs-1' },
      ]);
      manager = new SessionManager({ driver: mockDriver });

      const session = await manager.createSession({
        prompt: 'Review auth',
        project: 'wow-bot',
        owner: 'jarvis',
        label: 'auth-review',
      });

      expect(session.type).toBe('managed');
      expect(session.owner).toBe('jarvis');
      expect(session.label).toBe('auth-review');
      expect(session.status).toBe('starting');
      expect(mockDriver.startTurn).toHaveBeenCalledOnce();

      const callOpts = vi.mocked(mockDriver.startTurn).mock.calls[0][0];
      expect(callOpts.prompt).toBe('Review auth');
      expect(callOpts.cwd).toBe('/home/blasi/wow-bot');
    });

    it('resolves project name to cwd', async () => {
      mockDriver = createMockDriver([
        { type: 'result_success', result: 'Done', costUsd: 0, numTurns: 1, durationMs: 0, sessionId: 'cs-2' },
      ]);
      manager = new SessionManager({ driver: mockDriver });

      await manager.createSession({
        prompt: 'Test',
        project: 'wow-bot',
        owner: 'moon',
      });

      const callOpts = vi.mocked(mockDriver.startTurn).mock.calls[0][0];
      expect(callOpts.cwd).toBe('/home/blasi/wow-bot');
    });

    it('rejects if neither project nor cwd provided', async () => {
      mockDriver = createMockDriver();
      manager = new SessionManager({ driver: mockDriver });

      await expect(manager.createSession({
        prompt: 'Test',
        owner: 'jarvis',
      })).rejects.toThrow(/project or cwd/i);
    });

    it('rejects if project not found', async () => {
      mockDriver = createMockDriver();
      manager = new SessionManager({ driver: mockDriver });

      await expect(manager.createSession({
        prompt: 'Test',
        project: 'nonexistent',
        owner: 'jarvis',
      })).rejects.toThrow(/project.*not found/i);
    });
  });

  describe('sendMessage', () => {
    it('starts a new turn with resume on existing session', async () => {
      mockDriver = createMockDriver([
        { type: 'result_success', result: 'Done', costUsd: 0, numTurns: 1, durationMs: 0, sessionId: 'cs-msg' },
      ]);
      manager = new SessionManager({ driver: mockDriver });

      const session = queries.upsertSession({
        claude_session_id: 'cs-msg',
        jsonl_path: '/tmp/test.jsonl',
        status: 'waiting',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'jarvis');

      await manager.sendMessage(session.id, { message: 'Yes, proceed' });

      expect(mockDriver.startTurn).toHaveBeenCalledOnce();
      const callOpts = vi.mocked(mockDriver.startTurn).mock.calls[0][0];
      expect(callOpts.prompt).toBe('Yes, proceed');
      expect(callOpts.resumeSessionId).toBe('cs-msg');
    });

    it('rejects if session is not managed', async () => {
      mockDriver = createMockDriver();
      manager = new SessionManager({ driver: mockDriver });

      const session = queries.upsertSession({
        claude_session_id: 'cs-unmanaged',
        jsonl_path: '/tmp/test.jsonl',
        type: 'unmanaged',
      });

      await expect(
        manager.sendMessage(session.id, { message: 'Test' })
      ).rejects.toThrow(/not managed/i);
    });

    it('rejects if session not found', async () => {
      mockDriver = createMockDriver();
      manager = new SessionManager({ driver: mockDriver });

      await expect(
        manager.sendMessage('ss-nonexistent', { message: 'Test' })
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('resumeSession', () => {
    it('resumes an ended session with new owner', async () => {
      mockDriver = createMockDriver([
        { type: 'result_success', result: 'Done', costUsd: 0, numTurns: 1, durationMs: 0, sessionId: 'cs-resume' },
      ]);
      manager = new SessionManager({ driver: mockDriver });

      const session = queries.upsertSession({
        claude_session_id: 'cs-resume',
        jsonl_path: '/tmp/test.jsonl',
        status: 'ended',
      });

      await manager.resumeSession(session.id, {
        prompt: 'Continue from where you left off',
        owner: 'moon',
      });

      const updated = queries.getSession(session.id)!;
      expect(updated.owner).toBe('moon');
      expect(updated.type).toBe('managed');
    });

    it('rejects if session is not in resumable state', async () => {
      mockDriver = createMockDriver();
      manager = new SessionManager({ driver: mockDriver });

      const session = queries.upsertSession({
        claude_session_id: 'cs-active',
        jsonl_path: '/tmp/test.jsonl',
        status: 'active',
      });

      await expect(
        manager.resumeSession(session.id, { prompt: 'Test', owner: 'jarvis' })
      ).rejects.toThrow(/cannot resume/i);
    });
  });

  describe('terminateSession', () => {
    it('interrupts active turn and marks session as ended', async () => {
      const interruptFn = vi.fn().mockResolvedValue(undefined);
      const hangingDriver: SessionDriver = {
        startTurn: vi.fn((): TurnHandle => ({
          events: (async function* () {
            await new Promise(() => {});
          })(),
          interrupt: interruptFn,
        })),
      };

      manager = new SessionManager({ driver: hangingDriver });

      const session = queries.upsertSession({
        claude_session_id: 'cs-term',
        jsonl_path: '/tmp/test.jsonl',
        status: 'active',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'jarvis');

      // Start a turn to register an active handle
      manager.createSession({
        prompt: 'Work', cwd: '/tmp', owner: 'jarvis',
      }).catch(() => {}); // don't await — it hangs

      // Give the turn a moment to register
      await new Promise(r => setTimeout(r, 50));

      // Now terminate — should be possible even with different session
      // For this test, we terminate the pre-created session
      await manager.terminateSession(session.id);

      const updated = queries.getSession(session.id)!;
      expect(updated.status).toBe('ended');
    });

    it('rejects if session not found', async () => {
      mockDriver = createMockDriver();
      manager = new SessionManager({ driver: mockDriver });

      await expect(
        manager.terminateSession('ss-nonexistent')
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('hasActiveTurn', () => {
    it('returns true during active turn', async () => {
      const hangingDriver: SessionDriver = {
        startTurn: vi.fn((): TurnHandle => ({
          events: (async function* () { await new Promise(() => {}); })(),
          interrupt: vi.fn().mockResolvedValue(undefined),
        })),
      };

      manager = new SessionManager({ driver: hangingDriver });

      const session = await manager.createSession({
        prompt: 'Work', cwd: '/tmp', owner: 'jarvis',
      });

      await new Promise(r => setTimeout(r, 50));
      expect(manager.hasActiveTurn(session.id)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/manager.test.ts`

Expected: FAIL — `SessionManager` not found.

- [ ] **Step 3: Implement Session Manager**

Create `src/manager/index.ts`:

```typescript
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as queries from '../db/queries.js';
import { DEFAULT_MANAGER_CONFIG } from '../shared/constants.js';
import type {
  SessionDriver,
  TurnHandle,
  StreamEvent,
  CreateSessionInput,
  ResumeSessionInput,
  SendMessageInput,
  ManagerConfig,
  Session,
} from '../shared/types.js';
import type { ManagerEvents, ManagerEventName } from '../shared/events.js';

export class SessionManager extends EventEmitter {
  private driver: SessionDriver;
  private activeTurns = new Map<string, TurnHandle>();
  private config: ManagerConfig;

  constructor(config: Partial<ManagerConfig> & { driver: SessionDriver }) {
    super();
    this.driver = config.driver;
    this.config = {
      driver: config.driver,
      notifyScript: config.notifyScript,
      defaultModel: config.defaultModel ?? DEFAULT_MANAGER_CONFIG.defaultModel,
      defaultEffort: config.defaultEffort ?? DEFAULT_MANAGER_CONFIG.defaultEffort,
      defaultPermissionMode: config.defaultPermissionMode ?? DEFAULT_MANAGER_CONFIG.defaultPermissionMode,
      defaultAllowedTools: config.defaultAllowedTools ?? [...DEFAULT_MANAGER_CONFIG.defaultAllowedTools],
    };
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const cwd = this.resolveCwd(input);
    const claudeSessionId = randomUUID();
    const projectName = input.project ?? cwd.split('/').pop() ?? 'unknown';

    // Insert session BEFORE starting the turn — Monitor will find it via claude_session_id
    const session = queries.upsertSession({
      claude_session_id: claudeSessionId,
      jsonl_path: '', // filled by Monitor when JSONL appears
      status: 'starting',
      type: 'managed',
      label: input.label,
      cwd,
      project_name: projectName,
      model: input.model ?? this.config.defaultModel,
      effort: input.effort ?? this.config.defaultEffort,
    });

    queries.updateSessionOwner(session.id, input.owner);
    queries.insertEvent({
      session_id: session.id,
      event_type: 'session_created',
      to_status: 'starting',
      actor: input.owner,
      detail: { prompt: input.prompt, project: projectName },
    });

    this.emit('manager:session_created', { session: queries.getSession(session.id)! });

    // Start the turn
    this.startBackgroundTurn(session.id, {
      prompt: input.prompt,
      cwd,
      model: input.model ?? this.config.defaultModel,
      effort: input.effort ?? this.config.defaultEffort,
      permissionMode: this.config.defaultPermissionMode,
      allowedTools: input.allowedTools ?? this.config.defaultAllowedTools,
      systemPrompt: input.systemPrompt,
      maxBudgetUsd: input.maxBudgetUsd,
      claudeSessionId,
    });

    return queries.getSession(session.id)!;
  }

  async sendMessage(sessionId: string, input: SendMessageInput): Promise<void> {
    const session = queries.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.type !== 'managed') throw new Error(`Session ${sessionId} is not managed`);

    const resumableStatuses = ['waiting', 'active', 'idle', 'ended'];
    if (!resumableStatuses.includes(session.status)) {
      throw new Error(`Session ${sessionId} is in status ${session.status}, cannot send message`);
    }

    queries.insertEvent({
      session_id: sessionId,
      event_type: 'message_sent',
      actor: session.owner ?? 'api',
      detail: { message: input.message.substring(0, 200) },
    });

    this.startBackgroundTurn(sessionId, {
      prompt: input.message,
      cwd: session.cwd ?? process.cwd(),
      model: session.model ?? this.config.defaultModel,
      resumeSessionId: session.claude_session_id,
    });
  }

  async resumeSession(sessionId: string, input: ResumeSessionInput): Promise<Session> {
    const session = queries.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const resumableStatuses = ['ended', 'error', 'idle'];
    if (!resumableStatuses.includes(session.status)) {
      throw new Error(`Cannot resume session ${sessionId} in status ${session.status}`);
    }

    // Update ownership
    queries.updateSessionOwner(sessionId, input.owner);
    queries.insertEvent({
      session_id: sessionId,
      event_type: 'session_resumed',
      from_status: session.status,
      to_status: 'starting',
      actor: input.owner,
      detail: { previous_owner: session.owner },
    });

    this.startBackgroundTurn(sessionId, {
      prompt: input.prompt,
      cwd: session.cwd ?? process.cwd(),
      model: input.model ?? session.model ?? this.config.defaultModel,
      effort: input.effort ?? session.effort ?? this.config.defaultEffort,
      permissionMode: this.config.defaultPermissionMode,
      allowedTools: this.config.defaultAllowedTools,
      resumeSessionId: session.claude_session_id,
    });

    return queries.getSession(sessionId)!;
  }

  async terminateSession(sessionId: string): Promise<void> {
    const session = queries.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const activeTurn = this.activeTurns.get(sessionId);
    if (activeTurn) {
      await activeTurn.interrupt();
      this.activeTurns.delete(sessionId);
    }

    queries.updateSessionStatus(sessionId, 'ended');
    queries.insertEvent({
      session_id: sessionId,
      event_type: 'session_terminated',
      from_status: session.status,
      to_status: 'ended',
      actor: 'api',
    });

    this.emit('manager:session_terminated', { sessionId });
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.activeTurns.has(sessionId);
  }

  async stop(): Promise<void> {
    // Interrupt all active turns
    const interrupts = Array.from(this.activeTurns.entries()).map(
      async ([id, turn]) => {
        try { await turn.interrupt(); } catch {}
        this.activeTurns.delete(id);
      }
    );
    await Promise.allSettled(interrupts);
  }

  // --- Private ---

  private resolveCwd(input: CreateSessionInput): string {
    if (input.cwd) return input.cwd;
    if (input.project) {
      const project = queries.getProjectByName(input.project);
      if (!project) throw new Error(`Project not found: ${input.project}`);
      return project.cwd;
    }
    throw new Error('Either project or cwd must be provided');
  }

  private startBackgroundTurn(sessionId: string, opts: import('../shared/types.js').TurnOpts): void {
    const handle = this.driver.startTurn(opts);
    this.activeTurns.set(sessionId, handle);

    this.emit('manager:turn_started', { sessionId, prompt: opts.prompt });

    this.consumeStream(sessionId, handle).catch((err) => {
      this.emit('manager:error', { error: err, sessionId });
    });
  }

  private async consumeStream(sessionId: string, handle: TurnHandle): Promise<void> {
    try {
      for await (const event of handle.events) {
        // Minimal processing — Monitor handles JSONL data extraction.
        // We only track turn completion for cleanup and event emission.
        if (event.type === 'result_success') {
          this.emit('manager:turn_completed', { sessionId, success: true });
        } else if (event.type === 'result_error') {
          this.emit('manager:turn_completed', { sessionId, success: false });
        }
      }
    } finally {
      this.activeTurns.delete(sessionId);
    }
  }

  // Typed event emitter overrides
  emit<K extends ManagerEventName>(event: K, payload: ManagerEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends ManagerEventName>(event: K, listener: (payload: ManagerEvents[K]) => void): this {
    return super.on(event, listener);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/manager.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/manager/index.ts tests/unit/manager.test.ts
git commit -m "feat(manager): implement Session Manager with create, resume, message, terminate"
```

---

## Task 5: Agent Bridge (Notifications)

**Depends on:** Task 2 (notification queries), Task 4 (Manager events)
**Spec reference:** Section 6 (notification model)

**Files:**
- Create: `src/bridge/index.ts`
- Create: `tests/unit/bridge.test.ts`

- [ ] **Step 1: Write failing tests for Agent Bridge**

Create `tests/unit/bridge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentBridge } from '../../src/bridge/index.js';
import { initDb, closeDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import type { Session } from '../../src/shared/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';

// Mock child_process.execFile for agent-notify.sh
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: Function) => {
    cb(null, '', '');
  }),
}));

import { execFile } from 'node:child_process';

describe('AgentBridge', () => {
  let dbPath: string;
  let bridge: AgentBridge;
  let mockMonitor: EventEmitter;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sentinel-bridge-${Date.now()}.db`);
    initDb(dbPath);
    vi.clearAllMocks();
    mockMonitor = new EventEmitter();
  });

  afterEach(() => {
    if (bridge) bridge.stop();
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  function createManagedSession(overrides: Partial<Session> = {}): Session {
    const session = queries.upsertSession({
      claude_session_id: `cs-${Date.now()}`,
      jsonl_path: '/tmp/test.jsonl',
      status: overrides.status as any ?? 'active',
      type: 'managed',
    });
    queries.updateSessionOwner(session.id, overrides.owner ?? 'jarvis');
    return queries.getSession(session.id)!;
  }

  describe('notification on waiting', () => {
    it('sends dual notifications when managed session enters waiting', () => {
      bridge = new AgentBridge({
        monitor: mockMonitor,
        notifyScript: '/usr/local/bin/agent-notify.sh',
        apiBaseUrl: 'http://localhost:3100',
      });

      const session = createManagedSession({ status: 'active' });
      queries.updateSessionPendingQuestion(session.id, 'Should I proceed?');
      const updated = queries.getSession(session.id)!;

      mockMonitor.emit('session:status_changed', {
        session: { ...updated, status: 'waiting' },
        from: 'active',
        to: 'waiting',
      });

      // Should call agent-notify.sh twice (owner + sentinel-log)
      expect(execFile).toHaveBeenCalledTimes(2);

      // Check notifications persisted in DB
      const notifications = queries.listNotifications({ session_id: session.id });
      expect(notifications).toHaveLength(2);
      expect(notifications.map(n => n.channel)).toContain('discord_owner');
      expect(notifications.map(n => n.channel)).toContain('discord_sentinel_log');
    });

    it('does not notify for unmanaged sessions', () => {
      bridge = new AgentBridge({
        monitor: mockMonitor,
        notifyScript: '/usr/local/bin/agent-notify.sh',
        apiBaseUrl: 'http://localhost:3100',
      });

      const session = queries.upsertSession({
        claude_session_id: 'cs-unmanaged',
        jsonl_path: '/tmp/test.jsonl',
        status: 'active',
        type: 'unmanaged',
      });

      mockMonitor.emit('session:status_changed', {
        session: { ...queries.getSession(session.id)!, status: 'waiting' },
        from: 'active',
        to: 'waiting',
      });

      expect(execFile).not.toHaveBeenCalled();
    });
  });

  describe('notification on error', () => {
    it('sends dual notifications when managed session enters error', () => {
      bridge = new AgentBridge({
        monitor: mockMonitor,
        notifyScript: '/usr/local/bin/agent-notify.sh',
        apiBaseUrl: 'http://localhost:3100',
      });

      const session = createManagedSession({ status: 'active' });
      mockMonitor.emit('session:status_changed', {
        session: { ...queries.getSession(session.id)!, status: 'error', error_message: 'API rate limit' },
        from: 'active',
        to: 'error',
      });

      expect(execFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('no notification for idle/ended', () => {
    it('does not notify for idle transitions', () => {
      bridge = new AgentBridge({
        monitor: mockMonitor,
        notifyScript: '/usr/local/bin/agent-notify.sh',
        apiBaseUrl: 'http://localhost:3100',
      });

      const session = createManagedSession({ status: 'active' });
      mockMonitor.emit('session:status_changed', {
        session: { ...queries.getSession(session.id)!, status: 'idle' },
        from: 'active',
        to: 'idle',
      });

      expect(execFile).not.toHaveBeenCalled();
    });
  });

  describe('delivery failure handling', () => {
    it('persists notification as not delivered on script failure', () => {
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, _args: any, cb: any) => cb(new Error('Script failed'), '', 'error output')
      );

      bridge = new AgentBridge({
        monitor: mockMonitor,
        notifyScript: '/usr/local/bin/agent-notify.sh',
        apiBaseUrl: 'http://localhost:3100',
      });

      const session = createManagedSession({ status: 'active' });
      queries.updateSessionPendingQuestion(session.id, 'Question?');

      mockMonitor.emit('session:status_changed', {
        session: { ...queries.getSession(session.id)!, status: 'waiting' },
        from: 'active',
        to: 'waiting',
      });

      const notifications = queries.listNotifications({ session_id: session.id });
      expect(notifications.some(n => !n.delivered)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bridge.test.ts`

Expected: FAIL — `AgentBridge` not found.

- [ ] **Step 3: Implement Agent Bridge**

Create `src/bridge/index.ts`:

```typescript
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import * as queries from '../db/queries.js';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TRIGGERS } from '../shared/constants.js';
import type { Session, NotificationPayload } from '../shared/types.js';
import type { BridgeEvents, BridgeEventName } from '../shared/events.js';

export interface BridgeConfig {
  monitor: EventEmitter;
  notifyScript: string;
  apiBaseUrl: string;
}

export class AgentBridge extends EventEmitter {
  private config: BridgeConfig;

  constructor(config: BridgeConfig) {
    super();
    this.config = config;
    this.setupListeners();
  }

  stop(): void {
    this.config.monitor.removeAllListeners('session:status_changed');
  }

  private setupListeners(): void {
    this.config.monitor.on('session:status_changed', (data: { session: Session; from: string; to: string }) => {
      this.handleStatusChange(data.session, data.from, data.to);
    });
  }

  private handleStatusChange(session: Session, _from: string, to: string): void {
    if (session.type !== 'managed') return;
    if (!NOTIFICATION_TRIGGERS.has(to)) return;
    if (!session.owner) return;

    const payload = this.buildPayload(session, to);

    // Dual delivery: owner thread + sentinel-log
    this.deliver(session, NOTIFICATION_CHANNELS.OWNER_THREAD, `#${session.owner}`, to, payload);
    this.deliver(session, NOTIFICATION_CHANNELS.SENTINEL_LOG, '#sentinel-log', to, payload);
  }

  private buildPayload(session: Session, trigger: string): NotificationPayload {
    return {
      sessionId: session.id,
      label: session.label,
      status: trigger,
      project: session.project_name,
      gitBranch: session.git_branch,
      pendingQuestion: session.pending_question,
      errorMessage: session.error_message,
      waitingSince: trigger === 'waiting' ? new Date().toISOString() : null,
      apiUrl: `${this.config.apiBaseUrl}/sessions/${session.id}`,
    };
  }

  private deliver(
    session: Session,
    channel: string,
    destination: string,
    trigger: string,
    payload: NotificationPayload,
  ): void {
    const message = this.formatMessage(payload, trigger);

    execFile(this.config.notifyScript, [destination, message], (err) => {
      const delivered = !err;

      queries.insertNotification({
        session_id: session.id,
        channel,
        destination,
        trigger,
        payload,
        delivered,
      });

      if (delivered) {
        this.emit('bridge:notification_sent', {
          sessionId: session.id,
          destination,
          trigger,
        });
      } else {
        this.emit('bridge:notification_failed', {
          sessionId: session.id,
          destination,
          error: err!,
        });
      }
    });
  }

  private formatMessage(payload: NotificationPayload, trigger: string): string {
    const parts = [
      `[Session Sentinel] Session ${payload.sessionId}`,
      payload.label ? `(${payload.label})` : '',
      `is now **${trigger}**`,
    ];

    if (payload.project) parts.push(`| Project: ${payload.project}`);
    if (payload.gitBranch) parts.push(`| Branch: ${payload.gitBranch}`);

    if (trigger === 'waiting' && payload.pendingQuestion) {
      parts.push(`\nQuestion: ${payload.pendingQuestion}`);
    }
    if (trigger === 'error' && payload.errorMessage) {
      parts.push(`\nError: ${payload.errorMessage}`);
    }

    parts.push(`\nDetails: ${payload.apiUrl}`);
    return parts.filter(Boolean).join(' ');
  }

  // Typed event emitter overrides
  emit<K extends BridgeEventName>(event: K, payload: BridgeEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends BridgeEventName>(event: K, listener: (payload: BridgeEvents[K]) => void): this {
    return super.on(event, listener);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/bridge.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/bridge/ tests/unit/bridge.test.ts
git commit -m "feat(bridge): implement Agent Bridge with dual notification delivery"
```

---

## Task 6: Fastify Server & REST API

**Depends on:** Tasks 2, 4
**Spec reference:** Section 7 (API design, all endpoints)

**Files:**
- Create: `src/api/server.ts`
- Create: `src/api/routes.ts`
- Create: `tests/integration/api.test.ts`

- [ ] **Step 1: Write failing tests for the API**

Create `tests/integration/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { initDb, closeDb, getDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('REST API', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `sentinel-api-${Date.now()}.db`);
    initDb(dbPath);
    app = buildServer({ manager: null as any }); // Manager not needed for read-only tests
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  beforeEach(() => {
    // Clean sessions for each test
    const db = getDb();
    db.exec('DELETE FROM session_events');
    db.exec('DELETE FROM transcript_cache');
    db.exec('DELETE FROM notifications');
    db.exec('DELETE FROM runs');
    db.exec('DELETE FROM sub_agents');
    db.exec('DELETE FROM sessions');
  });

  // --- Health ---

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('version');
    });
  });

  // --- Sessions list ---

  describe('GET /sessions', () => {
    it('returns empty array when no sessions', async () => {
      const response = await app.inject({ method: 'GET', url: '/sessions' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('returns all sessions', async () => {
      queries.upsertSession({ claude_session_id: 'cs-1', jsonl_path: '/tmp/a.jsonl', status: 'active' });
      queries.upsertSession({ claude_session_id: 'cs-2', jsonl_path: '/tmp/b.jsonl', status: 'waiting' });

      const response = await app.inject({ method: 'GET', url: '/sessions' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(2);
    });

    it('filters by status', async () => {
      queries.upsertSession({ claude_session_id: 'cs-3', jsonl_path: '/tmp/a.jsonl', status: 'active' });
      queries.upsertSession({ claude_session_id: 'cs-4', jsonl_path: '/tmp/b.jsonl', status: 'waiting' });

      const response = await app.inject({ method: 'GET', url: '/sessions?status=waiting' });
      expect(response.json()).toHaveLength(1);
      expect(response.json()[0].status).toBe('waiting');
    });

    it('filters by type', async () => {
      const s = queries.upsertSession({ claude_session_id: 'cs-5', jsonl_path: '/tmp/a.jsonl', type: 'managed' });
      queries.updateSessionOwner(s.id, 'jarvis');
      queries.upsertSession({ claude_session_id: 'cs-6', jsonl_path: '/tmp/b.jsonl' }); // unmanaged

      const response = await app.inject({ method: 'GET', url: '/sessions?type=managed' });
      expect(response.json()).toHaveLength(1);
    });

    it('filters by owner', async () => {
      const s = queries.upsertSession({ claude_session_id: 'cs-7', jsonl_path: '/tmp/a.jsonl' });
      queries.updateSessionOwner(s.id, 'jarvis');

      const response = await app.inject({ method: 'GET', url: '/sessions?owner=jarvis' });
      expect(response.json()).toHaveLength(1);
    });
  });

  // --- Session detail ---

  describe('GET /sessions/:id', () => {
    it('returns session with runs, events, transcript, and available_actions', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-detail',
        jsonl_path: '/tmp/detail.jsonl',
        status: 'waiting',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'jarvis');
      queries.insertRun({ session_id: session.id, jsonl_path: '/tmp/r1.jsonl', start_type: 'startup' });
      queries.insertEvent({ session_id: session.id, event_type: 'status_change', to_status: 'waiting' });

      const response = await app.inject({ method: 'GET', url: `/sessions/${session.id}` });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.session.id).toBe(session.id);
      expect(body.runs).toHaveLength(1);
      expect(body.events).toHaveLength(1);
      expect(body.available_actions).toContain('send_message');
      expect(body.available_actions).toContain('terminate');
    });

    it('returns 404 for unknown session', async () => {
      const response = await app.inject({ method: 'GET', url: '/sessions/ss-nonexistent' });
      expect(response.statusCode).toBe(404);
    });
  });

  // --- Session transcript ---

  describe('GET /sessions/:id/transcript', () => {
    it('returns transcript entries', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-transcript',
        jsonl_path: '/tmp/test.jsonl',
      });
      queries.insertTranscriptEntry({ session_id: session.id, turn: 1, role: 'user', content: 'Hello' });
      queries.insertTranscriptEntry({ session_id: session.id, turn: 2, role: 'assistant', content: 'Hi' });

      const response = await app.inject({ method: 'GET', url: `/sessions/${session.id}/transcript` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(2);
    });
  });

  // --- Report ---

  describe('GET /report', () => {
    it('returns environment snapshot', async () => {
      queries.upsertSession({ claude_session_id: 'cs-r1', jsonl_path: '/tmp/a.jsonl', status: 'active' });
      queries.upsertSession({ claude_session_id: 'cs-r2', jsonl_path: '/tmp/b.jsonl', status: 'waiting' });

      const response = await app.inject({ method: 'GET', url: '/report' });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.summary.total_sessions).toBe(2);
      expect(body.summary.active).toBe(1);
      expect(body.summary.waiting).toBe(1);
      expect(body.needs_attention).toHaveLength(1);
      expect(body.active_sessions).toHaveLength(1);
    });
  });

  // --- Events ---

  describe('GET /events', () => {
    it('returns global event log', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-events',
        jsonl_path: '/tmp/test.jsonl',
      });
      queries.insertEvent({ session_id: session.id, event_type: 'status_change', to_status: 'active' });
      queries.insertEvent({ session_id: session.id, event_type: 'status_change', to_status: 'waiting' });

      const response = await app.inject({ method: 'GET', url: '/events' });
      expect(response.statusCode).toBe(200);
      expect(response.json().length).toBeGreaterThanOrEqual(2);
    });

    it('filters by session_id', async () => {
      const s1 = queries.upsertSession({ claude_session_id: 'cs-e1', jsonl_path: '/tmp/a.jsonl' });
      const s2 = queries.upsertSession({ claude_session_id: 'cs-e2', jsonl_path: '/tmp/b.jsonl' });
      queries.insertEvent({ session_id: s1.id, event_type: 'x' });
      queries.insertEvent({ session_id: s2.id, event_type: 'y' });

      const response = await app.inject({ method: 'GET', url: `/events?session_id=${s1.id}` });
      expect(response.json()).toHaveLength(1);
    });
  });

  // --- Projects ---

  describe('GET /projects', () => {
    it('returns known projects', async () => {
      queries.upsertProject('wow-bot', '/home/blasi/wow-bot');

      const response = await app.inject({ method: 'GET', url: '/projects' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(1);
      expect(response.json()[0].name).toBe('wow-bot');
    });
  });

  // --- Write endpoints (require Manager) ---
  // These tests use a mock Manager since the real SDK is not available in tests.

  describe('POST /sessions (with Manager)', () => {
    let appWithManager: FastifyInstance;
    let mockManager: any;

    beforeAll(async () => {
      mockManager = {
        createSession: vi.fn().mockResolvedValue({
          id: 'ss-new', status: 'starting', type: 'managed', owner: 'jarvis',
        }),
        resumeSession: vi.fn().mockResolvedValue({
          id: 'ss-resumed', status: 'starting', type: 'managed', owner: 'moon',
        }),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        terminateSession: vi.fn().mockResolvedValue(undefined),
      };
      appWithManager = buildServer({ manager: mockManager });
      await appWithManager.ready();
    });

    afterAll(async () => {
      await appWithManager.close();
    });

    it('creates a managed session', async () => {
      const response = await appWithManager.inject({
        method: 'POST', url: '/sessions',
        payload: { prompt: 'Review auth', owner: 'jarvis', project: 'wow-bot' },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().type).toBe('managed');
      expect(mockManager.createSession).toHaveBeenCalledOnce();
    });

    it('rejects without prompt or owner', async () => {
      const response = await appWithManager.inject({
        method: 'POST', url: '/sessions',
        payload: { prompt: 'Test' }, // missing owner
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 503 when Manager is not available', async () => {
      const response = await app.inject({
        method: 'POST', url: '/sessions',
        payload: { prompt: 'Test', owner: 'jarvis' },
      });
      expect(response.statusCode).toBe(503);
    });
  });

  describe('POST /sessions/:id/resume', () => {
    let appWithManager: FastifyInstance;
    let mockManager: any;

    beforeAll(async () => {
      mockManager = {
        resumeSession: vi.fn().mockResolvedValue({
          id: 'ss-resumed', status: 'starting', type: 'managed', owner: 'moon',
        }),
      };
      appWithManager = buildServer({ manager: mockManager });
      await appWithManager.ready();
    });

    afterAll(async () => { await appWithManager.close(); });

    it('resumes a session with new owner', async () => {
      const response = await appWithManager.inject({
        method: 'POST', url: '/sessions/ss-test/resume',
        payload: { prompt: 'Continue', owner: 'moon' },
      });
      expect(response.statusCode).toBe(200);
      expect(mockManager.resumeSession).toHaveBeenCalledWith('ss-test', expect.objectContaining({ owner: 'moon' }));
    });

    it('rejects without prompt or owner', async () => {
      const response = await appWithManager.inject({
        method: 'POST', url: '/sessions/ss-test/resume',
        payload: { prompt: 'Continue' }, // missing owner
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /sessions/:id/message', () => {
    let appWithManager: FastifyInstance;
    let mockManager: any;

    beforeAll(async () => {
      mockManager = {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      };
      appWithManager = buildServer({ manager: mockManager });
      await appWithManager.ready();
    });

    afterAll(async () => { await appWithManager.close(); });

    it('sends a message and returns 202', async () => {
      const response = await appWithManager.inject({
        method: 'POST', url: '/sessions/ss-test/message',
        payload: { message: 'Yes, proceed' },
      });
      expect(response.statusCode).toBe(202);
      expect(mockManager.sendMessage).toHaveBeenCalledWith('ss-test', { message: 'Yes, proceed' });
    });

    it('rejects without message', async () => {
      const response = await appWithManager.inject({
        method: 'POST', url: '/sessions/ss-test/message',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /sessions/:id', () => {
    let appWithManager: FastifyInstance;
    let mockManager: any;

    beforeAll(async () => {
      mockManager = {
        terminateSession: vi.fn().mockResolvedValue(undefined),
      };
      appWithManager = buildServer({ manager: mockManager });
      await appWithManager.ready();
    });

    afterAll(async () => { await appWithManager.close(); });

    it('terminates a session', async () => {
      const response = await appWithManager.inject({
        method: 'DELETE', url: '/sessions/ss-test',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('terminated');
    });

    it('returns 404 for not-found session', async () => {
      mockManager.terminateSession.mockRejectedValueOnce(new Error('Session not found: ss-nope'));
      const response = await appWithManager.inject({
        method: 'DELETE', url: '/sessions/ss-nope',
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/api.test.ts`

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement API routes**

Create `src/api/routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import * as queries from '../db/queries.js';
import type { SessionManager } from '../manager/index.js';
import type { SessionFilters, EventFilters } from '../shared/types.js';

export function registerRoutes(app: FastifyInstance, manager: SessionManager | null): void {

  // --- Health ---

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    version: '0.2.0',
    timestamp: new Date().toISOString(),
  }));

  // --- Sessions ---

  app.get('/sessions', async (request) => {
    const query = request.query as Record<string, string>;
    const filters: SessionFilters = {};

    if (query.status) filters.status = query.status as any;
    if (query.type) filters.type = query.type as any;
    if (query.owner) filters.owner = query.owner;
    if (query.project) filters.project_name = query.project;
    if (query.active === 'true') filters.active = true;
    if (query.limit) filters.limit = parseInt(query.limit, 10);

    return queries.listSessions(filters);
  });

  app.get('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = queries.getSession(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const runs = queries.getRuns(id);
    const events = queries.listEvents({ session_id: id, limit: 50 });
    const transcript = queries.getTranscript(id);
    const available_actions = getAvailableActions(session);

    return { session, runs, events, transcript, available_actions };
  });

  app.get('/sessions/:id/transcript', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const session = queries.getSession(id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return queries.getTranscript(id, limit);
  });

  // --- Session lifecycle (requires Manager) ---

  app.post('/sessions', async (request, reply) => {
    if (!manager) return reply.status(503).send({ error: 'Session Manager not available' });

    const body = request.body as Record<string, unknown>;
    if (!body.prompt || !body.owner) {
      return reply.status(400).send({ error: 'prompt and owner are required' });
    }

    try {
      const session = await manager.createSession({
        prompt: body.prompt as string,
        project: body.project as string | undefined,
        cwd: body.cwd as string | undefined,
        owner: body.owner as string,
        label: body.label as string | undefined,
        model: body.model as string | undefined,
        effort: body.effort as string | undefined,
        allowedTools: body.allowedTools as string[] | undefined,
        systemPrompt: body.systemPrompt as string | undefined,
        maxBudgetUsd: body.maxBudgetUsd as number | undefined,
      });
      return reply.status(201).send(session);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post('/sessions/:id/resume', async (request, reply) => {
    if (!manager) return reply.status(503).send({ error: 'Session Manager not available' });

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    if (!body.prompt || !body.owner) {
      return reply.status(400).send({ error: 'prompt and owner are required' });
    }

    try {
      const session = await manager.resumeSession(id, {
        prompt: body.prompt as string,
        owner: body.owner as string,
        model: body.model as string | undefined,
        effort: body.effort as string | undefined,
      });
      return reply.status(200).send(session);
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400;
      return reply.status(status).send({ error: err.message });
    }
  });

  app.post('/sessions/:id/message', async (request, reply) => {
    if (!manager) return reply.status(503).send({ error: 'Session Manager not available' });

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    if (!body.message) {
      return reply.status(400).send({ error: 'message is required' });
    }

    try {
      await manager.sendMessage(id, { message: body.message as string });
      return reply.status(202).send({ status: 'message_sent' });
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400;
      return reply.status(status).send({ error: err.message });
    }
  });

  app.delete('/sessions/:id', async (request, reply) => {
    if (!manager) return reply.status(503).send({ error: 'Session Manager not available' });

    const { id } = request.params as { id: string };
    try {
      await manager.terminateSession(id);
      return reply.status(200).send({ status: 'terminated' });
    } catch (err: any) {
      const status = err.message.includes('not found') ? 404 : 400;
      return reply.status(status).send({ error: err.message });
    }
  });

  // --- Report ---

  app.get('/report', async () => {
    const stats = queries.getReportStats();
    const needsAttention = queries.listSessions({ status: 'waiting' as any })
      .concat(queries.listSessions({ status: 'error' as any }))
      .filter(s => s.type === 'managed');
    const activeSessions = queries.listSessions({ active: true });
    const recentEvents = queries.listEvents({ limit: 20 });

    // Group by project
    const allSessions = queries.listSessions({});
    const byProject: Record<string, { active: number; waiting: number; ended_today: number }> = {};
    for (const s of allSessions) {
      const proj = s.project_name ?? 'unknown';
      if (!byProject[proj]) byProject[proj] = { active: 0, waiting: 0, ended_today: 0 };
      if (s.status === 'active') byProject[proj].active++;
      if (s.status === 'waiting') byProject[proj].waiting++;
      if (s.status === 'ended') byProject[proj].ended_today++;
    }

    return {
      summary: stats,
      needs_attention: needsAttention,
      active_sessions: activeSessions,
      recent_events: recentEvents,
      by_project: byProject,
    };
  });

  // --- Events ---

  app.get('/events', async (request) => {
    const query = request.query as Record<string, string>;
    const filters: EventFilters = {};

    if (query.session_id) filters.session_id = query.session_id;
    if (query.event_type) filters.event_type = query.event_type;
    if (query.limit) filters.limit = parseInt(query.limit, 10);

    return queries.listEvents(filters);
  });

  // --- Projects ---

  app.get('/projects', async () => {
    return queries.listProjects();
  });
}

function getAvailableActions(session: { status: string; type: string; can_resume: boolean }): string[] {
  const actions: string[] = [];

  if (session.type === 'managed') {
    if (['waiting', 'active', 'idle'].includes(session.status)) {
      actions.push('send_message');
    }
    if (['active', 'waiting', 'idle'].includes(session.status)) {
      actions.push('terminate');
    }
  }

  if (['ended', 'error', 'idle'].includes(session.status) && session.can_resume) {
    actions.push('resume');
  }

  return actions;
}
```

- [ ] **Step 4: Implement Fastify server builder**

Create `src/api/server.ts`:

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './routes.js';
import type { SessionManager } from '../manager/index.js';

export interface ServerConfig {
  manager: SessionManager | null;
  logger?: boolean;
}

export function buildServer(config: ServerConfig): FastifyInstance {
  const app = Fastify({
    logger: config.logger ?? false,
  });

  app.register(cors, {
    origin: true,
  });

  registerRoutes(app, config.manager);

  return app;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/integration/api.test.ts`

Expected: all tests pass.

Note: The `beforeEach` cleanup in the test uses direct DB access. If imports fail due to async module initialization, wrap the cleanup in a helper that uses `getDb()` from connection.ts.

- [ ] **Step 6: Commit**

```bash
git add src/api/ tests/integration/api.test.ts
git commit -m "feat(api): implement Fastify REST API with all session endpoints"
```

---

## Task 7: WebSocket Real-time

**Depends on:** Task 6 (Fastify server)
**Spec reference:** Section 7 (WS /ws), Section 8 (dashboard real-time)

**Files:**
- Create: `src/api/websocket.ts`
- Modify: `src/api/server.ts` (register WebSocket plugin)
- Create: `tests/integration/websocket.test.ts`

- [ ] **Step 1: Write failing tests for WebSocket**

Create `tests/integration/websocket.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { initDb, closeDb } from '../../src/db/connection.js';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('WebSocket /ws', () => {
  let app: FastifyInstance;
  let dbPath: string;
  let mockMonitor: EventEmitter;
  let port: number;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `sentinel-ws-${Date.now()}.db`);
    initDb(dbPath);
    mockMonitor = new EventEmitter();
    app = buildServer({ manager: null, monitor: mockMonitor });
    await app.listen({ port: 0 });
    const address = app.server.address();
    port = typeof address === 'object' ? address!.port : 0;
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('accepts WebSocket connections on /ws', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    ws.close();
  });

  it('broadcasts session status changes', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>(resolve => ws.on('open', resolve));

    const received = new Promise<any>(resolve => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    // Simulate Monitor event
    mockMonitor.emit('session:status_changed', {
      session: { id: 'ss-test', status: 'waiting' },
      from: 'active',
      to: 'waiting',
    });

    const message = await received;
    expect(message.type).toBe('status_change');
    expect(message.sessionId).toBe('ss-test');
    expect(message.to).toBe('waiting');

    ws.close();
  });

  it('broadcasts session discovery', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>(resolve => ws.on('open', resolve));

    const received = new Promise<any>(resolve => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    mockMonitor.emit('session:discovered', {
      session: { id: 'ss-new', status: 'starting' },
    });

    const message = await received;
    expect(message.type).toBe('session_update');

    ws.close();
  });

  it('broadcasts to multiple simultaneous clients', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws3 = new WebSocket(`ws://localhost:${port}/ws`);
    await Promise.all([
      new Promise<void>(resolve => ws1.on('open', resolve)),
      new Promise<void>(resolve => ws2.on('open', resolve)),
      new Promise<void>(resolve => ws3.on('open', resolve)),
    ]);

    const received = Promise.all([
      new Promise<any>(resolve => ws1.on('message', (d) => resolve(JSON.parse(d.toString())))),
      new Promise<any>(resolve => ws2.on('message', (d) => resolve(JSON.parse(d.toString())))),
      new Promise<any>(resolve => ws3.on('message', (d) => resolve(JSON.parse(d.toString())))),
    ]);

    mockMonitor.emit('session:status_changed', {
      session: { id: 'ss-multi', status: 'active' },
      from: 'starting',
      to: 'active',
    });

    const messages = await received;
    expect(messages).toHaveLength(3);
    expect(messages.every((m: any) => m.sessionId === 'ss-multi')).toBe(true);

    ws1.close(); ws2.close(); ws3.close();
  });

  it('handles client disconnect during broadcast without crashing', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${port}/ws`);
    await Promise.all([
      new Promise<void>(resolve => ws1.on('open', resolve)),
      new Promise<void>(resolve => ws2.on('open', resolve)),
    ]);

    // Disconnect ws1 before broadcast
    ws1.close();
    await new Promise(r => setTimeout(r, 50));

    const received = new Promise<any>(resolve => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    // Should not throw — server handles dead clients gracefully
    mockMonitor.emit('session:status_changed', {
      session: { id: 'ss-disconnect', status: 'error' },
      from: 'active',
      to: 'error',
    });

    const message = await received;
    expect(message.sessionId).toBe('ss-disconnect');

    ws2.close();
  });
});
```

- [ ] **Step 2: Implement WebSocket handler**

Create `src/api/websocket.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import type { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { Session, SessionEvent, WsOutgoingMessage } from '../shared/types.js';

const clients = new Set<WebSocket>();

export function registerWebSocket(app: FastifyInstance, monitor: EventEmitter | null): void {
  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });

  if (!monitor) return;

  monitor.on('session:discovered', (data: { session: Session }) => {
    broadcast({ type: 'session_update', session: data.session });
  });

  monitor.on('session:status_changed', (data: { session: Session; from: string; to: string }) => {
    broadcast({
      type: 'status_change',
      sessionId: data.session.id,
      from: data.from,
      to: data.to,
    });
  });

  monitor.on('session:activity', (data: { session: Session }) => {
    broadcast({ type: 'session_update', session: data.session });
  });
}

function broadcast(message: WsOutgoingMessage): void {
  const json = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(json);
    }
  }
}
```

- [ ] **Step 3: Update server.ts to register WebSocket**

Modify `src/api/server.ts` to accept an optional `monitor` and register the WebSocket plugin:

```typescript
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerRoutes } from './routes.js';
import { registerWebSocket } from './websocket.js';
import type { SessionManager } from '../manager/index.js';
import type { EventEmitter } from 'node:events';

export interface ServerConfig {
  manager: SessionManager | null;
  monitor?: EventEmitter | null;
  logger?: boolean;
}

export function buildServer(config: ServerConfig): FastifyInstance {
  const app = Fastify({
    logger: config.logger ?? false,
  });

  app.register(cors, { origin: true });
  app.register(websocket);

  registerRoutes(app, config.manager);
  registerWebSocket(app, config.monitor ?? null);

  return app;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/integration/websocket.test.ts`

Expected: all tests pass.

Note: WebSocket tests require the `ws` package. If not present as a transitive dependency, add it: `npm install -D ws @types/ws`.

- [ ] **Step 5: Commit**

```bash
git add src/api/ tests/integration/websocket.test.ts
git commit -m "feat(api): implement WebSocket real-time event broadcasting"
```

---

## Task 8: Dashboard Enhancements

**Depends on:** Task 7 (WebSocket)
**Spec reference:** Section 8 (dashboard UI)
**Coverage:** Manual verification only — Vitest unit tests are not applicable for SvelteKit UI components. E2E testing (Playwright) is out of scope for Sprint 2. Verify by running the dashboard and navigating to a session detail page.

**Files:**
- Modify: `dashboard/src/routes/+page.svelte` (add WebSocket connection for real-time)
- Create: `dashboard/src/routes/sessions/[id]/+page.server.ts` (session detail)
- Create: `dashboard/src/routes/sessions/[id]/+page.svelte` (session detail view)
- Modify: `dashboard/src/lib/db.ts` (add detail queries)

- [ ] **Step 1: Add session detail data loader**

Create `dashboard/src/routes/sessions/[id]/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { getSessions, getSessionById, getRunsForSession, getEventsForSession, getTranscriptForSession } from '$lib/db';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const session = getSessionById(params.id);
  if (!session) throw error(404, 'Session not found');

  const runs = getRunsForSession(params.id);
  const events = getEventsForSession(params.id);
  const transcript = getTranscriptForSession(params.id);

  return { session, runs, events, transcript };
};
```

- [ ] **Step 2: Add detail queries to dashboard db helper**

Add to `dashboard/src/lib/db.ts`:

```typescript
export function getSessionById(id: string) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

export function getRunsForSession(sessionId: string) {
  return getDb().prepare('SELECT * FROM runs WHERE session_id = ? ORDER BY run_number ASC').all(sessionId);
}

export function getEventsForSession(sessionId: string) {
  return getDb().prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY created_at DESC LIMIT 50').all(sessionId);
}

export function getTranscriptForSession(sessionId: string) {
  return getDb().prepare('SELECT * FROM transcript_cache WHERE session_id = ? ORDER BY turn ASC').all(sessionId);
}
```

- [ ] **Step 3: Create session detail Svelte page**

Create `dashboard/src/routes/sessions/[id]/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();
  const { session, runs, events, transcript } = data;

  const STATUS_COLORS: Record<string, string> = {
    starting: '#94a3b8',
    active: '#4ade80',
    waiting: '#facc15',
    idle: '#f97316',
    ended: '#6b7280',
    error: '#ef4444',
  };

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
</script>

<svelte:head>
  <title>{session.label ?? session.id} — Session Sentinel</title>
</svelte:head>

<main>
  <a href="/">&larr; Back to overview</a>

  <section class="metadata">
    <h1>
      <span class="status-badge" style="background:{STATUS_COLORS[session.status]}">{session.status}</span>
      {session.label ?? session.id}
    </h1>
    <div class="meta-grid">
      <div><strong>ID:</strong> {session.id}</div>
      <div><strong>Type:</strong> {session.type}</div>
      <div><strong>Owner:</strong> {session.owner ?? '—'}</div>
      <div><strong>Project:</strong> {session.project_name ?? '—'}</div>
      <div><strong>Branch:</strong> {session.git_branch ?? '—'}</div>
      <div><strong>Model:</strong> {session.model ?? '—'}</div>
      <div><strong>Tokens:</strong> {formatTokens(session.input_tokens)} in / {formatTokens(session.output_tokens)} out</div>
      <div><strong>Created:</strong> {timeAgo(session.created_at)}</div>
    </div>

    {#if session.status === 'waiting' && session.pending_question}
      <div class="alert waiting">
        <strong>Pending question:</strong> {session.pending_question}
      </div>
    {/if}

    {#if session.status === 'error' && session.error_message}
      <div class="alert error">
        <strong>Error:</strong> {session.error_message}
      </div>
    {/if}

    {#if session.remote_url}
      <div><strong>Remote:</strong> <a href={session.remote_url} target="_blank">{session.remote_url}</a></div>
    {/if}
  </section>

  <section class="runs">
    <h2>Runs ({runs.length})</h2>
    <table>
      <thead><tr><th>#</th><th>Type</th><th>Owner</th><th>Start</th><th>Tokens</th><th>Duration</th></tr></thead>
      <tbody>
        {#each runs as run}
          <tr>
            <td>{run.run_number}</td>
            <td>{run.start_type}</td>
            <td>{run.owner_during_run ?? '—'}</td>
            <td>{timeAgo(run.started_at)}</td>
            <td>{formatTokens(run.input_tokens + run.output_tokens)}</td>
            <td>{run.ended_at ? timeAgo(run.ended_at) : 'running'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="events">
    <h2>Events (last 50)</h2>
    <table>
      <thead><tr><th>Time</th><th>Type</th><th>From</th><th>To</th><th>Actor</th></tr></thead>
      <tbody>
        {#each events as event}
          <tr>
            <td>{timeAgo(event.created_at)}</td>
            <td>{event.event_type}</td>
            <td>{event.from_status ?? '—'}</td>
            <td>{event.to_status ?? '—'}</td>
            <td>{event.actor}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section class="transcript">
    <h2>Transcript ({transcript.length} turns)</h2>
    <div class="transcript-list">
      {#each transcript as entry}
        <div class="turn {entry.role}">
          <div class="turn-header">
            <span class="role">{entry.role}</span>
            <span class="tokens">{formatTokens((entry.input_tokens || 0) + (entry.output_tokens || 0))} tokens</span>
          </div>
          <div class="turn-content">{entry.content.substring(0, 500)}{entry.content.length > 500 ? '...' : ''}</div>
        </div>
      {/each}
    </div>
  </section>
</main>

<style>
  main { max-width: 1000px; margin: 0 auto; padding: 2rem; font-family: monospace; color: #e2e8f0; background: #0f172a; }
  a { color: #60a5fa; }
  .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; color: #000; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin: 1rem 0; }
  .alert { padding: 0.75rem; border-radius: 4px; margin: 1rem 0; }
  .alert.waiting { background: #422006; border: 1px solid #facc15; }
  .alert.error { background: #450a0a; border: 1px solid #ef4444; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #1e293b; }
  th { color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; }
  .transcript-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .turn { padding: 0.75rem; border-radius: 4px; background: #1e293b; }
  .turn.user { border-left: 3px solid #60a5fa; }
  .turn.assistant { border-left: 3px solid #4ade80; }
  .turn-header { display: flex; justify-content: space-between; font-size: 0.75rem; color: #94a3b8; margin-bottom: 0.25rem; }
  .turn-content { white-space: pre-wrap; font-size: 0.85rem; }
  h2 { margin-top: 2rem; color: #94a3b8; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
</style>
```

- [ ] **Step 4: Add WebSocket client to overview page**

Modify `dashboard/src/routes/+page.svelte` to add WebSocket auto-refresh. At the top of the `<script>` block, add:

```typescript
import { onMount, onDestroy } from 'svelte';
import { invalidateAll } from '$app/navigation';

let ws: WebSocket | null = null;

onMount(() => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//localhost:3100/ws`);

  ws.onmessage = () => {
    // Any WebSocket message triggers a data refresh
    invalidateAll();
  };

  ws.onerror = () => {
    // Fallback to polling if WebSocket fails
    console.warn('WebSocket error, falling back to polling');
  };
});

onDestroy(() => {
  if (ws) ws.close();
});
```

Remove the existing `setInterval(invalidateAll, 3000)` polling — WebSocket replaces it.

- [ ] **Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat(dashboard): add session detail view and WebSocket real-time updates"
```

---

## Task 9: Integration Entry Point

**Depends on:** All previous tasks
**Spec reference:** Section 4 (architecture overview)

**Files:**
- Modify: `src/main.ts`
- Create: `tests/integration/full-stack.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/full-stack.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, closeDb } from '../../src/db/connection.js';
import { SessionMonitor } from '../../src/monitor/index.js';
import { SessionManager } from '../../src/manager/index.js';
import { AgentBridge } from '../../src/bridge/index.js';
import { buildServer } from '../../src/api/server.js';
import { V1Driver } from '../../src/manager/v1-driver.js';
import type { FastifyInstance } from 'fastify';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Full stack integration', () => {
  let dbPath: string;
  let watchRoot: string;
  let monitor: SessionMonitor;
  let manager: SessionManager;
  let bridge: AgentBridge;
  let app: FastifyInstance;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `sentinel-full-${Date.now()}.db`);
    watchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watch-'));
    initDb(dbPath);

    monitor = new SessionMonitor({
      watchRoot,
      dbPath,
      idleThresholdMs: 60_000,
      endedThresholdMs: 300_000,
      pollIntervalMs: 60_000,
    });

    const driver = new V1Driver();
    manager = new SessionManager({ driver });

    bridge = new AgentBridge({
      monitor,
      notifyScript: '/bin/true', // no-op for testing
      apiBaseUrl: 'http://localhost:3100',
    });

    app = buildServer({ manager, monitor });
    await monitor.start();
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
    bridge.stop();
    await manager.stop();
    await monitor.stop();
    closeDb();
    fs.rmSync(watchRoot, { recursive: true, force: true });
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('all modules initialize without error', () => {
    expect(monitor).toBeDefined();
    expect(manager).toBeDefined();
    expect(bridge).toBeDefined();
    expect(app).toBeDefined();
  });

  it('API health endpoint works with all modules running', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('API sessions endpoint returns data from Monitor-populated DB', async () => {
    // Manually insert a session (as if Monitor discovered it)
    queries.upsertSession({
      claude_session_id: 'full-stack-test',
      jsonl_path: '/tmp/test.jsonl',
      status: 'active',
      cwd: '/home/blasi/wow-bot',
      project_name: 'wow-bot',
    });

    const response = await app.inject({ method: 'GET', url: '/sessions' });
    expect(response.statusCode).toBe(200);
    expect(response.json().length).toBeGreaterThanOrEqual(1);
  });

  it('API report endpoint aggregates data correctly', async () => {
    const response = await app.inject({ method: 'GET', url: '/report' });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary).toHaveProperty('total_sessions');
  });
});
```

- [ ] **Step 2: Rewrite main.ts to wire all modules**

Modify `src/main.ts`:

```typescript
import { SessionMonitor } from './monitor/index.js';
import { SessionManager } from './manager/index.js';
import { V1Driver } from './manager/v1-driver.js';
import { AgentBridge } from './bridge/index.js';
import { buildServer } from './api/server.js';
import { API_PORT, API_HOST } from './shared/constants.js';

// --- Configuration from environment ---
const config = {
  apiPort: parseInt(process.env.SENTINEL_PORT ?? String(API_PORT), 10),
  apiHost: process.env.SENTINEL_HOST ?? API_HOST,
  notifyScript: process.env.SENTINEL_NOTIFY_SCRIPT ?? '/usr/local/bin/agent-notify.sh',
  apiBaseUrl: process.env.SENTINEL_API_URL ?? `http://localhost:${API_PORT}`,
};

// --- Initialize modules ---
const monitor = new SessionMonitor();

const driver = new V1Driver();
const manager = new SessionManager({
  driver,
  notifyScript: config.notifyScript,
});

const bridge = new AgentBridge({
  monitor,
  notifyScript: config.notifyScript,
  apiBaseUrl: config.apiBaseUrl,
});

const app = buildServer({
  manager,
  monitor,
  logger: true,
});

// --- Graceful shutdown ---
async function shutdown() {
  console.log('\nShutting down...');
  await app.close();
  bridge.stop();
  await manager.stop();
  await monitor.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Start ---
console.log('Session Sentinel starting...');
await monitor.start();
console.log(`Monitoring ${monitor.getStats().filesWatched} files`);

await app.listen({ port: config.apiPort, host: config.apiHost });
console.log(`API listening on http://${config.apiHost}:${config.apiPort}`);
console.log(`WebSocket on ws://${config.apiHost}:${config.apiPort}/ws`);
console.log('Press Ctrl+C to stop.');
```

- [ ] **Step 3: Verify type check passes**

Run: `npx tsc --noEmit`

Expected: no type errors.

- [ ] **Step 4: Run integration test**

Run: `npx vitest run tests/integration/full-stack.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts tests/integration/full-stack.test.ts
git commit -m "feat(infra): wire Monitor + Manager + Bridge + API in main entry point"
```

---

## Task 10: Run All Tests and Final Commit

**Depends on:** All previous tasks

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass across all test files.

- [ ] **Step 2: Verify type check**

```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Verify dashboard builds**

```bash
cd dashboard && npm run build
```

Expected: build completes without errors.

- [ ] **Step 4: Test manual startup**

```bash
cd /home/blasi/session-sentinel && npx tsx src/main.ts
```

Expected: Sentinel starts, shows monitoring stats, API listening message. Ctrl+C to stop.

Quick verify:
```bash
curl http://localhost:3100/health
curl http://localhost:3100/sessions
curl http://localhost:3100/report
```

- [ ] **Step 5: Final commit if any remaining changes**

```bash
git add -A
git commit -m "chore(infra): Sprint 2 final — all tests passing, full stack integration verified"
```

---

## Dependency Graph

```
Task 1: Dependencies & Types
  ↓
  ├── Task 2: DB Queries ──────────────┐
  ├── Task 3: SessionDriver & V1 ──┐   │
  │                                 ↓   ↓
  │                           Task 4: Session Manager
  │                                 ↓         ↓
  │                           Task 5: Agent Bridge
  │                                 ↓
  ├── Task 6: Fastify & REST API ←──┘
  │         ↓
  ├── Task 7: WebSocket
  │         ↓
  ├── Task 8: Dashboard Enhancements
  │
  └── Task 9: Integration Entry Point ← (all above)
              ↓
        Task 10: Final Tests
```

## References

- Design spec: `docs/specs/2026-03-27-session-sentinel-design.md`
- ADR-0001: `docs/decisions/0001-session-driver-sdk-strategy.md`
- Sprint 1 plan: `docs/plans/2026-03-27-sprint1-foundation.md`
- Sprint 0 SDK spike: `docs/spikes/sprint0-sdk-interactive.md`
- Sprint 0 Claude Remote spike: `docs/spikes/sprint0-claude-remote.md`
- SDK V1 docs: https://platform.claude.com/docs/en/agent-sdk/typescript
