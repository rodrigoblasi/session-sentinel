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

      // Terminate the pre-created session
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

    it('uses custom actor and event type from options', async () => {
      mockDriver = createMockDriver();
      manager = new SessionManager({ driver: mockDriver });

      const session = queries.upsertSession({
        claude_session_id: 'cs-housekeep',
        jsonl_path: '/tmp/test.jsonl',
        status: 'idle',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'jarvis');

      await manager.terminateSession(session.id, {
        actor: 'housekeeper',
        eventType: 'housekeep',
        detail: { reason: 'idle_auto_kill', idle_ms: 900_000 },
      });

      const events = queries.listEvents({ session_id: session.id });
      const housekeepEvent = events.find(e => e.event_type === 'housekeep');
      expect(housekeepEvent).toBeDefined();
      expect(housekeepEvent!.actor).toBe('housekeeper');

      const updated = queries.getSession(session.id)!;
      expect(updated.status).toBe('ended');
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
