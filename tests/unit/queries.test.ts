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
    it('upsertProject creates and increments session_count', async () => {
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
