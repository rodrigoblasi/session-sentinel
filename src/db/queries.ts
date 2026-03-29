import { ulid } from 'ulid';
import { getDb } from './connection.js';
import { eventBus } from '../shared/event-bus.js';
import type {
  Session, SessionUpsert, SessionFilters, SessionStatus,
  Run, RunInsert,
  SubAgent, SubAgentUpsert, SubAgentTokenTotals,
  SessionEvent, EventInsert, EventFilters,
  TranscriptInsert, TranscriptEntry,
  TokenDelta,
  NotificationInsert, NotificationFilters, Notification,
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
      if (key === 'claude_session_id' || value === undefined) continue;
      // Allow jsonl_path update only if the existing value is empty
      if (key === 'jsonl_path') {
        const currentSession = db.prepare('SELECT jsonl_path FROM sessions WHERE id = ?').get(existing.id) as { jsonl_path: string };
        if (currentSession.jsonl_path && currentSession.jsonl_path !== '') continue;
      }
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
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM sub_agents WHERE session_id = s.id) AS sub_agent_count
       FROM sessions s ${where} ORDER BY s.updated_at DESC ${limit}`,
    )
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

export function getSubAgentTokenTotals(sessionId: string): SubAgentTokenTotals {
  return getDb().prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) AS input,
      COALESCE(SUM(output_tokens), 0) AS output,
      COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
      COALESCE(SUM(cache_create_tokens), 0) AS cache_create
    FROM sub_agents
    WHERE session_id = ?
  `).get(sessionId) as SubAgentTokenTotals;
}

// --- Events ---

export function insertEvent(data: EventInsert): SessionEvent {
  const result = getDb().prepare(`
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

  const event: SessionEvent = {
    id: Number(result.lastInsertRowid),
    session_id: data.session_id,
    event_type: data.event_type,
    from_status: data.from_status ?? null,
    to_status: data.to_status ?? null,
    actor: data.actor ?? 'monitor',
    detail: data.detail ? JSON.stringify(data.detail) : null,
    created_at: new Date().toISOString(),
  };

  eventBus.emit('event:created', event);
  return event;
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

// --- Session field updates ---

export function updateSessionPendingQuestion(id: string, question: string | null): void {
  getDb()
    .prepare("UPDATE sessions SET pending_question = ?, updated_at = datetime('now') WHERE id = ?")
    .run(question, id);
}

export function updateSessionRemoteUrl(id: string, remoteUrl: string): void {
  getDb()
    .prepare("UPDATE sessions SET remote_url = ?, updated_at = datetime('now') WHERE id = ?")
    .run(remoteUrl, id);
}

export function updateSessionType(id: string, type: string): void {
  getDb()
    .prepare("UPDATE sessions SET type = ?, updated_at = datetime('now') WHERE id = ?")
    .run(type, id);
}

// --- Sub-agent tokens ---

export function updateSubAgentTokens(agentId: string, tokens: TokenDelta): void {
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

  params.push(agentId);
  getDb().prepare(`UPDATE sub_agents SET ${sets.join(', ')} WHERE id = ?`).run(...params);
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
  return (getDb().prepare(`
    SELECT * FROM projects WHERE name = ?
  `).get(name) as {
    name: string;
    cwd: string;
    discovered_at: string;
    last_session_at: string | null;
    session_count: number;
    alias: string | null;
  } | undefined) ?? null;
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
