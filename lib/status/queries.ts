import { db } from "@/lib/db/client";
import { recentUtcDays, toUtcDay, utcDayStart } from "@/lib/status/time";
import {
  type AnyIncidentStatus,
  type ComponentGroupRow,
  type ComponentGroupWithComponents,
  type ComponentRow,
  type ComponentStatus,
  type ComponentWithUptime,
  type DailyUptime,
  type IncidentComponentRow,
  type IncidentRow,
  type IncidentUpdateRow,
  type IncidentWithUpdates,
  type PageIndicator,
  indicatorForComponentStatus,
  worstComponentStatus,
} from "@/lib/status/types";

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export async function listComponents(): Promise<ComponentRow[]> {
  const { results } = await db()
    .prepare("SELECT * FROM components ORDER BY position, name")
    .all<ComponentRow>();
  return results;
}

export async function listComponentGroups(): Promise<ComponentGroupRow[]> {
  const { results } = await db()
    .prepare("SELECT * FROM component_groups ORDER BY position, name")
    .all<ComponentGroupRow>();
  return results;
}

export async function getComponent(id: string): Promise<ComponentRow | null> {
  return db().prepare("SELECT * FROM components WHERE id = ?").bind(id).first<ComponentRow>();
}

// ---------------------------------------------------------------------------
// Uptime
//
// Historical days come from the `uptime_daily` rollup; the current UTC day is
// computed live from `checks`, so the rightmost bar updates within a minute of
// the probe running instead of waiting for the nightly rollup.
// ---------------------------------------------------------------------------

interface UptimeAggregate {
  component_id: string;
  day: string;
  up: number;
  degraded: number;
  down: number;
  avg_latency_ms: number | null;
}

async function historicalUptime(days: number): Promise<UptimeAggregate[]> {
  const from = recentUtcDays(days)[0];
  const { results } = await db()
    .prepare(
      `SELECT m.component_id AS component_id,
              u.day          AS day,
              SUM(u.up)       AS up,
              SUM(u.degraded) AS degraded,
              SUM(u.down)     AS down,
              AVG(u.avg_latency_ms) AS avg_latency_ms
         FROM uptime_daily u
         JOIN monitors m ON m.id = u.monitor_id
        WHERE u.day >= ? AND m.component_id IS NOT NULL
        GROUP BY m.component_id, u.day`,
    )
    .bind(from)
    .all<UptimeAggregate>();
  return results;
}

async function todayUptime(): Promise<UptimeAggregate[]> {
  const day = toUtcDay(Math.floor(Date.now() / 1000));
  const { results } = await db()
    .prepare(
      `SELECT m.component_id AS component_id,
              SUM(CASE WHEN c.outcome = 'up'       THEN 1 ELSE 0 END) AS up,
              SUM(CASE WHEN c.outcome = 'degraded' THEN 1 ELSE 0 END) AS degraded,
              SUM(CASE WHEN c.outcome = 'down'     THEN 1 ELSE 0 END) AS down,
              AVG(c.latency_ms) AS avg_latency_ms
         FROM checks c
         JOIN monitors m ON m.id = c.monitor_id
        WHERE c.checked_at >= ? AND m.component_id IS NOT NULL
        GROUP BY m.component_id`,
    )
    .bind(utcDayStart(day))
    .all<Omit<UptimeAggregate, "day">>();
  return results.map((r) => ({ ...r, day }));
}

function dailyFromAggregate(day: string, agg: UptimeAggregate | undefined): DailyUptime {
  if (!agg) return { day, outcome: "no_data", uptimePct: null, avgLatencyMs: null, total: 0 };

  const total = agg.up + agg.degraded + agg.down;
  if (total === 0) return { day, outcome: "no_data", uptimePct: null, avgLatencyMs: null, total: 0 };

  // A day is only "up" if nothing failed. One failed probe out of 1440 still
  // shows as degraded — under-reporting a bad day is worse than over-reporting.
  //
  // Degraded probes count against uptime alongside failures. Counting them as
  // healthy would print "100.00% uptime" next to a row of amber ticks, which
  // reads as a bug even when the arithmetic is defensible.
  const outcome = agg.down > 0 ? "down" : agg.degraded > 0 ? "degraded" : "up";
  return {
    day,
    outcome,
    uptimePct: (agg.up / total) * 100,
    avgLatencyMs: agg.avg_latency_ms,
    total,
  };
}

