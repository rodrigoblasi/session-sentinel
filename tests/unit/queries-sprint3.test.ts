import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb, getDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Sprint 3: notification settings', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sentinel-s3-${Date.now()}.db`);
    initDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('new sessions have notifications_enabled=true by default', () => {
    const session = queries.upsertSession({
      claude_session_id: 'cs-notif-1',
      jsonl_path: '/tmp/test.jsonl',
      type: 'managed',
    });
    expect(session.notifications_enabled).toBeTruthy();
    expect(session.notifications_target_override).toBeNull();
  });

  it('schema version is 2', () => {
    const db = getDb();
    const row = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe('2');
  });

  describe('updateNotificationSettings', () => {
    it('toggles notifications_enabled', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-notif-2',
        jsonl_path: '/tmp/test.jsonl',
        type: 'managed',
      });
      queries.updateNotificationSettings(session.id, { enabled: false });
      const updated = queries.getSession(session.id)!;
      expect(updated.notifications_enabled).toBeFalsy();
    });

    it('sets target override', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-notif-3',
        jsonl_path: '/tmp/test.jsonl',
        type: 'managed',
      });
      queries.updateNotificationSettings(session.id, { target_agent: 'friday' });
      const updated = queries.getSession(session.id)!;
      expect(updated.notifications_target_override).toBe('friday');
    });

    it('clears target override with null', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-notif-4',
        jsonl_path: '/tmp/test.jsonl',
        type: 'managed',
      });
      queries.updateNotificationSettings(session.id, { target_agent: 'friday' });
      queries.updateNotificationSettings(session.id, { target_agent: null });
      const updated = queries.getSession(session.id)!;
      expect(updated.notifications_target_override).toBeNull();
    });

    it('returns false for non-existent session', () => {
      const result = queries.updateNotificationSettings('nonexistent', { enabled: false });
      expect(result).toBe(false);
    });
  });
});
