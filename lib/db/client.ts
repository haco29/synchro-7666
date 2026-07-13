import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS constraints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'unavailable_date',
  value TEXT NOT NULL,
  UNIQUE(person_id, kind, value)
);

CREATE TABLE IF NOT EXISTS weeks (
  week_start TEXT PRIMARY KEY,
  published INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL REFERENCES weeks(week_start) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  person_id INTEGER NOT NULL REFERENCES people(id),
  UNIQUE(date, slot, person_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_week ON assignments(week_start);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dir = process.env.SYNCHRO_DATA_DIR ?? path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path.join(dir, "synchro.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  ensureShareToken(db);
  return db;
}

function ensureShareToken(db: DatabaseSync) {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'share_token'")
    .get() as { value: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('share_token', ?)").run(
      randomBytes(16).toString("hex"),
    );
  }
}
