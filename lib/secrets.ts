import { env } from "cloudflare:workers";
import { Seekrit } from "@seekrit/sdk";

/**
 * Secret lookup, from seekrit or from the Worker's own environment.
 *
 * Every secret this app reads goes through {@link secret}. A plain Worker
 * secret of the same name always wins; anything it does not answer is resolved
 * from seekrit with the `SEEKRIT_TOKEN` service token. That ordering is
 * deliberate — `wrangler secret put SESSION_SECRET` stays a working way to get
 * the dashboard back if seekrit is unreachable and the cache below has nothing.
 *
 * Set neither and lookups return `undefined`, which is what every caller
 * already handles: the deployment reports the feature as not configured.
 */

/** The names this app reads. Anything else in the environment is ignored. */
export type SecretName =
  | "ADMIN_PASSWORD_HASH"
  | "SESSION_SECRET"
  | "INGEST_SECRET"
  | "EMAIL_FROM";

/**
 * How long a resolved set is served without revalidating. Long enough that a
 * burst of admin requests costs one round trip, short enough that rotating a
 * secret in seekrit takes effect on its own.
 */
const FRESH_MS = 60_000;

interface Snapshot {
  values: Record<string, string>;
  /** `Date.now()` when the resolve returned. */
  at: number;
}

// Isolate-scoped, so a warm isolate answers from memory. Cloudflare may run
// many isolates per deployment; each pays its own first resolve.
let snapshot: Snapshot | undefined;
let inflight: Promise<Snapshot> | undefined;
let seekrit: Seekrit | null | undefined;

/**
 * The client for this isolate, or `null` when no service token is configured.
 * Built lazily: `env` is only readable inside a request or cron invocation, and
 * the client caches its unwrapped token key across resolves.
 */
function client(): Seekrit | null {
  if (seekrit === undefined) {
    const token = env.SEEKRIT_TOKEN;
    seekrit = token ? new Seekrit({ token, apiUrl: env.SEEKRIT_API_URL }) : null;
  }
  return seekrit;
}

/** One resolve at a time per isolate; concurrent callers share it. */
function refresh(sdk: Seekrit): Promise<Snapshot> {
  inflight ??= sdk
    .resolve()
    .then((values) => (snapshot = { values, at: Date.now() }))
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

async function resolved(): Promise<Record<string, string>> {
  const sdk = client();
  if (!sdk) return {};

  const cached = snapshot;

  // Nothing cached yet: fail closed. `resolve()` rejects rather than returning
  // half an environment, and a half-configured admin login is worse than a 500.
  if (!cached) {
    try {
      return (await refresh(sdk)).values;
    } catch (error) {
      // Named in the log, because the error surfaces to callers as a bare 500.
      console.error("[secrets] first resolve failed; nothing cached to fall back to", error);
      throw error;
    }
  }

  if (Date.now() - cached.at < FRESH_MS) return cached.values;

  try {
    return (await refresh(sdk)).values;
  } catch (error) {
    // Serve the last good values instead. This is a status page: taking the
    // dashboard and the ingest webhook down because api.seekrit.dev had a bad
    // minute is exactly the failure it exists to report on.
    console.error(
      `[secrets] revalidation failed, serving values resolved at ${new Date(cached.at).toISOString()}`,
      error,
    );
    return cached.values;
  }
}

/** A secret's value, or `undefined` when neither source has it. */
export async function secret(name: SecretName): Promise<string | undefined> {
  // `||`, not `??`: .dev.vars.example ships these names blank, and an empty
  // value should fall through to seekrit rather than shadow it.
  return env[name] || (await resolved())[name];
}
