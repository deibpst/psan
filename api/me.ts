import { getUser, touchSession, readSessionToken, TIMEOUT_MINUTES } from "../lib/auth";

export async function GET(req: Request) {
    const user = await getUser(req);
    if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
    await touchSession(readSessionToken(req));
    return Response.json({ id: user.id, name: user.name, inactivityTimeoutMinutes: TIMEOUT_MINUTES });
}
