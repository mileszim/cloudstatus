"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { newId, newToken } from "@/lib/db/id";
import { runDueChecks, runMonitorNow } from "@/lib/monitor/runner";
import { drain } from "@/lib/notify/dispatch";
import {
  addIncidentUpdate,
  createComponent,
  createGroup,
  createIncident,
  createSubscriber,
  deleteComponent,
  deleteGroup,
  deleteIncident,
  deleteSubscriber,
  moveComponent,
  publishPostmortem,
  setComponentStatus,
  updateComponent,
  updateGroup,
  updateIncidentDetails,
} from "@/lib/status/mutations";
import { updateSettings, type Settings } from "@/lib/status/settings";
import {
  COMPONENT_STATUSES,
  HTTP_METHODS,
  IMPACTS,
  type AnyIncidentStatus,
  type ComponentStatus,
  type HttpMethod,
  type Impact,
} from "@/lib/status/types";

/**
 * Server Actions for the admin dashboard.
 *
 * Every action re-checks the session. The middleware already gates these
 * routes, but Server Actions are individually addressable POST endpoints —
 * relying on the middleware alone would make authorisation a routing detail
 * rather than a property of the action.
 */

const ACTOR = "admin";

// ---------------------------------------------------------------------------
// Form parsing
// ---------------------------------------------------------------------------

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalStr(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value.length > 0 ? value : null;
}

function bool(form: FormData, key: string): boolean {
  return form.get(key) === "on" || form.get(key) === "true";
}

