const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Short, URL-safe, collision-resistant id. 14 chars of base36 from a CSPRNG is
 * ~72 bits — ample for a status page's row counts, and short enough to paste.
 */
export function newId(length = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Longer opaque token for confirm/unsubscribe links and API keys. */
export function newToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
