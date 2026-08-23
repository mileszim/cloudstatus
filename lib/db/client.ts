import { env } from "cloudflare:workers";

/**
 * The D1 handle. Accessed through a function rather than a module-level constant
 * so that importing this module never touches bindings at build time.
 */
export function db(): D1Database {
  return env.DB;
}

/** Unix seconds, UTC. Every timestamp in the schema uses this. */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}
