import { db, now } from "@/lib/db/client";
import type { ApiKeyRow } from "@/lib/status/types";

/**
 * Bearer-token auth for the write API.
 *
 * Only the SHA-256 of a key is stored, so a database leak does not hand out
 * working credentials. Lookup is by hash, which is also a constant-time
 * comparison by construction — the index does the matching, not our code.
 */

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AuthedKey {
  id: string;
  name: string;
  prefix: string;
}

export async function authenticateRequest(request: Request): Promise<AuthedKey | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice(7).trim();
  if (!token) return null;

  const row = await db()
    .prepare("SELECT * FROM api_keys WHERE hash = ? AND revoked_at IS NULL")
    .bind(await sha256Hex(token))
    .first<ApiKeyRow>();
  if (!row) return null;

  // Last-used is advisory; a failure here must not fail the request.
  await db()
    .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
    .bind(now(), row.id)
    .run()
    .catch(() => {});

  return { id: row.id, name: row.name, prefix: row.prefix };
}

export function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized", message: "Provide a valid API key as `Authorization: Bearer <key>`." },
    { status: 401, headers: { "www-authenticate": "Bearer" } },
  );
}

export function badRequest(message: string): Response {
  return Response.json({ error: "bad_request", message }, { status: 400 });
}

export function notFound(message: string): Response {
  return Response.json({ error: "not_found", message }, { status: 404 });
}
