/**
 * Admin password verification.
 *
 * PBKDF2-SHA256 via WebCrypto — available in workerd with no dependency, and
 * the iteration count is stored alongside the hash so it can be raised if the
 * platform ceiling below ever moves.
 *
 * Verifier format: `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`
 */

/**
 * The most PBKDF2 iterations Cloudflare Workers will perform in one call.
 *
 * A platform limit, not a preference: production rejects anything above it with
 * `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
 * supported`, as a DoS guard for a multi-tenant runtime. Local workerd does NOT
 * enforce it, so a higher count passes every local test and fails only once
 * deployed — which is how a 210,000-iteration default shipped here and made
 * admin sign-in impossible in production while working perfectly in dev.
 *
 * OWASP would prefer more for PBKDF2-SHA256. Reaching it would mean chaining
 * several capped calls; this deployment accepts the ceiling instead.
 *
 * @see https://github.com/cloudflare/workerd/issues/1346
 */
const MAX_ITERATIONS = 100_000;

const ITERATIONS = MAX_ITERATIONS;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** Below this a verifier did not come from this generator, whatever else it looks like. */
const MIN_ITERATIONS = 1_000;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Constant-time comparison. Never short-circuits on the first differing byte. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Tolerate the shapes a verifier arrives in when a human moves it by hand.
 *
 * `npm run hash-password` prints a ready-to-paste `.dev.vars` line, so the
 * value that reaches `wrangler secret put` or a seekrit field very often keeps
 * the `ADMIN_PASSWORD_HASH=` prefix, and copying out of a terminal or a YAML
 * file picks up quotes and stray whitespace. None of that means the password
 * was wrong, so normalise it instead of reporting a failed sign-in.
 */
function normalise(verifier: unknown): string {
  // Typed as `string` upstream, but it arrives from a secret store over the
  // network. A non-string here used to throw straight out of the Server Action
  // and reach the browser as an opaque 500.
  if (typeof verifier !== "string") return "";

  let value = verifier.trim().replace(/^ADMIN_PASSWORD_HASH\s*=\s*/, "").trim();

  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/**
 * Why a verification failed.
 *
 * `mismatch` is a wrong password — the one case the sign-in form should blame
 * on the person typing. Every `malformed` variant means the *deployment* is
 * misconfigured, which used to surface as "that password is not correct" and
 * sent people hunting for a typo that was never there.
 */
export type VerifyFailure =
  | "mismatch"
  | "empty"
  | "not-pbkdf2"
  | "wrong-field-count"
  | "bad-iterations"
  | "undecodable"
  | "wrong-digest-size"
  | "not-a-string"
  | "derive-rejected";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

/**
 * Checks `password` against a stored verifier.
 *
 * Deliberately returns *why* it failed. The caller decides what to show — none
 * of these reasons may be handed to the browser verbatim, and none of them
 * carry any part of the verifier or the password.
 */
export async function verifyPassword(password: string, verifier: unknown): Promise<VerifyResult> {
  if (verifier !== undefined && typeof verifier !== "string") {
    return { ok: false, reason: "not-a-string" };
  }

  const value = normalise(verifier);
  if (!value) return { ok: false, reason: "empty" };

  const parts = value.split("$");
  if (parts.length !== 4) return { ok: false, reason: "wrong-field-count" };
  if (parts[0] !== "pbkdf2") return { ok: false, reason: "not-pbkdf2" };

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    return { ok: false, reason: "bad-iterations" };
  }

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]);
    expected = fromBase64(parts[3]);
  } catch {
    return { ok: false, reason: "undecodable" };
  }

  // A digest of the wrong size can never match, and reporting it as a wrong
  // password would hide a truncated paste.
  if (expected.length !== KEY_LENGTH) return { ok: false, reason: "wrong-digest-size" };

  // Kept inside the guard deliberately. `deriveBits` rejects on parameters that
  // pass every check above, and letting that escape turns a bad secret into an
  // unreadable 500 on the sign-in form rather than a message naming the cause.
  let candidate: Uint8Array;
  try {
    candidate = await derive(password, salt, iterations);
  } catch {
    return { ok: false, reason: "derive-rejected" };
  }

  return timingSafeEqual(candidate, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** Operator-facing explanation for a misconfigured verifier. Never shown to visitors. */
export function explainFailure(reason: VerifyFailure): string {
  switch (reason) {
    case "mismatch":
      return "the password did not match the stored verifier";
    case "empty":
      return "ADMIN_PASSWORD_HASH is set but empty";
    case "wrong-field-count":
      return "ADMIN_PASSWORD_HASH is not four `$`-separated fields — it looks truncated, or a plain password was stored instead of the output of `npm run hash-password`";
    case "not-pbkdf2":
      return "ADMIN_PASSWORD_HASH does not start with `pbkdf2` — check for a copied prefix or a value from another tool";
    case "bad-iterations":
      return `the iteration count in ADMIN_PASSWORD_HASH is not a whole number between ${MIN_ITERATIONS} and ${MAX_ITERATIONS} — Cloudflare Workers refuses more than ${MAX_ITERATIONS} iterations per call, so a verifier generated before that ceiling applied can never be checked here and must be regenerated with \`npm run hash-password\``;
    case "not-a-string":
      return "ADMIN_PASSWORD_HASH did not resolve to a string — check how it is stored in seekrit or the Worker environment";
    case "derive-rejected":
      return `the runtime refused to derive a key from ADMIN_PASSWORD_HASH even though its parameters look valid — on Cloudflare Workers this means the iteration count is above the ${MAX_ITERATIONS} ceiling, and the verifier must be regenerated`;
    case "undecodable":
      return "the salt or digest in ADMIN_PASSWORD_HASH is not valid base64 — the value was probably line-wrapped or truncated in transit";
    case "wrong-digest-size":
      return `the digest in ADMIN_PASSWORD_HASH decodes to the wrong length (expected ${KEY_LENGTH} bytes) — the value was probably truncated`;
  }
}
