import { describe, it, expect, afterEach } from 'vitest';
import { initDb, closeDb } from '../../src/db/connection.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('initDb', () => {
  let dbPath: string;

  afterEach(() => {
    closeDb();
    if (dbPath && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('creates all tables', () => {
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);
    const db = initDb(dbPath);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('runs');
    expect(tableNames).toContain('sub_agents');
    expect(tableNames).toContain('session_events');
    expect(tableNames).toContain('transcript_cache');
    expect(tableNames).toContain('notifications');
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('_meta');
  });

  it('sets schema version to 2', () => {
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);
    const db = initDb(dbPath);

    const row = db
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;

    expect(row?.value).toBe('2');
  });

  it('is idempotent — calling twice does not error', () => {
    dbPath = path.join(os.tmpdir(), `sentinel-test-${Date.now()}.db`);
    initDb(dbPath);
    closeDb();
    const db = initDb(dbPath);

    const row = db
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;

    expect(row?.value).toBe('2');
  });
});
