import Link from "next/link";

import { IncidentStatusChip } from "@/components/status/status-chip";
import { Button } from "@/components/ui/button";
import { countIncidents, listIncidentsPage } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatDate, formatDuration } from "@/lib/status/time";
import type { IncidentWithUpdates } from "@/lib/status/types";

export const metadata = { title: "Incident history" };

const PAGE_SIZE = 20;

function monthKey(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Groups incidents into month buckets, preserving the newest-first ordering. */
function byMonth(incidents: IncidentWithUpdates[]): Array<[string, IncidentWithUpdates[]]> {
  const months = new Map<string, IncidentWithUpdates[]>();
  for (const incident of incidents) {
    const key = monthKey(incident.started_at);
    const bucket = months.get(key);
    if (bucket) bucket.push(incident);
    else months.set(key, [incident]);
  }
  return [...months];
}

export default async function IncidentHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [settings, incidents, total] = await Promise.all([
    getSettings(),
    listIncidentsPage(PAGE_SIZE, (page - 1) * PAGE_SIZE),
    countIncidents(),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Incident history</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every incident and maintenance window, newest first.
        </p>
      </div>

      {incidents.length === 0 ? (
        <p className="text-muted-foreground bg-card rounded-lg border px-5 py-10 text-center text-sm">
          Nothing to report — no incidents have been recorded.
        </p>
      ) : (
        byMonth(incidents).map(([month, group]) => (
          <section key={month} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold tracking-wide uppercase">{month}</h2>
            <ul className="bg-card divide-y overflow-hidden rounded-lg border">
              {group.map((incident) => (
                <li key={incident.id}>
                  <Link
                    href={`/incidents/${incident.shortlink ?? incident.id}`}
                    className="hover:bg-muted/40 block px-5 py-4 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-sm font-medium">{incident.title}</span>
                      <IncidentStatusChip status={incident.status} />
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatDate(incident.started_at, settings.timezone)}
                      {incident.resolved_at &&
                        ` · lasted ${formatDuration(incident.resolved_at - incident.started_at)}`}
                      {incident.components.length > 0 &&
                        ` · ${incident.components.map((c) => c.name).join(", ")}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
            {page > 1 ? <Link href={`/incidents?page=${page - 1}`}>Newer</Link> : <span>Newer</span>}
          </Button>
          <span className="text-muted-foreground text-xs">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} asChild={page < pages}>
            {page < pages ? (
              <Link href={`/incidents?page=${page + 1}`}>Older</Link>
            ) : (
              <span>Older</span>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}
