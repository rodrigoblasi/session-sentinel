import { describe, it, expect, afterEach } from 'vitest';
import { SessionMonitor } from '../../src/monitor/index.js';
import { initDb, closeDb, getDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SessionMonitor', () => {
  let tmpDir: string;
  let dbPath: string;
  let monitor: SessionMonitor;

  afterEach(async () => {
    if (monitor) await monitor.stop();
    closeDb();
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('discovers a new session from JSONL file', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-monitor-'));
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);

    monitor = new SessionMonitor({
      watchRoot: tmpDir,
      dbPath,
      idleThresholdMs: 60_000,
      endedThresholdMs: 300_000,
      pollIntervalMs: 60_000,
    });

    const discovered: any[] = [];
    monitor.on('session:discovered', (data) => discovered.push(data));

    await monitor.start();

    // Create a project directory and JSONL file
    const projectDir = path.join(tmpDir, '-home-user-project');
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionFile = path.join(projectDir, 'aaaa-bbbb-cccc-dddd.jsonl');
    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'aaaa-bbbb-cccc-dddd',
      entrypoint: 'cli',
      cwd: '/home/user/project',
      gitBranch: 'main',
      slug: 'test-session',
      promptId: 'p1',
    }) + '\n');

    await sleep(1000);

    expect(discovered).toHaveLength(1);

    const sessions = queries.listSessions({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0].claude_session_id).toBe('aaaa-bbbb-cccc-dddd');
    expect(sessions[0].cwd).toBe('/home/user/project');
  });

  it('transitions status from starting to active', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-monitor-'));
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);

    monitor = new SessionMonitor({
      watchRoot: tmpDir,
      dbPath,
      idleThresholdMs: 60_000,
      endedThresholdMs: 300_000,
      pollIntervalMs: 60_000,
    });

    const statusChanges: any[] = [];
    monitor.on('session:status_changed', (data) => statusChanges.push(data));

    await monitor.start();

    const projectDir = path.join(tmpDir, '-home-user-project');
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionFile = path.join(projectDir, 'aaaa-1111.jsonl');

    // Write startup hook
    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'progress',
      data: { type: 'hook_progress', hookEvent: 'SessionStart', hookName: 'SessionStart:startup' },
      timestamp: '2026-03-27T10:00:00Z',
      sessionId: 'aaaa-1111',
      entrypoint: 'cli',
      cwd: '/home/user/project',
    }) + '\n');

    await sleep(500);

    // Write assistant event to trigger starting → active
    fs.appendFileSync(sessionFile, JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 100 },
      },
      timestamp: '2026-03-27T10:00:05Z',
      sessionId: 'aaaa-1111',
    }) + '\n');

    await sleep(500);

    const session = queries.getSessionByClaudeId('aaaa-1111');
    expect(session?.status).toBe('active');
    expect(statusChanges.some((c) => c.to === 'active')).toBe(true);
  });

  it('detects question and emits event', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-monitor-'));
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);

    monitor = new SessionMonitor({
      watchRoot: tmpDir,
      dbPath,
      idleThresholdMs: 60_000,
      endedThresholdMs: 300_000,
      pollIntervalMs: 60_000,
    });

    const questions: any[] = [];
    monitor.on('session:question_detected', (data) => questions.push(data));

    await monitor.start();

    const projectDir = path.join(tmpDir, '-home-user-app');
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionFile = path.join(projectDir, 'bbbb-2222.jsonl');

    // Write lines from question fixture
    const fixture = fs.readFileSync(
      path.join(process.cwd(), 'sandbox/fixtures/session-with-question.jsonl'),
      'utf-8',
    );
    fs.writeFileSync(sessionFile, fixture);

    await sleep(1000);

    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe('Which environment should I deploy to?');

    const session = queries.getSessionByClaudeId('bbbb2222-0000-0000-0000-000000000002');
    expect(session?.status).toBe('waiting');
    expect(session?.pending_question).toBe('Which environment should I deploy to?');
  });

  it('does not auto-end managed idle sessions (Housekeeper handles them)', async () => {
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);
    initDb(dbPath);

    // Create a managed idle session directly in DB
    const session = queries.upsertSession({
      claude_session_id: 'cs-managed-idle',
      jsonl_path: '/tmp/managed.jsonl',
      status: 'idle',
      type: 'managed',
    });
    queries.updateSessionOwner(session.id, 'jarvis');

    // Age the session beyond endedThresholdMs
    const past = new Date(Date.now() - 600_000).toISOString().replace('T', ' ').replace('Z', '');
    const { getDb } = await import('../../src/db/connection.js');
    getDb().prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(past, session.id);

    const current = queries.getSession(session.id)!;
    expect(current.status).toBe('idle'); // still idle — Monitor won't touch managed sessions
  });
});
