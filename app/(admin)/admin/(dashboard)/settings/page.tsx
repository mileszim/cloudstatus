import { updateSettingsAction } from "../actions";
import { CheckboxField, Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/form";
import { PageHeader, Section } from "@/components/admin/page-header";
import { Select } from "@/components/admin/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getSettings } from "@/lib/status/settings";

export const metadata = { title: "Settings" };

/** A short list beats a 400-entry dropdown; anything else can be typed. */
const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export default async function SettingsPage() {
  const settings = await getSettings();
  const timezones = COMMON_TIMEZONES.includes(settings.timezone)
    ? COMMON_TIMEZONES
    : [settings.timezone, ...COMMON_TIMEZONES];

  return (
    <>
      <PageHeader title="Settings" description="How the public page presents itself." />

      <form action={updateSettingsAction} className="flex flex-col gap-6">
        <Section title="Page">
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Page name" htmlFor="pageName">
              <Input id="pageName" name="pageName" defaultValue={settings.pageName} required />
            </Field>

            <Field
              label="Public URL"
              htmlFor="siteUrl"
              hint="Used in feeds, emails, badges, and webhook payloads."
            >
              <Input
                id="siteUrl"
                name="siteUrl"
                type="url"
                defaultValue={settings.siteUrl}
                required
              />
            </Field>

            <Field label="Description" htmlFor="pageDescription" className="sm:col-span-2">
              <Textarea
                id="pageDescription"
                name="pageDescription"
                rows={2}
                defaultValue={settings.pageDescription}
              />
            </Field>

            <Field label="Support URL" htmlFor="supportUrl" hint="Optional link in the footer.">
              <Input
                id="supportUrl"
                name="supportUrl"
                type="url"
                defaultValue={settings.supportUrl}
                placeholder="https://example.com/support"
              />
            </Field>

            <Field label="Time zone" htmlFor="timezone" hint="How dates are shown to visitors.">
              <Select id="timezone" name="timezone" defaultValue={settings.timezone}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Default theme" htmlFor="defaultTheme">
              <Select id="defaultTheme" name="defaultTheme" defaultValue={settings.defaultTheme}>
                <option value="system">Follow the visitor's system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>

            <Field
              label="Uptime history (days)"
              htmlFor="uptimeDays"
              hint="Length of the bars on the status page. 7–365."
            >
              <Input
                id="uptimeDays"
                name="uptimeDays"
                type="number"
                min={7}
                max={365}
                defaultValue={settings.uptimeDays}
              />
            </Field>
          </div>
        </Section>

        <Section title="Notifications">
          <div className="flex flex-col gap-4 px-5 py-4">
            <CheckboxField
              name="allowSubscriptions"
              label="Let visitors subscribe"
              hint="Shows the subscribe button and enables /subscribe."
              defaultChecked={settings.allowSubscriptions}
            />
            <CheckboxField
              name="notifyOnComponentChange"
              label="Notify on component status changes outside incidents"
              hint="Off by default — most changes already arrive as incident updates, and doubling up trains people to ignore the emails."
              defaultChecked={settings.notifyOnComponentChange}
            />

            <Field
              label="Slack mirror webhook"
              htmlFor="slackWebhookUrl"
              hint="Every incident update is also posted here, independently of subscribers. Your own channel, not a subscription."
            >
              <Input
                id="slackWebhookUrl"
                name="slackWebhookUrl"
                type="url"
                defaultValue={settings.slackWebhookUrl}
                placeholder="https://hooks.slack.com/services/…"
              />
            </Field>
          </div>
        </Section>

        <div className="flex justify-end">
          <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
        </div>
      </form>

      <Section title="Secrets">
        <div className="text-muted-foreground space-y-2 px-5 py-4 text-sm">
          <p>
            These live outside the database, as Worker secrets. Set them with{" "}
            <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
              npx wrangler secret put NAME
            </code>
            , or in <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">.dev.vars</code>{" "}
            locally.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>
              <code className="font-mono">ADMIN_PASSWORD_HASH</code> — from{" "}
              <code className="font-mono">npm run hash-password</code>
            </li>
            <li>
              <code className="font-mono">SESSION_SECRET</code> — signs admin cookies; rotating it
              signs everyone out
            </li>
            <li>
              <code className="font-mono">INGEST_SECRET</code> — verifies the generic webhook
            </li>
            <li>
              <code className="font-mono">EMAIL_FROM</code> — sender address on a domain onboarded
              to Cloudflare Email Service
            </li>
          </ul>
        </div>
      </Section>
    </>
  );
}
