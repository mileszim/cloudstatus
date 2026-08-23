import Link from "next/link";
import { PlusIcon, RefreshCwIcon } from "lucide-react";

import { runAllChecksAction } from "./actions";
import { PageHeader, Section } from "@/components/admin/page-header";
import { SubmitButton } from "@/components/admin/form";
import { IncidentStatusChip } from "@/components/status/status-chip";
import { StatusDot } from "@/components/status/status-dot";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db/client";
import {
  getLastCheckedAt,
  getOverallStatus,
  listActiveIncidents,
  listComponents,
  listOpenMaintenances,
} from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatDateTime, relativeTime } from "@/lib/status/time";
import {
  COMPONENT_STATUS_LABEL,
  PAGE_INDICATOR_LABEL,
  type MonitorRow,
} from "@/lib/status/types";
import { INDICATOR_TEXT, STATUS_TEXT } from "@/lib/status/ui";
import { cn } from "@/lib/utils";

export const metadata = { title: "Overview" };

interface Counts {
  subscribers: number;
  pendingNotifications: number;
  failedNotifications: number;
}

async function counts(): Promise<Counts> {
  const [subscribers, notifications] = await Promise.all([
    db()
      .prepare("SELECT COUNT(*) AS n FROM subscribers WHERE state = 'active'")
      .first<{ n: number }>(),
    db()
      .prepare(
        `SELECT
           SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN state = 'failed'  THEN 1 ELSE 0 END) AS failed
         FROM notifications`,
      )
      .first<{ pending: number | null; failed: number | null }>(),
  ]);

  return {
    subscribers: subscribers?.n ?? 0,
    pendingNotifications: notifications?.pending ?? 0,
    failedNotifications: notifications?.failed ?? 0,
  };
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-card rounded-lg border px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold", tone)}>{value}</p>
    </div>
  );
}

export default async function AdminOverview() {
  const [settings, overall, components, incidents, maintenances, monitors, stats, lastChecked] =
    await Promise.all([
      getSettings(),
      getOverallStatus(),
      listComponents(),
      listActiveIncidents(),
      listOpenMaintenances(),
      db()
        .prepare("SELECT * FROM monitors ORDER BY enabled DESC, last_ok ASC, name")
        .all<MonitorRow>(),
      counts(),
      getLastCheckedAt(),
    ]);

  const failing = monitors.results.filter((m) => m.enabled === 1 && m.last_ok === 0);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${PAGE_INDICATOR_LABEL[overall.indicator]} · ${components.length} components, ${monitors.results.length} monitors`}
        action={
          <div className="flex gap-2">
            <form action={runAllChecksAction}>
              <SubmitButton variant="outline" size="sm" pendingLabel="Running…">
                <RefreshCwIcon className="size-3.5" />
                Run checks now
              </SubmitButton>
            </form>
            <Button size="sm" asChild>
              <Link href="/admin/incidents/new">
                <PlusIcon className="size-3.5" />
                New incident
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Page status"
          value={PAGE_INDICATOR_LABEL[overall.indicator]}
          tone={INDICATOR_TEXT[overall.indicator]}
        />
        <Stat
          label="Open incidents"
          value={String(overall.openIncidents)}
          tone={overall.openIncidents > 0 ? "text-major" : undefined}
        />
        <Stat
          label="Failing monitors"
          value={`${failing.length} of ${monitors.results.filter((m) => m.enabled === 1).length}`}
          tone={failing.length > 0 ? "text-major" : undefined}
        />
        <Stat label="Active subscribers" value={String(stats.subscribers)} />
      </div>

      {(stats.pendingNotifications > 0 || stats.failedNotifications > 0) && (
        <p className="bg-degraded-soft text-degraded mb-6 rounded-md px-4 py-2.5 text-sm">
          {stats.pendingNotifications} notifications queued, {stats.failedNotifications} awaiting
          retry. The minute cron drains these automatically.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Open incidents"
          description={
            incidents.length + maintenances.length === 0
              ? "Nothing is currently open."
              : undefined
          }
        >
          <ul className="divide-y">
            {[...incidents, ...maintenances].map((incident) => (
              <li key={incident.id}>
                <Link
                  href={`/admin/incidents/${incident.id}`}
                  className="hover:bg-muted/40 flex items-start justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{incident.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {relativeTime(incident.updates[0]?.display_at ?? incident.started_at)} ·{" "}
                      {incident.components.map((c) => c.name).join(", ") || "no components"}
                    </p>
                  </div>
                  <IncidentStatusChip status={incident.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Monitors"
          description={
            lastChecked
              ? `Last probe ${relativeTime(lastChecked)} · ${formatDateTime(lastChecked, settings.timezone)}`
              : "No checks have run yet."
          }
          footer={
            <Link href="/admin/monitors" className="text-muted-foreground hover:text-foreground text-xs">
              Manage monitors →
            </Link>
          }
        >
          <ul className="divide-y">
            {monitors.results.slice(0, 8).map((monitor) => (
              <li key={monitor.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot
                    status={
                      monitor.enabled === 0
                        ? "under_maintenance"
                        : monitor.last_ok === 0
                          ? "major_outage"
                          : "operational"
                    }
                    pulse={false}
                  />
                  <span className="truncate text-sm">{monitor.name}</span>
                </div>
                <span className="text-muted-foreground tnum shrink-0 text-xs">
                  {monitor.enabled === 0
                    ? "disabled"
                    : monitor.last_latency_ms != null
                      ? `${monitor.last_latency_ms}ms`
                      : "—"}
                </span>
              </li>
            ))}
            {monitors.results.length === 0 && (
              <li className="text-muted-foreground px-5 py-4 text-sm">
                No monitors yet. Add one to start collecting uptime history.
              </li>
            )}
          </ul>
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Components" description="Current status of every service on the page.">
        <ul className="divide-y">
          {components.map((component) => (
            <li key={component.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div className="flex items-center gap-2">
                <StatusDot status={component.status} pulse={false} />
                <span className="text-sm">{component.name}</span>
              </div>
              <span className={cn("text-xs", STATUS_TEXT[component.status])}>
                {COMPONENT_STATUS_LABEL[component.status]}
              </span>
            </li>
          ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
