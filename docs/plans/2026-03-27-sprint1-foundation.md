# Sprint 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational layer of Session Sentinel — JSONL monitoring, SQLite persistence, and a debug dashboard.

**Architecture:** The Session Monitor watches `~/.claude/projects/` via `fs.watch`, parses JSONL events, infers session status via a state machine, detects run boundaries and sub-agents, and persists everything to SQLite. A minimal SvelteKit dashboard reads from SQLite for debug visibility.

**Tech Stack:** Node.js, TypeScript, better-sqlite3, Vitest, SvelteKit, `@anthropic-ai/claude-agent-sdk`

**Spec:** `docs/specs/2026-03-27-sprint1-foundation.md`
**Sprint 0 findings:** `docs/spikes/sprint0-summary.md`
**JSONL format reference:** `docs/spikes/sprint0-jsonl-format.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/shared/types.ts`
- Create: `src/shared/constants.ts`
- Create: `src/shared/events.ts`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "session-sentinel",
  "version": "0.1.0",
  "description": "Control plane for development agent sessions",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/ tests/"
  },
  "devDependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "@sveltejs/adapter-node": "^5.0.0",
    "@sveltejs/kit": "^2.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "svelte": "^5.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "ulid": "^2.3.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "dashboard", "sandbox", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-journal
.svelte-kit/
.env
.env.local
```

- [ ] **Step 5: Create directory structure**

Run:
```bash
mkdir -p src/monitor src/db src/shared tests/unit tests/integration sandbox/fixtures dashboard
```

- [ ] **Step 6: Create shared types**

Create `src/shared/types.ts`:

```typescript
// --- Session types ---

export type SessionStatus = 'starting' | 'active' | 'waiting' | 'idle' | 'ended' | 'error';
export type SessionType = 'managed' | 'unmanaged';
export type RunStartType = 'startup' | 'resume' | 'compact';
export type SubAgentPattern = 'regular' | 'compact' | 'side_question';

export interface Session {
  id: string;
  claude_session_id: string;
  label: string | null;
  status: SessionStatus;
  type: SessionType;
  owner: string | null;
  cwd: string | null;
  project_name: string | null;
  model: string | null;
  effort: string | null;
  git_branch: string | null;
  git_remote: string | null;
  jsonl_path: string;
  pid: number | null;
  remote_url: string | null;
  last_entrypoint: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  pending_question: string | null;
  last_output: string | null;
  error_message: string | null;
  can_resume: boolean;
  parent_session_id: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface SessionUpsert {
  claude_session_id: string;
  jsonl_path: string;
  status?: SessionStatus;
  type?: SessionType;
  label?: string;
  cwd?: string;
  project_name?: string;
  model?: string;
  effort?: string;
  git_branch?: string;
  git_remote?: string;
  last_entrypoint?: string;
}

export interface SessionFilters {
  status?: SessionStatus;
  type?: SessionType;
  owner?: string;
  project_name?: string;
  active?: boolean;
  limit?: number;
}

export interface Run {
  id: number;
  session_id: string;
  run_number: number;
  jsonl_path: string;
  start_type: RunStartType;
  type_during_run: SessionType;
  owner_during_run: string | null;
  model: string | null;
  effort: string | null;
  remote_url: string | null;
  sentinel_managed: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  started_at: string;
  ended_at: string | null;
}

export interface RunInsert {
  session_id: string;
  jsonl_path: string;
  start_type: RunStartType;
  type_during_run?: SessionType;
  owner_during_run?: string;
  model?: string;
  effort?: string;
  remote_url?: string;
  sentinel_managed?: boolean;
}

export interface SubAgent {
  id: string;
  session_id: string;
  pattern: SubAgentPattern;
  agent_type: string | null;
  description: string | null;
  jsonl_path: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  started_at: string | null;
  ended_at: string | null;
}

export interface SubAgentUpsert {
  id: string;
  session_id: string;
  pattern: SubAgentPattern;
  jsonl_path: string;
  agent_type?: string;
  description?: string;
}

export interface SessionEvent {
  id: number;
  session_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor: string;
  detail: string | null;
  created_at: string;
}

export interface EventInsert {
  session_id: string;
  event_type: string;
  from_status?: string;
  to_status?: string;
  actor?: string;
  detail?: object;
}

export interface EventFilters {
  session_id?: string;
  event_type?: string;
  limit?: number;
}

export interface TranscriptEntry {
  id: number;
  session_id: string;
  run_id: number | null;
  turn: number;
  role: string;
  content: string;
  tools_used: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
  created_at: string;
}

export interface TranscriptInsert {
  session_id: string;
  run_id?: number;
  turn: number;
  role: string;
  content: string;
  tools_used?: string[];
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_create_tokens?: number;
}

export interface TokenDelta {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_create_tokens?: number;
}

// --- JSONL parsed event types ---

export type ParsedEventType =
  | 'assistant:text'
  | 'assistant:tool_use'
  | 'assistant:error'
  | 'user:prompt'
  | 'user:tool_result'
  | 'system:bridge_status'
  | 'system:api_error'
  | 'system:turn_duration'
  | 'system:stop_hook_summary'
  | 'system:compact_boundary'
  | 'progress:hook'
  | 'progress:agent'
  | 'last_prompt'
  | 'pr_link'
  | 'custom_title'
  | 'agent_name'
  | 'other';

export interface ParsedEvent {
  type: ParsedEventType;
  raw_type: string;
  timestamp: string | null;
  sessionId: string | null;
  entrypoint: string | null;
  cwd: string | null;
  gitBranch: string | null;
  slug: string | null;
  isSidechain: boolean;
  tokens: TokenDelta | null;
  model: string | null;
  toolName: string | null;
  toolInput: unknown | null;
  question: string | null;
  errorMessage: string | null;
  remoteUrl: string | null;
  lastPrompt: string | null;
  hookName: string | null;
  agentId: string | null;
  turnDurationMs: number | null;
  messageCount: number | null;
  stopReason: string | null;
  prUrl: string | null;
  customTitle: string | null;
  agentName: string | null;
  raw: unknown;
}

// --- Monitor types ---

export interface MonitorConfig {
  watchRoot: string;
  dbPath: string;
  idleThresholdMs: number;
  endedThresholdMs: number;
  pollIntervalMs: number;
}

export interface MonitorStats {
  filesWatched: number;
  sessionsByStatus: Record<SessionStatus, number>;
  totalTokensToday: number;
}
```

- [ ] **Step 7: Create shared constants**

Create `src/shared/constants.ts`:

```typescript
import type { SessionStatus } from './types.js';

export const DEFAULT_MONITOR_CONFIG = {
  watchRoot: `${process.env.HOME}/.claude/projects`,
  dbPath: './sentinel.db',
  idleThresholdMs: 60_000,
  endedThresholdMs: 300_000,
  pollIntervalMs: 5_000,
} as const;

export const SESSION_STATUSES: readonly SessionStatus[] = [
  'starting', 'active', 'waiting', 'idle', 'ended', 'error',
] as const;

// JSONL event types to skip during parsing (high volume, low value)
export const SKIP_EVENT_SUBTYPES = new Set([
  'hook_progress',
]);

// Tool names that trigger waiting status
export const QUESTION_TOOL_NAMES = new Set([
  'AskUserQuestion',
  'AskFollowupQuestions',
]);

// Hook names that indicate run start type
export const RUN_START_HOOKS: Record<string, string> = {
  'SessionStart:startup': 'startup',
  'SessionStart:resume': 'resume',
  'SessionStart:compact': 'compact',
};
```

- [ ] **Step 8: Create shared events**

Create `src/shared/events.ts`:

```typescript
import type { Session, Run, SubAgent, ParsedEvent } from './types.js';

export interface MonitorEvents {
  'session:discovered': { session: Session };
  'session:status_changed': { session: Session; from: string; to: string };
  'session:question_detected': { session: Session; question: string };
  'session:activity': { session: Session; event: ParsedEvent };
  'run:started': { session: Session; run: Run };
  'run:ended': { session: Session; run: Run };
  'subagent:detected': { session: Session; subagent: SubAgent };
  'monitor:error': { error: Error; context: string };
}

export type MonitorEventName = keyof MonitorEvents;
```

- [ ] **Step 9: Install dependencies and verify build**

Run:
```bash
cd /home/blasi/session-sentinel && npm install
```

Expected: dependencies installed without errors.

Run:
```bash
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 10: Commit scaffolding**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/shared/
git commit -m "chore(infra): scaffold TypeScript project with dependencies"
```

---

## Task 2: SQLite Schema and Connection

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/connection.ts`
- Create: `tests/unit/connection.test.ts`

- [ ] **Step 1: Write the failing test for DB initialization**

Create `tests/unit/connection.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/db/connection.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('initDb', () => {
  let dbPath: string;

  afterEach(() => {
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('creates all tables', () => {
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);
    const db = initDb(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('runs');
    expect(tableNames).toContain('sub_agents');
    expect(tableNames).toContain('session_events');
    expect(tableNames).toContain('transcript_cache');
    expect(tableNames).toContain('notifications');
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('_meta');
  });

  it('sets schema version to 1', () => {
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);
    const db = initDb(dbPath);

    const row = db
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;

    expect(row?.value).toBe('1');
  });

  it('is idempotent — calling twice does not error', () => {
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);
    initDb(dbPath);
    closeDb();
    const db = initDb(dbPath);

    const row = db
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;

    expect(row?.value).toBe('1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/connection.test.ts`

Expected: FAIL — module `../../src/db/connection.js` not found.

- [ ] **Step 3: Create schema.sql**

Create `src/db/schema.sql`:

```sql
-- Session Sentinel schema v1

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,
  claude_session_id   TEXT UNIQUE NOT NULL,
  label               TEXT,
  status              TEXT NOT NULL DEFAULT 'starting',
  type                TEXT NOT NULL DEFAULT 'unmanaged',
  owner               TEXT,
  cwd                 TEXT,
  project_name        TEXT,
  model               TEXT,
  effort              TEXT,
  git_branch          TEXT,
  git_remote          TEXT,
  jsonl_path          TEXT NOT NULL,
  pid                 INTEGER,
  remote_url          TEXT,
  last_entrypoint     TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  pending_question    TEXT,
  last_output         TEXT,
  error_message       TEXT,
  can_resume          INTEGER NOT NULL DEFAULT 1,
  parent_session_id   TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name);
CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner);

CREATE TABLE IF NOT EXISTS runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  run_number          INTEGER NOT NULL,
  jsonl_path          TEXT NOT NULL,
  start_type          TEXT NOT NULL DEFAULT 'startup',
  type_during_run     TEXT NOT NULL DEFAULT 'unmanaged',
  owner_during_run    TEXT,
  model               TEXT,
  effort              TEXT,
  remote_url          TEXT,
  sentinel_managed    INTEGER NOT NULL DEFAULT 0,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);

CREATE TABLE IF NOT EXISTS sub_agents (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  pattern             TEXT NOT NULL,
  agent_type          TEXT,
  description         TEXT,
  jsonl_path          TEXT NOT NULL,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  started_at          TEXT,
  ended_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_subagents_session ON sub_agents(session_id);

CREATE TABLE IF NOT EXISTS session_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  event_type          TEXT NOT NULL,
  from_status         TEXT,
  to_status           TEXT,
  actor               TEXT NOT NULL DEFAULT 'monitor',
  detail              TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON session_events(event_type);

CREATE TABLE IF NOT EXISTS transcript_cache (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  run_id              INTEGER REFERENCES runs(id),
  turn                INTEGER NOT NULL,
  role                TEXT NOT NULL,
  content             TEXT NOT NULL,
  tools_used          TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_create_tokens INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_cache(session_id);

CREATE TABLE IF NOT EXISTS notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  channel             TEXT NOT NULL,
  destination         TEXT NOT NULL,
  trigger             TEXT NOT NULL,
  payload             TEXT,
  delivered           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_session ON notifications(session_id);

CREATE TABLE IF NOT EXISTS projects (
  name                TEXT PRIMARY KEY,
  cwd                 TEXT UNIQUE NOT NULL,
  discovered_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_session_at     TEXT,
  session_count       INTEGER NOT NULL DEFAULT 0,
  alias               TEXT
);
```

- [ ] **Step 4: Create connection.ts**

Create `src/db/connection.ts`:

```typescript
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'schema.sql',
  );
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/connection.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.sql src/db/connection.ts tests/unit/connection.test.ts
git commit -m "feat(db): implement SQLite schema and connection"
```

---

## Task 3: SQLite Query Layer

**Files:**
- Create: `src/db/queries.ts`
- Create: `tests/unit/queries.test.ts`

- [ ] **Step 1: Write failing tests for session queries**

Create `tests/unit/queries.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('queries', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);
    initDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  describe('sessions', () => {
    it('upsertSession creates a new session with generated id', () => {
      const session = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
        cwd: '/home/user/project',
        project_name: 'project',
      });

      expect(session.id).toMatch(/^ss-/);
      expect(session.claude_session_id).toBe('uuid-1');
      expect(session.status).toBe('starting');
      expect(session.type).toBe('unmanaged');
      expect(session.cwd).toBe('/home/user/project');
    });

    it('upsertSession updates existing session by claude_session_id', () => {
      queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
      });

      const updated = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
        model: 'claude-opus-4-6',
        git_branch: 'main',
      });

      expect(updated.model).toBe('claude-opus-4-6');
      expect(updated.git_branch).toBe('main');
    });

    it('getSession returns null for unknown id', () => {
      expect(queries.getSession('nonexistent')).toBeNull();
    });

    it('getSessionByClaudeId finds session', () => {
      const created = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
      });

      const found = queries.getSessionByClaudeId('uuid-1');
      expect(found?.id).toBe(created.id);
    });

    it('updateSessionStatus changes status and logs event', () => {
      const session = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
      });

      queries.updateSessionStatus(session.id, 'active');

      const updated = queries.getSession(session.id);
      expect(updated?.status).toBe('active');

      const events = queries.listEvents({ session_id: session.id });
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('status_change');
      expect(events[0].from_status).toBe('starting');
      expect(events[0].to_status).toBe('active');
    });

    it('updateSessionTokens accumulates tokens', () => {
      const session = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
      });

      queries.updateSessionTokens(session.id, {
        input_tokens: 3,
        output_tokens: 100,
        cache_read_tokens: 5000,
        cache_create_tokens: 200,
      });

      queries.updateSessionTokens(session.id, {
        output_tokens: 50,
        cache_read_tokens: 3000,
      });

      const updated = queries.getSession(session.id);
      expect(updated?.input_tokens).toBe(3);
      expect(updated?.output_tokens).toBe(150);
      expect(updated?.cache_read_tokens).toBe(8000);
      expect(updated?.cache_create_tokens).toBe(200);
    });

    it('listSessions filters by status', () => {
      queries.upsertSession({ claude_session_id: 'a', jsonl_path: '/a.jsonl' });
      const b = queries.upsertSession({ claude_session_id: 'b', jsonl_path: '/b.jsonl' });
      queries.updateSessionStatus(b.id, 'active');

      const active = queries.listSessions({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].claude_session_id).toBe('b');
    });

    it('listSessions filters active (non-ended, non-error)', () => {
      queries.upsertSession({ claude_session_id: 'a', jsonl_path: '/a.jsonl' });
      const b = queries.upsertSession({ claude_session_id: 'b', jsonl_path: '/b.jsonl' });
      queries.updateSessionStatus(b.id, 'ended');

      const active = queries.listSessions({ active: true });
      expect(active).toHaveLength(1);
      expect(active[0].claude_session_id).toBe('a');
    });
  });

  describe('runs', () => {
    it('insertRun creates run with sequential run_number', () => {
      const session = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
      });

      const run1 = queries.insertRun({
        session_id: session.id,
        jsonl_path: '/path/to/uuid-1.jsonl',
        start_type: 'startup',
      });
      expect(run1.run_number).toBe(1);

      const run2 = queries.insertRun({
        session_id: session.id,
        jsonl_path: '/path/to/uuid-1.jsonl',
        start_type: 'resume',
      });
      expect(run2.run_number).toBe(2);
    });

    it('getCurrentRun returns the latest run', () => {
      const session = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
      });

      queries.insertRun({
        session_id: session.id,
        jsonl_path: '/path/to/uuid-1.jsonl',
        start_type: 'startup',
      });

      const run2 = queries.insertRun({
        session_id: session.id,
        jsonl_path: '/path/to/uuid-1.jsonl',
        start_type: 'resume',
      });

      const current = queries.getCurrentRun(session.id);
      expect(current?.id).toBe(run2.id);
      expect(current?.run_number).toBe(2);
    });

    it('endRun sets ended_at', () => {
      const session = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
      });

      const run = queries.insertRun({
        session_id: session.id,
        jsonl_path: '/path/to/uuid-1.jsonl',
        start_type: 'startup',
      });

      queries.endRun(run.id);

      const ended = queries.getCurrentRun(session.id);
      expect(ended?.ended_at).toBeTruthy();
    });
  });

  describe('sub_agents', () => {
    it('upsertSubAgent creates and retrieves sub-agent', () => {
      const session = queries.upsertSession({
        claude_session_id: 'uuid-1',
        jsonl_path: '/path/to/uuid-1.jsonl',
      });

      queries.upsertSubAgent({
        id: 'aeb3897ee3267e12c',
        session_id: session.id,
        pattern: 'regular',
        jsonl_path: '/path/to/agent-aeb3897ee3267e12c.jsonl',
        agent_type: 'Explore',
        description: 'Research task',
      });

      const agents = queries.getSubAgents(session.id);
      expect(agents).toHaveLength(1);
      expect(agents[0].agent_type).toBe('Explore');
      expect(agents[0].pattern).toBe('regular');
    });
  });

  describe('projects', () => {
    it('upsertProject creates and increments session_count', () => {
      queries.upsertProject('my-project', '/home/user/my-project');
      queries.upsertProject('my-project', '/home/user/my-project');

      const db = (await import('../../src/db/connection.js')).getDb();
      const row = db
        .prepare("SELECT session_count FROM projects WHERE name = ?")
        .get('my-project') as { session_count: number };

      expect(row.session_count).toBe(2);
    });
  });

  describe('events', () => {
    it('listEvents filters by session_id', () => {
      const s1 = queries.upsertSession({ claude_session_id: 'a', jsonl_path: '/a.jsonl' });
      const s2 = queries.upsertSession({ claude_session_id: 'b', jsonl_path: '/b.jsonl' });

      queries.updateSessionStatus(s1.id, 'active');
      queries.updateSessionStatus(s2.id, 'active');
      queries.updateSessionStatus(s2.id, 'waiting');

      const s2Events = queries.listEvents({ session_id: s2.id });
      expect(s2Events).toHaveLength(2);
    });

    it('listEvents respects limit', () => {
      const session = queries.upsertSession({ claude_session_id: 'a', jsonl_path: '/a.jsonl' });
      queries.updateSessionStatus(session.id, 'active');
      queries.updateSessionStatus(session.id, 'waiting');
      queries.updateSessionStatus(session.id, 'active');

      const limited = queries.listEvents({ limit: 2 });
      expect(limited).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/queries.test.ts`

Expected: FAIL — module `../../src/db/queries.js` not found.

- [ ] **Step 3: Implement queries.ts**

Create `src/db/queries.ts`:

```typescript
import { ulid } from 'ulid';
import { getDb } from './connection.js';
import type {
  Session, SessionUpsert, SessionFilters, SessionStatus,
  Run, RunInsert,
  SubAgent, SubAgentUpsert,
  SessionEvent, EventInsert, EventFilters,
  TranscriptEntry, TranscriptInsert,
  TokenDelta,
} from '../shared/types.js';

// --- Sessions ---

export function upsertSession(data: SessionUpsert): Session {
  const db = getDb();

  const existing = db
    .prepare('SELECT id, status FROM sessions WHERE claude_session_id = ?')
    .get(data.claude_session_id) as { id: string; status: string } | undefined;

  if (existing) {
    const sets: string[] = ["updated_at = datetime('now')"];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (key === 'claude_session_id' || key === 'jsonl_path' || value === undefined) continue;
      sets.push(`${key} = ?`);
      params.push(value);
    }

    params.push(existing.id);
    db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(existing.id) as Session;
  }

  const id = `ss-${ulid()}`;
  const columns = ['id', 'claude_session_id', 'jsonl_path'];
  const placeholders = ['?', '?', '?'];
  const params: unknown[] = [id, data.claude_session_id, data.jsonl_path];

  for (const [key, value] of Object.entries(data)) {
    if (key === 'claude_session_id' || key === 'jsonl_path' || value === undefined) continue;
    columns.push(key);
    placeholders.push('?');
    params.push(value);
  }

  db.prepare(
    `INSERT INTO sessions (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
  ).run(...params);

  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session;
}

