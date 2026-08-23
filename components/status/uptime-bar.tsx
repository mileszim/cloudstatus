import { formatUptimePct } from "@/lib/status/time";
import { UPTIME_TICK } from "@/lib/status/ui";
import type { DailyUptime } from "@/lib/status/types";
import { cn } from "@/lib/utils";

function tickTitle(day: DailyUptime): string {
  const date = new Date(`${day.day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (day.total === 0) return `${date} — no data`;

  const parts = [`${formatUptimePct(day.uptimePct!)} uptime`, `${day.total} checks`];
  if (day.avgLatencyMs != null) parts.push(`${Math.round(day.avgLatencyMs)}ms avg`);
  return `${date} — ${parts.join(" · ")}`;
}

/**
 * The 90-day uptime strip. One tick per UTC day, oldest at the left. Ticks flex
 * so the strip fits any width; older days collapse first on narrow screens.
 */
export function UptimeBar({
  days,
  uptimePct,
  className,
}: {
  days: DailyUptime[];
  uptimePct: number | null;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex h-8 items-stretch gap-[2px]" role="img" aria-label={ariaLabel(days, uptimePct)}>
        {days.map((day) => (
          <div
            key={day.day}
            title={tickTitle(day)}
            className={cn(
              "min-w-[2px] flex-1 rounded-[2px] transition-opacity hover:opacity-70",
              UPTIME_TICK[day.outcome],
              day.outcome === "no_data" && "opacity-40",
            )}
          />
        ))}
      </div>
      <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
        <span>{days.length} days ago</span>
        <span className="bg-border h-px flex-1" />
        <span className="tnum">
          {uptimePct == null ? "No data" : `${formatUptimePct(uptimePct)} uptime`}
        </span>
        <span className="bg-border h-px flex-1" />
        <span>Today</span>
      </div>
    </div>
  );
}

function ariaLabel(days: DailyUptime[], uptimePct: number | null): string {
  const bad = days.filter((d) => d.outcome === "down" || d.outcome === "degraded").length;
  const pct = uptimePct == null ? "no data" : `${formatUptimePct(uptimePct)} uptime`;
  return `${days.length}-day history: ${pct}, ${bad} ${bad === 1 ? "day" : "days"} with incidents.`;
}
