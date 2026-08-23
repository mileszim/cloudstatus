import {
  abandonNotification,
  deliverNotification,
  retryDelayForAttempt,
  type QueuedNotification,
} from "@/lib/notify/dispatch";

/**
 * Queue consumer for subscriber notifications.
 *
 * One Worker consumes two queues, told apart by `batch.queue`: the main
 * notification queue, and its dead-letter queue.
 *
 * Every message is acked or retried explicitly. Letting the handler throw would
 * retry the whole batch, so one unreachable webhook would resend nine emails
 * that already arrived — the ledger would catch the duplicates, but the sends
 * would still be attempted and billed.
 */

export const NOTIFICATION_QUEUE = "cloudstatus-notifications";
export const NOTIFICATION_DLQ = "cloudstatus-notifications-dlq";

export async function handleNotificationBatch(
  batch: MessageBatch<QueuedNotification>,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  if (batch.queue === NOTIFICATION_DLQ) {
    await handleDeadLetters(batch);
    return;
  }

  // Messages run concurrently; `max_concurrency` on the consumer plus
  // `max_batch_size` bound how many outbound connections exist at once.
  await Promise.all(batch.messages.map((message) => handleOne(message)));
}

async function handleOne(message: Message<QueuedNotification>): Promise<void> {
  const { notificationId } = message.body ?? {};

  if (!notificationId) {
    // Nothing actionable in a malformed message, and retrying cannot fix it.
    console.error("[queue] message has no notificationId", message.id);
    message.ack();
    return;
  }

  let outcome;
  try {
    outcome = await deliverNotification(notificationId, message.attempts);
  } catch (error) {
    // deliverNotification handles delivery errors itself, so reaching here means
    // D1 is unhappy. Retry without backoff assumptions — it is usually transient.
    console.error(`[queue] ${notificationId}: delivery threw`, error);
    message.retry({ delaySeconds: retryDelayForAttempt(message.attempts) });
    return;
  }

  if (outcome.status === "failed") {
    console.warn(
      `[queue] ${notificationId}: attempt ${message.attempts} failed — ${outcome.error}`,
    );
    message.retry({ delaySeconds: retryDelayForAttempt(message.attempts) });
    return;
  }

  message.ack();
}

/**
 * Terminal failures. Records the outcome so the dashboard's delivery log shows
 * "abandoned" rather than leaving a row stuck on "failed" forever.
 */
async function handleDeadLetters(batch: MessageBatch<QueuedNotification>): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      const id = message.body?.notificationId;
      if (id) {
        try {
          await abandonNotification(id);
          console.error(`[queue] ${id}: exhausted all retries, marked abandoned`);
        } catch (error) {
          console.error(`[queue] ${id}: could not mark abandoned`, error);
        }
      }
      // Always ack: a dead letter has nowhere left to go.
      message.ack();
    }),
  );
}
