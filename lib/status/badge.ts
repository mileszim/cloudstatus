import { COMPONENT_STATUS_LABEL, type ComponentStatus, type PageIndicator } from "@/lib/status/types";

/**
 * Shields-style SVG badges for READMEs and docs sites.
 *
 * Rendered as literal SVG rather than proxied to shields.io: no third-party
 * dependency in the path of a page that exists to report availability, and the
 * badge stays correct even if that service is the thing that is down.
 */

const BADGE_COLOR: Record<ComponentStatus, string> = {
  operational: "#1a9c6e",
  under_maintenance: "#4b7bd4",
  degraded_performance: "#c48a12",
  partial_outage: "#d4761f",
  major_outage: "#cf3b32",
};

const INDICATOR_COLOR: Record<PageIndicator, string> = {
  none: "#1a9c6e",
  maintenance: "#4b7bd4",
  minor: "#c48a12",
  major: "#d4761f",
  critical: "#cf3b32",
};

const INDICATOR_TEXT: Record<PageIndicator, string> = {
  none: "operational",
  maintenance: "maintenance",
  minor: "degraded",
  major: "partial outage",
  critical: "major outage",
};

/** Approximate width of DejaVu Sans at 11px — good enough to avoid clipping. */
function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if ("iljI.,:;'|!".includes(char)) width += 3.2;
    else if ("frt()[]{}/\\ ".includes(char)) width += 4.4;
    else if ("mwMW".includes(char)) width += 9.5;
    else if (char >= "A" && char <= "Z") width += 7.6;
    else width += 6.4;
  }
  return Math.ceil(width);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderBadge(label: string, message: string, color: string): string {
  const padding = 10;
  const labelW = textWidth(label) + padding * 2;
  const messageW = textWidth(message) + padding * 2;
  const total = labelW + messageW;
  const accessible = `${label}: ${message}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(accessible)}">
  <title>${escapeXml(accessible)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>
    <stop offset=".9" stop-color="#000" stop-opacity=".3"/>
    <stop offset="1" stop-color="#000" stop-opacity=".5"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#40474f"/>
    <rect x="${labelW}" width="${messageW}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${labelW / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelW / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelW + messageW / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(message)}</text>
    <text x="${labelW + messageW / 2}" y="14">${escapeXml(message)}</text>
  </g>
</svg>`;
}

export function overallBadge(pageName: string, indicator: PageIndicator): string {
  return renderBadge(pageName, INDICATOR_TEXT[indicator], INDICATOR_COLOR[indicator]);
}

export function componentBadge(name: string, status: ComponentStatus): string {
  return renderBadge(name, COMPONENT_STATUS_LABEL[status].toLowerCase(), BADGE_COLOR[status]);
}

export function uptimeBadge(name: string, uptimePct: number | null): string {
  const message = uptimePct == null ? "no data" : `${(Math.floor(uptimePct * 100) / 100).toFixed(2)}%`;
  const color =
    uptimePct == null
      ? "#8b9199"
      : uptimePct >= 99.9
        ? "#1a9c6e"
        : uptimePct >= 99
          ? "#c48a12"
          : "#cf3b32";
  return renderBadge(name, message, color);
}

export function badgeHeaders(): HeadersInit {
  return {
    "content-type": "image/svg+xml; charset=utf-8",
    // Short cache: a README badge showing a stale "operational" during an
    // outage is worse than an extra origin hit.
    "cache-control": "public, max-age=30, stale-while-revalidate=60",
    "access-control-allow-origin": "*",
  };
}
