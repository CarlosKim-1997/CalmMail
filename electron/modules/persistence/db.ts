/**
 * SQLite database singleton.
 *
 * We keep the schema deliberately small. The app is an *assistant layer*, not a
 * mail archive — we store metadata + memory state, not raw email bodies.
 */

import Database from 'better-sqlite3';
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runMigrations } from './migrations';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const userDir = app.getPath('userData');
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const dbPath = path.join(userDir, 'calmmail.sqlite');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  runMigrations(db);
  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
