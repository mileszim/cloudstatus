import { db, now } from "@/lib/db/client";
import { newId, newToken } from "@/lib/db/id";
import { drain, enqueue, mirrorToSlack } from "@/lib/notify/dispatch";
import type { NotificationPayload } from "@/lib/notify/payload";
import { getSettings } from "@/lib/status/settings";
import {
  impactForComponentStatus,
  isClosedStatus,
  worstComponentStatus,
  type AnyIncidentStatus,
  type ComponentRow,
  type ComponentStatus,
  type Impact,
  type IncidentRow,
} from "@/lib/status/types";

/**
 * Every write that changes what the public page says.
 *
 * Shared by the admin Server Actions, the authenticated write API, the ingest
 * webhooks, and the monitor check runner, so all four routes into the system
 * apply identical rules about component status, incident lifecycle, and
 * subscriber notification.
 */

export type Actor = string;

async function audit(
  actor: Actor,
  action: string,
  targetType: string,
  targetId: string,
  meta?: unknown,
): Promise<void> {
  await db()
    .prepare(
      "INSERT INTO audit_log (actor, action, target_type, target_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(actor, action, targetType, targetId, meta ? JSON.stringify(meta) : null, now())
    .run();
}

/**
 * Sends a payload to subscribers and the operator's Slack mirror.
 *
 * Delivery is awaited rather than backgrounded: the caller is a Server Action
 * or route handler that already has the request open, the ledger makes retries
 * safe, and an operator posting an incident update deserves to find out
 * immediately if notifications are broken.
 */
async function notify(payload: NotificationPayload, dedupeKey: string): Promise<void> {
  await enqueue(payload, dedupeKey);
  await Promise.allSettled([drain(), mirrorToSlack(payload)]);
}

// ---------------------------------------------------------------------------
// Component groups
// ---------------------------------------------------------------------------

export async function createGroup(
  input: { name: string; description?: string | null },
  actor: Actor,
): Promise<string> {
  const id = newId();
  const ts = now();
  const position = await nextPosition("component_groups");

  await db()
    .prepare(
      "INSERT INTO component_groups (id, name, description, position, collapsed, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(id, input.name, input.description ?? null, position, ts, ts)
    .run();

  await audit(actor, "group.create", "component_group", id, { name: input.name });
  return id;
}

export async function updateGroup(
  id: string,
  input: { name: string; description?: string | null },
  actor: Actor,
): Promise<void> {
  await db()
    .prepare("UPDATE component_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?")
    .bind(input.name, input.description ?? null, now(), id)
    .run();
  await audit(actor, "group.update", "component_group", id);
}

export async function deleteGroup(id: string, actor: Actor): Promise<void> {
  // Components survive their group; the FK is ON DELETE SET NULL, so they
  // simply become ungrouped rather than disappearing from the page.
  await db().prepare("DELETE FROM component_groups WHERE id = ?").bind(id).run();
  await audit(actor, "group.delete", "component_group", id);
}

async function nextPosition(table: "components" | "component_groups"): Promise<number> {
  const row = await db()
    .prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ${table}`)
    .first<{ next: number }>();
  return row?.next ?? 0;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export interface ComponentInput {
  name: string;
  description?: string | null;
  groupId?: string | null;
  showcase?: boolean;
  onlyShowIfDegraded?: boolean;
}

export async function createComponent(input: ComponentInput, actor: Actor): Promise<string> {
  const id = newId();
  const ts = now();

  await db()
    .prepare(
      `INSERT INTO components
         (id, group_id, name, description, status, base_status, position, showcase,
          only_show_if_degraded, status_since, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'operational', 'operational', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.groupId ?? null,
      input.name,
      input.description ?? null,
      await nextPosition("components"),
      input.showcase === false ? 0 : 1,
      input.onlyShowIfDegraded ? 1 : 0,
      ts,
      ts,
      ts,
    )
    .run();

  await audit(actor, "component.create", "component", id, { name: input.name });
  return id;
}

export async function updateComponent(
  id: string,
  input: ComponentInput,
  actor: Actor,
): Promise<void> {
  await db()
    .prepare(
      `UPDATE components
          SET name = ?, description = ?, group_id = ?, showcase = ?, only_show_if_degraded = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      input.name,
      input.description ?? null,
      input.groupId ?? null,
      input.showcase === false ? 0 : 1,
      input.onlyShowIfDegraded ? 1 : 0,
      now(),
      id,
    )
    .run();
  await audit(actor, "component.update", "component", id);
}

export async function deleteComponent(id: string, actor: Actor): Promise<void> {
  await db().prepare("DELETE FROM components WHERE id = ?").bind(id).run();
  await audit(actor, "component.delete", "component", id);
}

/** Swaps a component with its neighbour. Used by the admin reorder buttons. */
export async function moveComponent(
  id: string,
  direction: "up" | "down",
  actor: Actor,
): Promise<void> {
  const component = await db()
    .prepare("SELECT * FROM components WHERE id = ?")
    .bind(id)
    .first<ComponentRow>();
  if (!component) return;

  const comparison = direction === "up" ? "<" : ">";
  const order = direction === "up" ? "DESC" : "ASC";

  const neighbour = await db()
    .prepare(
      `SELECT * FROM components
        WHERE position ${comparison} ?
          AND (group_id IS ? OR group_id = ?)
        ORDER BY position ${order} LIMIT 1`,
    )
    .bind(component.position, component.group_id, component.group_id)
    .first<ComponentRow>();
  if (!neighbour) return;

  const ts = now();
  await db().batch([
    db()
      .prepare("UPDATE components SET position = ?, updated_at = ? WHERE id = ?")
      .bind(neighbour.position, ts, component.id),
    db()
      .prepare("UPDATE components SET position = ?, updated_at = ? WHERE id = ?")
      .bind(component.position, ts, neighbour.id),
  ]);

  await audit(actor, "component.move", "component", id, { direction });
}

/**
 * Sets a component's status and, unless suppressed, tells subscribers.
 *
 * `base_status` records the status to fall back to when an incident clears, so
 * a component that was already degraded before a maintenance window does not
 * come back reporting "operational".
 */
export async function setComponentStatus(
  id: string,
  status: ComponentStatus,
  actor: Actor,
  options: { notify?: boolean; updateBase?: boolean } = {},
): Promise<void> {
  const component = await db()
    .prepare("SELECT * FROM components WHERE id = ?")
    .bind(id)
    .first<ComponentRow>();
  if (!component || component.status === status) return;

  const ts = now();
  await db()
    .prepare(
      `UPDATE components
          SET status = ?, base_status = ?, status_since = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(status, options.updateBase === false ? component.base_status : status, ts, ts, id)
    .run();

  await audit(actor, "component.status", "component", id, {
    from: component.status,
    to: status,
  });

  const settings = await getSettings();
  if (options.notify ?? settings.notifyOnComponentChange) {
    await notify(
      {
        kind: "component_status",
        componentId: id,
        name: component.name,
        from: component.status,
        to: status,
        url: settings.siteUrl,
        at: ts,
      },
      `component:${id}:${ts}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export interface IncidentInput {
  title: string;
  status: AnyIncidentStatus;
  body: string;
  /** Component id → status to apply while the incident is open. */
  componentStatuses?: Record<string, ComponentStatus>;
  impact?: Impact;
  isMaintenance?: boolean;
  scheduledFor?: number | null;
  scheduledUntil?: number | null;
  autoTransition?: boolean;
  notify?: boolean;
  source?: IncidentRow["source"];
  sourceMonitorId?: string | null;
  /** Human-readable URL slug. Falls back to a slugified title. */
  shortlink?: string | null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/** Ensures the slug is free, appending a short suffix if not. */
async function uniqueShortlink(preferred: string): Promise<string> {
  const base = slugify(preferred) || "incident";
  const taken = await db()
    .prepare("SELECT 1 FROM incidents WHERE shortlink = ?")
    .bind(base)
    .first();
  return taken ? `${base}-${newId(4)}` : base;
}

export async function createIncident(input: IncidentInput, actor: Actor): Promise<string> {
  const id = newId();
  const ts = now();
  const componentStatuses = input.componentStatuses ?? {};
  const isMaintenance = input.isMaintenance ?? false;

  const impact =
    input.impact ??
    (isMaintenance
      ? "maintenance"
      : impactForComponentStatus(worstComponentStatus(Object.values(componentStatuses))));

  const shortlink = await uniqueShortlink(input.shortlink || input.title);
  const startedAt = isMaintenance ? (input.scheduledFor ?? ts) : ts;

  await db()
    .prepare(
      `INSERT INTO incidents
         (id, title, status, impact, is_maintenance, scheduled_for, scheduled_until,
          auto_transition, auto_component_status, source, source_monitor_id, shortlink,
          started_at, resolved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.title,
      input.status,
      impact,
      isMaintenance ? 1 : 0,
      input.scheduledFor ?? null,
      input.scheduledUntil ?? null,
      input.autoTransition === false ? 0 : 1,
      input.source ?? "manual",
      input.sourceMonitorId ?? null,
      shortlink,
      startedAt,
      ts,
      ts,
    )
    .run();

  await linkComponents(id, componentStatuses);

  // A scheduled window should not degrade anything until it actually starts.
  const applyNow = !isMaintenance || input.status === "in_progress";
  if (applyNow) {
    for (const [componentId, status] of Object.entries(componentStatuses)) {
      await setComponentStatus(componentId, status, actor, { notify: false, updateBase: false });
    }
  }

  await addIncidentUpdate(
    id,
    { status: input.status, body: input.body, notify: input.notify ?? true },
    actor,
    { skipComponentSync: true },
  );

  await audit(actor, "incident.create", "incident", id, { title: input.title, impact });
  return id;
}

async function linkComponents(
  incidentId: string,
  componentStatuses: Record<string, ComponentStatus>,
): Promise<void> {
  const ids = Object.keys(componentStatuses);
  if (ids.length === 0) return;

  const { results } = await db()
    .prepare(`SELECT id, status FROM components WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .bind(...ids)
    .all<{ id: string; status: ComponentStatus }>();

  const before = new Map(results.map((r) => [r.id, r.status]));

  await db().batch(
    ids.map((componentId) =>
      db()
        .prepare(
          `INSERT INTO incident_components (incident_id, component_id, status_before, status_during)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(incident_id, component_id)
           DO UPDATE SET status_during = excluded.status_during`,
        )
        .bind(
          incidentId,
          componentId,
          before.get(componentId) ?? "operational",
          componentStatuses[componentId],
        ),
    ),
  );
}

export interface IncidentUpdateInput {
  status: AnyIncidentStatus;
  body: string;
  componentStatuses?: Record<string, ComponentStatus>;
  notify?: boolean;
  displayAt?: number;
}

export async function addIncidentUpdate(
  incidentId: string,
  input: IncidentUpdateInput,
  actor: Actor,
  options: { skipComponentSync?: boolean } = {},
): Promise<string> {
  const incident = await db()
    .prepare("SELECT * FROM incidents WHERE id = ?")
    .bind(incidentId)
    .first<IncidentRow>();
  if (!incident) throw new Error(`Incident ${incidentId} not found.`);

  const ts = now();
  const updateId = newId();
  const displayAt = input.displayAt ?? ts;
  const closing = isClosedStatus(input.status);

  await db()
    .prepare(
      `INSERT INTO incident_updates (id, incident_id, status, body, display_at, notify, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(updateId, incidentId, input.status, input.body, displayAt, input.notify === false ? 0 : 1, ts)
    .run();

  await db()
    .prepare("UPDATE incidents SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?")
    .bind(input.status, closing ? (incident.resolved_at ?? ts) : null, ts, incidentId)
    .run();

  if (!options.skipComponentSync) {
    if (input.componentStatuses) {
      await linkComponents(incidentId, input.componentStatuses);
      for (const [componentId, status] of Object.entries(input.componentStatuses)) {
        await setComponentStatus(componentId, status, actor, { notify: false, updateBase: false });
      }
    }
    if (closing) await restoreComponents(incidentId, actor);
  }

  if (input.notify !== false) {
    const settings = await getSettings();
    const { results: components } = await db()
      .prepare(
        `SELECT ic.component_id AS id, c.name AS name, ic.status_during AS status
           FROM incident_components ic
           JOIN components c ON c.id = ic.component_id
          WHERE ic.incident_id = ?`,
      )
      .bind(incidentId)
      .all<{ id: string; name: string; status: ComponentStatus }>();

    await notify(
      {
        kind: "incident_update",
        incidentId,
        title: incident.title,
        status: input.status,
        impact: incident.impact,
        isMaintenance: incident.is_maintenance === 1,
        body: input.body,
        url: `${settings.siteUrl}/incidents/${incident.shortlink ?? incidentId}`,
        components,
        at: displayAt,
      },
      `incident_update:${updateId}`,
    );
  }

  await audit(actor, "incident.update", "incident", incidentId, { status: input.status });
  return updateId;
}

/** Puts every component the incident touched back to its pre-incident status. */
async function restoreComponents(incidentId: string, actor: Actor): Promise<void> {
  const { results } = await db()
    .prepare(
      `SELECT ic.component_id AS id, ic.status_before AS status_before, c.base_status AS base_status
         FROM incident_components ic
         JOIN components c ON c.id = ic.component_id
        WHERE ic.incident_id = ?`,
    )
    .bind(incidentId)
    .all<{ id: string; status_before: ComponentStatus; base_status: ComponentStatus }>();

  for (const row of results) {
    // Don't restore a component that a *different* open incident still affects.
    const stillAffected = await db()
      .prepare(
        `SELECT 1 FROM incident_components ic
           JOIN incidents i ON i.id = ic.incident_id
          WHERE ic.component_id = ? AND ic.incident_id != ?
            AND i.resolved_at IS NULL AND i.status NOT IN ('resolved', 'completed')
          LIMIT 1`,
      )
      .bind(row.id, incidentId)
      .first();
    if (stillAffected) continue;

    await setComponentStatus(row.id, row.base_status, actor, { notify: false });
  }
}

export async function updateIncidentDetails(
  incidentId: string,
  input: {
    title?: string;
    impact?: Impact;
    scheduledFor?: number | null;
    scheduledUntil?: number | null;
    autoTransition?: boolean;
  },
  actor: Actor,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) (sets.push("title = ?"), values.push(input.title));
  if (input.impact !== undefined) (sets.push("impact = ?"), values.push(input.impact));
  if (input.scheduledFor !== undefined)
    (sets.push("scheduled_for = ?"), values.push(input.scheduledFor));
  if (input.scheduledUntil !== undefined)
    (sets.push("scheduled_until = ?"), values.push(input.scheduledUntil));
  if (input.autoTransition !== undefined)
    (sets.push("auto_transition = ?"), values.push(input.autoTransition ? 1 : 0));

  if (sets.length === 0) return;

  sets.push("updated_at = ?");
  values.push(now(), incidentId);

  await db()
    .prepare(`UPDATE incidents SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  await audit(actor, "incident.edit", "incident", incidentId, input);
}

export async function publishPostmortem(
  incidentId: string,
  body: string,
  actor: Actor,
): Promise<void> {
  const ts = now();
  await db()
    .prepare(
      "UPDATE incidents SET postmortem_body = ?, postmortem_published_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(body, ts, ts, incidentId)
    .run();
  await audit(actor, "incident.postmortem", "incident", incidentId);
}

export async function deleteIncident(incidentId: string, actor: Actor): Promise<void> {
  await restoreComponents(incidentId, actor);
  await db().prepare("DELETE FROM incidents WHERE id = ?").bind(incidentId).run();
  await audit(actor, "incident.delete", "incident", incidentId);
}

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

export async function createSubscriber(input: {
  type: "email" | "slack" | "webhook";
  endpoint: string;
  componentIds?: string[] | null;
  /** Skip the confirmation step (admin-created subscribers). */
  preConfirmed?: boolean;
}): Promise<{ id: string; confirmToken: string | null; secret: string | null; created: boolean }> {
  const existing = await db()
    .prepare("SELECT * FROM subscribers WHERE type = ? AND endpoint = ?")
    .bind(input.type, input.endpoint)
    .first<{ id: string; state: string; confirm_token: string | null; secret: string | null }>();

  if (existing) {
    // Re-subscribing after unsubscribing resets to pending rather than erroring,
    // and an already-active subscriber is silently a no-op — the confirmation
    // flow must not reveal whether an address is already subscribed.
    if (existing.state === "unsubscribed") {
      const token = newToken(16);
      await db()
        .prepare("UPDATE subscribers SET state = 'pending', confirm_token = ? WHERE id = ?")
        .bind(token, existing.id)
        .run();
      return { id: existing.id, confirmToken: token, secret: existing.secret, created: true };
    }
    return {
      id: existing.id,
      confirmToken: existing.state === "pending" ? existing.confirm_token : null,
      secret: existing.secret,
      created: false,
    };
  }

  const id = newId();
  const confirmToken = input.preConfirmed ? null : newToken(16);
  const secret = input.type === "webhook" ? newToken(24) : null;
  const ts = now();

  await db()
    .prepare(
      `INSERT INTO subscribers
         (id, type, endpoint, secret, state, component_ids, confirm_token, unsub_token, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.type,
      input.endpoint,
      secret,
      input.preConfirmed ? "active" : "pending",
      input.componentIds && input.componentIds.length > 0
        ? JSON.stringify(input.componentIds)
        : null,
      confirmToken,
      newToken(16),
      ts,
      input.preConfirmed ? ts : null,
    )
    .run();

  return { id, confirmToken, secret, created: true };
}

export async function confirmSubscriber(token: string): Promise<boolean> {
  const result = await db()
    .prepare(
      "UPDATE subscribers SET state = 'active', confirmed_at = ?, confirm_token = NULL WHERE confirm_token = ? AND state = 'pending'",
    )
    .bind(now(), token)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function unsubscribe(token: string): Promise<boolean> {
  const result = await db()
    .prepare("UPDATE subscribers SET state = 'unsubscribed' WHERE unsub_token = ?")
    .bind(token)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteSubscriber(id: string, actor: Actor): Promise<void> {
  await db().prepare("DELETE FROM subscribers WHERE id = ?").bind(id).run();
  await audit(actor, "subscriber.delete", "subscriber", id);
}
