import { sql } from "./db";

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
