import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closeDb } from '../../src/db/connection.js';
import { SessionMonitor } from '../../src/monitor/index.js';
import { SessionManager } from '../../src/manager/index.js';
import { AgentBridge } from '../../src/bridge/index.js';
import { buildServer } from '../../src/api/server.js';
import { V1Driver } from '../../src/manager/v1-driver.js';
import type { FastifyInstance } from 'fastify';
import * as queries from '../../src/db/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Full stack integration', () => {
  let dbPath: string;
  let watchRoot: string;
  let monitor: SessionMonitor;
  let manager: SessionManager;
  let bridge: AgentBridge;
  let app: FastifyInstance;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `sentinel-full-${Date.now()}.db`);
    watchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-watch-'));

    monitor = new SessionMonitor({
      watchRoot,
      dbPath,
      idleThresholdMs: 60_000,
      endedThresholdMs: 300_000,
      pollIntervalMs: 60_000,
    });

    const driver = new V1Driver();
    manager = new SessionManager({ driver });

    bridge = new AgentBridge({
      monitor,
      notifyScript: '/bin/true', // no-op for testing
      apiBaseUrl: 'http://localhost:3100',
    });

    app = buildServer({ manager, monitor });
    await monitor.start();
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
    bridge.stop();
    await manager.stop();
    await monitor.stop();
    closeDb();
    fs.rmSync(watchRoot, { recursive: true, force: true });
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('all modules initialize without error', () => {
    expect(monitor).toBeDefined();
    expect(manager).toBeDefined();
    expect(bridge).toBeDefined();
    expect(app).toBeDefined();
  });

  it('API health endpoint works with all modules running', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('API sessions endpoint returns data from Monitor-populated DB', async () => {
    // Manually insert a session (as if Monitor discovered it)
    queries.upsertSession({
      claude_session_id: 'full-stack-test',
      jsonl_path: '/tmp/test.jsonl',
      status: 'active',
      cwd: '/home/blasi/wow-bot',
      project_name: 'wow-bot',
    });

    const response = await app.inject({ method: 'GET', url: '/sessions' });
    expect(response.statusCode).toBe(200);
    expect(response.json().length).toBeGreaterThanOrEqual(1);
  });

  it('API report endpoint aggregates data correctly', async () => {
    const response = await app.inject({ method: 'GET', url: '/report' });
    expect(response.statusCode).toBe(200);
    expect(response.json().summary).toHaveProperty('total_sessions');
  });
});