function int(form: FormData, key: string, fallback: number): number {
  const value = Number(str(form, key));
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** Parses a `datetime-local` value as UTC and returns unix seconds. */
function datetime(form: FormData, key: string): number | null {
  const value = str(form, key);
  if (!value) return null;
  const parsed = Date.parse(value.length === 16 ? `${value}:00Z` : `${value}Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Reads the per-component status pickers on the incident forms. Each affected
 * component posts `component:<id>` with the status it should hold.
 */
function componentStatuses(form: FormData): Record<string, ComponentStatus> {
  const out: Record<string, ComponentStatus> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("component:") || typeof value !== "string" || value === "unaffected") {
      continue;
    }
    out[key.slice("component:".length)] = oneOf(value, COMPONENT_STATUSES, "major_outage");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export async function createComponentAction(form: FormData): Promise<void> {
  await requireAdmin();
  await createComponent(
    {
      name: str(form, "name"),
      description: optionalStr(form, "description"),
      groupId: optionalStr(form, "groupId"),
      showcase: bool(form, "showcase"),
      onlyShowIfDegraded: bool(form, "onlyShowIfDegraded"),
    },
    ACTOR,
  );
}

export async function updateComponentAction(form: FormData): Promise<void> {
  await requireAdmin();
  await updateComponent(
    str(form, "id"),
    {
      name: str(form, "name"),
      description: optionalStr(form, "description"),
      groupId: optionalStr(form, "groupId"),
      showcase: bool(form, "showcase"),
      onlyShowIfDegraded: bool(form, "onlyShowIfDegraded"),
    },
    ACTOR,
  );
}

export async function deleteComponentAction(form: FormData): Promise<void> {
  await requireAdmin();
  await deleteComponent(str(form, "id"), ACTOR);
}

export async function moveComponentAction(form: FormData): Promise<void> {
  await requireAdmin();
  await moveComponent(str(form, "id"), str(form, "direction") === "up" ? "up" : "down", ACTOR);
}

export async function setComponentStatusAction(form: FormData): Promise<void> {
  await requireAdmin();
  await setComponentStatus(
    str(form, "id"),
    oneOf(str(form, "status"), COMPONENT_STATUSES, "operational"),
    ACTOR,
    { notify: bool(form, "notify") },
  );
}

export async function createGroupAction(form: FormData): Promise<void> {
  await requireAdmin();
  await createGroup({ name: str(form, "name"), description: optionalStr(form, "description") }, ACTOR);
}

export async function updateGroupAction(form: FormData): Promise<void> {
  await requireAdmin();
  await updateGroup(
    str(form, "id"),
    { name: str(form, "name"), description: optionalStr(form, "description") },
    ACTOR,
  );
}

export async function deleteGroupAction(form: FormData): Promise<void> {
  await requireAdmin();
  await deleteGroup(str(form, "id"), ACTOR);
}

// ---------------------------------------------------------------------------
// Incidents and maintenance
// ---------------------------------------------------------------------------

const INCIDENT_STATUS_VALUES = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
  "scheduled",
  "in_progress",
  "verifying",
  "completed",
] as const;

export async function createIncidentAction(form: FormData): Promise<void> {
  await requireAdmin();
  const isMaintenance = bool(form, "isMaintenance");

  const id = await createIncident(
    {
      title: str(form, "title"),
      status: oneOf(
        str(form, "status"),
        INCIDENT_STATUS_VALUES,
        isMaintenance ? "scheduled" : "investigating",
      ) as AnyIncidentStatus,
      body: str(form, "body"),
      componentStatuses: componentStatuses(form),
      impact: optionalStr(form, "impact")
        ? oneOf(str(form, "impact"), IMPACTS, "minor")
        : undefined,
      isMaintenance,
      scheduledFor: isMaintenance ? datetime(form, "scheduledFor") : null,
      scheduledUntil: isMaintenance ? datetime(form, "scheduledUntil") : null,
      autoTransition: bool(form, "autoTransition"),
      notify: bool(form, "notify"),
    },
    ACTOR,
  );

  redirect(`/admin/incidents/${id}`);
}

export async function addIncidentUpdateAction(form: FormData): Promise<void> {
  await requireAdmin();
  await addIncidentUpdate(
    str(form, "incidentId"),
    {
      status: oneOf(
        str(form, "status"),
        INCIDENT_STATUS_VALUES,
        "investigating",
      ) as AnyIncidentStatus,
      body: str(form, "body"),
      componentStatuses: componentStatuses(form),
      notify: bool(form, "notify"),
    },
    ACTOR,
  );
}

export async function updateIncidentDetailsAction(form: FormData): Promise<void> {
  await requireAdmin();
  await updateIncidentDetails(
    str(form, "incidentId"),
    {
      title: str(form, "title"),
      impact: oneOf(str(form, "impact"), IMPACTS, "minor") as Impact,
      scheduledFor: datetime(form, "scheduledFor"),
      scheduledUntil: datetime(form, "scheduledUntil"),
      autoTransition: bool(form, "autoTransition"),
    },
    ACTOR,
  );
}

export async function publishPostmortemAction(form: FormData): Promise<void> {
  await requireAdmin();
  await publishPostmortem(str(form, "incidentId"), str(form, "body"), ACTOR);
}

export async function deleteIncidentAction(form: FormData): Promise<void> {
  await requireAdmin();
  await deleteIncident(str(form, "incidentId"), ACTOR);
  redirect("/admin/incidents");
}

// ---------------------------------------------------------------------------
// Monitors
// ---------------------------------------------------------------------------

function monitorFields(form: FormData) {
  return {
    componentId: optionalStr(form, "componentId"),
    name: str(form, "name"),
    method: oneOf(str(form, "method"), HTTP_METHODS, "GET") as HttpMethod,
    url: str(form, "url"),
    headers: optionalStr(form, "headers"),
    body: optionalStr(form, "body"),
    expectedStatus: str(form, "expectedStatus") || "2xx",
    bodyMatch: optionalStr(form, "bodyMatch"),
    timeoutMs: Math.min(30_000, Math.max(1000, int(form, "timeoutMs", 10_000))),
    intervalS: Math.max(60, int(form, "intervalS", 60)),
    degradedMs: optionalStr(form, "degradedMs") ? int(form, "degradedMs", 2000) : null,
    failureThreshold: Math.max(1, int(form, "failureThreshold", 2)),
    recoveryThreshold: Math.max(1, int(form, "recoveryThreshold", 2)),
    failureStatus: oneOf(
      str(form, "failureStatus"),
      ["degraded_performance", "partial_outage", "major_outage"] as const,
      "major_outage",
    ),
    enabled: bool(form, "enabled"),
    autoIncident: bool(form, "autoIncident"),
  };
}

export async function createMonitorAction(form: FormData): Promise<void> {
  await requireAdmin();
  const f = monitorFields(form);
  const ts = Math.floor(Date.now() / 1000);

  await db()
    .prepare(
      `INSERT INTO monitors
         (id, component_id, name, method, url, headers, body, expected_status, body_match,
          timeout_ms, interval_s, degraded_ms, failure_threshold, recovery_threshold,
          failure_status, enabled, auto_incident, consecutive_failures, consecutive_successes,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    )
    .bind(
      newId(),
      f.componentId,
      f.name,
      f.method,
      f.url,
      f.headers,
      f.body,
      f.expectedStatus,
      f.bodyMatch,
      f.timeoutMs,
      f.intervalS,
      f.degradedMs,
      f.failureThreshold,
      f.recoveryThreshold,
      f.failureStatus,
      f.enabled ? 1 : 0,
      f.autoIncident ? 1 : 0,
      ts,
      ts,
    )
    .run();
}

export async function updateMonitorAction(form: FormData): Promise<void> {
  await requireAdmin();
  const f = monitorFields(form);

  await db()
    .prepare(
      `UPDATE monitors
          SET component_id = ?, name = ?, method = ?, url = ?, headers = ?, body = ?,
              expected_status = ?, body_match = ?, timeout_ms = ?, interval_s = ?,
              degraded_ms = ?, failure_threshold = ?, recovery_threshold = ?,
              failure_status = ?, enabled = ?, auto_incident = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      f.componentId,
      f.name,
      f.method,
      f.url,
      f.headers,
      f.body,
      f.expectedStatus,
      f.bodyMatch,
      f.timeoutMs,
      f.intervalS,
      f.degradedMs,
      f.failureThreshold,
      f.recoveryThreshold,
      f.failureStatus,
      f.enabled ? 1 : 0,
      f.autoIncident ? 1 : 0,
      Math.floor(Date.now() / 1000),
      str(form, "id"),
    )
    .run();
}

export async function deleteMonitorAction(form: FormData): Promise<void> {
  await requireAdmin();
  await db().prepare("DELETE FROM monitors WHERE id = ?").bind(str(form, "id")).run();
}

export async function runMonitorAction(form: FormData): Promise<void> {
  await requireAdmin();
  await runMonitorNow(str(form, "id"));
}

/**
 * Runs every due check on demand. The cron does this each minute in production;
 * the button exists because scheduled triggers are awkward to exercise in local
 * development.
 */
export async function runAllChecksAction(): Promise<void> {
  await requireAdmin();
  await runDueChecks();
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

export async function addSubscriberAction(form: FormData): Promise<void> {
  await requireAdmin();
  await createSubscriber({
    type: oneOf(str(form, "type"), ["email", "slack", "webhook"] as const, "email"),
    endpoint: str(form, "endpoint"),
    // Admin-added subscribers skip confirmation: the operator is vouching for
    // the endpoint, and a Slack or webhook URL has no inbox to confirm from.
    preConfirmed: true,
  });
}

export async function deleteSubscriberAction(form: FormData): Promise<void> {
  await requireAdmin();
  await deleteSubscriber(str(form, "id"), ACTOR);
}

export async function drainNotificationsAction(): Promise<void> {
  await requireAdmin();
  await drain();
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

/**
 * Mints an API key. The plaintext is returned once via a redirect parameter and
 * never stored — only its SHA-256 lives in the database.
 */
export async function createApiKeyAction(form: FormData): Promise<void> {
  await requireAdmin();

  const token = `cs_${newToken(24)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

  await db()
    .prepare(
      "INSERT INTO api_keys (id, name, hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(newId(), str(form, "name") || "Untitled key", hash, token.slice(0, 11), Math.floor(Date.now() / 1000))
    .run();

  redirect(`/admin/integrations?token=${encodeURIComponent(token)}`);
}

export async function revokeApiKeyAction(form: FormData): Promise<void> {
  await requireAdmin();
  await db()
    .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?")
    .bind(Math.floor(Date.now() / 1000), str(form, "id"))
    .run();
}

export async function createIntegrationRuleAction(form: FormData): Promise<void> {
  await requireAdmin();
  await db()
    .prepare(
      `INSERT INTO integration_rules (id, provider, match_key, component_id, degrade_to, open_incident, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(provider, match_key) DO UPDATE SET
         component_id = excluded.component_id,
         degrade_to = excluded.degrade_to,
         open_incident = excluded.open_incident`,
    )
    .bind(
      newId(),
      oneOf(str(form, "provider"), ["generic", "pagerduty", "datadog"] as const, "generic"),
      str(form, "matchKey"),
      str(form, "componentId"),
      oneOf(
        str(form, "degradeTo"),
        ["degraded_performance", "partial_outage", "major_outage"] as const,
        "major_outage",
      ),
      bool(form, "openIncident") ? 1 : 0,
      Math.floor(Date.now() / 1000),
    )
    .run();
}

export async function deleteIntegrationRuleAction(form: FormData): Promise<void> {
  await requireAdmin();
  await db().prepare("DELETE FROM integration_rules WHERE id = ?").bind(str(form, "id")).run();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateSettingsAction(form: FormData): Promise<void> {
  await requireAdmin();

  const patch: Partial<Settings> = {
    pageName: str(form, "pageName"),
    pageDescription: str(form, "pageDescription"),
    siteUrl: str(form, "siteUrl").replace(/\/$/, ""),
    supportUrl: str(form, "supportUrl"),
    timezone: str(form, "timezone") || "UTC",
    defaultTheme: oneOf(str(form, "defaultTheme"), ["light", "dark", "system"] as const, "system"),
    allowSubscriptions: bool(form, "allowSubscriptions"),
    notifyOnComponentChange: bool(form, "notifyOnComponentChange"),
    slackWebhookUrl: str(form, "slackWebhookUrl"),
    uptimeDays: Math.min(365, Math.max(7, int(form, "uptimeDays", 90))),
  };

  await updateSettings(patch);
}
