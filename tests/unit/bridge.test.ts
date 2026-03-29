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
