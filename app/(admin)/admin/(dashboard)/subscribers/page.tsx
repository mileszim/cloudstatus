import { SendIcon, Trash2Icon } from "lucide-react";

import { addSubscriberAction, deleteSubscriberAction, drainNotificationsAction } from "../actions";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/form";
import { PageHeader, Section } from "@/components/admin/page-header";
import { Select } from "@/components/admin/select";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db/client";
import { getSettings } from "@/lib/status/settings";
import { formatDateTime, relativeTime } from "@/lib/status/time";
import type { NotificationRow, SubscriberRow } from "@/lib/status/types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Subscribers" };

const STATE_TONE: Record<SubscriberRow["state"], string> = {
  active: "text-operational",
  pending: "text-degraded",
  unsubscribed: "text-muted-foreground",
  bounced: "text-major",
};

const NOTIFICATION_TONE: Record<NotificationRow["state"], string> = {
  sent: "text-operational",
  pending: "text-muted-foreground",
  failed: "text-degraded",
  abandoned: "text-major",
};

export default async function SubscribersPage() {
  const [settings, subscribers, notifications, counts] = await Promise.all([
    getSettings(),
    db()
      .prepare("SELECT * FROM subscribers ORDER BY created_at DESC LIMIT 200")
      .all<SubscriberRow>(),
    db()
      .prepare(
        `SELECT n.*, s.endpoint AS endpoint
           FROM notifications n
           JOIN subscribers s ON s.id = n.subscriber_id
          ORDER BY n.created_at DESC LIMIT 40`,
      )
      .all<NotificationRow & { endpoint: string }>(),
    db()
      .prepare(
        `SELECT
           SUM(CASE WHEN state = 'active'       THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN state = 'pending'      THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN state = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed
         FROM subscribers`,
      )
      .first<{ active: number | null; pending: number | null; unsubscribed: number | null }>(),
  ]);

  return (
    <>
      <PageHeader
        title="Subscribers"
        description={`${counts?.active ?? 0} active · ${counts?.pending ?? 0} awaiting confirmation · ${counts?.unsubscribed ?? 0} unsubscribed`}
        action={
          <form action={drainNotificationsAction}>
            <SubmitButton variant="outline" size="sm" pendingLabel="Sending…">
              <SendIcon className="size-3.5" />
              Send queued now
            </SubmitButton>
          </form>
        }
      />

      <div className="flex flex-col gap-6">
        <Section
          title="Add a subscriber"
          description="Added directly, without a confirmation step — you are vouching for the endpoint."
        >
          <form action={addSubscriberAction} className="flex flex-wrap items-end gap-3 px-5 py-4">
            <Field label="Type" htmlFor="sub-type" className="w-36">
              <Select id="sub-type" name="type" defaultValue="email">
                <option value="email">Email</option>
                <option value="slack">Slack webhook</option>
                <option value="webhook">HTTP webhook</option>
              </Select>
            </Field>
            <Field label="Endpoint" htmlFor="sub-endpoint" className="min-w-64 flex-1">
              <Input
                id="sub-endpoint"
                name="endpoint"
                required
                placeholder="ops@example.com or https://hooks.slack.com/…"
              />
            </Field>
            <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
          </form>
        </Section>

        <Section title="Subscribers" description={`${subscribers.results.length} shown, newest first.`}>
          <ul className="divide-y">
            {subscribers.results.map((subscriber) => (
              <li
                key={subscriber.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{subscriber.endpoint}</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {subscriber.type} ·{" "}
                    <span className={cn(STATE_TONE[subscriber.state])}>{subscriber.state}</span> ·
                    joined {relativeTime(subscriber.created_at)}
                    {subscriber.component_ids && " · filtered to specific components"}
                  </p>
                </div>
                <form action={deleteSubscriberAction}>
                  <input type="hidden" name="id" value={subscriber.id} />
                  <SubmitButton
                    size="sm"
                    variant="ghost"
                    confirm={`Remove ${subscriber.endpoint}?`}
                  >
                    <Trash2Icon className="size-3.5" />
                  </SubmitButton>
                </form>
              </li>
            ))}
            {subscribers.results.length === 0 && (
              <li className="text-muted-foreground px-5 py-8 text-center text-sm">
                No subscribers yet.
              </li>
            )}
          </ul>
        </Section>

        <Section
          title="Delivery log"
          description="The most recent 40 notifications. Failed rows are retried by the minute cron with backoff."
        >
          <ul className="divide-y">
            {notifications.results.map((notification) => (
              <li key={notification.id} className="px-5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs">{notification.endpoint}</span>
                  <span className={cn("text-xs", NOTIFICATION_TONE[notification.state])}>
                    {notification.state}
                    {notification.attempts > 1 && ` after ${notification.attempts} attempts`}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {notification.kind} ·{" "}
                  {formatDateTime(notification.sent_at ?? notification.created_at, settings.timezone)}
                  {notification.last_error && (
                    <span className="text-major"> · {notification.last_error}</span>
                  )}
                </p>
              </li>
            ))}
            {notifications.results.length === 0 && (
              <li className="text-muted-foreground px-5 py-8 text-center text-sm">
                Nothing sent yet.
              </li>
            )}
          </ul>
        </Section>
      </div>
    </>
  );
}
