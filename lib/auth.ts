import { sql } from "./db";

export type User = { id: number; name: string };

export async function createSession(userID: number): Promise<string> {
    const token = crypto.randomUUID();
    await sql`INSERT INTO sessions (token, user_id) VALUES (${token}, ${userID})`;
    return token;
}

export async function destroySession(token: string) {
    await sql`DELETE FROM sessions WHERE token = ${token}`;
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
      SELECT users.id, users.name
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ${token}`;

    return (rows[0] as User | undefined) ?? null;
}
