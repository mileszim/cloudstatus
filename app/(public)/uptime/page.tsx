import Link from "next/link";

import { LatencyChart } from "@/components/status/latency-chart";
import { StatusDot } from "@/components/status/status-dot";
import { UptimeBar } from "@/components/status/uptime-bar";
import { getLatencySeries, getUptimeSeries, listComponents } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatUptimePct } from "@/lib/status/time";
import { COMPONENT_STATUS_LABEL } from "@/lib/status/types";
import { STATUS_TEXT } from "@/lib/status/ui";
import { cn } from "@/lib/utils";

export const metadata = { title: "Uptime" };

const WINDOWS = [30, 90, 365] as const;
type Window = (typeof WINDOWS)[number];

function isWindow(value: unknown): value is Window {
  return WINDOWS.includes(Number(value) as Window);
}

export default async function UptimePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days: daysParam } = await searchParams;
  const days: Window = isWindow(daysParam) ? (Number(daysParam) as Window) : 90;

  const [settings, components, uptime, latency] = await Promise.all([
    getSettings(),
    listComponents(),
    getUptimeSeries(days),
    getLatencySeries(days),
  ]);

  const showcased = components.filter((c) => c.showcase === 1);

  const overall = (() => {
    const values = showcased
      .map((c) => uptime.get(c.id)?.uptimePct)
      .filter((v): v is number => v != null);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  })();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Uptime</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {overall == null
              ? "No check history recorded yet."
              : `${formatUptimePct(overall, 3)} average across ${showcased.length} services over the last ${days} days.`}
          </p>
        </div>

        <nav className="bg-secondary flex rounded-md p-0.5 text-xs" aria-label="Time range">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/uptime?days=${w}`}
              className={cn(
                "rounded-[5px] px-3 py-1.5 transition-colors",
                w === days
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {w}d
            </Link>
          ))}
        </nav>
      </div>

      {showcased.length === 0 && (
        <p className="text-muted-foreground bg-card rounded-lg border px-5 py-10 text-center text-sm">
          No components are configured to show uptime.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {showcased.map((component) => {
          const series = uptime.get(component.id);
          const points = latency.get(component.id) ?? [];

          return (
            <section key={component.id} className="bg-card rounded-lg border">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
                <div className="flex items-center gap-2">
                  <StatusDot status={component.status} pulse={false} />
                  <h2 className="text-sm font-medium">{component.name}</h2>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className={cn("font-medium", STATUS_TEXT[component.status])}>
                    {COMPONENT_STATUS_LABEL[component.status]}
                  </span>
                  <span className="bg-border h-3 w-px" />
                  <span className="tnum text-muted-foreground">
                    {series?.uptimePct == null
                      ? "No data"
                      : `${formatUptimePct(series.uptimePct, 3)} over ${days}d`}
                  </span>
                </div>
              </header>

              <div className="px-5 py-4">
                {series && <UptimeBar days={series.series} uptimePct={series.uptimePct} />}
              </div>

              <div className="border-t px-3 pt-3 pb-2">
                <p className="text-muted-foreground mb-1 px-2 text-[11px] tracking-wide uppercase">
                  Response time
                </p>
                <LatencyChart points={points} id={component.id} />
              </div>
            </section>
          );
        })}
      </div>

      <p className="text-muted-foreground text-xs">
        Uptime counts a probe as downtime when it fails or exceeds its degraded-latency
        threshold. Days are UTC. Times elsewhere on this page are shown in{" "}
        <span className="font-mono">{settings.timezone}</span>.
      </p>
    </div>
  );
}
