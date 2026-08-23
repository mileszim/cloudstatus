import { handleAlert, type AlertState } from "@/lib/status/ingest";

/**
 * POST /api/hooks/datadog — Datadog webhook integration.
 *
 * Configure the webhook body in Datadog as:
 *   {
 *     "key": "$ALERT_TITLE",
 *     "state": "$ALERT_TRANSITION",
 *     "detail": "$EVENT_MSG",
 *     "id": "$ALERT_ID"
 *   }
 *
 * Like the PagerDuty hook, this is unauthenticated and inert unless an
 * integration rule maps the alert onto a component.
 */

/** Datadog sends Triggered / Re-Triggered / Warn / No Data / Recovered. */
function toState(transition: string | undefined): AlertState {
  const value = (transition ?? "").toLowerCase();
  return value.includes("recover") || value === "ok" ? "resolved" : "triggered";
}

interface DatadogPayload {
  key?: string;
  title?: string;
  alert_title?: string;
  state?: string;
  alert_transition?: string;
  detail?: string;
  body?: string;
  id?: string;
  alert_id?: string;
}

export async function POST(request: Request) {
  let payload: DatadogPayload;
  try {
    payload = (await request.json()) as DatadogPayload;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const key = payload.key ?? payload.alert_title ?? payload.title;
  if (!key) {
    return Response.json({ matched: false, action: "unmatched", reason: "no alert title" });
  }

  const result = await handleAlert("datadog", {
    key,
    state: toState(payload.state ?? payload.alert_transition),
    title: payload.alert_title ?? payload.title,
    detail: payload.detail ?? payload.body,
    externalId: payload.alert_id ?? payload.id,
  });

  return Response.json(result);
}
