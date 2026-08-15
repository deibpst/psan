import { sql } from "./db";

export type User = { id: number; name: string };

const TIMEOUT_MINUTES = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES ?? "60");

export async function createSession(userID: number): Promise<string> {
    const token = crypto.randomUUID();
    await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userID}, now() + ${TIMEOUT_MINUTES} * interval '1 minute')`;
    return token;
}

export async function destroySession(token: string) {
    await sql`DELETE FROM sessions WHERE token = ${token}`;
}

export async function touchSession(token: string | null) {
    if (!token) return;
    await sql`UPDATE sessions SET expires_at = now() + ${TIMEOUT_MINUTES} * interval '1 minute' WHERE token = ${token}`;
}

export function readSessionToken(req: Request): string | null {
    return (
        req.headers
            .get("cookie")
            ?.split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith("session="))
            ?.slice("session=".length) ?? null
    );
}

export async function getUser(req: Request): Promise<User | null> {
    const token = readSessionToken(req);
    if (!token) return null;

    const rows = await sql`
      SELECT users.id, users.name, sessions.expires_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ${token}`;

    const row = rows[0] as { id: number; name: string; expires_at: Date } | undefined;
    if (!row) return null;

    if (new Date() > new Date(row.expires_at)) {
        await sql`DELETE FROM sessions WHERE token = ${token}`;
        return null;
    }

    return { id: row.id, name: row.name };
}

export { TIMEOUT_MINUTES };
