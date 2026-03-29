import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Housekeeper } from '../../src/manager/housekeeper.js';
import { SessionManager } from '../../src/manager/index.js';
import { initDb, closeDb, getDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import type { SessionDriver, TurnHandle, TurnOpts } from '../../src/shared/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function createMockDriver(): SessionDriver {
  return {
    startTurn: vi.fn((_opts: TurnOpts): TurnHandle => ({
      events: (async function* () {})(),
      interrupt: vi.fn().mockResolvedValue(undefined),
    })),
  };
}

/** Helper: set a session's updated_at to N ms in the past. */
function ageSession(sessionId: string, ageMs: number): void {
  const past = new Date(Date.now() - ageMs).toISOString().replace('T', ' ').replace('Z', '');
  getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(past, sessionId);
}

describe('Housekeeper', () => {
  let dbPath: string;
  let manager: SessionManager;
  let housekeeper: Housekeeper;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sentinel-hk-${Date.now()}.db`);
    initDb(dbPath);
    manager = new SessionManager({ driver: createMockDriver() });
  });

  afterEach(async () => {
    if (housekeeper) housekeeper.stop();
    if (manager) await manager.stop();
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  describe('sweep', () => {
    it('terminates managed idle sessions past threshold', async () => {
      housekeeper = new Housekeeper(manager, { idleThresholdMs: 1_000 });

      const session = queries.upsertSession({
        claude_session_id: 'cs-hk-1',
        jsonl_path: '/tmp/a.jsonl',
        status: 'idle',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'jarvis');

      // Age the session beyond threshold
      ageSession(session.id, 2_000);

      await housekeeper.sweep();

      const updated = queries.getSession(session.id)!;
      expect(updated.status).toBe('ended');

      // Check housekeep event was logged
      const events = queries.listEvents({ session_id: session.id });
      const hkEvent = events.find(e => e.event_type === 'housekeep');
      expect(hkEvent).toBeDefined();
      expect(hkEvent!.actor).toBe('housekeeper');
    });

    it('skips unmanaged idle sessions', async () => {
      housekeeper = new Housekeeper(manager, { idleThresholdMs: 1_000 });

      const session = queries.upsertSession({
        claude_session_id: 'cs-hk-2',
        jsonl_path: '/tmp/b.jsonl',
        status: 'idle',
        type: 'unmanaged',
      });

      ageSession(session.id, 2_000);

      await housekeeper.sweep();

      const updated = queries.getSession(session.id)!;
      expect(updated.status).toBe('idle'); // unchanged
    });

    it('skips managed sessions not past threshold', async () => {
      housekeeper = new Housekeeper(manager, { idleThresholdMs: 60_000 });

      const session = queries.upsertSession({
        claude_session_id: 'cs-hk-3',
        jsonl_path: '/tmp/c.jsonl',
        status: 'idle',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'moon');

      // Session is fresh — not past threshold
      await housekeeper.sweep();

      const updated = queries.getSession(session.id)!;
      expect(updated.status).toBe('idle'); // unchanged
    });

    it('skips managed waiting sessions (never auto-kill waiting)', async () => {
      housekeeper = new Housekeeper(manager, { idleThresholdMs: 1_000 });

      const session = queries.upsertSession({
        claude_session_id: 'cs-hk-4',
        jsonl_path: '/tmp/d.jsonl',
        status: 'waiting',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'jarvis');

      ageSession(session.id, 2_000);

      await housekeeper.sweep();

      const updated = queries.getSession(session.id)!;
      expect(updated.status).toBe('waiting'); // unchanged
    });

    it('skips managed active sessions', async () => {
      housekeeper = new Housekeeper(manager, { idleThresholdMs: 1_000 });

      const session = queries.upsertSession({
        claude_session_id: 'cs-hk-5',
        jsonl_path: '/tmp/e.jsonl',
        status: 'active',
        type: 'managed',
      });
      queries.updateSessionOwner(session.id, 'jarvis');

      ageSession(session.id, 2_000);

      await housekeeper.sweep();

      const updated = queries.getSession(session.id)!;
      expect(updated.status).toBe('active'); // unchanged
    });

    it('emits sweep event with counts', async () => {
      housekeeper = new Housekeeper(manager, { idleThresholdMs: 1_000 });
      const sweepHandler = vi.fn();
      housekeeper.on('housekeeper:sweep', sweepHandler);

      const s1 = queries.upsertSession({
        claude_session_id: 'cs-hk-6a',
        jsonl_path: '/tmp/f.jsonl',
        status: 'idle',
        type: 'managed',
      });
      queries.updateSessionOwner(s1.id, 'jarvis');
      ageSession(s1.id, 2_000);

      const s2 = queries.upsertSession({
        claude_session_id: 'cs-hk-6b',
        jsonl_path: '/tmp/g.jsonl',
        status: 'idle',
        type: 'managed',
      });
      queries.updateSessionOwner(s2.id, 'moon');
      ageSession(s2.id, 2_000);

      await housekeeper.sweep();

      expect(sweepHandler).toHaveBeenCalledWith({ checked: 2, terminated: 2 });
    });
  });
});