/** Per-component daily uptime series, oldest day first. */
export async function getUptimeSeries(
  days: number,
): Promise<Map<string, { series: DailyUptime[]; uptimePct: number | null }>> {
  const [historical, today] = await Promise.all([historicalUptime(days), todayUptime()]);
  const currentDay = toUtcDay(Math.floor(Date.now() / 1000));

  const byComponent = new Map<string, Map<string, UptimeAggregate>>();
  for (const row of [...historical.filter((r) => r.day !== currentDay), ...today]) {
    let dayMap = byComponent.get(row.component_id);
    if (!dayMap) byComponent.set(row.component_id, (dayMap = new Map()));
    dayMap.set(row.day, row);
  }

  const window = recentUtcDays(days);
  const out = new Map<string, { series: DailyUptime[]; uptimePct: number | null }>();

  for (const [componentId, dayMap] of byComponent) {
    const series = window.map((day) => dailyFromAggregate(day, dayMap.get(day)));
    const withData = series.filter((d) => d.total > 0);
    const totals = withData.reduce(
      (acc, d) => {
        acc.up += (d.uptimePct! / 100) * d.total;
        acc.total += d.total;
        return acc;
      },
      { up: 0, total: 0 },
    );
    out.set(componentId, {
      series,
      uptimePct: totals.total > 0 ? (totals.up / totals.total) * 100 : null,
    });
  }

  return out;
}

/**
 * The public component tree: groups in order, each with its components, plus a
 * synthetic trailing group for ungrouped components.
 *
 * `only_show_if_degraded` components are filtered out while operational.
 */
