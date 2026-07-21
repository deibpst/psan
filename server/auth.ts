import { db } from "./db";

export type User = { id: number; name: string };

export function createSession(userID: number): string {
    const token = crypto.randomUUID();
    db.query("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, userID);
    return token;
}

export function destroySession(token: string) {
    db.query("DELETE FROM sessions WHERE token = ?").run(token);
}

export function getUser(req: Request): User | null {
    const token = req.headers
        .get("cookie")
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("sessions"))
        ?.slice("session=".length);

    if (!token) return null;

    return db
        .query(
            `SELECT users.id, users.name
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`
        )
        .get(token) as User | null;
}