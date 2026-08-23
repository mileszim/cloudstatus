import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Markdown } from "@/components/status/markdown";
import { IncidentStatusChip, StatusChip } from "@/components/status/status-chip";
import { getIncident } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatDateTime, formatDuration, relativeTime } from "@/lib/status/time";
import { INCIDENT_STATUS_LABEL, IMPACT_LABEL } from "@/lib/status/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const incident = await getIncident(id);
  return { title: incident?.title ?? "Incident" };
}

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [incident, settings] = await Promise.all([getIncident(id), getSettings()]);
  if (!incident) notFound();

  const tz = settings.timezone;
  const duration = incident.resolved_at ? incident.resolved_at - incident.started_at : null;

  return (
    <article className="flex flex-col gap-8">
      <div>
        <Link
          href="/incidents"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
        >
          <ArrowLeftIcon className="size-3.5" />
          All incidents
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl leading-tight font-semibold text-balance">{incident.title}</h1>
          <IncidentStatusChip status={incident.status} />
        </div>
      </div>

      <dl className="bg-card grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border px-5 py-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground text-xs">
            {incident.is_maintenance ? "Scheduled" : "Started"}
          </dt>
          <dd className="mt-0.5">
            {formatDateTime(incident.scheduled_for ?? incident.started_at, tz)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">
            {incident.is_maintenance ? "Until" : "Resolved"}
          </dt>
          <dd className="mt-0.5">
            {incident.is_maintenance
              ? incident.scheduled_until
                ? formatDateTime(incident.scheduled_until, tz)
                : "—"
              : incident.resolved_at
                ? formatDateTime(incident.resolved_at, tz)
                : "Ongoing"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Duration</dt>
          <dd className="mt-0.5">
            {duration != null
              ? formatDuration(duration)
              : formatDuration(Math.floor(Date.now() / 1000) - incident.started_at) + " so far"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Impact</dt>
          <dd className="mt-0.5">{IMPACT_LABEL[incident.impact]}</dd>
        </div>
      </dl>

      {incident.components.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">Affected services</h2>
          <ul className="flex flex-wrap gap-2">
            {incident.components.map((c) => (
              <li key={c.id} className="bg-card flex items-center gap-2 rounded-md border px-3 py-1.5">
                <span className="text-sm">{c.name}</span>
                <StatusChip status={c.status_during} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Updates</h2>
        <ol className="bg-card divide-y overflow-hidden rounded-lg border">
          {incident.updates.map((update) => (
            <li key={update.id} className="px-5 py-4">
              <div className="text-muted-foreground flex flex-wrap items-baseline gap-2 text-xs">
                <span className="text-foreground text-sm font-medium">
                  {INCIDENT_STATUS_LABEL[update.status]}
                </span>
                <span>{formatDateTime(update.display_at, tz)}</span>
                <span>·</span>
                <span>{relativeTime(update.display_at)}</span>
              </div>
              <Markdown className="mt-1.5">{update.body}</Markdown>
            </li>
          ))}
          {incident.updates.length === 0 && (
            <li className="text-muted-foreground px-5 py-4 text-sm">No updates posted.</li>
          )}
        </ol>
      </section>

      {incident.postmortem_body && incident.postmortem_published_at && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wide uppercase">Postmortem</h2>
            <span className="text-muted-foreground text-xs">
              Published {formatDateTime(incident.postmortem_published_at, tz)}
            </span>
          </div>
          <div className="bg-card rounded-lg border px-5 py-4">
            <Markdown>{incident.postmortem_body}</Markdown>
          </div>
        </section>
      )}
    </article>
  );
}