export function getSession(id: string): Session | null {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | null;
}

export function getSessionByClaudeId(claudeId: string): Session | null {
  return getDb()
    .prepare('SELECT * FROM sessions WHERE claude_session_id = ?')
    .get(claudeId) as Session | null;
}

export function listSessions(filters: SessionFilters = {}): Session[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.type) {
    conditions.push('type = ?');
    params.push(filters.type);
  }
  if (filters.owner) {
    conditions.push('owner = ?');
    params.push(filters.owner);
  }
  if (filters.project_name) {
    conditions.push('project_name = ?');
    params.push(filters.project_name);
  }
  if (filters.active) {
    conditions.push("status NOT IN ('ended', 'error')");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ? `LIMIT ${filters.limit}` : '';

  return getDb()
    .prepare(`SELECT * FROM sessions ${where} ORDER BY updated_at DESC ${limit}`)
    .all(...params) as Session[];
}

export function updateSessionStatus(
  id: string,
  newStatus: SessionStatus,
  detail?: object,
): void {
  const db = getDb();
  const current = db.prepare('SELECT status FROM sessions WHERE id = ?').get(id) as
    | { status: string }
    | undefined;

  if (!current) return;

  db.prepare(
    "UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(newStatus, id);

  if (newStatus === 'ended') {
    db.prepare(
      "UPDATE sessions SET ended_at = datetime('now') WHERE id = ?",
    ).run(id);
  }

  insertEvent({
    session_id: id,
    event_type: 'status_change',
    from_status: current.status,
    to_status: newStatus,
    actor: 'monitor',
    detail,
  });
}

export function updateSessionTokens(id: string, tokens: TokenDelta): void {
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (tokens.input_tokens) {
    sets.push('input_tokens = input_tokens + ?');
    params.push(tokens.input_tokens);
  }
  if (tokens.output_tokens) {
    sets.push('output_tokens = output_tokens + ?');
    params.push(tokens.output_tokens);
  }
  if (tokens.cache_read_tokens) {
    sets.push('cache_read_tokens = cache_read_tokens + ?');
    params.push(tokens.cache_read_tokens);
  }
  if (tokens.cache_create_tokens) {
    sets.push('cache_create_tokens = cache_create_tokens + ?');
    params.push(tokens.cache_create_tokens);
  }

  params.push(id);
  getDb().prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// --- Runs ---

export function insertRun(data: RunInsert): Run {
  const db = getDb();

  const maxRun = db
    .prepare('SELECT COALESCE(MAX(run_number), 0) as max FROM runs WHERE session_id = ?')
    .get(data.session_id) as { max: number };

  const runNumber = maxRun.max + 1;

  const result = db.prepare(`
    INSERT INTO runs (session_id, run_number, jsonl_path, start_type, type_during_run, owner_during_run, model, effort, remote_url, sentinel_managed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.session_id,
    runNumber,
    data.jsonl_path,
    data.start_type,
    data.type_during_run ?? 'unmanaged',
    data.owner_during_run ?? null,
    data.model ?? null,
    data.effort ?? null,
    data.remote_url ?? null,
    data.sentinel_managed ? 1 : 0,
  );

  return db.prepare('SELECT * FROM runs WHERE id = ?').get(result.lastInsertRowid) as Run;
}

export function getCurrentRun(sessionId: string): Run | null {
  return getDb()
    .prepare('SELECT * FROM runs WHERE session_id = ? ORDER BY run_number DESC LIMIT 1')
    .get(sessionId) as Run | null;
}

export function updateRunTokens(runId: number, tokens: TokenDelta): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (tokens.input_tokens) {
    sets.push('input_tokens = input_tokens + ?');
    params.push(tokens.input_tokens);
  }
  if (tokens.output_tokens) {
    sets.push('output_tokens = output_tokens + ?');
    params.push(tokens.output_tokens);
  }
  if (tokens.cache_read_tokens) {
    sets.push('cache_read_tokens = cache_read_tokens + ?');
    params.push(tokens.cache_read_tokens);
  }
  if (tokens.cache_create_tokens) {
    sets.push('cache_create_tokens = cache_create_tokens + ?');
    params.push(tokens.cache_create_tokens);
  }

  if (sets.length === 0) return;

  params.push(runId);
  getDb().prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function endRun(runId: number): void {
  getDb()
    .prepare("UPDATE runs SET ended_at = datetime('now') WHERE id = ?")
    .run(runId);
}

// --- Sub-agents ---

export function upsertSubAgent(data: SubAgentUpsert): void {
  getDb().prepare(`
    INSERT INTO sub_agents (id, session_id, pattern, jsonl_path, agent_type, description)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      agent_type = COALESCE(excluded.agent_type, sub_agents.agent_type),
      description = COALESCE(excluded.description, sub_agents.description)
  `).run(
    data.id,
    data.session_id,
    data.pattern,
    data.jsonl_path,
    data.agent_type ?? null,
    data.description ?? null,
  );
}

export function getSubAgents(sessionId: string): SubAgent[] {
  return getDb()
    .prepare('SELECT * FROM sub_agents WHERE session_id = ? ORDER BY started_at')
    .all(sessionId) as SubAgent[];
}

// --- Events ---

export function insertEvent(data: EventInsert): void {
  getDb().prepare(`
    INSERT INTO session_events (session_id, event_type, from_status, to_status, actor, detail)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.session_id,
    data.event_type,
    data.from_status ?? null,
    data.to_status ?? null,
    data.actor ?? 'monitor',
    data.detail ? JSON.stringify(data.detail) : null,
  );
}

export function listEvents(filters: EventFilters = {}): SessionEvent[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.session_id) {
    conditions.push('session_id = ?');
    params.push(filters.session_id);
  }
  if (filters.event_type) {
    conditions.push('event_type = ?');
    params.push(filters.event_type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ? `LIMIT ${filters.limit}` : '';

  return getDb()
    .prepare(`SELECT * FROM session_events ${where} ORDER BY created_at DESC ${limit}`)
    .all(...params) as SessionEvent[];
}

// --- Transcript ---

export function insertTranscriptEntry(data: TranscriptInsert): void {
  getDb().prepare(`
    INSERT INTO transcript_cache (session_id, run_id, turn, role, content, tools_used, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.session_id,
    data.run_id ?? null,
    data.turn,
    data.role,
    data.content,
    data.tools_used ? JSON.stringify(data.tools_used) : null,
    data.input_tokens ?? 0,
    data.output_tokens ?? 0,
    data.cache_read_tokens ?? 0,
    data.cache_create_tokens ?? 0,
  );
}

// --- Projects ---

export function upsertProject(name: string, cwd: string): void {
  getDb().prepare(`
    INSERT INTO projects (name, cwd, session_count)
    VALUES (?, ?, 1)
    ON CONFLICT(name) DO UPDATE SET
      session_count = projects.session_count + 1,
      last_session_at = datetime('now')
  `).run(name, cwd);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/queries.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts tests/unit/queries.test.ts
git commit -m "feat(db): implement typed query layer for all tables"
```

---

## Task 4: JSONL Test Fixtures

**Files:**
- Create: `sandbox/fixtures/session-startup.jsonl`
- Create: `sandbox/fixtures/session-with-question.jsonl`
- Create: `sandbox/fixtures/session-with-resume.jsonl`
- Create: `sandbox/fixtures/session-with-error.jsonl`
- Create: `sandbox/fixtures/session-with-subagent/` (directory with sub-agent files)
- Create: `sandbox/fixtures/session-with-bridge.jsonl`

These fixtures are anonymized synthetic data based on the schemas documented in `docs/spikes/sprint0-jsonl-format.md`. Each fixture tests a specific scenario for the parser.

- [ ] **Step 1: Create startup session fixture**

Create `sandbox/fixtures/session-startup.jsonl`. Each line is a JSON object. This fixture covers: startup hooks → bridge_status → user prompt → assistant response with tool_use → user tool_result → assistant final → stop_hook_summary → turn_duration.

```jsonl
{"type":"progress","data":{"type":"hook_progress","hookEvent":"SessionStart","hookName":"SessionStart:startup","command":"python3 ~/.claude/hooks/tracker.py"},"timestamp":"2026-03-27T10:00:00.000Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","entrypoint":"cli","cwd":"/home/user/my-project","version":"2.1.85","uuid":"evt-001","parentUuid":null,"isSidechain":false,"userType":"external","gitBranch":"main"}
{"type":"progress","data":{"type":"hook_progress","hookEvent":"SessionStart","hookName":"SessionStart:startup","command":"~/.tmux/hooks/status.sh"},"timestamp":"2026-03-27T10:00:00.100Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","entrypoint":"cli","cwd":"/home/user/my-project","version":"2.1.85","uuid":"evt-002","parentUuid":null,"isSidechain":false,"userType":"external","gitBranch":"main"}
{"type":"system","subtype":"bridge_status","content":"/remote-control is active. Code in CLI or at https://claude.ai/code/session_test001","url":"https://claude.ai/code/session_test001","timestamp":"2026-03-27T10:00:01.000Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","entrypoint":"cli","cwd":"/home/user/my-project","uuid":"evt-003","parentUuid":null,"isSidechain":false,"userType":"external","gitBranch":"main"}
{"type":"user","message":{"role":"user","content":"Read the README and summarize it"},"timestamp":"2026-03-27T10:00:05.000Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","entrypoint":"cli","cwd":"/home/user/my-project","uuid":"evt-004","parentUuid":null,"isSidechain":false,"userType":"external","slug":"test-startup-session","gitBranch":"main","promptId":"prompt-001"}
{"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_001","type":"message","role":"assistant","content":[{"type":"text","text":"I'll read the README for you."},{"type":"tool_use","id":"toolu_001","name":"Read","input":{"file_path":"/home/user/my-project/README.md"}}],"stop_reason":"tool_use","usage":{"input_tokens":5,"output_tokens":30,"cache_read_input_tokens":12000,"cache_creation_input_tokens":500}},"timestamp":"2026-03-27T10:00:08.000Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","entrypoint":"cli","cwd":"/home/user/my-project","uuid":"evt-005","parentUuid":"evt-004","isSidechain":false,"slug":"test-startup-session","gitBranch":"main"}
{"type":"user","message":{"role":"user","content":"# My Project\nThis is a test project."},"toolUseResult":true,"sourceToolUseID":"toolu_001","timestamp":"2026-03-27T10:00:08.500Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","entrypoint":"cli","cwd":"/home/user/my-project","uuid":"evt-006","parentUuid":"evt-005","isSidechain":false,"slug":"test-startup-session","gitBranch":"main"}
{"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_002","type":"message","role":"assistant","content":[{"type":"text","text":"The README describes a test project."}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":20,"cache_read_input_tokens":15000,"cache_creation_input_tokens":100}},"timestamp":"2026-03-27T10:00:12.000Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","entrypoint":"cli","cwd":"/home/user/my-project","uuid":"evt-007","parentUuid":"evt-006","isSidechain":false,"slug":"test-startup-session","gitBranch":"main"}
{"type":"system","subtype":"stop_hook_summary","hookCount":2,"hookInfos":[{"command":"python3 tracker.py","durationMs":50}],"hookErrors":[],"timestamp":"2026-03-27T10:00:12.500Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","uuid":"evt-008","isSidechain":false}
{"type":"system","subtype":"turn_duration","durationMs":7500,"messageCount":4,"timestamp":"2026-03-27T10:00:12.600Z","sessionId":"aaaa1111-0000-0000-0000-000000000001","uuid":"evt-009","isSidechain":false}
```

- [ ] **Step 2: Create question (waiting) fixture**

Create `sandbox/fixtures/session-with-question.jsonl`:

```jsonl
{"type":"user","message":{"role":"user","content":"Deploy the app"},"timestamp":"2026-03-27T11:00:00.000Z","sessionId":"bbbb2222-0000-0000-0000-000000000002","entrypoint":"cli","cwd":"/home/user/app","uuid":"evt-101","parentUuid":null,"isSidechain":false,"slug":"test-question-session","gitBranch":"feat/deploy","promptId":"prompt-101"}
{"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_101","type":"message","role":"assistant","content":[{"type":"text","text":"I need to confirm the deployment target."},{"type":"tool_use","id":"toolu_101","name":"AskUserQuestion","input":{"questions":[{"question":"Which environment should I deploy to?","header":"Deploy Target","options":[{"label":"staging","description":"Deploy to staging"},{"label":"production","description":"Deploy to production"}],"multiSelect":false}]}}],"stop_reason":"tool_use","usage":{"input_tokens":3,"output_tokens":45,"cache_read_input_tokens":8000,"cache_creation_input_tokens":300}},"timestamp":"2026-03-27T11:00:05.000Z","sessionId":"bbbb2222-0000-0000-0000-000000000002","entrypoint":"cli","cwd":"/home/user/app","uuid":"evt-102","parentUuid":"evt-101","isSidechain":false,"slug":"test-question-session","gitBranch":"feat/deploy"}
```

- [ ] **Step 3: Create resume fixture**

Create `sandbox/fixtures/session-with-resume.jsonl`:

```jsonl
{"type":"progress","data":{"type":"hook_progress","hookEvent":"SessionStart","hookName":"SessionStart:startup","command":"tracker.py"},"timestamp":"2026-03-27T08:00:00.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","entrypoint":"cli","cwd":"/home/user/project","uuid":"evt-201","parentUuid":null,"isSidechain":false,"gitBranch":"main"}
{"type":"system","subtype":"bridge_status","url":"https://claude.ai/code/session_run1","timestamp":"2026-03-27T08:00:01.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","uuid":"evt-202","isSidechain":false}
{"type":"user","message":{"role":"user","content":"Start the refactor"},"timestamp":"2026-03-27T08:00:05.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","entrypoint":"cli","uuid":"evt-203","parentUuid":null,"isSidechain":false,"slug":"test-resume-session","gitBranch":"main","promptId":"prompt-201"}
{"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_201","type":"message","role":"assistant","content":[{"type":"text","text":"Starting the refactor."}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":10,"cache_read_input_tokens":5000,"cache_creation_input_tokens":200}},"timestamp":"2026-03-27T08:05:00.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","uuid":"evt-204","parentUuid":"evt-203","isSidechain":false,"slug":"test-resume-session","gitBranch":"main"}
{"type":"system","subtype":"stop_hook_summary","hookCount":1,"hookInfos":[],"hookErrors":[],"timestamp":"2026-03-27T08:05:01.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","uuid":"evt-205","isSidechain":false}
{"type":"system","subtype":"turn_duration","durationMs":296000,"messageCount":10,"timestamp":"2026-03-27T08:05:01.100Z","sessionId":"cccc3333-0000-0000-0000-000000000003","uuid":"evt-206","isSidechain":false}
{"type":"last-prompt","lastPrompt":"Start the refactor","sessionId":"cccc3333-0000-0000-0000-000000000003"}
{"type":"progress","data":{"type":"hook_progress","hookEvent":"SessionStart","hookName":"SessionStart:resume","command":"tracker.py"},"timestamp":"2026-03-27T12:00:00.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","entrypoint":"cli","cwd":"/home/user/project","uuid":"evt-207","parentUuid":null,"isSidechain":false,"gitBranch":"main"}
{"type":"system","subtype":"bridge_status","url":"https://claude.ai/code/session_run2","timestamp":"2026-03-27T12:00:01.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","uuid":"evt-208","isSidechain":false}
{"type":"user","message":{"role":"user","content":"Continue the refactor"},"timestamp":"2026-03-27T12:00:05.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","entrypoint":"cli","uuid":"evt-209","parentUuid":null,"isSidechain":false,"slug":"test-resume-session","gitBranch":"main","promptId":"prompt-202"}
{"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_202","type":"message","role":"assistant","content":[{"type":"text","text":"Continuing from where we left off."}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":15,"cache_read_input_tokens":20000,"cache_creation_input_tokens":100}},"timestamp":"2026-03-27T12:05:00.000Z","sessionId":"cccc3333-0000-0000-0000-000000000003","uuid":"evt-210","parentUuid":"evt-209","isSidechain":false,"slug":"test-resume-session","gitBranch":"main"}
```

- [ ] **Step 4: Create error fixture**

Create `sandbox/fixtures/session-with-error.jsonl`:

```jsonl
{"type":"user","message":{"role":"user","content":"Generate report"},"timestamp":"2026-03-27T14:00:00.000Z","sessionId":"dddd4444-0000-0000-0000-000000000004","entrypoint":"cli","cwd":"/home/user/reports","uuid":"evt-301","parentUuid":null,"isSidechain":false,"slug":"test-error-session","gitBranch":"main","promptId":"prompt-301"}
{"type":"system","subtype":"api_error","level":"error","error":{"status":529,"requestID":"req_001","error":{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}},"retryInMs":500,"retryAttempt":1,"maxRetries":10,"timestamp":"2026-03-27T14:00:05.000Z","sessionId":"dddd4444-0000-0000-0000-000000000004","uuid":"evt-302","isSidechain":false}
{"type":"system","subtype":"api_error","level":"error","error":{"status":529,"requestID":"req_002","error":{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}},"retryInMs":1000,"retryAttempt":2,"maxRetries":10,"timestamp":"2026-03-27T14:00:06.000Z","sessionId":"dddd4444-0000-0000-0000-000000000004","uuid":"evt-303","isSidechain":false}
{"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_301","type":"message","role":"assistant","content":[{"type":"text","text":"Here is the report."}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":20,"cache_read_input_tokens":5000,"cache_creation_input_tokens":100}},"timestamp":"2026-03-27T14:00:10.000Z","sessionId":"dddd4444-0000-0000-0000-000000000004","uuid":"evt-304","parentUuid":"evt-301","isSidechain":false,"slug":"test-error-session","gitBranch":"main"}
```

- [ ] **Step 5: Create sub-agent fixture directory**

Create directory and files for a session that spawns a sub-agent.

Create `sandbox/fixtures/subagent-parent.jsonl`:

```jsonl
{"type":"user","message":{"role":"user","content":"Explore the codebase"},"timestamp":"2026-03-27T15:00:00.000Z","sessionId":"eeee5555-0000-0000-0000-000000000005","entrypoint":"cli","cwd":"/home/user/codebase","uuid":"evt-401","parentUuid":null,"isSidechain":false,"slug":"test-subagent-session","gitBranch":"main","promptId":"prompt-401"}
{"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_401","type":"message","role":"assistant","content":[{"type":"text","text":"I'll dispatch an agent to explore."},{"type":"tool_use","id":"toolu_401","name":"Agent","input":{"description":"Explore src/ directory","subagent_type":"Explore","prompt":"List all files in src/"}}],"stop_reason":"tool_use","usage":{"input_tokens":3,"output_tokens":40,"cache_read_input_tokens":10000,"cache_creation_input_tokens":300}},"timestamp":"2026-03-27T15:00:05.000Z","sessionId":"eeee5555-0000-0000-0000-000000000005","uuid":"evt-402","parentUuid":"evt-401","isSidechain":false,"slug":"test-subagent-session","gitBranch":"main"}
{"type":"progress","data":{"type":"agent_progress","agentId":"a1234567890abcdef","prompt":"List all files in src/","message":{"type":"user","message":{"role":"user","content":"exploring..."}}},"parentToolUseID":"toolu_401","timestamp":"2026-03-27T15:00:10.000Z","sessionId":"eeee5555-0000-0000-0000-000000000005","uuid":"evt-403","isSidechain":false}
```

Create `sandbox/fixtures/eeee5555-0000-0000-0000-000000000005/subagents/agent-a1234567890abcdef.meta.json`:

```json
{"agentType": "Explore", "description": "Explore src/ directory"}
```

Create `sandbox/fixtures/eeee5555-0000-0000-0000-000000000005/subagents/agent-a1234567890abcdef.jsonl`:

```jsonl
{"type":"user","message":{"role":"user","content":"List all files in src/"},"timestamp":"2026-03-27T15:00:06.000Z","sessionId":"eeee5555-0000-0000-0000-000000000005","agentId":"a1234567890abcdef","uuid":"evt-sa-001","parentUuid":null,"isSidechain":true,"entrypoint":"cli","cwd":"/home/user/codebase","gitBranch":"main"}
{"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_sa_001","type":"message","role":"assistant","content":[{"type":"text","text":"Found 5 files in src/"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":15,"cache_read_input_tokens":3000,"cache_creation_input_tokens":50}},"timestamp":"2026-03-27T15:00:08.000Z","sessionId":"eeee5555-0000-0000-0000-000000000005","agentId":"a1234567890abcdef","uuid":"evt-sa-002","parentUuid":"evt-sa-001","isSidechain":true,"entrypoint":"cli","cwd":"/home/user/codebase","gitBranch":"main"}
```

- [ ] **Step 6: Create bridge_status fixture**

Already covered in `session-startup.jsonl` (has bridge_status event). No separate file needed.

- [ ] **Step 7: Commit fixtures**

```bash
git add sandbox/fixtures/
git commit -m "test(monitor): add JSONL test fixtures for all scenarios"
```

---

## Task 5: JSONL Parser

**Files:**
- Create: `src/monitor/parser.ts`
- Create: `tests/unit/parser.test.ts`

- [ ] **Step 1: Write failing tests for parser**

Create `tests/unit/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseLine } from '../../src/monitor/parser.js';

describe('parseLine', () => {
  it('returns null for empty or invalid lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('{}')).toBeNull();
  });

  it('skips hook_progress events', () => {
    const line = JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Read' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    expect(parseLine(line)).toBeNull();
  });

  it('parses SessionStart hook_progress as progress:hook (not skipped)', () => {
    const line = JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
      cwd: '/home/user/project',
      gitBranch: 'main',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('progress:hook');
    expect(event?.hookName).toBe('SessionStart:startup');
    expect(event?.entrypoint).toBe('cli');
  });

  it('parses assistant text event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 3,
          output_tokens: 20,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 100,
        },
      },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      slug: 'my-session',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('assistant:text');
    expect(event?.model).toBe('claude-opus-4-6');
    expect(event?.tokens).toEqual({
      input_tokens: 3,
      output_tokens: 20,
      cache_read_tokens: 5000,
      cache_create_tokens: 100,
    });
    expect(event?.stopReason).toBe('end_turn');
    expect(event?.slug).toBe('my-session');
  });

  it('parses assistant tool_use event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading file' },
          { type: 'tool_use', id: 'toolu_001', name: 'Read', input: { file_path: '/README.md' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('assistant:tool_use');
    expect(event?.toolName).toBe('Read');
  });

  it('parses AskUserQuestion as question event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_001',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Which env?' }] },
        }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('assistant:tool_use');
    expect(event?.toolName).toBe('AskUserQuestion');
    expect(event?.question).toBe('Which env?');
  });

  it('parses assistant error event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        isApiErrorMessage: true,
        content: [{ type: 'text', text: 'Error occurred' }],
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('assistant:error');
    expect(event?.errorMessage).toBe('Error occurred');
  });

  it('parses user prompt (not tool result)', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Hello world' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      promptId: 'prompt-001',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('user:prompt');
  });

  it('parses user tool_result (not a real prompt)', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'file contents here' },
      toolUseResult: true,
      sourceToolUseID: 'toolu_001',
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('user:tool_result');
  });

  it('parses system:bridge_status', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'bridge_status',
      url: 'https://claude.ai/code/session_test',
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('system:bridge_status');
    expect(event?.remoteUrl).toBe('https://claude.ai/code/session_test');
  });

  it('parses system:api_error', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'api_error',
      error: { status: 529, error: { error: { message: 'Overloaded' } } },
      retryAttempt: 1,
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('system:api_error');
    expect(event?.errorMessage).toBe('Overloaded');
  });

  it('parses system:turn_duration', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'turn_duration',
      durationMs: 5000,
      messageCount: 4,
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('system:turn_duration');
    expect(event?.turnDurationMs).toBe(5000);
    expect(event?.messageCount).toBe(4);
  });

  it('parses last-prompt', () => {
    const line = JSON.stringify({
      type: 'last-prompt',
      lastPrompt: 'Do the thing',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('last_prompt');
    expect(event?.lastPrompt).toBe('Do the thing');
  });

  it('parses agent_progress', () => {
    const line = JSON.stringify({
      type: 'progress',
      data: { type: 'agent_progress', agentId: 'a1234567890abcdef', prompt: 'Explore files' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
    });
    const event = parseLine(line);
    expect(event?.type).toBe('progress:agent');
    expect(event?.agentId).toBe('a1234567890abcdef');
  });

  it('extracts common fields from all events', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'test' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'sdk-cli',
      cwd: '/home/user/project',
      gitBranch: 'feat/x',
      isSidechain: true,
      agentId: 'a123',
      promptId: 'p1',
    });
    const event = parseLine(line);
    expect(event?.sessionId).toBe('uuid-1');
    expect(event?.entrypoint).toBe('sdk-cli');
    expect(event?.cwd).toBe('/home/user/project');
    expect(event?.gitBranch).toBe('feat/x');
    expect(event?.isSidechain).toBe(true);
    expect(event?.agentId).toBe('a123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/parser.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement parser.ts**

Create `src/monitor/parser.ts`:

```typescript
import type { ParsedEvent, ParsedEventType, TokenDelta } from '../shared/types.js';
import { SKIP_EVENT_SUBTYPES, QUESTION_TOOL_NAMES } from '../shared/constants.js';

export function parseLine(line: string): ParsedEvent | null {
  if (!line.trim()) return null;

  let raw: any;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }

  if (!raw.type) return null;

  const rawType: string = raw.type;

  // Progress events — skip noise, keep SessionStart hooks and agent_progress
  if (rawType === 'progress' && raw.data) {
    const subtype: string = raw.data.type;

    if (subtype === 'hook_progress') {
      // Keep only SessionStart hooks (for run detection)
      if (raw.data.hookEvent !== 'SessionStart') return null;

      return makeEvent('progress:hook', raw, {
        hookName: raw.data.hookName ?? null,
      });
    }

    if (subtype === 'agent_progress') {
      return makeEvent('progress:agent', raw, {
        agentId: raw.data.agentId ?? null,
      });
    }

    // Skip other progress subtypes (query_update, search_results_received, waiting_for_task)
    return null;
  }

  // System events — dispatch by subtype
  if (rawType === 'system') {
    const subtype: string = raw.subtype;

    if (subtype === 'bridge_status') {
      return makeEvent('system:bridge_status', raw, {
        remoteUrl: raw.url ?? null,
      });
    }

    if (subtype === 'api_error') {
      const errorMsg = raw.error?.error?.error?.message
        ?? raw.error?.error?.message
        ?? raw.error?.message
        ?? 'Unknown API error';
      return makeEvent('system:api_error', raw, {
        errorMessage: errorMsg,
      });
    }

    if (subtype === 'turn_duration') {
      return makeEvent('system:turn_duration', raw, {
        turnDurationMs: raw.durationMs ?? null,
        messageCount: raw.messageCount ?? null,
      });
    }

    if (subtype === 'stop_hook_summary') {
      return makeEvent('system:stop_hook_summary', raw, {});
    }

    if (subtype === 'compact_boundary') {
      return makeEvent('system:compact_boundary', raw, {});
    }

    return null;
  }

  // Assistant events
  if (rawType === 'assistant') {
    const msg = raw.message;
    if (!msg) return null;

    // Error response
    if (msg.isApiErrorMessage) {
      const errorText = extractTextFromContent(msg.content);
      return makeEvent('assistant:error', raw, {
        errorMessage: errorText || 'API error',
        tokens: extractTokens(msg.usage),
        model: msg.model ?? null,
        stopReason: msg.stop_reason ?? null,
      });
    }

    // Tool use detection
    const toolUse = findToolUse(msg.content);
    if (toolUse) {
      const question = extractQuestion(toolUse);
      return makeEvent('assistant:tool_use', raw, {
        toolName: toolUse.name,
        toolInput: toolUse.input ?? null,
        question,
        tokens: extractTokens(msg.usage),
        model: msg.model ?? null,
        stopReason: msg.stop_reason ?? null,
      });
    }

    // Plain text response
    return makeEvent('assistant:text', raw, {
      tokens: extractTokens(msg.usage),
      model: msg.model ?? null,
      stopReason: msg.stop_reason ?? null,
    });
  }

  // User events
  if (rawType === 'user') {
    const isToolResult = !!raw.toolUseResult || !!raw.sourceToolUseID;
    return makeEvent(isToolResult ? 'user:tool_result' : 'user:prompt', raw, {});
  }

  // last-prompt
  if (rawType === 'last-prompt') {
    return makeEvent('last_prompt', raw, {
      lastPrompt: raw.lastPrompt ?? null,
    });
  }

  // pr-link
  if (rawType === 'pr-link') {
    return makeEvent('pr_link', raw, {
      prUrl: raw.prUrl ?? null,
    });
  }

  // custom-title
  if (rawType === 'custom-title') {
    return makeEvent('custom_title', raw, {
      customTitle: raw.customTitle ?? null,
    });
  }

  // agent-name
  if (rawType === 'agent-name') {
    return makeEvent('agent_name', raw, {
      agentName: raw.agentName ?? null,
    });
  }

  // Skip everything else (file-history-snapshot, queue-operation)
  return null;
}

function makeEvent(type: ParsedEventType, raw: any, extra: Partial<ParsedEvent>): ParsedEvent {
  return {
    type,
    raw_type: raw.type,
    timestamp: raw.timestamp ?? null,
    sessionId: raw.sessionId ?? null,
    entrypoint: raw.entrypoint ?? null,
    cwd: raw.cwd ?? null,
    gitBranch: raw.gitBranch ?? null,
    slug: raw.slug ?? null,
    isSidechain: raw.isSidechain ?? false,
    tokens: null,
    model: null,
    toolName: null,
    toolInput: null,
    question: null,
    errorMessage: null,
    remoteUrl: null,
    lastPrompt: null,
    hookName: null,
    agentId: raw.agentId ?? null,
    turnDurationMs: null,
    messageCount: null,
    stopReason: null,
    prUrl: null,
    customTitle: null,
    agentName: null,
    raw,
    ...extra,
  };
}

function extractTokens(usage: any): TokenDelta | null {
  if (!usage) return null;
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_create_tokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function findToolUse(content: any[]): any | null {
  if (!Array.isArray(content)) return null;
  return content.find((block: any) => block.type === 'tool_use') ?? null;
}

function extractQuestion(toolUse: any): string | null {
  if (!QUESTION_TOOL_NAMES.has(toolUse.name)) return null;

  const input = toolUse.input;
  if (!input) return null;

  return input.question
    ?? input.questions?.[0]?.question
    ?? input.text
    ?? null;
}

function extractTextFromContent(content: any[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/parser.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/parser.ts tests/unit/parser.test.ts
git commit -m "feat(monitor): implement JSONL parser and event classification"
```

---

## Task 6: Status State Machine

**Files:**
- Create: `src/monitor/state-machine.ts`
- Create: `tests/unit/state-machine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/state-machine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { transition } from '../../src/monitor/state-machine.js';
import type { ParsedEvent, SessionStatus } from '../../src/shared/types.js';

function makeEvent(overrides: Partial<ParsedEvent>): ParsedEvent {
  return {
    type: 'other',
    raw_type: 'unknown',
    timestamp: '2026-03-27T10:00:00Z',
    sessionId: null,
    entrypoint: null,
    cwd: null,
    gitBranch: null,
    slug: null,
    isSidechain: false,
    tokens: null,
    model: null,
    toolName: null,
    toolInput: null,
    question: null,
    errorMessage: null,
    remoteUrl: null,
    lastPrompt: null,
    hookName: null,
    agentId: null,
    turnDurationMs: null,
    messageCount: null,
    stopReason: null,
    prUrl: null,
    customTitle: null,
    agentName: null,
    raw: {},
    ...overrides,
  };
}

describe('transition', () => {
  it('starting → active on assistant:text', () => {
    const result = transition('starting', makeEvent({ type: 'assistant:text' }));
    expect(result).toBe('active');
  });

  it('starting → active on assistant:tool_use', () => {
    const result = transition('starting', makeEvent({ type: 'assistant:tool_use' }));
    expect(result).toBe('active');
  });

  it('active → waiting on AskUserQuestion', () => {
    const result = transition('active', makeEvent({
      type: 'assistant:tool_use',
      toolName: 'AskUserQuestion',
      question: 'Which env?',
    }));
    expect(result).toBe('waiting');
  });

  it('active stays active on non-question tool_use', () => {
    const result = transition('active', makeEvent({
      type: 'assistant:tool_use',
      toolName: 'Read',
    }));
    expect(result).toBeNull();
  });

  it('waiting → active on user:prompt', () => {
    const result = transition('waiting', makeEvent({ type: 'user:prompt' }));
    expect(result).toBe('active');
  });

  it('waiting stays waiting on user:tool_result', () => {
    const result = transition('waiting', makeEvent({ type: 'user:tool_result' }));
    expect(result).toBeNull();
  });

  it('idle → active on assistant event', () => {
    const result = transition('idle', makeEvent({ type: 'assistant:text' }));
    expect(result).toBe('active');
  });

  it('idle → active on user:prompt', () => {
    const result = transition('idle', makeEvent({ type: 'user:prompt' }));
    expect(result).toBe('active');
  });

  it('any → error on system:api_error', () => {
    for (const status of ['starting', 'active', 'waiting', 'idle'] as SessionStatus[]) {
      const result = transition(status, makeEvent({ type: 'system:api_error' }));
      expect(result).toBe('error');
    }
  });

  it('any → error on assistant:error', () => {
    const result = transition('active', makeEvent({ type: 'assistant:error' }));
    expect(result).toBe('error');
  });

  it('error → active on successful assistant event', () => {
    const result = transition('error', makeEvent({ type: 'assistant:text' }));
    expect(result).toBe('active');
  });

  it('ended → starting on progress:hook (resume)', () => {
    const result = transition('ended', makeEvent({
      type: 'progress:hook',
      hookName: 'SessionStart:resume',
    }));
    expect(result).toBe('starting');
  });

  it('ended stays ended on last_prompt', () => {
    const result = transition('ended', makeEvent({ type: 'last_prompt' }));
    expect(result).toBeNull();
  });

  it('returns null when no transition applies', () => {
    const result = transition('active', makeEvent({ type: 'system:turn_duration' }));
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/state-machine.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement state-machine.ts**

Create `src/monitor/state-machine.ts`:

```typescript
import type { SessionStatus, ParsedEvent } from '../shared/types.js';
import { QUESTION_TOOL_NAMES } from '../shared/constants.js';

/**
 * Pure function: given the current session status and a new parsed event,
 * returns the new status or null if no transition applies.
 */
export function transition(
  currentStatus: SessionStatus,
  event: ParsedEvent,
): SessionStatus | null {
  // Error events transition from any non-ended state
  if (event.type === 'system:api_error' || event.type === 'assistant:error') {
    if (currentStatus !== 'ended') return 'error';
    return null;
  }

  switch (currentStatus) {
    case 'starting':
      // starting → active when assistant produces output
      if (event.type === 'assistant:text' || event.type === 'assistant:tool_use') {
        return 'active';
      }
      return null;

    case 'active':
      // active → waiting when a question tool is used
      if (
        event.type === 'assistant:tool_use' &&
        event.toolName &&
        QUESTION_TOOL_NAMES.has(event.toolName)
      ) {
        return 'waiting';
      }
      return null;

    case 'waiting':
      // waiting → active when user responds (real prompt, not tool result)
      if (event.type === 'user:prompt') {
        return 'active';
      }
      return null;

    case 'idle':
      // idle → active on any meaningful activity
      if (
        event.type === 'assistant:text' ||
        event.type === 'assistant:tool_use' ||
        event.type === 'user:prompt'
      ) {
        return 'active';
      }
      return null;

    case 'error':
      // error → active on successful assistant response
      if (event.type === 'assistant:text' || event.type === 'assistant:tool_use') {
        return 'active';
      }
      return null;

    case 'ended':
      // ended → starting on resume (detected by SessionStart hook)
      if (event.type === 'progress:hook') {
        return 'starting';
      }
      // ended → starting on bridge_status (resume without hooks configured)
      if (event.type === 'system:bridge_status') {
        return 'starting';
      }
      return null;

    default:
      return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/state-machine.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/state-machine.ts tests/unit/state-machine.test.ts
git commit -m "feat(monitor): implement session status state machine"
```

---

## Task 7: Run Detector

**Files:**
- Create: `src/monitor/run-detector.ts`
- Create: `tests/unit/run-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/run-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RunDetector } from '../../src/monitor/run-detector.js';
import { parseLine } from '../../src/monitor/parser.js';
import fs from 'node:fs';
import path from 'node:path';

describe('RunDetector', () => {
  it('detects initial startup as run boundary', () => {
    const detector = new RunDetector();
    const line = JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    });
    const event = parseLine(line)!;
    const boundary = detector.checkBoundary(event);

    expect(boundary).not.toBeNull();
    expect(boundary?.startType).toBe('startup');
    expect(boundary?.entrypoint).toBe('cli');
  });

  it('detects resume hook as run boundary', () => {
    const detector = new RunDetector();

    // First startup
    const startup = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T08:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    }))!;
    detector.checkBoundary(startup);

    // Some events happen...
    detector.markEventSeen();

    // Resume hook
    const resume = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:resume' },
      timestamp: '2026-03-27T12:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    }))!;
    const boundary = detector.checkBoundary(resume);

    expect(boundary).not.toBeNull();
    expect(boundary?.startType).toBe('resume');
  });

  it('detects last-prompt followed by new event as run boundary', () => {
    const detector = new RunDetector();

    // Startup
    const startup = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T08:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    }))!;
    detector.checkBoundary(startup);
    detector.markEventSeen();

    // last-prompt
    const lastPrompt = parseLine(JSON.stringify({
      type: 'last-prompt',
      lastPrompt: 'some prompt',
      sessionId: 'uuid-1',
    }))!;
    detector.checkBoundary(lastPrompt);

    // New event after last-prompt
    const newEvent = parseLine(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'continue' },
      timestamp: '2026-03-27T12:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
      promptId: 'p1',
    }))!;
    const boundary = detector.checkBoundary(newEvent);

    expect(boundary).not.toBeNull();
    expect(boundary?.startType).toBe('resume');
  });

  it('detects entrypoint change for handoff', () => {
    const detector = new RunDetector();

    // Startup with sdk-cli
    const startup = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T08:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'sdk-cli',
    }))!;
    detector.checkBoundary(startup);
    detector.markEventSeen();

    // Resume with cli (user took over)
    const resume = parseLine(JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:resume' },
      timestamp: '2026-03-27T12:00:00Z',
      sessionId: 'uuid-1',
      entrypoint: 'cli',
    }))!;
    const boundary = detector.checkBoundary(resume);

    expect(boundary?.entrypoint).toBe('cli');
    expect(boundary?.previousEntrypoint).toBe('sdk-cli');
    expect(boundary?.isHandoff).toBe(true);
  });

  it('processes full resume fixture correctly', () => {
    const fixturePath = path.join(process.cwd(), 'sandbox/fixtures/session-with-resume.jsonl');
    const lines = fs.readFileSync(fixturePath, 'utf-8').trim().split('\n');

    const detector = new RunDetector();
    const boundaries: any[] = [];

    for (const line of lines) {
      const event = parseLine(line);
      if (!event) continue;
      const boundary = detector.checkBoundary(event);
      if (boundary) boundaries.push(boundary);
      detector.markEventSeen();
    }

    expect(boundaries).toHaveLength(2);
    expect(boundaries[0].startType).toBe('startup');
    expect(boundaries[1].startType).toBe('resume');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/run-detector.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement run-detector.ts**

Create `src/monitor/run-detector.ts`:

```typescript
import type { ParsedEvent, RunStartType } from '../shared/types.js';
import { RUN_START_HOOKS } from '../shared/constants.js';

export interface RunBoundary {
  startType: RunStartType;
  entrypoint: string | null;
  previousEntrypoint: string | null;
  isHandoff: boolean;
  timestamp: string | null;
  remoteUrl: string | null;
}

export class RunDetector {
  private eventsSeen = 0;
  private lastEntrypoint: string | null = null;
  private sawLastPrompt = false;
  private hasBridgeStatus = false;

  /**
   * Check if a parsed event marks a run boundary.
   * Call markEventSeen() after processing each event.
   */
  checkBoundary(event: ParsedEvent): RunBoundary | null {
    // Signal 1: SessionStart hook (primary, most reliable)
    if (event.type === 'progress:hook' && event.hookName) {
      const hookKey = event.hookName;
      const startType = RUN_START_HOOKS[hookKey] as RunStartType | undefined;

      if (startType) {
        const isNewRun = this.eventsSeen > 0;
        const previousEntrypoint = this.lastEntrypoint;
        const entrypoint = event.entrypoint;

        if (entrypoint) this.lastEntrypoint = entrypoint;
        this.sawLastPrompt = false;

        // Only report boundary if this is the first event or we've seen events before
        if (isNewRun || startType === 'startup') {
          return {
            startType: isNewRun ? startType : 'startup',
            entrypoint,
            previousEntrypoint: isNewRun ? previousEntrypoint : null,
            isHandoff: isNewRun && !!previousEntrypoint && !!entrypoint && previousEntrypoint !== entrypoint,
            timestamp: event.timestamp,
            remoteUrl: null,
          };
        }
      }
    }

    // Signal 2: bridge_status after existing bridge_status (new Remote URL = new run)
    if (event.type === 'system:bridge_status') {
      if (this.hasBridgeStatus && this.eventsSeen > 0) {
        const previousEntrypoint = this.lastEntrypoint;
        this.hasBridgeStatus = true;
        return {
          startType: 'resume',
          entrypoint: event.entrypoint,
          previousEntrypoint,
          isHandoff: false,
          timestamp: event.timestamp,
          remoteUrl: event.remoteUrl,
        };
      }
      this.hasBridgeStatus = true;
    }

    // Signal 3: last-prompt → next event = new run
    if (event.type === 'last_prompt') {
      this.sawLastPrompt = true;
      return null;
    }

    if (this.sawLastPrompt && event.type !== 'last_prompt') {
      this.sawLastPrompt = false;
      const previousEntrypoint = this.lastEntrypoint;
      if (event.entrypoint) this.lastEntrypoint = event.entrypoint;

      return {
        startType: 'resume',
        entrypoint: event.entrypoint,
        previousEntrypoint,
        isHandoff: !!previousEntrypoint && !!event.entrypoint && previousEntrypoint !== event.entrypoint,
        timestamp: event.timestamp,
        remoteUrl: null,
      };
    }

    // Track entrypoint from any event
    if (event.entrypoint && this.lastEntrypoint === null) {
      this.lastEntrypoint = event.entrypoint;
    }

    return null;
  }

  markEventSeen(): void {
    this.eventsSeen++;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/run-detector.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/run-detector.ts tests/unit/run-detector.test.ts
git commit -m "feat(monitor): implement run boundary and handoff detection"
```

---

## Task 8: Sub-agent Detector

**Files:**
- Create: `src/monitor/subagent-detector.ts`
- Create: `tests/unit/subagent-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/subagent-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  extractParentSessionId,
  parseAgentFilename,
  readMetaFile,
} from '../../src/monitor/subagent-detector.js';
import path from 'node:path';

describe('parseAgentFilename', () => {
  it('parses regular sub-agent', () => {
    const result = parseAgentFilename('agent-aeb3897ee3267e12c.jsonl');
    expect(result.agentId).toBe('aeb3897ee3267e12c');
    expect(result.pattern).toBe('regular');
  });

  it('parses compact sub-agent', () => {
    const result = parseAgentFilename('agent-acompact-767ece576f2b74e8.jsonl');
    expect(result.agentId).toBe('acompact-767ece576f2b74e8');
    expect(result.pattern).toBe('compact');
  });

  it('parses side_question sub-agent', () => {
    const result = parseAgentFilename('agent-aside_question-c5e5c961a7749e08.jsonl');
    expect(result.agentId).toBe('aside_question-c5e5c961a7749e08');
    expect(result.pattern).toBe('side_question');
  });
});

describe('extractParentSessionId', () => {
  it('extracts parent UUID from sub-agent path', () => {
    const subagentPath = '/home/user/.claude/projects/-home-user-project/aaaa-bbbb-cccc/subagents/agent-a123.jsonl';
    expect(extractParentSessionId(subagentPath)).toBe('aaaa-bbbb-cccc');
  });
});

describe('readMetaFile', () => {
  it('reads meta.json for regular sub-agent', () => {
    const fixturePath = path.join(
      process.cwd(),
      'sandbox/fixtures/eeee5555-0000-0000-0000-000000000005/subagents/agent-a1234567890abcdef.meta.json',
    );
    // meta.json is next to jsonl, we derive it from jsonl path
    const jsonlPath = fixturePath.replace('.meta.json', '.jsonl');
    const meta = readMetaFile(jsonlPath);
    expect(meta?.agentType).toBe('Explore');
    expect(meta?.description).toBe('Explore src/ directory');
  });

  it('returns null for missing meta.json', () => {
    const meta = readMetaFile('/nonexistent/path/agent-acompact-123.jsonl');
    expect(meta).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/subagent-detector.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement subagent-detector.ts**

Create `src/monitor/subagent-detector.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { SubAgentPattern } from '../shared/types.js';

export interface AgentFileInfo {
  agentId: string;
  pattern: SubAgentPattern;
}

export interface AgentMeta {
  agentType: string;
  description: string;
}

export function parseAgentFilename(filename: string): AgentFileInfo {
  const base = filename.replace(/\.(?:jsonl|meta\.json)$/, '');
  const agentId = base.replace(/^agent-/, '');

  let pattern: SubAgentPattern;
  if (agentId.startsWith('acompact-')) {
    pattern = 'compact';
  } else if (agentId.startsWith('aside_question-')) {
    pattern = 'side_question';
  } else {
    pattern = 'regular';
  }

  return { agentId, pattern };
}

export function extractParentSessionId(subagentJsonlPath: string): string {
  const parts = subagentJsonlPath.split(path.sep);
  const subagentsIdx = parts.indexOf('subagents');
  if (subagentsIdx < 1) {
    throw new Error(`Cannot extract parent session ID from path: ${subagentJsonlPath}`);
  }
  return parts[subagentsIdx - 1];
}

export function readMetaFile(jsonlPath: string): AgentMeta | null {
  const metaPath = jsonlPath.replace(/\.jsonl$/, '.meta.json');
  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(content);
    return {
      agentType: parsed.agentType ?? null,
      description: parsed.description ?? null,
    };
  } catch {
    return null;
  }
}

export function isSubagentPath(filePath: string): boolean {
  return filePath.includes(`${path.sep}subagents${path.sep}`) && filePath.endsWith('.jsonl');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/subagent-detector.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/subagent-detector.ts tests/unit/subagent-detector.test.ts
git commit -m "feat(monitor): implement sub-agent detection and filesystem linking"
```

---

## Task 9: JSONL Watcher

**Files:**
- Create: `src/monitor/watcher.ts`
- Create: `tests/integration/watcher.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/watcher.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { JsonlWatcher } from '../../src/monitor/watcher.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('JsonlWatcher', () => {
  let tmpDir: string;
  let watcher: JsonlWatcher;

  afterEach(async () => {
    if (watcher) await watcher.stop();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects new JSONL file and emits lines', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watcher-'));
    watcher = new JsonlWatcher(tmpDir);

    const lines: string[] = [];
    watcher.on('lines', ({ filePath, newLines }) => {
      lines.push(...newLines);
    });

    await watcher.start();

    // Create a JSONL file after watcher is running
    const jsonlPath = path.join(tmpDir, 'test-session.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"user","sessionId":"test"}\n');

    // Wait for fs.watch to pick up the change
    await sleep(500);

    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain('"type":"user"');
  });

  it('reads incremental appends', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watcher-'));
    watcher = new JsonlWatcher(tmpDir);

    const allLines: string[] = [];
    watcher.on('lines', ({ newLines }) => {
      allLines.push(...newLines);
    });

    await watcher.start();

    const jsonlPath = path.join(tmpDir, 'incremental.jsonl');
    fs.writeFileSync(jsonlPath, '{"type":"user","n":1}\n');
    await sleep(500);

    fs.appendFileSync(jsonlPath, '{"type":"assistant","n":2}\n');
    await sleep(500);

    expect(allLines).toHaveLength(2);
  });

  it('emits new_file event for new JSONL', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watcher-'));
    watcher = new JsonlWatcher(tmpDir);

    const newFiles: string[] = [];
    watcher.on('new_file', ({ filePath }) => {
      newFiles.push(filePath);
    });

    await watcher.start();

    fs.writeFileSync(path.join(tmpDir, 'new-session.jsonl'), '{"type":"user"}\n');
    await sleep(500);

    expect(newFiles).toHaveLength(1);
    expect(newFiles[0]).toContain('new-session.jsonl');
  });

  it('ignores non-JSONL files', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watcher-'));
    watcher = new JsonlWatcher(tmpDir);

    const lines: string[] = [];
    watcher.on('lines', ({ newLines }) => {
      lines.push(...newLines);
    });

    await watcher.start();

    fs.writeFileSync(path.join(tmpDir, 'not-jsonl.txt'), 'hello\n');
    await sleep(500);

    expect(lines).toHaveLength(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/watcher.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement watcher.ts**

Create `src/monitor/watcher.ts`:

```typescript
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export interface WatcherEvents {
  lines: { filePath: string; newLines: string[] };
  new_file: { filePath: string };
  error: { error: Error; context: string };
}

export class JsonlWatcher extends EventEmitter {
  private watchRoot: string;
  private offsets = new Map<string, number>();
  private watchers: fs.FSWatcher[] = [];
  private scanTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(watchRoot: string) {
    super();
    this.watchRoot = watchRoot;
  }

  async start(): Promise<void> {
    this.running = true;

    // Initial scan for existing JSONL files
    this.scanDirectory(this.watchRoot);

    // Watch for changes
    try {
      const watcher = fs.watch(this.watchRoot, { recursive: true }, (eventType, filename) => {
        if (!filename || !this.running) return;

        const fullPath = path.join(this.watchRoot, filename);
        if (!fullPath.endsWith('.jsonl')) return;

        this.handleFileChange(fullPath);
      });

      watcher.on('error', (error) => {
        this.emit('error', { error, context: 'fs.watch' });
      });

      this.watchers.push(watcher);
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'start watch' });
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  getWatchedFiles(): string[] {
    return [...this.offsets.keys()];
  }

  private scanDirectory(dir: string): void {
    try {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const fullPath = path.join(entry.parentPath ?? entry.path ?? dir, entry.name);
          if (!this.offsets.has(fullPath)) {
            // For existing files, start from current end (don't replay history)
            const stats = fs.statSync(fullPath);
            this.offsets.set(fullPath, stats.size);
          }
        }
      }
    } catch (error) {
      this.emit('error', { error: error as Error, context: `scan ${dir}` });
    }
  }

  private handleFileChange(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;

      const stats = fs.statSync(filePath);
      const isNew = !this.offsets.has(filePath);

      if (isNew) {
        this.offsets.set(filePath, 0);
        this.emit('new_file', { filePath });
      }

      const offset = this.offsets.get(filePath) ?? 0;
      if (stats.size <= offset) return;

      // Read only new bytes
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stats.size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      fs.closeSync(fd);

      this.offsets.set(filePath, stats.size);

      const text = buffer.toString('utf-8');
      const newLines = text.split('\n').filter((line) => line.trim().length > 0);

      if (newLines.length > 0) {
        this.emit('lines', { filePath, newLines });
      }
    } catch (error) {
      this.emit('error', { error: error as Error, context: `read ${filePath}` });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/watcher.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/watcher.ts tests/integration/watcher.test.ts
git commit -m "feat(monitor): implement JSONL file watcher with incremental reads"
```

---

## Task 10: Monitor Orchestrator

**Files:**
- Create: `src/monitor/index.ts`
- Create: `tests/integration/monitor.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/monitor.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { SessionMonitor } from '../../src/monitor/index.js';
import { initDb, closeDb, getDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SessionMonitor', () => {
  let tmpDir: string;
  let dbPath: string;
  let monitor: SessionMonitor;

  afterEach(async () => {
    if (monitor) await monitor.stop();
    closeDb();
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('discovers a new session from JSONL file', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-monitor-'));
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);

    monitor = new SessionMonitor({
      watchRoot: tmpDir,
      dbPath,
      idleThresholdMs: 60_000,
      endedThresholdMs: 300_000,
      pollIntervalMs: 60_000,
    });

    const discovered: any[] = [];
    monitor.on('session:discovered', (data) => discovered.push(data));

    await monitor.start();

    // Create a project directory and JSONL file
    const projectDir = path.join(tmpDir, '-home-user-project');
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionFile = path.join(projectDir, 'aaaa-bbbb-cccc-dddd.jsonl');
    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'aaaa-bbbb-cccc-dddd',
      entrypoint: 'cli',
      cwd: '/home/user/project',
      gitBranch: 'main',
      slug: 'test-session',
      promptId: 'p1',
    }) + '\n');

    await sleep(1000);

    expect(discovered).toHaveLength(1);

    const sessions = queries.listSessions({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].claude_session_id).toBe('aaaa-bbbb-cccc-dddd');
    expect(sessions[0].cwd).toBe('/home/user/project');
  });

  it('transitions status from starting to active', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-monitor-'));
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);

    monitor = new SessionMonitor({
      watchRoot: tmpDir,
      dbPath,
      idleThresholdMs: 60_000,
      endedThresholdMs: 300_000,
      pollIntervalMs: 60_000,
    });

    const statusChanges: any[] = [];
    monitor.on('session:status_changed', (data) => statusChanges.push(data));

    await monitor.start();

    const projectDir = path.join(tmpDir, '-home-user-project');
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionFile = path.join(projectDir, 'aaaa-1111.jsonl');

    // Write startup hook
    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'aaaa-1111',
      entrypoint: 'cli',
      cwd: '/home/user/project',
    }) + '\n');

    await sleep(500);

    // Write assistant event to trigger starting → active
    fs.appendFileSync(sessionFile, JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 100 },
      },
      timestamp: '2026-03-27T10:00:05Z',
      sessionId: 'aaaa-1111',
    }) + '\n');

    await sleep(500);

    const session = queries.getSessionByClaudeId('aaaa-1111');
    expect(session?.status).toBe('active');
    expect(statusChanges.some((c) => c.to === 'active')).toBe(true);
  });

  it('detects question and emits event', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-monitor-'));
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);

    monitor = new SessionMonitor({
      watchRoot: tmpDir,
      dbPath,
      idleThresholdMs: 60_000,
      endedThresholdMs: 300_000,
      pollIntervalMs: 60_000,
    });

    const questions: any[] = [];
    monitor.on('session:question_detected', (data) => questions.push(data));

    await monitor.start();

    const projectDir = path.join(tmpDir, '-home-user-app');
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionFile = path.join(projectDir, 'bbbb-2222.jsonl');

    // Write lines from question fixture
    const fixture = fs.readFileSync(
      path.join(process.cwd(), 'sandbox/fixtures/session-with-question.jsonl'),
      'utf-8',
    );
    fs.writeFileSync(sessionFile, fixture);

    await sleep(1000);

    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe('Which environment should I deploy to?');

    const session = queries.getSessionByClaudeId('bbbb2222-0000-0000-0000-000000000002');
    expect(session?.status).toBe('waiting');
    expect(session?.pending_question).toBe('Which environment should I deploy to?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/monitor.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement monitor orchestrator**

Create `src/monitor/index.ts`:

```typescript
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { JsonlWatcher } from './watcher.js';
import { parseLine } from './parser.js';
import { transition } from './state-machine.js';
import { RunDetector, type RunBoundary } from './run-detector.js';
import {
  extractParentSessionId,
  parseAgentFilename,
  readMetaFile,
  isSubagentPath,
} from './subagent-detector.js';
import { initDb, closeDb } from '../db/connection.js';
import * as queries from '../db/queries.js';
import type {
  MonitorConfig,
  MonitorStats,
  ParsedEvent,
  Session,
  SessionStatus,
} from '../shared/types.js';
import type { MonitorEvents, MonitorEventName } from '../shared/events.js';
import { DEFAULT_MONITOR_CONFIG, QUESTION_TOOL_NAMES } from '../shared/constants.js';

export class SessionMonitor extends EventEmitter {
  private config: MonitorConfig;
  private watcher: JsonlWatcher;
  private runDetectors = new Map<string, RunDetector>();
  private lastActivity = new Map<string, number>();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<MonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
    this.watcher = new JsonlWatcher(this.config.watchRoot);
  }

  override emit<K extends MonitorEventName>(event: K, data: MonitorEvents[K]): boolean {
    return super.emit(event, data);
  }

  override on<K extends MonitorEventName>(event: K, listener: (data: MonitorEvents[K]) => void): this {
    return super.on(event, listener as (...args: any[]) => void);
  }

  async start(): Promise<void> {
    initDb(this.config.dbPath);

    this.watcher.on('new_file', ({ filePath }) => this.handleNewFile(filePath));
    this.watcher.on('lines', ({ filePath, newLines }) => this.handleLines(filePath, newLines));
    this.watcher.on('error', ({ error, context }) => {
      this.emit('monitor:error', { error, context });
    });

    await this.watcher.start();

    // Periodic check for idle/ended sessions
    this.idleTimer = setInterval(() => this.checkIdleSessions(), this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    await this.watcher.stop();
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    closeDb();
  }

  getStats(): MonitorStats {
    const sessions = queries.listSessions({});
    const statusCounts: Record<SessionStatus, number> = {
      starting: 0, active: 0, waiting: 0, idle: 0, ended: 0, error: 0,
    };

    let totalTokens = 0;
    for (const s of sessions) {
      if (s.status in statusCounts) {
        statusCounts[s.status as SessionStatus]++;
      }
      totalTokens += s.output_tokens;
    }

    return {
      filesWatched: this.watcher.getWatchedFiles().length,
      sessionsByStatus: statusCounts,
      totalTokensToday: totalTokens,
    };
  }

  private handleNewFile(filePath: string): void {
    if (isSubagentPath(filePath)) {
      this.handleNewSubagent(filePath);
    }
    // Main session files are handled when their first lines are read
  }

  private handleLines(filePath: string, newLines: string[]): void {
    for (const line of newLines) {
      const event = parseLine(line);
      if (!event) continue;

      if (isSubagentPath(filePath)) {
        this.handleSubagentEvent(filePath, event);
      } else {
        this.handleSessionEvent(filePath, event);
      }
    }
  }

  private handleSessionEvent(filePath: string, event: ParsedEvent): void {
    // Skip sidechain events in parent JSONL
    if (event.isSidechain) return;

    const claudeId = event.sessionId ?? this.claudeIdFromPath(filePath);
    if (!claudeId) return;

    // Ensure session exists
    let session = queries.getSessionByClaudeId(claudeId);
    const isNew = !session;

    if (isNew) {
      session = queries.upsertSession({
        claude_session_id: claudeId,
        jsonl_path: filePath,
        cwd: event.cwd ?? undefined,
        project_name: event.cwd ? path.basename(event.cwd) : undefined,
        model: event.model ?? undefined,
        git_branch: event.gitBranch ?? undefined,
        label: event.slug ?? undefined,
        last_entrypoint: event.entrypoint ?? undefined,
      });

      // Register project
      if (event.cwd) {
        queries.upsertProject(path.basename(event.cwd), event.cwd);
      }

      this.emit('session:discovered', { session });
    }

    // Update session fields from event
    this.updateSessionFromEvent(session!, event);

    // Track activity
    this.lastActivity.set(session!.id, Date.now());

    // Run detection
    if (!this.runDetectors.has(session!.id)) {
      this.runDetectors.set(session!.id, new RunDetector());
    }
    const detector = this.runDetectors.get(session!.id)!;
    const boundary = detector.checkBoundary(event);
    detector.markEventSeen();

    if (boundary) {
      this.handleRunBoundary(session!, boundary, filePath);
    }

    // State machine transition
    const newStatus = transition(session!.status as SessionStatus, event);
    if (newStatus) {
      queries.updateSessionStatus(session!.id, newStatus);
      session = queries.getSession(session!.id)!;
      this.emit('session:status_changed', {
        session,
        from: session!.status,
        to: newStatus,
      });
    }

    // Token accumulation
    if (event.tokens) {
      queries.updateSessionTokens(session!.id, event.tokens);
      const currentRun = queries.getCurrentRun(session!.id);
      if (currentRun) {
        queries.updateRunTokens(currentRun.id, event.tokens);
      }
    }

    // Question detection
    if (event.question && event.toolName && QUESTION_TOOL_NAMES.has(event.toolName)) {
      // Update pending_question on session
      getDb().prepare('UPDATE sessions SET pending_question = ? WHERE id = ?')
        .run(event.question, session!.id);

      session = queries.getSession(session!.id)!;
      this.emit('session:question_detected', { session, question: event.question });
    }

    // Bridge status (Remote URL)
    if (event.type === 'system:bridge_status' && event.remoteUrl) {
      getDb().prepare('UPDATE sessions SET remote_url = ? WHERE id = ?')
        .run(event.remoteUrl, session!.id);
    }

    // Emit activity
    session = queries.getSession(session!.id)!;
    this.emit('session:activity', { session, event });
  }

  private handleRunBoundary(session: Session, boundary: RunBoundary, jsonlPath: string): void {
    // End previous run if exists
    const previousRun = queries.getCurrentRun(session.id);
    if (previousRun && !previousRun.ended_at) {
      queries.endRun(previousRun.id);
      this.emit('run:ended', { session, run: { ...previousRun, ended_at: new Date().toISOString() } as any });
    }

    const run = queries.insertRun({
      session_id: session.id,
      jsonl_path: jsonlPath,
      start_type: boundary.startType,
      remote_url: boundary.remoteUrl ?? undefined,
    });

    // Update entrypoint on session
    if (boundary.entrypoint) {
      queries.upsertSession({
        claude_session_id: session.claude_session_id,
        jsonl_path: jsonlPath,
        last_entrypoint: boundary.entrypoint,
      });
    }

    // Handle managed/unmanaged handoff
    if (boundary.isHandoff) {
      const newType = boundary.entrypoint === 'cli' ? 'unmanaged' : 'managed';
      getDb().prepare('UPDATE sessions SET type = ? WHERE id = ?').run(newType, session.id);

      queries.insertEvent({
        session_id: session.id,
        event_type: 'type_change',
        from_status: boundary.previousEntrypoint === 'cli' ? 'unmanaged' : 'managed',
        to_status: newType,
        actor: 'monitor',
        detail: { entrypoint: boundary.entrypoint, previousEntrypoint: boundary.previousEntrypoint },
      });
    }

    const updatedSession = queries.getSession(session.id)!;
    this.emit('run:started', { session: updatedSession, run });
  }

  private handleNewSubagent(filePath: string): void {
    try {
      const parentId = extractParentSessionId(filePath);
      const filename = path.basename(filePath);
      const { agentId, pattern } = parseAgentFilename(filename);
      const meta = readMetaFile(filePath);

      const parentSession = queries.getSessionByClaudeId(parentId);
      if (!parentSession) return;

      queries.upsertSubAgent({
        id: agentId,
        session_id: parentSession.id,
        pattern,
        jsonl_path: filePath,
        agent_type: meta?.agentType,
        description: meta?.description,
      });

      const subagents = queries.getSubAgents(parentSession.id);
      const subagent = subagents.find((sa) => sa.id === agentId);
      if (subagent) {
        this.emit('subagent:detected', { session: parentSession, subagent });
      }
    } catch (error) {
      this.emit('monitor:error', { error: error as Error, context: `subagent ${filePath}` });
    }
  }

  private handleSubagentEvent(filePath: string, event: ParsedEvent): void {
    // Accumulate sub-agent tokens
    if (event.tokens && event.agentId) {
      try {
        const sets: string[] = [];
        const params: unknown[] = [];

        if (event.tokens.input_tokens) {
          sets.push('input_tokens = input_tokens + ?');
          params.push(event.tokens.input_tokens);
        }
        if (event.tokens.output_tokens) {
          sets.push('output_tokens = output_tokens + ?');
          params.push(event.tokens.output_tokens);
        }
        if (event.tokens.cache_read_tokens) {
          sets.push('cache_read_tokens = cache_read_tokens + ?');
          params.push(event.tokens.cache_read_tokens);
        }
        if (event.tokens.cache_create_tokens) {
          sets.push('cache_create_tokens = cache_create_tokens + ?');
          params.push(event.tokens.cache_create_tokens);
        }

        if (sets.length > 0) {
          params.push(event.agentId);
          getDb().prepare(`UPDATE sub_agents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        }

        // Also roll up to parent session
        const parentId = extractParentSessionId(filePath);
        const parentSession = queries.getSessionByClaudeId(parentId);
        if (parentSession) {
          queries.updateSessionTokens(parentSession.id, event.tokens);
        }
      } catch {
        // Non-fatal: sub-agent may not be registered yet
      }
    }
  }

  private updateSessionFromEvent(session: Session, event: ParsedEvent): void {
    const updates: Record<string, unknown> = {};
    if (event.slug && !session.label) updates.label = event.slug;
    if (event.model && event.model !== session.model) updates.model = event.model;
    if (event.cwd && !session.cwd) updates.cwd = event.cwd;
    if (event.gitBranch && event.gitBranch !== session.git_branch) updates.git_branch = event.gitBranch;
    if (event.entrypoint) updates.last_entrypoint = event.entrypoint;

    if (Object.keys(updates).length > 0) {
      queries.upsertSession({
        claude_session_id: session.claude_session_id,
        jsonl_path: session.jsonl_path,
        ...updates as any,
      });
    }
  }

  private checkIdleSessions(): void {
    const now = Date.now();
    const sessions = queries.listSessions({ active: true });

    for (const session of sessions) {
      const lastSeen = this.lastActivity.get(session.id);
      if (!lastSeen) continue;

      const idleMs = now - lastSeen;

      if (session.status === 'active' && idleMs >= this.config.idleThresholdMs) {
        queries.updateSessionStatus(session.id, 'idle');
        const updated = queries.getSession(session.id)!;
        this.emit('session:status_changed', { session: updated, from: 'active', to: 'idle' });
      }

      if (session.status === 'idle' && idleMs >= this.config.endedThresholdMs) {
        queries.updateSessionStatus(session.id, 'ended');
        const updated = queries.getSession(session.id)!;
        this.emit('session:status_changed', { session: updated, from: 'idle', to: 'ended' });
      }
    }
  }

  private claudeIdFromPath(filePath: string): string | null {
    const basename = path.basename(filePath, '.jsonl');
    // UUID pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(basename)) {
      return basename;
    }
    return null;
  }
}
```

**Note:** All database access in the orchestrator uses the `getDb()` function imported at the top of the file. Since `better-sqlite3` is synchronous, no async/await is needed for DB operations.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/monitor.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/index.ts tests/integration/monitor.test.ts
git commit -m "feat(monitor): implement Monitor orchestrator with full event pipeline"
```

