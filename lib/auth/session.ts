import { cookies } from "next/headers";

import { secret } from "@/lib/secrets";

/**
 * Stateless admin sessions: an HMAC-SHA256 signed `<expiry>.<signature>` cookie.
 *
 * No session table — there is exactly one admin, so there is nothing to look
 * up. Rotating SESSION_SECRET invalidates every outstanding session, which is
 * the intended way to force a logout everywhere.
 */

export const SESSION_COOKIE = "__cs_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

async function signingKey(): Promise<string> {
  const value = await secret("SESSION_SECRET");
  if (!value) {
    throw new Error(
      "SESSION_SECRET is not set. Add it to seekrit or to .dev.vars locally, or run `wrangler secret put SESSION_SECRET`.",
    );
  }
  return value;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(await signingKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionCookieValue(): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  return `${expiresAt}.${await sign(String(expiresAt))}`;
}

/** Verifies signature and expiry. Any malformed value is simply "not signed in". */
export async function isValidSession(value: string | undefined): Promise<boolean> {
  if (!value) return false;

  const separator = value.indexOf(".");
  if (separator < 1) return false;

  const expiry = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  const expiresAt = Number(expiry);
  if (!Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;

  return timingSafeEqual(signature, await sign(expiry));
}

export function sessionCookieOptions(request?: Request) {
  // `secure` is skipped on plain-HTTP localhost so the cookie survives dev.
  const isHttps = request ? new URL(request.url).protocol === "https:" : true;
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/** True when the current request carries a valid admin session. */
export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return isValidSession(store.get(SESSION_COOKIE)?.value);
}

/** Throws unless the caller is signed in. Guards every admin Server Action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAuthenticated())) {
    throw new Error("Not authorised. Sign in to the admin dashboard and try again.");
  }
}

export async function adminConfigured(): Promise<boolean> {
  const [verifier, signing] = await Promise.all([
    secret("ADMIN_PASSWORD_HASH"),
    secret("SESSION_SECRET"),
  ]);
  return Boolean(verifier && signing);
}
