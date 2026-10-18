import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH ?? path.join(dataDir, 'tocacifra.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nick TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  capo INTEGER NOT NULL DEFAULT 0,
  style TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS songs_user ON songs(user_id);

CREATE TABLE IF NOT EXISTS setlists (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS setlists_user ON setlists(user_id);

-- song_id NULL = "momento" (etiqueta no meio da sequencia)
CREATE TABLE IF NOT EXISTS setlist_items (
  setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
  label TEXT,
  PRIMARY KEY (setlist_id, position)
);
`);

// migracao simples: colunas de audio adicionadas depois da primeira versao
const songCols = (db.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name);
if (!songCols.includes('audio_type')) db.exec(`ALTER TABLE songs ADD COLUMN audio_type TEXT; ALTER TABLE songs ADD COLUMN audio_name TEXT;`);

export const audioDir = path.join(dataDir, 'audio');
fs.mkdirSync(audioDir, { recursive: true });

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
