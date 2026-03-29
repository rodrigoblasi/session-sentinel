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

    it('GET /sessions/:id includes notifications array', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-detail-notif',
        jsonl_path: '/tmp/notif.jsonl',
        status: 'waiting',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'jarvis');

      queries.insertNotification({
        session_id: session.id,
        channel: 'discord_owner',
        destination: '#jarvis',
        trigger: 'waiting',
        payload: {
          sessionId: session.id,
          label: null,
          status: 'waiting',
          project: null,
          gitBranch: null,
          pendingQuestion: 'Continue?',
          errorMessage: null,
          waitingSince: new Date().toISOString(),
          apiUrl: `http://localhost:3100/sessions/${session.id}`,
        },
        delivered: true,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${session.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toBeDefined();
      expect(body.notifications).toHaveLength(1);
      expect(body.notifications[0].trigger).toBe('waiting');
    });

    it('GET /sessions/:id returns empty notifications array when none exist', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-detail-no-notif',
        jsonl_path: '/tmp/no-notif.jsonl',
        status: 'active',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${session.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toBeDefined();
      expect(body.notifications).toEqual([]);
    });

    it('GET /sessions/:id returns multiple notifications in order', async () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-detail-multi-notif',
        jsonl_path: '/tmp/multi-notif.jsonl',
        status: 'error',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'moon');

      const basePayload = {
        sessionId: session.id, label: null, status: 'waiting',
        project: null, gitBranch: null, pendingQuestion: null,
        errorMessage: null, waitingSince: null,
        apiUrl: `http://localhost:3100/sessions/${session.id}`,
      };

      queries.insertNotification({
        session_id: session.id, channel: 'discord_owner',
        destination: '#moon', trigger: 'waiting',
        payload: { ...basePayload, status: 'waiting' }, delivered: true,
      });
      queries.insertNotification({
        session_id: session.id, channel: 'discord_sentinel_log',
        destination: '#sentinel-log', trigger: 'waiting',
        payload: { ...basePayload, status: 'waiting' }, delivered: true,
      });
      queries.insertNotification({
        session_id: session.id, channel: 'discord_owner',
        destination: '#moon', trigger: 'error',
        payload: { ...basePayload, status: 'error', errorMessage: 'crash' }, delivered: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${session.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.notifications).toHaveLength(3);
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
