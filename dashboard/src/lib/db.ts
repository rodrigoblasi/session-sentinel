import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve(import.meta.dirname, '../../sentinel-dev.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function getSessions() {
  return getDb()
    .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    .all();
}

export function getRecentEvents(limit = 50) {
  return getDb()
    .prepare(`
      SELECT e.*, s.label as session_label
      FROM session_events e
      LEFT JOIN sessions s ON e.session_id = s.id
      ORDER BY e.created_at DESC
      LIMIT ?
    `)
    .all(limit);
}

export function getStats() {
  const db = getDb();

  const statusCounts = db
    .prepare("SELECT status, COUNT(*) as count FROM sessions GROUP BY status")
    .all() as { status: string; count: number }[];

  const totalTokens = db
    .prepare("SELECT COALESCE(SUM(output_tokens), 0) as total FROM sessions")
    .get() as { total: number };

  const sessionCount = db
    .prepare("SELECT COUNT(*) as count FROM sessions")
    .get() as { count: number };

  return {
    statusCounts: Object.fromEntries(statusCounts.map((r) => [r.status, r.count])),
    totalOutputTokens: totalTokens.total,
    totalSessions: sessionCount.count,
  };
}
