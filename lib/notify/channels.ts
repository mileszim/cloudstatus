import { env } from "cloudflare:workers";

import type { NotificationPayload } from "@/lib/notify/payload";
import {
  COMPONENT_STATUS_LABEL,
  INCIDENT_STATUS_LABEL,
  IMPACT_LABEL,
} from "@/lib/status/types";
import type { SubscriberRow } from "@/lib/status/types";

/** Per-channel delivery. Each returns normally on success and throws on failure. */

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface Rendered {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function render(payload: NotificationPayload, unsubUrl: string | null): Rendered {
  switch (payload.kind) {
    case "confirm": {
      const subject = `Confirm your ${payload.pageName} status subscription`;
      return {
        subject,
        text: `Confirm your subscription to ${payload.pageName} status updates:\n\n${payload.confirmUrl}\n\nIf you did not request this, ignore this email — no subscription is created until you confirm.`,
        html: layout(
          subject,
          `<p>Confirm your subscription to <strong>${escapeHtml(payload.pageName)}</strong> status updates.</p>
           <p><a href="${payload.confirmUrl}" style="display:inline-block;padding:10px 18px;background:#1a9c6e;color:#fff;border-radius:6px;text-decoration:none">Confirm subscription</a></p>
           <p style="color:#6b7280;font-size:13px">If you did not request this, ignore this email — no subscription is created until you confirm.</p>`,
          null,
        ),
      };
    }

    case "component_status": {
      const subject = `${payload.name} is now ${COMPONENT_STATUS_LABEL[payload.to].toLowerCase()}`;
      return {
        subject,
        text: `${payload.name} changed from ${COMPONENT_STATUS_LABEL[payload.from]} to ${COMPONENT_STATUS_LABEL[payload.to]}.\n\n${payload.url}`,
        html: layout(
          subject,
          `<p><strong>${escapeHtml(payload.name)}</strong> changed from ${COMPONENT_STATUS_LABEL[payload.from]} to <strong>${COMPONENT_STATUS_LABEL[payload.to]}</strong>.</p>
           <p><a href="${payload.url}">View the status page</a></p>`,
          unsubUrl,
        ),
      };
    }

    case "incident_update": {
      const prefix = payload.isMaintenance ? "Maintenance" : INCIDENT_STATUS_LABEL[payload.status];
      const subject = `[${prefix}] ${payload.title}`;
      const affected = payload.components.map((c) => c.name).join(", ");
      return {
        subject,
        text:
          `${payload.title}\n${INCIDENT_STATUS_LABEL[payload.status]} · ${IMPACT_LABEL[payload.impact]} impact\n` +
          (affected ? `Affected: ${affected}\n` : "") +
          `\n${payload.body}\n\n${payload.url}`,
        html: layout(
          subject,
          `<h2 style="margin:0 0 4px;font-size:18px">${escapeHtml(payload.title)}</h2>
           <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
             ${INCIDENT_STATUS_LABEL[payload.status]} · ${IMPACT_LABEL[payload.impact]} impact
             ${affected ? ` · ${escapeHtml(affected)}` : ""}
           </p>
           <div style="white-space:pre-wrap">${escapeHtml(payload.body)}</div>
           <p style="margin-top:20px"><a href="${payload.url}">View this incident</a></p>`,
          unsubUrl,
        ),
      };
    }
  }
}

function layout(title: string, body: string, unsubUrl: string | null): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:24px">
    ${body}
  </div>
  ${
    unsubUrl
      ? `<p style="max-width:560px;margin:16px auto 0;color:#9ca3af;font-size:12px;text-align:center">
           <a href="${unsubUrl}" style="color:#9ca3af">Unsubscribe</a>
         </p>`
      : ""
  }
</body></html>`;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function sendEmail(
  subscriber: SubscriberRow,
  payload: NotificationPayload,
  unsubUrl: string,
): Promise<void> {
  const from = env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not set, so subscriber email cannot be sent.");
  }

  const { subject, text, html } = render(payload, unsubUrl);

  await env.EMAIL.send({
    to: subscriber.endpoint,
    from,
    subject,
    text,
    html,
    headers: {
      // One-click unsubscribe, so mail clients surface it natively and
      // recipients never have to hunt for the link.
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}

const SLACK_COLOR: Record<string, string> = {
  none: "#1a9c6e",
  minor: "#c48a12",
  major: "#d4761f",
  critical: "#cf3b32",
  maintenance: "#4b7bd4",
};

export function slackBlocks(payload: NotificationPayload): unknown {
  if (payload.kind === "confirm") {
    return { text: `Confirm your subscription: ${payload.confirmUrl}` };
  }

  if (payload.kind === "component_status") {
    return {
      text: `${payload.name} is now ${COMPONENT_STATUS_LABEL[payload.to]}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${payload.url}|${payload.name}>* is now *${COMPONENT_STATUS_LABEL[payload.to]}*\n_was ${COMPONENT_STATUS_LABEL[payload.from]}_`,
          },
        },
      ],
    };
  }

  const affected = payload.components.map((c) => c.name).join(", ");
  return {
    text: `[${INCIDENT_STATUS_LABEL[payload.status]}] ${payload.title}`,
    attachments: [
      {
        color: SLACK_COLOR[payload.impact] ?? "#8b9199",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*<${payload.url}|${payload.title}>*` },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text:
                  `*${INCIDENT_STATUS_LABEL[payload.status]}* · ${IMPACT_LABEL[payload.impact]} impact` +
                  (affected ? ` · ${affected}` : ""),
              },
            ],
          },
          { type: "section", text: { type: "mrkdwn", text: payload.body.slice(0, 2900) } },
        ],
      },
    ],
  };
}

export async function sendSlack(url: string, payload: NotificationPayload): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(slackBlocks(payload)),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook returned ${response.status}: ${await response.text()}`);
  }
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sendWebhook(
  subscriber: SubscriberRow,
  payload: NotificationPayload,
): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ timestamp, event: payload });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Cloudstatus/1.0",
    "x-cloudstatus-timestamp": String(timestamp),
    "x-cloudstatus-event": payload.kind,
  };

  // Signed over `<timestamp>.<body>` so a captured payload cannot be replayed
  // with a fresh timestamp.
  if (subscriber.secret) {
    headers["x-cloudstatus-signature"] =
      `sha256=${await hmacHex(subscriber.secret, `${timestamp}.${body}`)}`;
  }

  const response = await fetch(subscriber.endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }
}
