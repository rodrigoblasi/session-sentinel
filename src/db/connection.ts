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
