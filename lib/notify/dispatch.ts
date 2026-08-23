import { db, now } from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { sendEmail, sendSlack, sendWebhook, slackBlocks } from "@/lib/notify/channels";
import { payloadComponentIds, type NotificationPayload } from "@/lib/notify/payload";
import { getSettings } from "@/lib/status/settings";
import type { NotificationRow, SubscriberRow } from "@/lib/status/types";

/**
 * Notification fan-out.
 *
 * Every send is first written to the `notifications` table, then attempted.
 * The table is both the retry ledger and the idempotency guard — the unique
 * index on (subscriber_id, dedupe_key) means re-running the same event, whether
 * from a double-submit or a cron retry, cannot double-send.
 *
 * A Cloudflare Queue would be the textbook fan-out here, but it requires a paid
 * plan; this keeps the page deployable on the free tier with equivalent
 * durability. Swapping one in only touches this file.
 */

const MAX_ATTEMPTS = 5;
/** Attempt n waits 1m, 5m, 15m, 60m. */
const BACKOFF_SECONDS = [60, 300, 900, 3600];
/** Per-invocation cap, so one drain cannot exhaust the subrequest budget. */
const DRAIN_BATCH = 40;

function matchesFilter(subscriber: SubscriberRow, payload: NotificationPayload): boolean {
  if (payload.kind === "confirm") return true;
  if (!subscriber.component_ids) return true;

  const affected = payloadComponentIds(payload);
  if (!affected) return true;

  try {
    const wanted = JSON.parse(subscriber.component_ids) as string[];
    return wanted.length === 0 || affected.some((id) => wanted.includes(id));
  } catch {
    // A malformed filter should not silence a subscriber.
    return true;
  }
}

/**
 * Writes ledger rows for every subscriber the event concerns. Returns the number
 * queued. Call `drain()` afterwards (usually inside `waitUntil`) to send them.
 */
export async function enqueue(
  payload: NotificationPayload,
  dedupeKey: string,
): Promise<number> {
  const { results } = await db()
    .prepare("SELECT * FROM subscribers WHERE state = 'active'")
    .all<SubscriberRow>();

  const targets = results.filter((s) => matchesFilter(s, payload));
  if (targets.length === 0) return 0;

  const ts = now();
  const serialised = JSON.stringify(payload);

  await db().batch(
    targets.map((subscriber) =>
      db()
        .prepare(
          `INSERT INTO notifications
             (id, subscriber_id, dedupe_key, kind, payload, state, attempts, next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
           ON CONFLICT(subscriber_id, dedupe_key) DO NOTHING`,
        )
        .bind(newId(), subscriber.id, dedupeKey, payload.kind, serialised, ts, ts),
    ),
  );

  return targets.length;
}

/** Queues a single notification to one subscriber (confirmation emails). */
export async function enqueueDirect(
  subscriberId: string,
  payload: NotificationPayload,
  dedupeKey: string,
): Promise<void> {
  const ts = now();
  await db()
    .prepare(
      `INSERT INTO notifications
         (id, subscriber_id, dedupe_key, kind, payload, state, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT(subscriber_id, dedupe_key) DO NOTHING`,
    )
    .bind(newId(), subscriberId, dedupeKey, payload.kind, JSON.stringify(payload), ts, ts)
    .run();
}

async function deliver(
  subscriber: SubscriberRow,
  payload: NotificationPayload,
  siteUrl: string,
): Promise<void> {
  switch (subscriber.type) {
    case "email":
      return sendEmail(subscriber, payload, `${siteUrl}/subscribe/unsubscribe?token=${subscriber.unsub_token}`);
    case "slack":
      return sendSlack(subscriber.endpoint, payload);
    case "webhook":
      return sendWebhook(subscriber, payload);
  }
}

interface DueRow extends NotificationRow {
  sub_id: string;
  sub_type: SubscriberRow["type"];
  sub_endpoint: string;
  sub_secret: string | null;
  sub_state: SubscriberRow["state"];
  sub_component_ids: string | null;
  sub_unsub_token: string;
}

/**
 * Sends everything that is due. Safe to call concurrently from a request and
 * from cron: rows are re-read each pass and a delivered row moves to 'sent',
 * so the worst case of overlap is a duplicate attempt, not a duplicate message.
 */
export async function drain(): Promise<{ sent: number; failed: number }> {
  const settings = await getSettings();
  const ts = now();

  const { results } = await db()
    .prepare(
      `SELECT n.*,
              s.id            AS sub_id,
              s.type          AS sub_type,
              s.endpoint      AS sub_endpoint,
              s.secret        AS sub_secret,
              s.state         AS sub_state,
              s.component_ids AS sub_component_ids,
              s.unsub_token   AS sub_unsub_token
         FROM notifications n
         JOIN subscribers s ON s.id = n.subscriber_id
        WHERE n.state IN ('pending', 'failed')
          AND n.next_attempt_at <= ?
          AND s.state IN ('active', 'pending')
        ORDER BY n.created_at
        LIMIT ?`,
    )
    .bind(ts, DRAIN_BATCH)
    .all<DueRow>();

  if (results.length === 0) return { sent: 0, failed: 0 };

  const outcomes = await Promise.allSettled(
    results.map(async (row) => {
      const subscriber: SubscriberRow = {
        id: row.sub_id,
        type: row.sub_type,
        endpoint: row.sub_endpoint,
        secret: row.sub_secret,
        state: row.sub_state,
        component_ids: row.sub_component_ids,
        confirm_token: null,
        unsub_token: row.sub_unsub_token,
        created_at: 0,
        confirmed_at: null,
        last_sent_at: null,
      };
      await deliver(subscriber, JSON.parse(row.payload) as NotificationPayload, settings.siteUrl);
      return row.id;
    }),
  );

  const statements: D1PreparedStatement[] = [];
  let sent = 0;
  let failed = 0;

  outcomes.forEach((outcome, i) => {
    const row = results[i];

    if (outcome.status === "fulfilled") {
      sent++;
      statements.push(
        db()
          .prepare(
            "UPDATE notifications SET state = 'sent', sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?",
          )
          .bind(ts, row.id),
        db().prepare("UPDATE subscribers SET last_sent_at = ? WHERE id = ?").bind(ts, row.sub_id),
      );
      return;
    }

    failed++;
    const attempts = row.attempts + 1;
    const message = String(outcome.reason).slice(0, 500);

    if (attempts >= MAX_ATTEMPTS) {
      statements.push(
        db()
          .prepare(
            "UPDATE notifications SET state = 'abandoned', attempts = ?, last_error = ? WHERE id = ?",
          )
          .bind(attempts, message, row.id),
      );
    } else {
      const delay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
      statements.push(
        db()
          .prepare(
            "UPDATE notifications SET state = 'failed', attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
          )
          .bind(attempts, ts + delay, message, row.id),
      );
    }
  });

  await db().batch(statements);
  return { sent, failed };
}

/**
 * Mirrors an event into the page-wide Slack webhook, if one is configured.
 * Separate from subscribers: it is the operator's own channel, not a
 * subscription, so it is not filtered by component and cannot be unsubscribed.
 */
export async function mirrorToSlack(payload: NotificationPayload): Promise<void> {
  const settings = await getSettings();
  if (!settings.slackWebhookUrl) return;

  try {
    await fetch(settings.slackWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slackBlocks(payload)),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // The operator's mirror is best-effort: never let it fail an incident update.
    console.error("[notify] Slack mirror failed", error);
  }
}