---

## Task 11: Issue #3 — SDK V2 bridge_status Spike

**Files:**
- Create: `sandbox/spike-bridge-status/test-v2.ts`
- Modify: `docs/spikes/sprint0-claude-remote.md` (section 3.2 update)

This task is an investigation, not TDD. It requires running Claude Code SDK and observing actual JSONL output.

- [ ] **Step 1: Create V2 test script**

Create `sandbox/spike-bridge-status/test-v2.ts`:

```typescript
/**
 * Issue #3: Test whether SDK V2 createSession/send produces bridge_status events.
 *
 * Run: npx tsx sandbox/spike-bridge-status/test-v2.ts
 *
 * After running, check ~/.claude/projects/ for the JSONL file and search for bridge_status.
 */
import { createSession } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';

const WATCH_DIR = path.join(process.env.HOME!, '.claude/projects');

async function testV2BridgeStatus() {
  console.log('=== Test 1: SDK V2 session without --remote-control ===\n');

  // Take snapshot of existing JSONL files
  const beforeFiles = new Set(findJsonlFiles(WATCH_DIR));

  console.log('Creating V2 session...');
  const session = await createSession({
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Respond briefly.',
    cwd: process.cwd(),
  });

  console.log('Sending message...');
  const response = await session.send('Say hello in one word.');
  console.log('Response:', response.text);

  // Wait for JSONL to be written
  await new Promise((r) => setTimeout(r, 2000));

  // Find new JSONL files
  const afterFiles = findJsonlFiles(WATCH_DIR);
  const newFiles = afterFiles.filter((f) => !beforeFiles.has(f));

  console.log(`\nNew JSONL files: ${newFiles.length}`);

  for (const file of newFiles) {
    console.log(`\nChecking: ${file}`);
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    let foundBridgeStatus = false;
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'system' && event.subtype === 'bridge_status') {
          foundBridgeStatus = true;
          console.log('  ✓ bridge_status FOUND');
          console.log(`    URL: ${event.url}`);
          break;
        }
      } catch {}
    }

    if (!foundBridgeStatus) {
      console.log('  ✗ bridge_status NOT found');
    }

    // Show entrypoint
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.entrypoint) {
          console.log(`  entrypoint: ${event.entrypoint}`);
          break;
        }
      } catch {}
    }
  }

  await session.close?.();
}

function findJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(path.join(entry.parentPath ?? entry.path ?? dir, entry.name));
      }
    }
  } catch {}
  return results;
}

testV2BridgeStatus().catch(console.error);
```

