import { getOverallStatus } from "@/lib/status/queries";
import type { PageIndicator } from "@/lib/status/types";

const COLOR: Record<PageIndicator, string> = {
  none: "#1a9c6e",
  maintenance: "#4b7bd4",
  minor: "#c48a12",
  major: "#d4761f",
  critical: "#cf3b32",
};

/** A favicon that carries the current status, so a pinned tab is a dashboard. */
export async function GET() {
  const { indicator } = await getOverallStatus();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#1c2128"/>
  <circle cx="16" cy="16" r="7" fill="${COLOR[indicator]}"/>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
