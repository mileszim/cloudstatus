import { env } from "cloudflare:workers";

import { db, now } from "@/lib/db/client";
import { newId } from "@/lib/db/id";
import { sendEmail, sendSlack, sendWebhook, slackBlocks } from "@/lib/notify/channels";
import { payloadComponentIds, type NotificationPayload } from "@/lib/notify/payload";
import { getSettings } from "@/lib/status/settings";
import type { NotificationRow, SubscriberRow } from "@/lib/status/types";

/**
 * Notification fan-out over Cloudflare Queues.
 *
 * Writes go to two places: a row in `notifications`, and a message on the queue
 * carrying only that row's id. The queue owns scheduling, retries, concurrency,
 * and the dead-letter hand-off; the table is the durable record of what was
 * sent, why it failed, and the idempotency guard — a unique index on
 * `(subscriber_id, dedupe_key)` means the same event can be enqueued twice
 * without a subscriber hearing about it twice.
 *
 * Keeping the payload in D1 rather than in the message body means a queued
 * notification is rendered from current code when it is finally delivered, so a
 * deploy mid-incident does not send a message built by the previous version.
 */

/** Retry backoff by attempt: 1m, 5m, 15m, 1h, 4h. `max_retries` is 5. */
const BACKOFF_SECONDS = [60, 300, 900, 3600, 14_400];

/** Queues accepts at most 100 messages per sendBatch call. */
const SEND_BATCH_LIMIT = 100;

/**
 * How long a row may sit `pending` before the reconciliation sweep assumes its
 * queue message was lost and re-enqueues it. Comfortably longer than the
 * consumer's batch timeout plus a slow delivery.
 */
const STUCK_AFTER_SECONDS = 600;

export interface QueuedNotification {
  notificationId: string;
}

function queue(): Queue<QueuedNotification> {
  return env.NOTIFICATIONS;
}

export function retryDelayForAttempt(attempt: number): number {
  return BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
}

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
 * Inserts a ledger row per subscriber, then queues the ids that were actually
 * new. `DO NOTHING` on conflict means a replayed event inserts nothing and
 * queues nothing, so dedupe happens before a message is ever created.
 */
export async function enqueue(payload: NotificationPayload, dedupeKey: string): Promise<number> {
  const { results } = await db()
    .prepare("SELECT * FROM subscribers WHERE state = 'active'")
    .all<SubscriberRow>();

  const targets = results.filter((s) => matchesFilter(s, payload));
  if (targets.length === 0) return 0;

  const ts = now();
  const serialised = JSON.stringify(payload);
  const rows = targets.map((subscriber) => ({ id: newId(), subscriberId: subscriber.id }));

  const inserted = await db().batch<unknown>(
    rows.map((row) =>
      db()
        .prepare(
          `INSERT INTO notifications
             (id, subscriber_id, dedupe_key, kind, payload, state, attempts, next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
           ON CONFLICT(subscriber_id, dedupe_key) DO NOTHING`,
        )
        .bind(row.id, row.subscriberId, dedupeKey, payload.kind, serialised, ts, ts),
    ),
  );

  // Only queue the rows this call created. `changes` is 0 for a conflict.
  const fresh = rows.filter((_, i) => (inserted[i]?.meta.changes ?? 0) > 0);
  await publish(fresh.map((row) => row.id));

  return fresh.length;
}

/** Queues a single notification to one subscriber (confirmation emails). */
export async function enqueueDirect(
  subscriberId: string,
  payload: NotificationPayload,
  dedupeKey: string,
): Promise<void> {
  const id = newId();
  const ts = now();

  const result = await db()
    .prepare(
      `INSERT INTO notifications
         (id, subscriber_id, dedupe_key, kind, payload, state, attempts, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT(subscriber_id, dedupe_key) DO NOTHING`,
    )
    .bind(id, subscriberId, dedupeKey, payload.kind, JSON.stringify(payload), ts, ts)
    .run();

  if ((result.meta.changes ?? 0) > 0) await publish([id]);
}

/** Sends notification ids to the queue, chunked to the per-call limit. */
async function publish(notificationIds: string[]): Promise<void> {
  for (let i = 0; i < notificationIds.length; i += SEND_BATCH_LIMIT) {
    const chunk = notificationIds.slice(i, i + SEND_BATCH_LIMIT);
    await queue().sendBatch(chunk.map((notificationId) => ({ body: { notificationId } })));
  }
}

// ---------------------------------------------------------------------------
// Delivery — called by the queue consumer, one message at a time
// ---------------------------------------------------------------------------

interface JoinedRow extends NotificationRow {
  sub_id: string;
  sub_type: SubscriberRow["type"];
  sub_endpoint: string;
  sub_secret: string | null;
  sub_state: SubscriberRow["state"];
  sub_component_ids: string | null;
  sub_unsub_token: string;
}

