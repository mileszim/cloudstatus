/**
 * Generates demo data for a fresh Cloudstatus database and writes it to stdout as SQL.
 *
 *   node scripts/seed.mjs > .seed.sql
 *   npx wrangler d1 execute cloudstatus --local --file .seed.sql
 *
 * Deterministic: a fixed PRNG seed means re-running produces the same history,
 * so screenshots and tests stay stable.
 */

const DAYS = 90;
const CHECKS_PER_DAY = 1440;
const NOW = Math.floor(Date.now() / 1000);

// Mulberry32 — small, deterministic, good enough for fixture noise.
function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260822);

const q = (v) =>
  v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

const lines = [];
const emit = (sql) => lines.push(sql);
const insert = (table, row) =>
  emit(
    `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")});`,
  );

const utcDay = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

emit("-- Cloudstatus demo seed. Safe to re-run after `wrangler d1 migrations apply`.");
emit("DELETE FROM audit_log;");
emit("DELETE FROM integration_rules;");
emit("DELETE FROM api_keys;");
emit("DELETE FROM notifications;");
emit("DELETE FROM subscribers;");
emit("DELETE FROM incident_components;");
emit("DELETE FROM incident_updates;");
emit("DELETE FROM incidents;");
emit("DELETE FROM uptime_daily;");
emit("DELETE FROM checks;");
emit("DELETE FROM monitors;");
emit("DELETE FROM components;");
emit("DELETE FROM component_groups;");
emit("DELETE FROM settings;");

// --- settings ---------------------------------------------------------------

for (const [key, value] of Object.entries({
  pageName: "Acme Cloud",
  pageDescription: "Live and historical status for the Acme Cloud platform.",
  siteUrl: "http://localhost:3000",
  supportUrl: "https://example.com/support",
  timezone: "UTC",
  uptimeDays: "90",
  allowSubscriptions: "true",
})) {
  insert("settings", { key, value, updated_at: NOW });
}

// --- components -------------------------------------------------------------

const groups = [
  { id: "grp_core", name: "Core platform", description: "Services every customer depends on.", position: 0 },
  { id: "grp_regional", name: "Regional edge", description: "Per-region request handling.", position: 1 },
];

for (const g of groups) {
  insert("component_groups", {
    ...g,
    collapsed: 0,
    created_at: NOW - DAYS * 86400,
    updated_at: NOW,
  });
}

const components = [
  { id: "cmp_api", group_id: "grp_core", name: "API", description: "REST and GraphQL endpoints.", status: "operational", position: 0 },
  { id: "cmp_dashboard", group_id: "grp_core", name: "Dashboard", description: "app.acme.example", status: "operational", position: 1 },
  { id: "cmp_auth", group_id: "grp_core", name: "Authentication", description: "Login, SSO, and token issuance.", status: "operational", position: 2 },
  { id: "cmp_webhooks", group_id: "grp_core", name: "Webhooks", description: "Outbound event delivery.", status: "degraded_performance", position: 3 },
  { id: "cmp_us", group_id: "grp_regional", name: "US East (iad)", description: null, status: "operational", position: 0 },
  { id: "cmp_eu", group_id: "grp_regional", name: "EU West (dub)", description: null, status: "operational", position: 1 },
  { id: "cmp_docs", group_id: null, name: "Documentation", description: "docs.acme.example", status: "operational", position: 0 },
];

for (const c of components) {
  insert("components", {
    ...c,
    base_status: "operational",
    showcase: 1,
    only_show_if_degraded: 0,
    status_since: NOW - 3600,
    created_at: NOW - DAYS * 86400,
    updated_at: NOW,
  });
}

// --- monitors ---------------------------------------------------------------

const monitors = [
  { id: "mon_api", component_id: "cmp_api", name: "API health", url: "https://httpbin.org/status/200" },
  { id: "mon_dashboard", component_id: "cmp_dashboard", name: "Dashboard", url: "https://example.com/" },
  { id: "mon_auth", component_id: "cmp_auth", name: "Auth token endpoint", url: "https://httpbin.org/status/200" },
  { id: "mon_webhooks", component_id: "cmp_webhooks", name: "Webhook dispatcher", url: "https://httpbin.org/delay/3" },
  { id: "mon_us", component_id: "cmp_us", name: "US East edge", url: "https://example.com/" },
  { id: "mon_eu", component_id: "cmp_eu", name: "EU West edge", url: "https://example.com/" },
  { id: "mon_docs", component_id: "cmp_docs", name: "Docs", url: "https://example.com/" },
];

