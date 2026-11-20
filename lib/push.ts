import { sql, pgIntArray } from "./db";
import { waitUntil } from "@vercel/functions";

// Web Push sin payload (RFC 8030 + VAPID RFC 8292), cero dependencias.
// VAPID_PUBLIC_KEY: punto EC P-256 sin comprimir (65 bytes) en base64url.
// VAPID_PRIVATE_KEY: escalar d (32 bytes) en base64url.

const b64url = (buf: ArrayBuffer | Uint8Array) =>
    Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64url");

async function privateKey(): Promise<CryptoKey> {
    const pub = Buffer.from(process.env.VAPID_PUBLIC_KEY!, "base64url");
    return crypto.subtle.importKey(
        "jwk",
        {
            kty: "EC", crv: "P-256",
            d: process.env.VAPID_PRIVATE_KEY!,
            x: b64url(pub.subarray(1, 33)),
            y: b64url(pub.subarray(33, 65)),
        },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"]
    );
}

async function vapidJwt(audience: string): Promise<string> {
    const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const unsigned =
        enc({ typ: "JWT", alg: "ES256" }) + "." +
        enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:poncesantosdavid@gmail.com" });
    const sig = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        await privateKey(),
        new TextEncoder().encode(unsigned)
    );
    return unsigned + "." + b64url(sig); // WebCrypto ya firma en formato r||s de JWS
}

export type PushSub = { id: number; endpoint: string };

// Título recortado para que el sistema no corte la notificación
export const clip = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Texto del recordatorio diario; "" = nada que avisar
export function reminderText(overdue: number, today: number, first: string): string {
    if (overdue > 0) {
        const s = overdue > 1 ? "s" : "";
        return `Atención: ${overdue} tarea${s} vencida${s}` + (today > 0 ? `, ${today} para hoy` : "");
    }
    if (today === 1) return `Buenos días, hoy toca: ${clip(first)}`;
    if (today > 1) return `Hoy: ${clip(first)} y ${today - 1} más`;
    return "";
}

// Guarda el aviso por dispositivo suscrito y lo despierta con push vacío.
// Quien no tiene push activo no genera filas. Mejor esfuerzo: nunca rompe la
// operación que lo dispara.
export async function notifyUsers(userIds: number[], body: string) {
    const ids = [...new Set(userIds)].filter((id) => Number.isInteger(id) && id > 0);
    if (!ids.length) return;
    try {
        const subs = await sql`
          SELECT id, user_id, endpoint FROM push_subscriptions
          WHERE user_id = ANY(${pgIntArray(ids)}::int[])`;
        for (const s of subs) {
            await sql`INSERT INTO notifications (user_id, endpoint, body) VALUES (${s.user_id}, ${s.endpoint}, ${body})`;
        }
        // ponytail: el aviso ya quedó en notifications (leído por POST /api/notifications);
        // el fan-out de red (VAPID sign + fetch por suscripción) es lo lento y no debe
        // retrasar la respuesta. Se difiere con waitUntil para que Vercel no mate la
        // función antes de que termine.
        waitUntil(
            Promise.allSettled(subs.map((s: PushSub) => sendPush(s))).catch((err) => {
                console.error("push fan-out failed", err);
            })
        );
    } catch {
        // sin VAPID configurado o push caído: el aviso queda guardado igual
    }
}

// Push vacío: el service worker compone el texto. true = entregado.
export async function sendPush(sub: PushSub): Promise<boolean> {
    const aud = new URL(sub.endpoint).origin;
    const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
            Authorization: `vapid t=${await vapidJwt(aud)}, k=${process.env.VAPID_PUBLIC_KEY!}`,
            TTL: "86400",
        },
    });
    if (res.status === 404 || res.status === 410) {
        // suscripción muerta → se limpia sola
        await sql`DELETE FROM push_subscriptions WHERE id = ${sub.id}`;
    }
    return res.ok;
}
