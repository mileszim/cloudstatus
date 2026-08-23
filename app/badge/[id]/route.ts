import { badgeHeaders, componentBadge, uptimeBadge } from "@/lib/status/badge";
import { getComponent, getUptimeSeries } from "@/lib/status/queries";

/**
 * `/badge/<component-id>.svg` — current status.
 * Add `?metric=uptime&days=90` for an uptime-percentage badge instead.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const componentId = id.replace(/\.svg$/, "");
  const component = await getComponent(componentId);

  if (!component) {
    return new Response(componentBadge("status", "major_outage"), {
      status: 404,
      headers: badgeHeaders(),
    });
  }

  const url = new URL(request.url);
  const label = url.searchParams.get("label") ?? component.name;

  if (url.searchParams.get("metric") === "uptime") {
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 90));
    const series = await getUptimeSeries(days);
    return new Response(uptimeBadge(label, series.get(componentId)?.uptimePct ?? null), {
      headers: badgeHeaders(),
    });
  }

  return new Response(componentBadge(label, component.status), { headers: badgeHeaders() });
}
