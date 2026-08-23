import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { PageHeader, Section } from "@/components/admin/page-header";
import { IncidentStatusChip } from "@/components/status/status-chip";
import { Button } from "@/components/ui/button";
import { countIncidents, listIncidentsPage } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatDateTime, formatDuration } from "@/lib/status/time";
import { IMPACT_LABEL } from "@/lib/status/types";

export const metadata = { title: "Incidents" };

const PAGE_SIZE = 25;

export default async function AdminIncidentsPage({
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
    <>
      <PageHeader
        title="Incidents"
        description={`${total} recorded, including maintenance windows.`}
        action={
          <Button size="sm" asChild>
            <Link href="/admin/incidents/new">
              <PlusIcon className="size-3.5" />
              New incident
            </Link>
          </Button>
        }
      />

      <Section title="All incidents">
        <ul className="divide-y">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link
                href={`/admin/incidents/${incident.id}`}
                className="hover:bg-muted/40 flex flex-wrap items-start justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{incident.title}</span>
                    {incident.is_maintenance === 1 && (
                      <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 text-[10px] uppercase">
                        maintenance
                      </span>
                    )}
                    {incident.source !== "manual" && (
                      <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
                        {incident.source}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {formatDateTime(incident.started_at, settings.timezone)}
                    {incident.resolved_at &&
                      ` · ${formatDuration(incident.resolved_at - incident.started_at)}`}
                    {` · ${IMPACT_LABEL[incident.impact]} impact`}
                    {` · ${incident.updates.length} ${incident.updates.length === 1 ? "update" : "updates"}`}
                  </p>
                </div>
                <IncidentStatusChip status={incident.status} />
              </Link>
            </li>
          ))}
          {incidents.length === 0 && (
            <li className="text-muted-foreground px-5 py-8 text-center text-sm">
              No incidents recorded.
            </li>
          )}
        </ul>
      </Section>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
          <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
            {page > 1 ? (
              <Link href={`/admin/incidents?page=${page - 1}`}>Newer</Link>
            ) : (
              <span>Newer</span>
            )}
          </Button>
          <span className="text-muted-foreground text-xs">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} asChild={page < pages}>
            {page < pages ? (
              <Link href={`/admin/incidents?page=${page + 1}`}>Older</Link>
            ) : (
              <span>Older</span>
            )}
          </Button>
        </nav>
      )}
    </>
  );
}
