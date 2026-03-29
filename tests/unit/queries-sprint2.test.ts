import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Sprint 2 queries', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sentinel-s2-${Date.now()}.db`);
    initDb(dbPath);
  });

  afterEach(() => {
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  // --- Managed session helpers ---

  describe('updateSessionOwner', () => {
    it('sets owner and type to managed', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-owner-1',
        jsonl_path: '/tmp/test.jsonl',
      });

      queries.updateSessionOwner(session.id, 'jarvis');
      const updated = queries.getSession(session.id);

      expect(updated!.owner).toBe('jarvis');
      expect(updated!.type).toBe('managed');
    });

    it('changes owner on resume by different agent', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-owner-2',
        jsonl_path: '/tmp/test.jsonl',
      });
      queries.updateSessionOwner(session.id, 'jarvis');
      queries.updateSessionOwner(session.id, 'moon');

      const updated = queries.getSession(session.id);
      expect(updated!.owner).toBe('moon');
    });
  });

  // --- Notifications ---

  describe('insertNotification', () => {
    it('persists notification record', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-notif-1',
        jsonl_path: '/tmp/test.jsonl',
      });

      queries.insertNotification({
        session_id: session.id,
        channel: 'discord_owner',
        destination: '#jarvis',
        trigger: 'waiting',
        payload: {
          sessionId: session.id,
          label: null,
          status: 'waiting',
          project: 'wow-bot',
          gitBranch: 'main',
          pendingQuestion: 'Should I proceed?',
          errorMessage: null,
          waitingSince: new Date().toISOString(),
          apiUrl: `http://localhost:3100/sessions/${session.id}`,
        },
        delivered: true,
      });

      const notifications = queries.listNotifications({ session_id: session.id });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].trigger).toBe('waiting');
      expect(notifications[0].delivered).toBe(true);
    });
  });

  describe('listNotifications', () => {
    it('filters by channel', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-notif-2',
        jsonl_path: '/tmp/test.jsonl',
      });

      const basePayload = {
        sessionId: session.id, label: null, status: 'waiting',
        project: null, gitBranch: null, pendingQuestion: null,
        errorMessage: null, waitingSince: null, apiUrl: '',
      };

      queries.insertNotification({
        session_id: session.id, channel: 'discord_owner',
        destination: '#jarvis', trigger: 'waiting',
        payload: basePayload, delivered: true,
      });
      queries.insertNotification({
        session_id: session.id, channel: 'discord_sentinel_log',
        destination: '#sentinel-log', trigger: 'waiting',
        payload: basePayload, delivered: true,
      });

      const ownerNotifs = queries.listNotifications({ channel: 'discord_owner' });
      expect(ownerNotifs).toHaveLength(1);
    });
  });

  // --- Transcript retrieval ---

  describe('getTranscript', () => {
    it('returns transcript entries ordered by turn', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-tx-1',
        jsonl_path: '/tmp/test.jsonl',
      });

      queries.insertTranscriptEntry({ session_id: session.id, turn: 1, role: 'user', content: 'Hello' });
      queries.insertTranscriptEntry({ session_id: session.id, turn: 2, role: 'assistant', content: 'Hi there' });
      queries.insertTranscriptEntry({ session_id: session.id, turn: 3, role: 'user', content: 'Fix the bug' });

      const transcript = queries.getTranscript(session.id);
      expect(transcript).toHaveLength(3);
      expect(transcript[0].turn).toBe(1);
      expect(transcript[2].turn).toBe(3);
    });

    it('respects limit', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-tx-2',
        jsonl_path: '/tmp/test.jsonl',
      });

      for (let i = 1; i <= 10; i++) {
        queries.insertTranscriptEntry({ session_id: session.id, turn: i, role: 'user', content: `Turn ${i}` });
      }

      const transcript = queries.getTranscript(session.id, 5);
      expect(transcript).toHaveLength(5);
      expect(transcript[0].turn).toBe(6); // last 5 turns
    });
  });

  // --- Runs retrieval ---

  describe('getRuns', () => {
    it('returns all runs for a session', () => {
      const session = queries.upsertSession({
        claude_session_id: 'cs-runs-1',
        jsonl_path: '/tmp/test.jsonl',
      });

      queries.insertRun({ session_id: session.id, jsonl_path: '/tmp/r1.jsonl', start_type: 'startup' });
      queries.insertRun({ session_id: session.id, jsonl_path: '/tmp/r2.jsonl', start_type: 'resume' });

      const runs = queries.getRuns(session.id);
      expect(runs).toHaveLength(2);
      expect(runs[0].run_number).toBe(1);
      expect(runs[1].run_number).toBe(2);
    });
  });

  // --- Projects ---

  describe('listProjects', () => {
    it('returns all known projects', () => {
      queries.upsertProject('wow-bot', '/home/blasi/wow-bot');
      queries.upsertProject('sentinel', '/home/blasi/session-sentinel');

      const projects = queries.listProjects();
      expect(projects).toHaveLength(2);
      expect(projects.map(p => p.name)).toContain('wow-bot');
    });
  });

  describe('getProjectByName', () => {
    it('returns project by name', () => {
      queries.upsertProject('wow-bot', '/home/blasi/wow-bot');

      const project = queries.getProjectByName('wow-bot');
      expect(project).not.toBeNull();
      expect(project!.cwd).toBe('/home/blasi/wow-bot');
    });

    it('returns null for unknown project', () => {
      const project = queries.getProjectByName('nonexistent');
      expect(project).toBeNull();
    });
  });

  // --- Report stats ---

  describe('getReportStats', () => {
    it('returns aggregated session stats', () => {
      queries.upsertSession({ claude_session_id: 'cs-rpt-1', jsonl_path: '/tmp/a.jsonl', status: 'active' });
      queries.upsertSession({ claude_session_id: 'cs-rpt-2', jsonl_path: '/tmp/b.jsonl', status: 'waiting' });
      queries.upsertSession({ claude_session_id: 'cs-rpt-3', jsonl_path: '/tmp/c.jsonl', status: 'ended' });

      const stats = queries.getReportStats();
      expect(stats.total_sessions).toBe(3);
      expect(stats.active).toBe(1);
      expect(stats.waiting).toBe(1);
    });
  });
});
