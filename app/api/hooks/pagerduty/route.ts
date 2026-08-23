import { handleAlert, type AlertState } from "@/lib/status/ingest";

/**
 * POST /api/hooks/pagerduty — PagerDuty v3 webhook subscription.
 *
 * PagerDuty signs with X-PagerDuty-Signature, but the shared secret is issued
 * per-subscription in their UI and there is nowhere here to configure it, so
 * this endpoint is unauthenticated by design. That is safe because it cannot
 * do anything you have not already allowed: an alert only has an effect if an
 * integration rule maps its service name to a component. Anything unmatched is
 * a no-op. Do not create rules keyed on values an outsider can guess if that
 * concerns you — or put the route behind Cloudflare Access.
 */

const TRIGGERING_EVENTS = new Set([
  "incident.triggered",
  "incident.escalated",
  "incident.reopened",
  "incident.unacknowledged",
]);

const RESOLVING_EVENTS = new Set(["incident.resolved"]);

interface PagerDutyPayload {
  event?: {
    event_type?: string;
    data?: {
      id?: string;
      title?: string;
      status?: string;
      html_url?: string;
      service?: { summary?: string; name?: string };
    };
  };
}

export async function POST(request: Request) {
  let payload: PagerDutyPayload;
  try {
    payload = (await request.json()) as PagerDutyPayload;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const eventType = payload.event?.event_type ?? "";
  const data = payload.event?.data;

  if (!TRIGGERING_EVENTS.has(eventType) && !RESOLVING_EVENTS.has(eventType)) {
    // Acknowledge the events we do not act on, or PagerDuty retries them.
    return Response.json({ matched: false, action: "ignored", event: eventType });
  }

  const serviceName = data?.service?.summary ?? data?.service?.name;
  if (!serviceName) {
    return Response.json({ matched: false, action: "unmatched", reason: "no service name" });
  }

  const state: AlertState = RESOLVING_EVENTS.has(eventType) ? "resolved" : "triggered";

  const result = await handleAlert("pagerduty", {
    key: serviceName,
    state,
    title: data?.title ? `${data.title}` : undefined,
    detail: data?.html_url
      ? `PagerDuty incident [${data.title ?? data.id}](${data.html_url}) on **${serviceName}**.`
      : undefined,
    externalId: data?.id,
  });

  return Response.json(result);
}
