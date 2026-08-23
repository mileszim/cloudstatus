import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";

import { Markdown } from "@/components/status/markdown";
import { IncidentStatusChip } from "@/components/status/status-chip";
import { COMPONENT_STATUS_LABEL, type IncidentWithUpdates } from "@/lib/status/types";
import { formatDateTime, relativeTime } from "@/lib/status/time";
import { cn } from "@/lib/utils";

const IMPACT_RULE: Record<string, string> = {
  none: "bg-unknown",
  minor: "bg-degraded",
  major: "bg-partial",
  critical: "bg-major",
  maintenance: "bg-maintenance",
};

/**
 * One incident with its update timeline. `compact` trims to the latest two
 * updates for the home page; detail pages show everything.
 */
export function IncidentCard({
  incident,
  timezone,
  compact = false,
}: {
  incident: IncidentWithUpdates;
  timezone: string;
  compact?: boolean;
}) {
  const updates = compact ? incident.updates.slice(0, 2) : incident.updates;
  const hidden = incident.updates.length - updates.length;
  const href = `/incidents/${incident.shortlink ?? incident.id}`;

  return (
    <article className="bg-card relative overflow-hidden rounded-lg border">
      <span
        className={cn("absolute inset-y-0 left-0 w-[3px]", IMPACT_RULE[incident.impact])}
        aria-hidden
      />

      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-base leading-snug font-semibold text-balance">
            {compact ? <Link href={href} className="hover:underline">{incident.title}</Link> : incident.title}
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            {incident.is_maintenance && incident.scheduled_for ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClockIcon className="size-3.5" />
                {formatDateTime(incident.scheduled_for, timezone)}
                {incident.scheduled_until
                  ? ` – ${formatDateTime(incident.scheduled_until, timezone)}`
                  : ""}
              </span>
            ) : (
              <>
                Started {formatDateTime(incident.started_at, timezone)} ·{" "}
                {relativeTime(incident.started_at)}
              </>
            )}
          </p>
        </div>
        <IncidentStatusChip status={incident.status} />
      </header>

      {incident.components.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-5 pb-3">
          {incident.components.map((c) => (
            <span
              key={c.id}
              className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-[11px]"
              title={COMPONENT_STATUS_LABEL[c.status_during]}
            >
              {c.name}
            </span>
          ))}
        </div>
      )}

      <ol className="border-t">
        {updates.map((update) => (
          <li key={update.id} className="border-b px-5 py-3 last:border-b-0">
            <div className="text-muted-foreground mb-1 flex items-baseline gap-2 text-xs">
              <span className="text-foreground font-medium">
                {update.status.charAt(0).toUpperCase() + update.status.slice(1).replace("_", " ")}
              </span>
              <span>{formatDateTime(update.display_at, timezone)}</span>
            </div>
            <Markdown className="text-muted-foreground">{update.body}</Markdown>
          </li>
        ))}
        {updates.length === 0 && (
          <li className="text-muted-foreground px-5 py-3 text-sm">No updates posted yet.</li>
        )}
      </ol>

      {hidden > 0 && (
        <Link
          href={href}
          className="text-muted-foreground hover:text-foreground block border-t px-5 py-2.5 text-xs"
        >
          {hidden} earlier {hidden === 1 ? "update" : "updates"} →
        </Link>
      )}
    </article>
  );
}
