/** UTC day helpers. Uptime buckets are keyed by UTC date so rollups are stable. */

export function toUtcDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function utcDayStart(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
}

/** The last `count` UTC days ending today, oldest first. */
export function recentUtcDays(count: number, endingAt = Date.now()): string[] {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    days.push(new Date(endingAt - i * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 hours ago" / "in 2 days". Deterministic given a reference time. */
export function relativeTime(unixSeconds: number, reference = Date.now() / 1000): string {
  const delta = unixSeconds - reference;
  const abs = Math.abs(delta);
  if (abs < 45) return delta < 0 ? "just now" : "in a moment";

  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (abs >= seconds) return fmt.format(Math.round(delta / seconds), unit);
  }
  return fmt.format(Math.round(delta / 60), "minute");
}

export function formatDateTime(unixSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(unixSeconds * 1000);
}

export function formatDate(unixSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).format(
    unixSeconds * 1000,
  );
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Uptime percentages are floored, never rounded. 99.996% must not print as
 * "100.00%" — claiming a perfect record you did not have is the one rounding
 * error a status page cannot afford.
 */
export function formatUptimePct(pct: number, decimals = 2): string {
  const factor = 10 ** decimals;
  return `${(Math.floor(pct * factor) / factor).toFixed(decimals)}%`;
}