export type DeliveryOutcome =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

async function deliver(
  subscriber: SubscriberRow,
  payload: NotificationPayload,
  siteUrl: string,
): Promise<void> {
  switch (subscriber.type) {
    case "email":
      return sendEmail(
        subscriber,
        payload,
        `${siteUrl}/subscribe/unsubscribe?token=${subscriber.unsub_token}`,
      );
    case "slack":
      return sendSlack(subscriber.endpoint, payload);
    case "webhook":
      return sendWebhook(subscriber, payload);
  }
}

/**
 * Delivers one notification and records the outcome.
 *
 * Returns rather than throws, so the consumer decides whether to ack or retry
 * instead of failing — and taking down — the whole batch.
 */
export async function deliverNotification(
  notificationId: string,
  attempt: number,
): Promise<DeliveryOutcome> {
  const row = await db()
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
        WHERE n.id = ?`,
    )
    .bind(notificationId)
    .first<JoinedRow>();

  // The row or its subscriber was deleted between enqueue and delivery.
  if (!row) return { status: "skipped", reason: "notification no longer exists" };

  // Already delivered — a redelivery after the ack was lost. Nothing to do.
  if (row.state === "sent") return { status: "skipped", reason: "already sent" };

  // Someone unsubscribed while the message was in flight. Honour that.
  if (row.sub_state === "unsubscribed" || row.sub_state === "bounced") {
    await db()
      .prepare("UPDATE notifications SET state = 'abandoned', last_error = ? WHERE id = ?")
      .bind(`subscriber is ${row.sub_state}`, notificationId)
      .run();
    return { status: "skipped", reason: `subscriber is ${row.sub_state}` };
  }

  const settings = await getSettings();
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

  const ts = now();

  try {
    await deliver(subscriber, JSON.parse(row.payload) as NotificationPayload, settings.siteUrl);
  } catch (error) {
    const message = String(error).slice(0, 500);
    await db()
      .prepare(
        "UPDATE notifications SET state = 'failed', attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
      )
      .bind(attempt, ts + retryDelayForAttempt(attempt), message, notificationId)
      .run();
    return { status: "failed", error: message };
  }

  await db().batch([
    db()
      .prepare(
        "UPDATE notifications SET state = 'sent', sent_at = ?, attempts = ?, last_error = NULL WHERE id = ?",
      )
      .bind(ts, attempt, notificationId),
    db().prepare("UPDATE subscribers SET last_sent_at = ? WHERE id = ?").bind(ts, row.sub_id),
  ]);

  return { status: "sent" };
}

/** Marks a notification terminally failed. Called by the dead-letter consumer. */
export async function abandonNotification(notificationId: string): Promise<void> {
  await db()
    .prepare(
      `UPDATE notifications
          SET state = 'abandoned',
              last_error = COALESCE(last_error, 'delivery failed and exhausted all retries')
        WHERE id = ? AND state != 'sent'`,
    )
    .bind(notificationId)
    .run();
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Safety net for rows whose queue message never arrived — a `sendBatch` that
 * failed after the insert committed, or a message lost to the queue's 24-hour
 * retention on the free plan.
 *
 * This is not the retry path; Queues handles retries. It only catches
 * notifications that were never queued at all, which is why it waits ten
 * minutes before touching anything.
 */
export async function reconcileStuck(limit = 100): Promise<number> {
  const cutoff = now() - STUCK_AFTER_SECONDS;

  const { results } = await db()
    .prepare(
      `SELECT id FROM notifications
        WHERE state = 'pending' AND created_at <= ?
        ORDER BY created_at
        LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<{ id: string }>();

  if (results.length === 0) return 0;

  await publish(results.map((row) => row.id));

  // Push `created_at` forward so the next sweep does not immediately re-queue
  // the same rows while this attempt is still in flight.
  const ts = now();
  await db()
    .prepare(
      `UPDATE notifications SET created_at = ?
        WHERE id IN (${results.map(() => "?").join(", ")})`,
    )
    .bind(ts, ...results.map((row) => row.id))
    .run();

  return results.length;
}

/** Re-queues everything not yet delivered. Backs the admin "retry now" button. */
export async function requeueUndelivered(limit = 200): Promise<number> {
  const { results } = await db()
    .prepare(
      `SELECT id FROM notifications
        WHERE state IN ('pending', 'failed', 'abandoned')
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string }>();

  if (results.length === 0) return 0;

  await db()
    .prepare(
      `UPDATE notifications SET state = 'pending', next_attempt_at = ?
        WHERE id IN (${results.map(() => "?").join(", ")})`,
    )
    .bind(now(), ...results.map((row) => row.id))
    .run();

  await publish(results.map((row) => row.id));
  return results.length;
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
