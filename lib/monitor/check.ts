import type { CheckOutcome, MonitorRow } from "@/lib/status/types";

/** Runs a single synthetic HTTP probe. */

export interface CheckResult {
  outcome: CheckOutcome;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
}

/**
 * Matches a status code against a spec like "200", "2xx", or "200,201,404".
 * An empty spec accepts anything below 400.
 */
export function statusMatches(code: number, spec: string): boolean {
  const patterns = spec
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (patterns.length === 0) return code < 400;

  return patterns.some((pattern) => {
    if (/^\d{3}$/.test(pattern)) return code === Number(pattern);
    if (/^\dxx$/.test(pattern)) return Math.floor(code / 100) === Number(pattern[0]);
    return false;
  });
}

function parseHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function runCheck(monitor: MonitorRow): Promise<CheckResult> {
  const started = Date.now();

  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      headers: {
        // Identify ourselves so operators can spot the probe in their logs.
        "user-agent": "Cloudstatus-Monitor/1.0 (+https://github.com/cloudflare/workers)",
        ...parseHeaders(monitor.headers),
      },
      body: monitor.method === "GET" || monitor.method === "HEAD" ? undefined : (monitor.body ?? undefined),
      signal: AbortSignal.timeout(monitor.timeout_ms),
      redirect: "follow",
    });

    // Read the body before stopping the clock only when we need to inspect it;
    // otherwise latency would include transfer time we never look at.
    let bodyMatchFailed = false;
    if (monitor.body_match) {
      const text = await response.text();
      bodyMatchFailed = !text.toLowerCase().includes(monitor.body_match.toLowerCase());
    }

    const latencyMs = Date.now() - started;

    if (!statusMatches(response.status, monitor.expected_status)) {
      return {
        outcome: "down",
        statusCode: response.status,
        latencyMs,
        error: `Unexpected status ${response.status} (expected ${monitor.expected_status})`,
      };
    }

    if (bodyMatchFailed) {
      return {
        outcome: "down",
        statusCode: response.status,
        latencyMs,
        error: `Response body did not contain "${monitor.body_match}"`,
      };
    }

    if (monitor.degraded_ms != null && latencyMs > monitor.degraded_ms) {
      return {
        outcome: "degraded",
        statusCode: response.status,
        latencyMs,
        error: `Responded in ${latencyMs}ms (threshold ${monitor.degraded_ms}ms)`,
      };
    }

    return { outcome: "up", statusCode: response.status, latencyMs, error: null };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message =
      error instanceof DOMException && error.name === "TimeoutError"
        ? `Timed out after ${monitor.timeout_ms}ms`
        : error instanceof Error
          ? error.message
          : String(error);

    return { outcome: "down", statusCode: null, latencyMs, error: message.slice(0, 300) };
  }
}
