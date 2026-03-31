import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  if (db) {
    throw new Error('Database already initialized. Call closeDb() before re-initializing.');
  }

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'schema.sql',
  );
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Migrate v1 → v2: notification columns
  const version = (db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as { value: string })?.value;
  if (version === '1') {
    db.exec(`
      ALTER TABLE sessions ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE sessions ADD COLUMN notifications_target_override TEXT;
    `);
    db.prepare("UPDATE _meta SET value = '2' WHERE key = 'schema_version'").run();
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
