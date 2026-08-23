import { listRecentIncidents } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { INCIDENT_STATUS_LABEL, type IncidentWithUpdates } from "@/lib/status/types";

/** Atom and RSS feeds of incident activity. */

const FEED_DAYS = 180;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The update timeline rendered as a simple HTML fragment for feed readers. */
function entryBody(incident: IncidentWithUpdates): string {
  const items = incident.updates
    .map(
      (u) =>
        `<p><strong>${escapeXml(INCIDENT_STATUS_LABEL[u.status])}</strong> — ` +
        `${escapeXml(new Date(u.display_at * 1000).toUTCString())}<br/>` +
        `${escapeXml(u.body)}</p>`,
    )
    .join("\n");

  const affected =
    incident.components.length > 0
      ? `<p>Affected: ${escapeXml(incident.components.map((c) => c.name).join(", "))}</p>`
      : "";

  return `${affected}${items}`;
}

/** Most recent update wins, so a feed reader re-surfaces an incident as it evolves. */
function lastActivity(incident: IncidentWithUpdates): number {
  return incident.updates[0]?.display_at ?? incident.updated_at;
}

async function feedData() {
  const [settings, incidents] = await Promise.all([
    getSettings(),
    listRecentIncidents(Math.floor(Date.now() / 1000) - FEED_DAYS * 86_400),
  ]);
  const sorted = [...incidents].sort((a, b) => lastActivity(b) - lastActivity(a));
  return { settings, incidents: sorted };
}

export async function atomFeed(): Promise<string> {
  const { settings, incidents } = await feedData();
  const updated = new Date((incidents[0] ? lastActivity(incidents[0]) : Math.floor(Date.now() / 1000)) * 1000).toISOString();

  const entries = incidents
    .map((incident) => {
      const url = `${settings.siteUrl}/incidents/${incident.shortlink ?? incident.id}`;
      return `  <entry>
    <id>${escapeXml(url)}</id>
    <title>${escapeXml(incident.title)}</title>
    <link rel="alternate" type="text/html" href="${escapeXml(url)}"/>
    <published>${new Date(incident.started_at * 1000).toISOString()}</published>
    <updated>${new Date(lastActivity(incident) * 1000).toISOString()}</updated>
    <category term="${escapeXml(incident.is_maintenance ? "maintenance" : "incident")}"/>
    <content type="html">${escapeXml(entryBody(incident))}</content>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(settings.siteUrl)}/</id>
  <title>${escapeXml(settings.pageName)} status</title>
  <subtitle>${escapeXml(settings.pageDescription)}</subtitle>
  <link rel="self" type="application/atom+xml" href="${escapeXml(settings.siteUrl)}/history.atom"/>
  <link rel="alternate" type="text/html" href="${escapeXml(settings.siteUrl)}/"/>
  <updated>${updated}</updated>
${entries}
</feed>
`;
}

export async function rssFeed(): Promise<string> {
  const { settings, incidents } = await feedData();

  const items = incidents
    .map((incident) => {
      const url = `${settings.siteUrl}/incidents/${incident.shortlink ?? incident.id}`;
      return `    <item>
      <title>${escapeXml(incident.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(lastActivity(incident) * 1000).toUTCString()}</pubDate>
      <description>${escapeXml(entryBody(incident))}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(settings.pageName)} status</title>
    <link>${escapeXml(settings.siteUrl)}/</link>
    <description>${escapeXml(settings.pageDescription)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

export function feedHeaders(contentType: string): HeadersInit {
  return {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "public, max-age=60, stale-while-revalidate=300",
    "access-control-allow-origin": "*",
  };
}
