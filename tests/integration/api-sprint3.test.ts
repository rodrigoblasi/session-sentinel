import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { initDb, closeDb, getDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Sprint 3 API', () => {
  let app: FastifyInstance;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `sentinel-api-s3-${Date.now()}.db`);
    initDb(dbPath);
    app = buildServer({ manager: null as any });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM notifications');
    db.exec('DELETE FROM session_events');
    db.exec('DELETE FROM transcript_cache');
    db.exec('DELETE FROM runs');
    db.exec('DELETE FROM sub_agents');
    db.exec('DELETE FROM sessions');
  });

  describe('PATCH /sessions/:id/notifications', () => {
    it('toggles notifications_enabled', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-patch-1',
        jsonl_path: '/tmp/test.jsonl',
        type: 'managed',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/sessions/${session.id}/notifications`,
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.notifications_enabled).toBeFalsy();
    });

    it('sets target_agent', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-patch-2',
        jsonl_path: '/tmp/test.jsonl',
        type: 'managed',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/sessions/${session.id}/notifications`,
        payload: { target_agent: 'friday' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().notifications_target_override).toBe('friday');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/sessions/nonexistent/notifications',
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when body is empty', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-patch-3',
        jsonl_path: '/tmp/test.jsonl',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/sessions/${session.id}/notifications`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('activity_state field', () => {
    it('returns null for idle/ended sessions', async () => {
      queries.upsertSession({
        claude_session_id: 'cs-act-1',
        jsonl_path: '/tmp/test.jsonl',
        status: 'ended',
      });

      const res = await app.inject({ method: 'GET', url: '/sessions' });
      expect(res.json()[0].activity_state).toBeNull();
    });

    it('returns processing when updated_at is recent and status is active', async () => {
      queries.upsertSession({
        claude_session_id: 'cs-act-2',
        jsonl_path: '/tmp/test.jsonl',
        status: 'active',
      });

      const res = await app.inject({ method: 'GET', url: '/sessions' });
      expect(res.json()[0].activity_state).toBe('processing');
    });

    it('returns subagents when active sub-agents exist', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-act-3',
        jsonl_path: '/tmp/test.jsonl',
        status: 'active',
      });
      queries.upsertSubAgent({
        id: `sa-${Date.now()}`,
        session_id: session.id,
        pattern: 'regular',
        jsonl_path: '/tmp/sa.jsonl',
      });

      const res = await app.inject({ method: 'GET', url: '/sessions' });
      expect(res.json()[0].activity_state).toBe('subagents');
    });

    it('returns activity_state in detail response', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-act-4',
        jsonl_path: '/tmp/test.jsonl',
        status: 'active',
      });

      const res = await app.inject({ method: 'GET', url: `/sessions/${session.id}` });
      expect(res.json().session.activity_state).toBe('processing');
    });
  });
});