for (const m of monitors) {
  insert("monitors", {
    id: m.id,
    component_id: m.component_id,
    name: m.name,
    method: "GET",
    url: m.url,
    headers: null,
    body: null,
    expected_status: "2xx",
    body_match: null,
    timeout_ms: 10000,
    interval_s: 60,
    degraded_ms: 2000,
    failure_threshold: 2,
    recovery_threshold: 2,
    failure_status: "major_outage",
    enabled: 1,
    auto_incident: 1,
    consecutive_failures: 0,
    consecutive_successes: 5,
    last_checked_at: NOW - 40,
    last_ok: 1,
    last_latency_ms: 120 + Math.floor(rand() * 90),
    last_error: null,
    created_at: NOW - DAYS * 86400,
    updated_at: NOW,
  });
}

// --- uptime history ---------------------------------------------------------
//
// Mostly clean, with two seeded bad patches so the 90-day bars have something
// to show: a multi-hour API outage 12 days ago and slow webhooks all last week.

const apiOutageDay = utcDay(NOW - 12 * 86400);
const webhookSlowDays = new Set(
  Array.from({ length: 7 }, (_, i) => utcDay(NOW - (3 + i) * 86400)),
);

for (const m of monitors) {
  for (let i = DAYS - 1; i >= 1; i--) {
    const day = utcDay(NOW - i * 86400);
    const base = 110 + rand() * 120;

    let down = 0;
    let degraded = 0;

    if (m.id === "mon_api" && day === apiOutageDay) down = 143; // ~2h24m
    if (m.id === "mon_webhooks" && webhookSlowDays.has(day)) degraded = 200 + Math.floor(rand() * 300);
    // Background noise: an occasional single blip.
    if (down === 0 && degraded === 0 && rand() < 0.04) degraded = 1 + Math.floor(rand() * 3);

    const up = CHECKS_PER_DAY - down - degraded;
    insert("uptime_daily", {
      monitor_id: m.id,
      day,
      up,
      degraded,
      down,
      avg_latency_ms: Math.round((degraded > 0 ? base * 4 : base) * 10) / 10,
      max_latency_ms: Math.round(base * (degraded > 0 ? 9 : 2.5)),
      downtime_s: down * 60,
    });
  }
}

// Today's partial history lives in `checks` so the live path is exercised too.
const minutesToday = Math.floor((NOW % 86400) / 60);
for (const m of monitors) {
  for (let i = Math.min(minutesToday, 240); i >= 1; i--) {
    const at = NOW - i * 60;
    const slow = m.id === "mon_webhooks" && rand() < 0.35;
    insert("checks", {
      monitor_id: m.id,
      checked_at: at,
      outcome: slow ? "degraded" : "up",
      status_code: 200,
      latency_ms: Math.round(slow ? 2400 + rand() * 900 : 110 + rand() * 120),
      error: null,
    });
  }
}

// --- incidents --------------------------------------------------------------

const outageStart = NOW - 12 * 86400 - 3600;
insert("incidents", {
  id: "inc_api_outage",
  title: "Elevated error rates on the API",
  status: "resolved",
  impact: "critical",
  is_maintenance: 0,
  scheduled_for: null,
  scheduled_until: null,
  auto_transition: 0,
  auto_component_status: 1,
  source: "monitor",
  source_monitor_id: "mon_api",
  shortlink: "api-errors",
  started_at: outageStart,
  resolved_at: outageStart + 8640,
  postmortem_body:
    "## Summary\n\nA configuration rollout to the request router dropped connection pooling for the primary datastore, saturating available connections within four minutes.\n\n## Timeline\n\n| Time (UTC) | Event |\n| --- | --- |\n| 14:02 | Rollout begins |\n| 14:06 | Error rate crosses 5% |\n| 14:11 | Paged, incident opened |\n| 16:26 | Rollback complete, errors clear |\n\n## What we are changing\n\n- Connection-pool settings move behind a staged rollout with automatic rollback.\n- Added a synthetic check that exercises a pooled query path directly.",
  postmortem_published_at: outageStart + 3 * 86400,
  created_at: outageStart,
  updated_at: outageStart + 8640,
});

