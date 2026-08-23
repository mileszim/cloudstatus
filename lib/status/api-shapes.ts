import {
  getComponentTree,
  getOverallStatus,
  listActiveIncidents,
  listComponentGroups,
  listComponents,
  listOpenMaintenances,
  listRecentIncidents,
} from "@/lib/status/queries";
import { getSettings, type Settings } from "@/lib/status/settings";
import {
  PAGE_INDICATOR_LABEL,
  worstComponentStatus,
  type ComponentRow,
  type IncidentWithUpdates,
} from "@/lib/status/types";

/**
 * Response shapes for `/api/v2/*`.
 *
 * These deliberately mirror Atlassian Statuspage's public API field-for-field.
 * It is the de-facto standard that Slack apps, uptime aggregators, and status
 * dashboards already parse, so matching it means existing tooling works against
 * this page with no changes. Fields we do not model (page_id, tweet ids) are
 * still emitted, with null or derived values, because consumers index into them.
 */

const iso = (unix: number | null): string | null =>
  unix == null ? null : new Date(unix * 1000).toISOString();

function pageObject(settings: Settings, updatedAt: number) {
  return {
    id: "cloudstatus",
    name: settings.pageName,
    url: settings.siteUrl,
    time_zone: settings.timezone,
    updated_at: iso(updatedAt),
  };
}

function componentObject(component: ComponentRow, groupChildren: string[] | null) {
  return {
    id: component.id,
    page_id: "cloudstatus",
    group_id: component.group_id,
    // Statuspage marks group rows with `group: true`; leaf components are false.
    group: groupChildren !== null,
    components: groupChildren,
    name: component.name,
    description: component.description,
    status: component.status,
    position: component.position,
    showcase: component.showcase === 1,
    only_show_if_degraded: component.only_show_if_degraded === 1,
    start_date: new Date(component.created_at * 1000).toISOString().slice(0, 10),
    created_at: iso(component.created_at),
    updated_at: iso(component.updated_at),
  };
}

function incidentObject(incident: IncidentWithUpdates, settings: Settings) {
  const affected = incident.components.map((c) => ({
    code: c.id,
    name: c.name,
    old_status: "operational",
    new_status: c.status_during,
  }));

  return {
    id: incident.id,
    // Statuspage calls the title "name".
    name: incident.title,
    status: incident.status,
    impact: incident.impact,
    created_at: iso(incident.created_at),
    updated_at: iso(incident.updated_at),
    monitoring_at: iso(
      incident.updates.find((u) => u.status === "monitoring")?.display_at ?? null,
    ),
    resolved_at: iso(incident.resolved_at),
    shortlink: `${settings.siteUrl}/incidents/${incident.shortlink ?? incident.id}`,
    started_at: iso(incident.started_at),
    page_id: "cloudstatus",
    scheduled_for: iso(incident.scheduled_for),
    scheduled_until: iso(incident.scheduled_until),
    scheduled_remind_prior: false,
    scheduled_reminded_at: null,
    impact_override: null,
    incident_updates: incident.updates.map((update) => ({
      id: update.id,
      incident_id: incident.id,
      status: update.status,
      body: update.body,
      created_at: iso(update.created_at),
      updated_at: iso(update.created_at),
      display_at: iso(update.display_at),
      deliver_notifications: update.notify === 1,
      affected_components: affected,
      custom_tweet: null,
      tweet_id: null,
    })),
    components: incident.components.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status_during,
      page_id: "cloudstatus",
    })),
  };
}

/** Components, ordered as the page shows them, with group rows interleaved. */
async function componentsPayload() {
  const [components, groups] = await Promise.all([listComponents(), listComponentGroups()]);

  const groupRows = groups.map((g) => {
    const members = components.filter((c) => c.group_id === g.id);
    return componentObject(
      {
        id: g.id,
        group_id: null,
        name: g.name,
        description: g.description,
        // A group reports the worst status among its members, matching the page.
        status: worstComponentStatus(members.map((c) => c.status)),
        base_status: "operational",
        position: g.position,
        showcase: 0,
        only_show_if_degraded: 0,
        status_since: g.created_at,
        created_at: g.created_at,
        updated_at: g.updated_at,
      },
      members.map((c) => c.id),
    );
  });

  return [...groupRows, ...components.map((c) => componentObject(c, null))];
}

export async function statusPayload() {
  const [settings, overall] = await Promise.all([getSettings(), getOverallStatus()]);
  return {
    page: pageObject(settings, Math.floor(Date.now() / 1000)),
    status: {
      indicator: overall.indicator,
      description: PAGE_INDICATOR_LABEL[overall.indicator],
    },
  };
}

export async function componentsResponse() {
  const [settings, components] = await Promise.all([getSettings(), componentsPayload()]);
  return { page: pageObject(settings, Math.floor(Date.now() / 1000)), components };
}

export async function incidentsResponse(scope: "all" | "unresolved") {
  const [settings, incidents] = await Promise.all([
    getSettings(),
    scope === "unresolved"
      ? listActiveIncidents()
      : listRecentIncidents(Math.floor(Date.now() / 1000) - 365 * 86_400),
  ]);
  return {
    page: pageObject(settings, Math.floor(Date.now() / 1000)),
    incidents: incidents
      .filter((i) => i.is_maintenance === 0)
      .map((i) => incidentObject(i, settings)),
  };
}

export async function maintenancesResponse(scope: "all" | "upcoming" | "active") {
  const settings = await getSettings();
  const open = await listOpenMaintenances();
  const all =
    scope === "all"
      ? (await listRecentIncidents(Math.floor(Date.now() / 1000) - 365 * 86_400)).filter(
          (i) => i.is_maintenance === 1,
        )
      : open;

  const filtered =
    scope === "upcoming"
      ? all.filter((m) => m.status === "scheduled")
      : scope === "active"
        ? all.filter((m) => m.status === "in_progress" || m.status === "verifying")
        : all;

  return {
    page: pageObject(settings, Math.floor(Date.now() / 1000)),
    scheduled_maintenances: filtered.map((m) => incidentObject(m, settings)),
  };
}

/** The everything endpoint most consumers poll. */
export async function summaryResponse() {
  const settings = await getSettings();
  const [overall, tree, components, incidents, maintenances] = await Promise.all([
    getOverallStatus(),
    getComponentTree(settings.uptimeDays),
    componentsPayload(),
    listActiveIncidents(),
    listOpenMaintenances(),
  ]);

  return {
    page: pageObject(settings, Math.floor(Date.now() / 1000)),
    components,
    incidents: incidents.map((i) => incidentObject(i, settings)),
    scheduled_maintenances: maintenances.map((m) => incidentObject(m, settings)),
    status: {
      indicator: overall.indicator,
      description: PAGE_INDICATOR_LABEL[overall.indicator],
    },
    // Not part of Statuspage's schema — a convenience for consumers that would
    // otherwise have to reconstruct the uptime strip from raw checks.
    uptime: Object.fromEntries(
      [...tree.groups.flatMap((g) => g.components), ...tree.ungrouped].map((c) => [
        c.id,
        { days: c.uptime.length, uptime_pct: c.uptimePct },
      ]),
    ),
  };
}

/** Shared headers: public, briefly cacheable at the edge, readable cross-origin. */
export function publicJsonHeaders(maxAge = 10): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 3}`,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
  };
}
