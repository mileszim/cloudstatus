import { badgeHeaders, overallBadge } from "@/lib/status/badge";
import { getOverallStatus } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";

export async function GET(request: Request) {
  const [settings, overall] = await Promise.all([getSettings(), getOverallStatus()]);
  const label = new URL(request.url).searchParams.get("label") ?? settings.pageName;
  return new Response(overallBadge(label, overall.indicator), { headers: badgeHeaders() });
}
