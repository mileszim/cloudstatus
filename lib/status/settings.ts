import { db, now } from "@/lib/db/client";

/**
 * Page configuration. Stored as key/value rows so adding a setting never needs a
 * migration; the defaults below are the schema.
 */
export interface Settings {
  pageName: string;
  pageDescription: string;
  /** Public origin, used in feeds, emails, and webhook payloads. */
  siteUrl: string;
  supportUrl: string;
  /** IANA zone used to render timestamps for readers, e.g. "UTC", "America/New_York". */
  timezone: string;
  /** "light" | "dark" | "system" — the default before a visitor chooses. */
  defaultTheme: "light" | "dark" | "system";
  /** Show the subscribe button and /subscribe page. */
  allowSubscriptions: boolean;
  /** Notify subscribers when a component changes status outside an incident. */
  notifyOnComponentChange: boolean;
  /** Slack incoming webhook that mirrors every incident update, independent of subscribers. */
  slackWebhookUrl: string;
  /** Days of uptime history shown on the public page. */
  uptimeDays: number;
}

export const DEFAULT_SETTINGS: Settings = {
  pageName: "Cloudstatus",
  pageDescription: "Live and historical service status.",
  siteUrl: "http://localhost:3000",
  supportUrl: "",
  timezone: "UTC",
  defaultTheme: "system",
  allowSubscriptions: true,
  notifyOnComponentChange: false,
  slackWebhookUrl: "",
  uptimeDays: 90,
};

type SettingKey = keyof Settings;

function coerce<K extends SettingKey>(key: K, raw: string): Settings[K] {
  const fallback = DEFAULT_SETTINGS[key];
  if (typeof fallback === "boolean") return (raw === "true") as Settings[K];
  if (typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as Settings[K];
  }
  return raw as Settings[K];
}

export async function getSettings(): Promise<Settings> {
  const { results } = await db()
    .prepare("SELECT key, value FROM settings")
    .all<{ key: string; value: string }>();

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of results) {
    if (row.key in settings) {
      const key = row.key as SettingKey;
      (settings[key] as Settings[SettingKey]) = coerce(key, row.value);
    }
  }
  return settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const entries = Object.entries(patch).filter(([key]) => key in DEFAULT_SETTINGS);
  if (entries.length === 0) return;

  const ts = now();
  await db().batch(
    entries.map(([key, value]) =>
      db()
        .prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(key, String(value), ts),
    ),
  );
}