- [ ] **Step 2: Run the V2 test**

Run: `npx tsx sandbox/spike-bridge-status/test-v2.ts`

Observe: does the output show `bridge_status FOUND` or `NOT found`?

- [ ] **Step 3: If Test 1 failed, create and run V2 with remote-control test**

Only needed if Test 1 shows `NOT found`. Modify the `createSession` call to pass `--remote-control` flag (check SDK docs for the parameter name).

- [ ] **Step 4: Document results**

Update `docs/spikes/sprint0-claude-remote.md` section 3.2 with:
- Test results (what was observed)
- Decision (from the matrix in issue #3)
- Impact on `SessionDriver` interface

- [ ] **Step 5: Comment on issue #3 and close**

Run:
```bash
gh issue comment 3 --body "Test results: [paste findings]. Decision: [chosen option from matrix]."
gh issue close 3
```

- [ ] **Step 6: Commit**

```bash
git add sandbox/spike-bridge-status/ docs/spikes/sprint0-claude-remote.md
git commit -m "spike(monitor): verify bridge_status in SDK V2 sessions — closes #3"
```

---

## Task 12: Seed Script

**Files:**
- Create: `sandbox/seed.ts`

- [ ] **Step 1: Create seed script**

Create `sandbox/seed.ts`:

```typescript
/**
 * Populate sentinel.db with realistic test data for dashboard development.
 * Run: npx tsx sandbox/seed.ts
 */
import { initDb, closeDb, getDb } from '../src/db/connection.js';
import * as queries from '../src/db/queries.js';

const DB_PATH = './sentinel-dev.db';

function seed() {
  initDb(DB_PATH);

  // Session 1: Active session working on feature
  const s1 = queries.upsertSession({
    claude_session_id: 'aaaa-1111-2222-3333',
    jsonl_path: '/home/user/.claude/projects/-home-user-app/aaaa-1111-2222-3333.jsonl',
    status: 'active',
    cwd: '/home/user/app',
    project_name: 'app',
    model: 'claude-opus-4-6',
    git_branch: 'feat/auth',
    label: 'busy-coding-elephant',
    last_entrypoint: 'cli',
  });
  queries.updateSessionStatus(s1.id, 'active');
  queries.updateSessionTokens(s1.id, {
    input_tokens: 50,
    output_tokens: 15000,
    cache_read_tokens: 500000,
    cache_create_tokens: 30000,
  });
  queries.insertRun({
    session_id: s1.id,
    jsonl_path: s1.jsonl_path,
    start_type: 'startup',
    model: 'claude-opus-4-6',
  });

  // Session 2: Waiting for user input
  const s2 = queries.upsertSession({
    claude_session_id: 'bbbb-4444-5555-6666',
    jsonl_path: '/home/user/.claude/projects/-home-user-api/bbbb-4444-5555-6666.jsonl',
    status: 'waiting',
    cwd: '/home/user/api',
    project_name: 'api',
    model: 'claude-opus-4-6',
    git_branch: 'fix/rate-limit',
    label: 'patient-waiting-falcon',
    last_entrypoint: 'cli',
  });
  queries.updateSessionStatus(s2.id, 'active');
  queries.updateSessionStatus(s2.id, 'waiting');
  queries.updateSessionTokens(s2.id, {
    output_tokens: 8000,
    cache_read_tokens: 200000,
  });
  getDb().prepare('UPDATE sessions SET pending_question = ? WHERE id = ?')
    .run('Should I apply the rate limit to all endpoints or just public ones?', s2.id);
  queries.insertRun({
    session_id: s2.id,
    jsonl_path: s2.jsonl_path,
    start_type: 'startup',
  });

  // Session 3: Ended, can resume
  const s3 = queries.upsertSession({
    claude_session_id: 'cccc-7777-8888-9999',
    jsonl_path: '/home/user/.claude/projects/-home-user-docs/cccc-7777-8888-9999.jsonl',
    status: 'ended',
    cwd: '/home/user/docs',
    project_name: 'docs',
    model: 'claude-sonnet-4-6',
    git_branch: 'docs/api-guide',
    label: 'sleepy-finished-owl',
    last_entrypoint: 'cli',
  });
  queries.updateSessionStatus(s3.id, 'active');
  queries.updateSessionStatus(s3.id, 'ended');
  queries.updateSessionTokens(s3.id, {
    output_tokens: 25000,
    cache_read_tokens: 800000,
    cache_create_tokens: 50000,
  });
  queries.insertRun({
    session_id: s3.id,
    jsonl_path: s3.jsonl_path,
    start_type: 'startup',
  });
  const r2 = queries.insertRun({
    session_id: s3.id,
    jsonl_path: s3.jsonl_path,
    start_type: 'resume',
  });
  queries.endRun(r2.id);

  // Session 4: Error state
  const s4 = queries.upsertSession({
    claude_session_id: 'dddd-aaaa-bbbb-cccc',
    jsonl_path: '/home/user/.claude/projects/-home-user-infra/dddd-aaaa-bbbb-cccc.jsonl',
    status: 'error',
    cwd: '/home/user/infra',
    project_name: 'infra',
    model: 'claude-opus-4-6',
    git_branch: 'chore/ci',
    label: 'troubled-erroring-raven',
    last_entrypoint: 'sdk-cli',
  });
  queries.updateSessionStatus(s4.id, 'active');
  queries.updateSessionStatus(s4.id, 'error');
  getDb().prepare('UPDATE sessions SET error_message = ?, owner = ?, type = ? WHERE id = ?')
    .run('API overloaded (529)', 'jarvis', 'managed', s4.id);
  queries.insertRun({
    session_id: s4.id,
    jsonl_path: s4.jsonl_path,
    start_type: 'startup',
    type_during_run: 'managed',
    owner_during_run: 'jarvis',
    sentinel_managed: true,
  });

  // Projects
  queries.upsertProject('app', '/home/user/app');
  queries.upsertProject('api', '/home/user/api');
  queries.upsertProject('docs', '/home/user/docs');
  queries.upsertProject('infra', '/home/user/infra');

  console.log('Seed complete. Database:', DB_PATH);
  console.log('Sessions created:', 4);

  closeDb();
}

seed();
```


- [ ] **Step 2: Run seed to verify it works**

Run: `npx tsx sandbox/seed.ts`

Expected: `Seed complete. Database: ./sentinel-dev.db` with 4 sessions created.

- [ ] **Step 3: Verify with sqlite3**

Run: `sqlite3 sentinel-dev.db "SELECT id, status, project_name, label FROM sessions"`

Expected: 4 rows with different statuses.

- [ ] **Step 4: Commit**

```bash
git add sandbox/seed.ts
git commit -m "chore(infra): add seed script for dashboard development"
```

---

## Task 13: Debug Dashboard

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/svelte.config.js`
- Create: `dashboard/vite.config.ts`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/src/app.html`
- Create: `dashboard/src/routes/+page.svelte`
- Create: `dashboard/src/routes/+page.server.ts`
- Create: `dashboard/src/lib/db.ts`

- [ ] **Step 1: Initialize SvelteKit dashboard**

Run:
```bash
cd /home/blasi/session-sentinel/dashboard && npm create svelte@latest . -- --template skeleton --types typescript --no-add-ons
```

If interactive, answer: skeleton project, TypeScript, no additional options.

Then install dependencies:
```bash
cd /home/blasi/session-sentinel/dashboard && npm install && npm install better-sqlite3 @types/better-sqlite3
```

- [ ] **Step 2: Create database helper**

Create `dashboard/src/lib/db.ts`:

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve(import.meta.dirname, '../../sentinel-dev.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function getSessions() {
  return getDb()
    .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    .all();
}

export function getRecentEvents(limit = 50) {
  return getDb()
    .prepare(`
      SELECT e.*, s.label as session_label
      FROM session_events e
      LEFT JOIN sessions s ON e.session_id = s.id
      ORDER BY e.created_at DESC
      LIMIT ?
    `)
    .all(limit);
}

export function getStats() {
  const db = getDb();

  const statusCounts = db
    .prepare("SELECT status, COUNT(*) as count FROM sessions GROUP BY status")
    .all() as { status: string; count: number }[];

  const totalTokens = db
    .prepare("SELECT COALESCE(SUM(output_tokens), 0) as total FROM sessions")
    .get() as { total: number };

  const sessionCount = db
    .prepare("SELECT COUNT(*) as count FROM sessions")
    .get() as { count: number };

  return {
    statusCounts: Object.fromEntries(statusCounts.map((r) => [r.status, r.count])),
    totalOutputTokens: totalTokens.total,
    totalSessions: sessionCount.count,
  };
}
```

- [ ] **Step 3: Create server-side data loader**

Create `dashboard/src/routes/+page.server.ts`:

```typescript
import { getSessions, getRecentEvents, getStats } from '$lib/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  return {
    sessions: getSessions(),
    events: getRecentEvents(50),
    stats: getStats(),
    timestamp: new Date().toISOString(),
  };
};
```

- [ ] **Step 4: Create dashboard page**

Create `dashboard/src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  const STATUS_COLORS: Record<string, string> = {
    starting: '#94a3b8',
    active: '#22c55e',
    waiting: '#eab308',
    idle: '#f97316',
    ended: '#6b7280',
    error: '#ef4444',
  };

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // Auto-refresh every 3 seconds
  onMount(() => {
    const interval = setInterval(() => invalidateAll(), 3000);
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>Session Sentinel — Debug</title>
</svelte:head>

<main>
  <h1>Session Sentinel <span class="debug-badge">DEBUG</span></h1>

  <!-- Stats -->
  <section class="stats">
    <div class="stat">
      <span class="stat-value">{data.stats.totalSessions}</span>
      <span class="stat-label">Sessions</span>
    </div>
    {#each Object.entries(data.stats.statusCounts) as [status, count]}
      <div class="stat">
        <span class="stat-value" style="color: {STATUS_COLORS[status] ?? '#888'}">{count}</span>
        <span class="stat-label">{status}</span>
      </div>
    {/each}
    <div class="stat">
      <span class="stat-value">{formatTokens(data.stats.totalOutputTokens)}</span>
      <span class="stat-label">Output tokens</span>
    </div>
  </section>

  <!-- Sessions table -->
  <section>
    <h2>Sessions</h2>
    <table>
      <thead>
        <tr>
          <th>Status</th>
          <th>Label</th>
          <th>Project</th>
          <th>Type</th>
          <th>Owner</th>
          <th>Model</th>
          <th>Tokens (out)</th>
          <th>Last Activity</th>
        </tr>
      </thead>
      <tbody>
        {#each data.sessions as session}
          <tr>
            <td>
              <span class="badge" style="background: {STATUS_COLORS[session.status] ?? '#888'}">
                {session.status}
              </span>
            </td>
            <td>{session.label ?? session.claude_session_id.slice(0, 8)}</td>
            <td>{session.project_name ?? '—'}</td>
            <td>{session.type}</td>
            <td>{session.owner ?? '—'}</td>
            <td class="mono">{session.model?.replace('claude-', '') ?? '—'}</td>
            <td class="mono">{formatTokens(session.output_tokens)}</td>
            <td>{timeAgo(session.updated_at)}</td>
          </tr>
          {#if session.pending_question}
            <tr class="question-row">
              <td colspan="8">⏳ {session.pending_question}</td>
            </tr>
          {/if}
          {#if session.error_message}
            <tr class="error-row">
              <td colspan="8">❌ {session.error_message}</td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </section>

  <!-- Recent events -->
  <section>
    <h2>Recent Events</h2>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Session</th>
          <th>Transition</th>
          <th>Actor</th>
        </tr>
      </thead>
      <tbody>
        {#each data.events as event}
          <tr>
            <td>{timeAgo(event.created_at)}</td>
            <td><span class="event-type">{event.event_type}</span></td>
            <td>{event.session_label ?? event.session_id.slice(0, 12)}</td>
            <td>
              {#if event.from_status && event.to_status}
                <span class="badge small" style="background: {STATUS_COLORS[event.from_status] ?? '#888'}">{event.from_status}</span>
                →
                <span class="badge small" style="background: {STATUS_COLORS[event.to_status] ?? '#888'}">{event.to_status}</span>
              {:else}
                —
              {/if}
            </td>
            <td>{event.actor}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <footer>
    Last refresh: {data.timestamp}
  </footer>
</main>

<style>
  :global(body) {
    font-family: 'SF Mono', 'Fira Code', monospace;
    background: #0f172a;
    color: #e2e8f0;
    margin: 0;
    padding: 1rem;
  }

  main { max-width: 1200px; margin: 0 auto; }

  h1 { font-size: 1.5rem; margin-bottom: 1rem; }

  .debug-badge {
    background: #ef4444;
    color: white;
    font-size: 0.6rem;
    padding: 2px 6px;
    border-radius: 3px;
    vertical-align: super;
  }

  h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #334155; padding-bottom: 0.3rem; }

  .stats {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .stat { text-align: center; }
  .stat-value { display: block; font-size: 1.5rem; font-weight: bold; }
  .stat-label { font-size: 0.75rem; color: #94a3b8; }

  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; padding: 0.4rem 0.6rem; color: #94a3b8; border-bottom: 1px solid #334155; }
  td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #1e293b; }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    color: white;
    font-weight: 600;
  }

  .badge.small { font-size: 0.65rem; padding: 1px 5px; }

  .event-type { color: #60a5fa; }

  .mono { font-family: inherit; }

  .question-row td { color: #eab308; font-style: italic; padding-left: 2rem; font-size: 0.8rem; border-bottom: none; }
  .error-row td { color: #ef4444; font-style: italic; padding-left: 2rem; font-size: 0.8rem; }

  footer { margin-top: 2rem; font-size: 0.7rem; color: #475569; }
</style>
```

- [ ] **Step 5: Run seed and start dashboard**

Run seed to populate dev database:
```bash
cd /home/blasi/session-sentinel && npx tsx sandbox/seed.ts
```

Start dashboard:
```bash
cd /home/blasi/session-sentinel/dashboard && npm run dev
```

Expected: Dashboard opens at `http://localhost:5173` showing 4 sessions, events, and stats.

- [ ] **Step 6: Commit dashboard**

```bash
cd /home/blasi/session-sentinel
git add dashboard/
git commit -m "feat(dashboard): implement debug dashboard with sessions, events, and stats"
```

---

## Task 14: Run All Tests and Final Commit

- [ ] **Step 1: Run full test suite**

Run: `cd /home/blasi/session-sentinel && npx vitest run`

Expected: all unit and integration tests PASS.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`

Expected: no type errors.

- [ ] **Step 3: Verify dashboard starts**

Run:
```bash
npx tsx sandbox/seed.ts && cd dashboard && npm run dev &
sleep 3 && curl -s http://localhost:5173 | head -20
kill %1
```

Expected: HTML response containing "Session Sentinel".

- [ ] **Step 4: Create src/main.ts entry point**

Create `src/main.ts`:

```typescript
import { SessionMonitor } from './monitor/index.js';

const monitor = new SessionMonitor();

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await monitor.stop();
  process.exit(0);
});

console.log('Session Sentinel starting...');
await monitor.start();
console.log('Monitoring', monitor.getStats().filesWatched, 'files');
console.log('Press Ctrl+C to stop.');
```

- [ ] **Step 5: Commit entry point**

```bash
git add src/main.ts
git commit -m "feat(infra): add main entry point for Session Monitor"
```
