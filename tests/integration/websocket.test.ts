import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { initDb, closeDb } from '../../src/db/connection.js';
import * as queries from '../../src/db/queries.js';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('WebSocket /ws', () => {
  let app: FastifyInstance;
  let dbPath: string;
  let mockMonitor: EventEmitter;
  let mockBridge: EventEmitter;
  let port: number;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `sentinel-ws-${Date.now()}.db`);
    initDb(dbPath);
    mockMonitor = new EventEmitter();
    mockBridge = new EventEmitter();
    app = buildServer({ manager: null, monitor: mockMonitor, bridge: mockBridge });
    await app.listen({ port: 0 });
    const address = app.server.address();
    port = typeof address === 'object' ? address!.port : 0;
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('accepts WebSocket connections on /ws', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    ws.close();
  });

  it('broadcasts session status changes', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>(resolve => ws.on('open', resolve));

    const received = new Promise<any>(resolve => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    // Simulate Monitor event
    mockMonitor.emit('session:status_changed', {
      session: { id: 'ss-test', status: 'waiting' },
      from: 'active',
      to: 'waiting',
    });

    const message = await received;
    expect(message.type).toBe('status_change');
    expect(message.sessionId).toBe('ss-test');
    expect(message.to).toBe('waiting');

    ws.close();
  });

  it('broadcasts session discovery', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>(resolve => ws.on('open', resolve));

    const received = new Promise<any>(resolve => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    mockMonitor.emit('session:discovered', {
      session: { id: 'ss-new', status: 'starting' },
    });

    const message = await received;
    expect(message.type).toBe('session_update');

    ws.close();
  });

  it('broadcasts to multiple simultaneous clients', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws3 = new WebSocket(`ws://localhost:${port}/ws`);
    await Promise.all([
      new Promise<void>(resolve => ws1.on('open', resolve)),
      new Promise<void>(resolve => ws2.on('open', resolve)),
      new Promise<void>(resolve => ws3.on('open', resolve)),
    ]);

    const received = Promise.all([
      new Promise<any>(resolve => ws1.on('message', (d) => resolve(JSON.parse(d.toString())))),
      new Promise<any>(resolve => ws2.on('message', (d) => resolve(JSON.parse(d.toString())))),
      new Promise<any>(resolve => ws3.on('message', (d) => resolve(JSON.parse(d.toString())))),
    ]);

    mockMonitor.emit('session:status_changed', {
      session: { id: 'ss-multi', status: 'active' },
      from: 'starting',
      to: 'active',
    });

    const messages = await received;
    expect(messages).toHaveLength(3);
    expect(messages.every((m: any) => m.sessionId === 'ss-multi')).toBe(true);

    ws1.close(); ws2.close(); ws3.close();
  });

  it('handles client disconnect during broadcast without crashing', async () => {
    const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
    const ws2 = new WebSocket(`ws://localhost:${port}/ws`);
    await Promise.all([
      new Promise<void>(resolve => ws1.on('open', resolve)),
      new Promise<void>(resolve => ws2.on('open', resolve)),
    ]);

    // Disconnect ws1 before broadcast
    ws1.close();
    await new Promise(r => setTimeout(r, 50));

    const received = new Promise<any>(resolve => {
      ws2.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    // Should not throw — server handles dead clients gracefully
    mockMonitor.emit('session:status_changed', {
      session: { id: 'ss-disconnect', status: 'error' },
      from: 'active',
      to: 'error',
    });

    const message = await received;
    expect(message.sessionId).toBe('ss-disconnect');

    ws2.close();
  });

  it('broadcasts event type when insertEvent is called', async () => {
    const session = queries.upsertSession({
      claude_session_id: 'cs-ws-event',
      jsonl_path: '/tmp/ws-event.jsonl',
      status: 'active',
    });

    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>(resolve => ws.on('open', resolve));

    const received = new Promise<any>(resolve => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    queries.insertEvent({
      session_id: session.id,
      event_type: 'status_change',
      from_status: 'active',
      to_status: 'waiting',
      actor: 'monitor',
    });

    const message = await received;
    expect(message.type).toBe('event');
    expect(message.event.session_id).toBe(session.id);
    expect(message.event.event_type).toBe('status_change');
    expect(message.event.from_status).toBe('active');
    expect(message.event.to_status).toBe('waiting');
    expect(message.event).toHaveProperty('id');
    expect(message.event).toHaveProperty('created_at');

    ws.close();
  });

  it('broadcasts notification type when bridge sends notification', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise<void>(resolve => ws.on('open', resolve));

    const received = new Promise<any>(resolve => {
      ws.on('message', (data) => resolve(JSON.parse(data.toString())));
    });

    mockBridge.emit('bridge:notification_sent', {
      sessionId: 'ss-notif-test',
      trigger: 'waiting',
      destination: '#jarvis',
    });

    const message = await received;
    expect(message.type).toBe('notification');
    expect(message.sessionId).toBe('ss-notif-test');
    expect(message.trigger).toBe('waiting');
    expect(message.destination).toBe('#jarvis');

    ws.close();
  });
});