const apiUpdates = [
  ["investigating", outageStart, "We are investigating elevated error rates affecting API requests. Dashboard sign-in may also be slow."],
  ["identified", outageStart + 900, "The issue has been traced to a configuration change in the request routing layer. A rollback is underway."],
  ["monitoring", outageStart + 5400, "The rollback is complete and error rates have returned to normal. We are monitoring the recovery."],
  ["resolved", outageStart + 8640, "Error rates have been stable for 45 minutes. This incident is resolved. A postmortem will follow within three business days."],
];

apiUpdates.forEach(([status, at, body], i) => {
  insert("incident_updates", {
    id: `iu_api_${i}`,
    incident_id: "inc_api_outage",
    status,
    body,
    display_at: at,
    notify: 1,
    created_at: at,
  });
});

for (const [componentId, during] of [
  ["cmp_api", "major_outage"],
  ["cmp_dashboard", "degraded_performance"],
]) {
  insert("incident_components", {
    incident_id: "inc_api_outage",
    component_id: componentId,
    status_before: "operational",
    status_during: during,
  });
}

// An open incident, so the page shows the active-incident treatment.
const webhookStart = NOW - 5400;
insert("incidents", {
  id: "inc_webhook_delay",
  title: "Delayed webhook delivery",
  status: "monitoring",
  impact: "minor",
  is_maintenance: 0,
  scheduled_for: null,
  scheduled_until: null,
  auto_transition: 0,
  auto_component_status: 1,
  source: "manual",
  source_monitor_id: null,
  shortlink: "webhook-delay",
  started_at: webhookStart,
  resolved_at: null,
  postmortem_body: null,
  postmortem_published_at: null,
  created_at: webhookStart,
  updated_at: NOW - 600,
});

[
  ["investigating", webhookStart, "Some outbound webhooks are being delivered several minutes late. Events are queued, not dropped — no data has been lost."],
  ["identified", webhookStart + 1800, "A backlog in the delivery queue is the cause. We have added capacity and the queue is draining."],
  ["monitoring", NOW - 600, "The backlog has cleared and delivery latency is back under ten seconds. Monitoring before we resolve."],
].forEach(([status, at, body], i) => {
  insert("incident_updates", {
    id: `iu_wh_${i}`,
    incident_id: "inc_webhook_delay",
    status,
    body,
    display_at: at,
    notify: 1,
    created_at: at,
  });
});

insert("incident_components", {
  incident_id: "inc_webhook_delay",
  component_id: "cmp_webhooks",
  status_before: "operational",
  status_during: "degraded_performance",
});

// Upcoming maintenance window.
const maintStart = NOW + 3 * 86400;
insert("incidents", {
  id: "inc_maint_db",
  title: "Scheduled datastore upgrade (EU West)",
  status: "scheduled",
  impact: "maintenance",
  is_maintenance: 1,
  scheduled_for: maintStart,
  scheduled_until: maintStart + 7200,
  auto_transition: 1,
  auto_component_status: 1,
  source: "manual",
  source_monitor_id: null,
  shortlink: "eu-db-upgrade",
  started_at: maintStart,
  resolved_at: null,
  postmortem_body: null,
  postmortem_published_at: null,
  created_at: NOW - 2 * 86400,
  updated_at: NOW - 2 * 86400,
});

insert("incident_updates", {
  id: "iu_maint_0",
  incident_id: "inc_maint_db",
  status: "scheduled",
  body: "We will upgrade the EU West datastore cluster. Requests served from **EU West (dub)** may see elevated latency for up to 15 minutes during failover. No action is required from you.",
  display_at: NOW - 2 * 86400,
  notify: 1,
  created_at: NOW - 2 * 86400,
});

insert("incident_components", {
  incident_id: "inc_maint_db",
  component_id: "cmp_eu",
  status_before: "operational",
  status_during: "under_maintenance",
});

// --- integrations -----------------------------------------------------------

insert("integration_rules", {
  id: "rule_pd_api",
  provider: "pagerduty",
  match_key: "Acme API",
  component_id: "cmp_api",
  degrade_to: "major_outage",
  open_incident: 1,
  enabled: 1,
  created_at: NOW,
});

process.stdout.write(lines.join("\n") + "\n");
