import Link from "next/link";

import { ComponentList } from "@/components/status/component-list";
import { IncidentCard } from "@/components/status/incident-card";
import { OverallBanner } from "@/components/status/overall-banner";
import { StatusDot } from "@/components/status/status-dot";
import {
  getComponentTree,
  getLastCheckedAt,
  getOverallStatus,
  listActiveIncidents,
  listOpenMaintenances,
  listRecentIncidents,
} from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatDate, relativeTime } from "@/lib/status/time";
import {
  worstComponentStatus,
  type ComponentStatus,
  type IncidentWithUpdates,
} from "@/lib/status/types";

const HISTORY_DAYS = 14;

function bannerDetail(open: number, maintenances: number): string | undefined {
  const parts: string[] = [];
  if (open > 0) parts.push(`${open} open ${open === 1 ? "incident" : "incidents"}`);
  if (maintenances > 0)
    parts.push(`${maintenances} maintenance ${maintenances === 1 ? "window" : "windows"} in progress`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export default async function StatusPage() {
  const settings = await getSettings();

  const [overall, tree, incidents, maintenances, recent, lastCheckedAt] = await Promise.all([
    getOverallStatus(),
    getComponentTree(settings.uptimeDays),
    listActiveIncidents(),
    listOpenMaintenances(),
    listRecentIncidents(Math.floor(Date.now() / 1000) - HISTORY_DAYS * 86_400),
    getLastCheckedAt(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <OverallBanner
        indicator={overall.indicator}
        lastCheckedAt={lastCheckedAt}
        detail={bannerDetail(overall.openIncidents, overall.activeMaintenances)}
      />

      {incidents.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase">Active incidents</h2>
          {incidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} timezone={settings.timezone} compact />
          ))}
        </section>
      )}

      {maintenances.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase">Scheduled maintenance</h2>
          {maintenances.map((m) => (
            <IncidentCard key={m.id} incident={m} timezone={settings.timezone} compact />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Current status by service</h2>
        <ComponentList groups={tree.groups} ungrouped={tree.ungrouped} />
      </section>

      <RecentHistory incidents={recent} timezone={settings.timezone} />
    </div>
  );
}

function RecentHistory({
  incidents,
  timezone,
}: {
  incidents: IncidentWithUpdates[];
  timezone: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Past {HISTORY_DAYS} days
        </h2>
        <Link href="/incidents" className="text-muted-foreground hover:text-foreground text-xs">
          Full history →
        </Link>
      </div>

      {incidents.length === 0 ? (
        <div className="bg-card flex items-center gap-2.5 rounded-lg border px-5 py-4 text-sm">
          <StatusDot status="operational" pulse={false} />
          <span className="text-muted-foreground">
            No incidents reported in the past {HISTORY_DAYS} days.
          </span>
        </div>
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-lg border">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link
                href={`/incidents/${incident.shortlink ?? incident.id}`}
                className="hover:bg-muted/40 flex items-start justify-between gap-4 px-5 py-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot
                      status={worstOf(incident)}
                      pulse={false}
                      className="mt-[3px] self-start"
                    />
                    <span className="truncate text-sm font-medium">{incident.title}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 ml-[18px] text-xs">
                    {formatDate(incident.started_at, timezone)}
                    {incident.resolved_at
                      ? ` · resolved ${relativeTime(incident.resolved_at)}`
                      : " · ongoing"}
                  </p>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs capitalize">
                  {incident.impact}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Worst component status the incident touched, for the history dot colour. */
function worstOf(incident: IncidentWithUpdates): ComponentStatus {
  if (incident.components.length > 0) {
    return worstComponentStatus(incident.components.map((c) => c.status_during));
  }
  // Older or API-created incidents may not link components; fall back to impact.
  switch (incident.impact) {
    case "critical":
      return "major_outage";
    case "major":
      return "partial_outage";
    case "maintenance":
      return "under_maintenance";
    case "none":
      return "operational";
    default:
      return "degraded_performance";
  }
}
