import { SQL } from "bun";

// Neon/Vercel exponen la URL como DATABASE_URL (o POSTGRES_URL según la integración)
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) throw new Error("Falta DATABASE_URL / POSTGRES_URL");

export const sql = new SQL(url);

export async function migrate() {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        pin_hash   TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id                SERIAL PRIMARY KEY,
        title             TEXT NOT NULL,
        notes             TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        due_date          DATE,
        created_by        INTEGER NOT NULL REFERENCES users(id),
        assigned_to       INTEGER REFERENCES users(id),
        status_changed_by INTEGER REFERENCES users(id),
        status_changed_at TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at        TIMESTAMPTZ
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS task_revisions (
        id         SERIAL PRIMARY KEY,
        task_id    INTEGER NOT NULL REFERENCES tasks(id),
        changed_by INTEGER NOT NULL REFERENCES users(id),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        previous   JSONB NOT NULL
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS lists (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS list_items (
        id         SERIAL PRIMARY KEY,
        list_id    INTEGER NOT NULL REFERENCES lists(id),
        text       TEXT NOT NULL,
        checked    BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;

    await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence TEXT`;

    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;

    await sql`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id        SERIAL PRIMARY KEY,
        name      TEXT NOT NULL,
        failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_login_attempts_name ON login_attempts(name, failed_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE deleted_at IS NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_revisions_task ON task_revisions(task_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id)`;
}
