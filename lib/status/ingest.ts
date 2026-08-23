import { db } from "@/lib/db/client";
import {
  addIncidentUpdate,
  createIncident,
  setComponentStatus,
} from "@/lib/status/mutations";
import type { IncidentRow, IntegrationRuleRow } from "@/lib/status/types";

/**
 * Inbound alert handling, shared by every provider webhook.
 *
 * A provider tells us "this thing started/stopped being broken"; an
 * `integration_rules` row says which component that maps to and what should
 * happen. Alerts with no matching rule are acknowledged with 200 and ignored —
 * returning an error would make the sender retry forever over a mapping we
 * simply do not have.
 */

export type AlertState = "triggered" | "resolved";

export interface Alert {
  /** Value matched against `integration_rules.match_key`. */
  key: string;
  state: AlertState;
  /** Human-readable summary used as the incident title and body. */
  title?: string;
  detail?: string;
  /** Provider's own id, so repeated deliveries land on the same incident. */
  externalId?: string;
}

export interface IngestResult {
  matched: boolean;
  action: "opened" | "resolved" | "degraded" | "cleared" | "ignored" | "unmatched";
  componentId?: string;
  incidentId?: string;
}

async function findRule(
  provider: IntegrationRuleRow["provider"],
  key: string,
): Promise<IntegrationRuleRow | null> {
  // Exact match first; then a case-insensitive contains, so a rule keyed on a
  // service name still matches an alert titled "[P1] Acme API latency".
  const exact = await db()
    .prepare(
      "SELECT * FROM integration_rules WHERE provider = ? AND enabled = 1 AND match_key = ?",
    )
    .bind(provider, key)
    .first<IntegrationRuleRow>();
  if (exact) return exact;

  const { results } = await db()
    .prepare("SELECT * FROM integration_rules WHERE provider = ? AND enabled = 1")
    .bind(provider)
    .all<IntegrationRuleRow>();

  const haystack = key.toLowerCase();
  return results.find((rule) => haystack.includes(rule.match_key.toLowerCase())) ?? null;
}

/** The open incident this provider+key previously opened, if any. */
async function findOpenIncident(shortlinkKey: string): Promise<IncidentRow | null> {
  return db()
    .prepare(
      `SELECT * FROM incidents
        WHERE source = 'webhook' AND shortlink = ? AND resolved_at IS NULL
        ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(shortlinkKey)
    .first<IncidentRow>();
}

export async function handleAlert(
  provider: IntegrationRuleRow["provider"],
  alert: Alert,
): Promise<IngestResult> {
  const rule = await findRule(provider, alert.key);
  if (!rule) return { matched: false, action: "unmatched" };

  const actor = `webhook:${provider}`;
  // Deterministic slug per rule + external id, so retries and follow-up
  // deliveries update one incident instead of opening a pile of duplicates.
  const slug = `${provider}-${alert.externalId ?? rule.match_key}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  const existing = await findOpenIncident(slug);

  if (alert.state === "triggered") {
    if (existing) return { matched: true, action: "ignored", incidentId: existing.id };

    await setComponentStatus(rule.component_id, rule.degrade_to, actor, {
      notify: false,
      updateBase: false,
    });

    if (!rule.open_incident) {
      return { matched: true, action: "degraded", componentId: rule.component_id };
    }

    const incidentId = await createIncident(
      {
        title: alert.title || `Alert from ${provider}: ${alert.key}`,
        status: "investigating",
        body:
          alert.detail ||
          `An alert from ${provider} fired for \`${alert.key}\`. This incident was opened ` +
            "automatically and will resolve when the alert clears.",
        componentStatuses: { [rule.component_id]: rule.degrade_to },
        source: "webhook",
        shortlink: slug,
      },
      actor,
    );

    return { matched: true, action: "opened", componentId: rule.component_id, incidentId };
  }

  if (existing) {
    await addIncidentUpdate(
      existing.id,
      {
        status: "resolved",
        body: alert.detail || `The ${provider} alert for \`${alert.key}\` has cleared.`,
      },
      actor,
    );
    return { matched: true, action: "resolved", componentId: rule.component_id, incidentId: existing.id };
  }

  await setComponentStatus(rule.component_id, "operational", actor, { notify: false });
  return { matched: true, action: "cleared", componentId: rule.component_id };
}

/** Verifies an `sha256=<hex>` HMAC over `<timestamp>.<body>`, or over the raw body. */
export async function verifySignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const provided = signatureHeader.replace(/^sha256=/, "").toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const candidates = timestampHeader ? [`${timestampHeader}.${body}`, body] : [body];

  for (const message of candidates) {
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    const expected = Array.from(new Uint8Array(signature), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");

    if (expected.length === provided.length) {
      let diff = 0;
      for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
      if (diff === 0) return true;
    }
  }

  return false;
}
