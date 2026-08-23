/**
 * Secrets and vars that live outside wrangler.jsonc (so `wrangler types` cannot see them).
 * Set with `npx wrangler secret put <NAME>`; in local dev put them in `.dev.vars`.
 *
 * The four below can also come from seekrit — see [lib/secrets.ts](lib/secrets.ts).
 * Read them through `secret()` from that module rather than off `env` directly;
 * a value set here still wins, which is the break-glass path.
 */
declare namespace Cloudflare {
  interface Env {
    /** PBKDF2 verifier for the admin password, produced by `npm run hash-password`. */
    ADMIN_PASSWORD_HASH?: string;
    /** HMAC key for admin session cookies. Rotating it logs everyone out. */
    SESSION_SECRET?: string;
    /** Shared secret the generic ingest webhook signs requests with. */
    INGEST_SECRET?: string;
    /** From-address for subscriber email. Must belong to a domain on Email Service. */
    EMAIL_FROM?: string;

    /** `skt_...` seekrit service token. Without it, only the values above are used. */
    SEEKRIT_TOKEN?: string;
    /** Overrides seekrit's API host. Only needed for a self-hosted instance. */
    SEEKRIT_API_URL?: string;
  }
}

/** The `Env` shape passed to the Worker's fetch/scheduled handlers. */
type Env = Cloudflare.Env;