export async function getComponentTree(uptimeDays: number): Promise<{
  groups: ComponentGroupWithComponents[];
  ungrouped: ComponentWithUptime[];
}> {
  const [components, groups, uptime] = await Promise.all([
    listComponents(),
    listComponentGroups(),
    getUptimeSeries(uptimeDays),
  ]);

  const emptySeries = recentUtcDays(uptimeDays).map<DailyUptime>((day) => ({
    day,
    outcome: "no_data",
    uptimePct: null,
    avgLatencyMs: null,
    total: 0,
  }));

  const visible = components.filter(
    (c) => !c.only_show_if_degraded || c.status !== "operational",
  );

  const decorate = (c: ComponentRow): ComponentWithUptime => {
    const u = uptime.get(c.id);
    return { ...c, uptime: u?.series ?? emptySeries, uptimePct: u?.uptimePct ?? null };
  };

  const grouped = groups.map<ComponentGroupWithComponents>((g) => {
    const members = visible.filter((c) => c.group_id === g.id).map(decorate);
    return {
      ...g,
      components: members,
      status: worstComponentStatus(members.map((c) => c.status)),
    };
  });

  return {
    groups: grouped.filter((g) => g.components.length > 0),
    ungrouped: visible.filter((c) => c.group_id === null).map(decorate),
  };
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

const OPEN_INCIDENT_WHERE = "is_maintenance = 0 AND resolved_at IS NULL";

export async function listActiveIncidents(): Promise<IncidentWithUpdates[]> {
  const { results } = await db()
    .prepare(`SELECT * FROM incidents WHERE ${OPEN_INCIDENT_WHERE} ORDER BY started_at DESC`)
    .all<IncidentRow>();
  return hydrateIncidents(results);
}

/** Maintenance windows that are scheduled or running but not yet completed. */
export async function listOpenMaintenances(): Promise<IncidentWithUpdates[]> {
  const { results } = await db()
    .prepare(
      `SELECT * FROM incidents
        WHERE is_maintenance = 1 AND status != 'completed'
        ORDER BY scheduled_for ASC`,
    )
    .all<IncidentRow>();
  return hydrateIncidents(results);
}

export async function listRecentIncidents(sinceUnix: number): Promise<IncidentWithUpdates[]> {
  const { results } = await db()
    .prepare("SELECT * FROM incidents WHERE started_at >= ? ORDER BY started_at DESC")
    .bind(sinceUnix)
    .all<IncidentRow>();
  return hydrateIncidents(results);
}

export async function listIncidentsPage(
  limit: number,
  offset: number,
  opts: { maintenance?: boolean } = {},
): Promise<IncidentWithUpdates[]> {
  const filter = opts.maintenance === undefined ? "" : `WHERE is_maintenance = ${opts.maintenance ? 1 : 0}`;
  const { results } = await db()
    .prepare(`SELECT * FROM incidents ${filter} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
    .bind(limit, offset)
    .all<IncidentRow>();
  return hydrateIncidents(results);
}

export async function countIncidents(opts: { maintenance?: boolean } = {}): Promise<number> {
  const filter = opts.maintenance === undefined ? "" : `WHERE is_maintenance = ${opts.maintenance ? 1 : 0}`;
  const row = await db()
    .prepare(`SELECT COUNT(*) AS n FROM incidents ${filter}`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getIncident(id: string): Promise<IncidentWithUpdates | null> {
  const incident = await db()
    .prepare("SELECT * FROM incidents WHERE id = ? OR shortlink = ?")
    .bind(id, id)
    .first<IncidentRow>();
  if (!incident) return null;
  const [hydrated] = await hydrateIncidents([incident]);
  return hydrated ?? null;
}

/** Attaches updates and affected components in two queries regardless of incident count. */
async function hydrateIncidents(incidents: IncidentRow[]): Promise<IncidentWithUpdates[]> {
  if (incidents.length === 0) return [];

  const ids = incidents.map((i) => i.id);
  const placeholders = ids.map(() => "?").join(", ");

  const [updates, components] = await Promise.all([
    db()
      .prepare(
        `SELECT * FROM incident_updates WHERE incident_id IN (${placeholders})
          ORDER BY display_at DESC, created_at DESC`,
      )
      .bind(...ids)
      .all<IncidentUpdateRow>(),
    db()
      .prepare(
        `SELECT ic.incident_id, ic.component_id, ic.status_during, c.name
           FROM incident_components ic
           JOIN components c ON c.id = ic.component_id
          WHERE ic.incident_id IN (${placeholders})
          ORDER BY c.position, c.name`,
      )
      .bind(...ids)
      .all<Pick<IncidentComponentRow, "incident_id" | "component_id" | "status_during"> & {
        name: string;
      }>(),
  ]);

  return incidents.map((incident) => ({
    ...incident,
    updates: updates.results.filter((u) => u.incident_id === incident.id),
    components: components.results
      .filter((c) => c.incident_id === incident.id)
      .map((c) => ({ id: c.component_id, name: c.name, status_during: c.status_during })),
  }));
}

// ---------------------------------------------------------------------------
// Overall status
// ---------------------------------------------------------------------------

export interface OverallStatus {
  indicator: PageIndicator;
  worstComponent: ComponentStatus;
  /** Count of unresolved incidents, excluding maintenance. */
  openIncidents: number;
  activeMaintenances: number;
}

export async function getOverallStatus(): Promise<OverallStatus> {
  const [componentRow, incidentRow] = await Promise.all([
    db()
      .prepare("SELECT status FROM components")
      .all<{ status: ComponentStatus }>(),
    db()
      .prepare(
        `SELECT
           SUM(CASE WHEN is_maintenance = 0 AND resolved_at IS NULL THEN 1 ELSE 0 END) AS open_incidents,
           SUM(CASE WHEN is_maintenance = 1 AND status = 'in_progress' THEN 1 ELSE 0 END) AS active_maintenances
         FROM incidents`,
      )
      .first<{ open_incidents: number | null; active_maintenances: number | null }>(),
  ]);

  const worst = worstComponentStatus(componentRow.results.map((r) => r.status));

  return {
    indicator: indicatorForComponentStatus(worst),
    worstComponent: worst,
    openIncidents: incidentRow?.open_incidents ?? 0,
    activeMaintenances: incidentRow?.active_maintenances ?? 0,
  };
}

/** Statuses an incident may take, given whether it is a maintenance window. */
export function statusOptions(isMaintenance: boolean): AnyIncidentStatus[] {
  return isMaintenance
    ? ["scheduled", "in_progress", "verifying", "completed"]
    : ["investigating", "identified", "monitoring", "resolved"];
}

/** Most recent probe across all monitors, used for the "last checked" line. */
export async function getLastCheckedAt(): Promise<number | null> {
  const row = await db()
    .prepare("SELECT MAX(last_checked_at) AS ts FROM monitors WHERE enabled = 1")
    .first<{ ts: number | null }>();
  return row?.ts ?? null;
}

export interface LatencyPoint {
  day: string;
  /** Average latency in ms across the component's monitors that day. */
  ms: number;
}

/** Daily average latency per component, for the uptime showcase chart. */
export async function getLatencySeries(days: number): Promise<Map<string, LatencyPoint[]>> {
  const from = recentUtcDays(days)[0];
  const { results } = await db()
    .prepare(
      `SELECT m.component_id AS component_id,
              u.day          AS day,
              AVG(u.avg_latency_ms) AS ms
         FROM uptime_daily u
         JOIN monitors m ON m.id = u.monitor_id
        WHERE u.day >= ? AND m.component_id IS NOT NULL AND u.avg_latency_ms IS NOT NULL
        GROUP BY m.component_id, u.day
        ORDER BY u.day`,
    )
    .bind(from)
    .all<{ component_id: string; day: string; ms: number }>();

  const out = new Map<string, LatencyPoint[]>();
  for (const row of results) {
    const points = out.get(row.component_id) ?? [];
    points.push({ day: row.day, ms: Math.round(row.ms) });
    out.set(row.component_id, points);
  }
  return out;
}
