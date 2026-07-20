import { Database } from "bun:sqlite";

export const db = new Database("psan.sqlite");

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    pin_hash   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    notes        TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    due_date     TEXT,
    created_by   INTEGER NOT NULL REFERENCES users(id),
    assigned_to  INTEGER REFERENCES users(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS task_revisions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      INTEGER NOT NULL REFERENCES tasks(id),
    changed_by   INTEGER NOT NULL REFERENCES users(id),
    changed_at   TEXT NOT NULL DEFAULT (datetime('now')),
    previous     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_revisions_task ON task_revisions(task_id);
`);