import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentBridge } from '../../src/bridge/index.js';
import { initDb, closeDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: Function) => {
    cb(null, '', '');
  }),
}));

import { execFile } from 'node:child_process';

describe('Bridge: notification gating (Sprint 3)', () => {
  let dbPath: string;
  let bridge: AgentBridge;
  let mockMonitor: EventEmitter;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sentinel-bridge-s3-${Date.now()}.db`);
    initDb(dbPath);
    vi.clearAllMocks();
    mockMonitor = new EventEmitter();
  });

  afterEach(() => {
    if (bridge) bridge.stop();
    closeDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  function createSession(overrides: { notifications_enabled?: boolean; notifications_target_override?: string | null } = {}) {
    const session = queries.upsertSession({
      claude_session_id: `cs-${Date.now()}-${Math.random()}`,
      jsonl_path: '/tmp/test.jsonl',
      status: 'active',
      type: 'managed',
    });
    queries.updateSessionOwner(session.id, 'jarvis');
    if (overrides.notifications_enabled === false) {
      queries.updateNotificationSettings(session.id, { enabled: false });
    }
    if (overrides.notifications_target_override) {
      queries.updateNotificationSettings(session.id, { target_agent: overrides.notifications_target_override });
    }
    return queries.getSession(session.id)!;
  }

  it('skips notification when notifications_enabled is false', () => {
    bridge = new AgentBridge({
      monitor: mockMonitor,
      notifyScript: '/usr/local/bin/agent-notify.sh',
      apiBaseUrl: 'http://localhost:3100',
    });

    const session = createSession({ notifications_enabled: false });
    mockMonitor.emit('session:status_changed', { session, from: 'active', to: 'waiting' });

    expect(execFile).not.toHaveBeenCalled();
  });

  it('delivers to target_override instead of owner', () => {
    bridge = new AgentBridge({
      monitor: mockMonitor,
      notifyScript: '/usr/local/bin/agent-notify.sh',
      apiBaseUrl: 'http://localhost:3100',
    });

    const session = createSession({ notifications_target_override: 'friday' });
    mockMonitor.emit('session:status_changed', { session, from: 'active', to: 'waiting' });

    const calls = (execFile as any).mock.calls;
    const destinations = calls.map((c: any[]) => c[1][0]);
    expect(destinations).toContain('#friday');
    expect(destinations).not.toContain('#jarvis');
  });

  it('still delivers to sentinel-log regardless of target override', () => {
    bridge = new AgentBridge({
      monitor: mockMonitor,
      notifyScript: '/usr/local/bin/agent-notify.sh',
      apiBaseUrl: 'http://localhost:3100',
    });

    const session = createSession({ notifications_target_override: 'friday' });
    mockMonitor.emit('session:status_changed', { session, from: 'active', to: 'waiting' });

    const calls = (execFile as any).mock.calls;
    const destinations = calls.map((c: any[]) => c[1][0]);
    expect(destinations).toContain('#sentinel-log');
  });
});
