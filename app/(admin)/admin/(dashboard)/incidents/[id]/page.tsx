import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react";

import {
  addIncidentUpdateAction,
  deleteIncidentAction,
  publishPostmortemAction,
  updateIncidentDetailsAction,
} from "../../actions";
import { ComponentStatusPicker } from "@/components/admin/component-status-picker";
import { CheckboxField, Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/form";
import { PageHeader, Section } from "@/components/admin/page-header";
import { Select } from "@/components/admin/select";
import { Markdown } from "@/components/status/markdown";
import { IncidentStatusChip } from "@/components/status/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getIncident, listComponents, statusOptions } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatDateTime, relativeTime } from "@/lib/status/time";
import {
  IMPACTS,
  IMPACT_LABEL,
  INCIDENT_STATUS_LABEL,
  isClosedStatus,
  type ComponentStatus,
} from "@/lib/status/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const incident = await getIncident(id);
  return { title: incident?.title ?? "Incident" };
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`; we store and edit in UTC. */
function toDatetimeLocal(unix: number | null): string {
  return unix == null ? "" : new Date(unix * 1000).toISOString().slice(0, 16);
}

export default async function AdminIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [incident, components, settings] = await Promise.all([
    getIncident(id),
    listComponents(),
    getSettings(),
  ]);
  if (!incident) notFound();

  const isMaintenance = incident.is_maintenance === 1;
  const statuses = statusOptions(isMaintenance);
  const closed = isClosedStatus(incident.status);

  const current: Record<string, ComponentStatus> = Object.fromEntries(
    incident.components.map((c) => [c.id, c.status_during]),
  );

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
        title={incident.title}
        description={`${INCIDENT_STATUS_LABEL[incident.status]} · started ${formatDateTime(incident.started_at, settings.timezone)} · ${relativeTime(incident.started_at)}`}
        action={
          <div className="flex items-center gap-2">
            <IncidentStatusChip status={incident.status} />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/incidents/${incident.shortlink ?? incident.id}`} target="_blank">
                View public
                <ExternalLinkIcon className="size-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-6">
        <Section
          title="Post an update"
          description={
            closed
              ? "This incident is closed. Posting an update will reopen it."
              : "Subscribers receive this immediately unless you turn notifications off."
          }
        >
          <form action={addIncidentUpdateAction} className="flex flex-col gap-4 px-5 py-4">
            <input type="hidden" name="incidentId" value={incident.id} />

            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <Field label="Status" htmlFor="update-status">
                <Select id="update-status" name="status" defaultValue={incident.status}>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {INCIDENT_STATUS_LABEL[status]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Update" htmlFor="update-body">
                <Textarea
                  id="update-body"
                  name="body"
                  rows={4}
                  required
                  placeholder="What changed since the last update?"
                />
              </Field>
            </div>

            <details className="text-sm">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
                Change affected component statuses
              </summary>
              <div className="mt-3">
                <ComponentStatusPicker components={components} current={current} />
                <p className="text-muted-foreground mt-2 text-xs">
                  Resolving an incident automatically restores every component it touched.
                </p>
              </div>
            </details>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <CheckboxField name="notify" label="Notify subscribers" defaultChecked />
              <SubmitButton pendingLabel="Posting…">Post update</SubmitButton>
            </div>
          </form>
        </Section>

        <Section title="Timeline" description={`${incident.updates.length} updates.`}>
          <ol className="divide-y">
            {incident.updates.map((update) => (
              <li key={update.id} className="px-5 py-3">
                <div className="text-muted-foreground flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="text-foreground font-medium">
                    {INCIDENT_STATUS_LABEL[update.status]}
                  </span>
                  <span>{formatDateTime(update.display_at, settings.timezone)}</span>
                  {update.notify === 0 && (
                    <span className="bg-secondary rounded px-1.5 py-0.5 text-[10px]">
                      not notified
                    </span>
                  )}
                </div>
                <Markdown className="text-muted-foreground mt-1">{update.body}</Markdown>
              </li>
            ))}
            {incident.updates.length === 0 && (
              <li className="text-muted-foreground px-5 py-4 text-sm">No updates yet.</li>
            )}
          </ol>
        </Section>

        <Section title="Details">
          <form
            action={updateIncidentDetailsAction}
            className="grid gap-4 px-5 py-4 sm:grid-cols-2"
          >
            <input type="hidden" name="incidentId" value={incident.id} />

            <Field label="Title" htmlFor="edit-title" className="sm:col-span-2">
              <Input id="edit-title" name="title" defaultValue={incident.title} required />
            </Field>

            <Field label="Impact" htmlFor="edit-impact">
              <Select id="edit-impact" name="impact" defaultValue={incident.impact}>
                {IMPACTS.map((impact) => (
                  <option key={impact} value={impact}>
                    {IMPACT_LABEL[impact]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Public URL" htmlFor="edit-shortlink">
              <Input
                id="edit-shortlink"
                value={`/incidents/${incident.shortlink ?? incident.id}`}
                readOnly
                disabled
              />
            </Field>

            {isMaintenance && (
              <>
                <Field label="Starts (UTC)" htmlFor="edit-start">
                  <Input
                    id="edit-start"
                    name="scheduledFor"
                    type="datetime-local"
                    defaultValue={toDatetimeLocal(incident.scheduled_for)}
                  />
                </Field>
                <Field label="Ends (UTC)" htmlFor="edit-end">
                  <Input
                    id="edit-end"
                    name="scheduledUntil"
                    type="datetime-local"
                    defaultValue={toDatetimeLocal(incident.scheduled_until)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <CheckboxField
                    name="autoTransition"
                    label="Start and complete automatically"
                    defaultChecked={incident.auto_transition === 1}
                  />
                </div>
              </>
            )}

            <div className="flex justify-end sm:col-span-2">
              <SubmitButton variant="outline" pendingLabel="Saving…">
                Save details
              </SubmitButton>
            </div>
          </form>
        </Section>

        {!isMaintenance && (
          <Section
            title="Postmortem"
            description={
              incident.postmortem_published_at
                ? `Published ${formatDateTime(incident.postmortem_published_at, settings.timezone)}.`
                : "Published on the public incident page. Markdown is supported."
            }
          >
            <form action={publishPostmortemAction} className="flex flex-col gap-3 px-5 py-4">
              <input type="hidden" name="incidentId" value={incident.id} />
              <Textarea
                name="body"
                rows={10}
                defaultValue={incident.postmortem_body ?? ""}
                placeholder={"## Summary\n\nWhat happened, in plain language.\n\n## Timeline\n\n## What we are changing"}
                className="font-mono text-xs"
              />
              <div className="flex justify-end">
                <SubmitButton variant="outline" pendingLabel="Publishing…">
                  {incident.postmortem_published_at ? "Update postmortem" : "Publish postmortem"}
                </SubmitButton>
              </div>
            </form>
          </Section>
        )}

        <Section title="Danger zone">
          <form action={deleteIncidentAction} className="flex items-center justify-between px-5 py-4">
            <input type="hidden" name="incidentId" value={incident.id} />
            <p className="text-muted-foreground text-sm">
              Deleting removes the incident and its updates from the public history. Affected
              components are restored first.
            </p>
            <SubmitButton
              variant="ghost"
              confirm={`Delete "${incident.title}" permanently?`}
              className="text-major"
            >
              <Trash2Icon className="size-3.5" />
              Delete
            </SubmitButton>
          </form>
        </Section>
      </div>
    </>
  );
}
