import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { createIncidentAction } from "../../actions";
import { ComponentStatusPicker } from "@/components/admin/component-status-picker";
import { CheckboxField, Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/form";
import { PageHeader, Section } from "@/components/admin/page-header";
import { Select } from "@/components/admin/select";
import { TemplatePicker } from "@/components/admin/template-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listComponents } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import {
  IMPACTS,
  IMPACT_LABEL,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABEL,
  MAINTENANCE_STATUSES,
} from "@/lib/status/types";

export const metadata = { title: "New incident" };

const TEMPLATES = [
  {
    label: "Investigating",
    body: "We are investigating reports of an issue affecting this service. We will provide an update within 30 minutes.",
  },
  {
    label: "Identified",
    body: "We have identified the cause and are working on a fix. We will update this page as the rollout progresses.",
  },
  {
    label: "Monitoring",
    body: "A fix has been deployed and we are monitoring the results. Service should be returning to normal.",
  },
];

export default async function NewIncidentPage({
  searchParams,
}: {
  searchParams: Promise<{ maintenance?: string }>;
}) {
  const [{ maintenance }, components, settings] = await Promise.all([
    searchParams,
    listComponents(),
    getSettings(),
  ]);

  const isMaintenance = maintenance === "1";
  const statuses = isMaintenance ? MAINTENANCE_STATUSES : INCIDENT_STATUSES;

  return (
    <>
      <Link
        href="/admin/incidents"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeftIcon className="size-3.5" />
        All incidents
      </Link>

      <PageHeader
        title={isMaintenance ? "Schedule maintenance" : "New incident"}
        description={
          isMaintenance
            ? "Announce a planned window. Components are only degraded once it starts."
            : "Post an incident and its first update. Subscribers are notified immediately."
        }
        action={
          <Link
            href={isMaintenance ? "/admin/incidents/new" : "/admin/incidents/new?maintenance=1"}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
          >
            {isMaintenance ? "Create an incident instead" : "Schedule maintenance instead"}
          </Link>
        }
      />

      <form action={createIncidentAction} className="flex flex-col gap-6">
        <input type="hidden" name="isMaintenance" value={isMaintenance ? "true" : "false"} />

        <Section title="Details">
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="title" className="sm:col-span-2">
              <Input
                id="title"
                name="title"
                required
                autoFocus
                placeholder={
                  isMaintenance ? "Database upgrade (EU West)" : "Elevated error rates on the API"
                }
              />
            </Field>

            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={statuses[0]}>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {INCIDENT_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Impact"
              htmlFor="impact"
              hint="Leave on auto to derive it from the affected components."
            >
              <Select id="impact" name="impact" defaultValue="">
                <option value="">Auto</option>
                {IMPACTS.map((impact) => (
                  <option key={impact} value={impact}>
                    {IMPACT_LABEL[impact]}
                  </option>
                ))}
              </Select>
            </Field>

            {isMaintenance && (
              <>
                <Field
                  label="Starts"
                  htmlFor="scheduledFor"
                  hint={`Entered and displayed in ${settings.timezone === "UTC" ? "UTC" : `UTC (page shows ${settings.timezone})`}.`}
                >
                  <Input id="scheduledFor" name="scheduledFor" type="datetime-local" required />
                </Field>
                <Field label="Ends" htmlFor="scheduledUntil">
                  <Input id="scheduledUntil" name="scheduledUntil" type="datetime-local" required />
                </Field>
                <div className="sm:col-span-2">
                  <CheckboxField
                    name="autoTransition"
                    label="Start and complete automatically"
                    hint="The cron moves the window to in-progress and completed at these times."
                    defaultChecked
                  />
                </div>
              </>
            )}
          </div>
        </Section>

        <Section
          title="First update"
          description="Markdown is supported. This is what subscribers receive."
        >
          <div className="flex flex-col gap-3 px-5 py-4">
            {!isMaintenance && <TemplatePicker targetId="body" templates={TEMPLATES} />}

            <Textarea
              id="body"
              name="body"
              rows={6}
              required
              placeholder={
                isMaintenance
                  ? "What you are changing, who it affects, and whether any action is needed."
                  : "What you know so far, who is affected, and when you will update next."
              }
            />

            <CheckboxField
              name="notify"
              label="Notify subscribers"
              hint="Sends email, Slack, and webhook notifications now."
              defaultChecked
            />
          </div>
        </Section>

        <Section
          title="Affected components"
          description="Statuses apply immediately for incidents, and at the start time for maintenance."
        >
          <div className="px-5 py-4">
            <ComponentStatusPicker components={components} />
          </div>
        </Section>

        <div className="flex justify-end gap-2">
          <SubmitButton pendingLabel="Publishing…">
            {isMaintenance ? "Schedule maintenance" : "Publish incident"}
          </SubmitButton>
        </div>
      </form>
    </>
  );
}
