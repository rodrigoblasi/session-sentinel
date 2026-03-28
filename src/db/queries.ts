import { ulid } from 'ulid';
import { getDb } from './connection.js';
import type {
  Session, SessionUpsert, SessionFilters, SessionStatus,
  Run, RunInsert,
  SubAgent, SubAgentUpsert,
  SessionEvent, EventInsert, EventFilters,
  TranscriptInsert,
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
  return (getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined) ?? null;
}

export function getSessionByClaudeId(claudeId: string): Session | null {
  return (
    getDb()
      .prepare('SELECT * FROM sessions WHERE claude_session_id = ?')
      .get(claudeId) as Session | undefined
  ) ?? null;
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
  return (getDb()
    .prepare('SELECT * FROM runs WHERE session_id = ? ORDER BY run_number DESC LIMIT 1')
    .get(sessionId) as Run | undefined) ?? null;
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
