import { PlayIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";

import {
  createMonitorAction,
  deleteMonitorAction,
  runAllChecksAction,
  runMonitorAction,
  updateMonitorAction,
} from "../actions";
import { CheckboxField, Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/form";
import { PageHeader, Section } from "@/components/admin/page-header";
import { Select } from "@/components/admin/select";
import { StatusDot } from "@/components/status/status-dot";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/db/client";
import { listComponents } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatDateTime, relativeTime } from "@/lib/status/time";
import {
  COMPONENT_STATUS_LABEL,
  HTTP_METHODS,
  type CheckRow,
  type ComponentRow,
  type MonitorRow,
} from "@/lib/status/types";

export const metadata = { title: "Monitors" };

const FAILURE_STATUSES = ["degraded_performance", "partial_outage", "major_outage"] as const;

const INTERVALS = [
  { value: 60, label: "Every minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 900, label: "Every 15 minutes" },
  { value: 3600, label: "Hourly" },
];

/** Shared field set for the create and edit forms. */
function MonitorFields({
  monitor,
  components,
  idPrefix,
}: {
  monitor?: MonitorRow;
  components: ComponentRow[];
  idPrefix: string;
}) {
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label="Name" htmlFor={id("name")} className="sm:col-span-3">
        <Input id={id("name")} name="name" defaultValue={monitor?.name} required placeholder="API health" />
      </Field>

      <Field label="Component" htmlFor={id("component")} className="sm:col-span-3">
        <Select id={id("component")} name="componentId" defaultValue={monitor?.component_id ?? ""}>
          <option value="">Not linked</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Method" htmlFor={id("method")} className="sm:col-span-1">
        <Select id={id("method")} name="method" defaultValue={monitor?.method ?? "GET"}>
          {HTTP_METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="URL" htmlFor={id("url")} className="sm:col-span-5">
        <Input
          id={id("url")}
          name="url"
          type="url"
          defaultValue={monitor?.url}
          required
          placeholder="https://api.example.com/health"
        />
      </Field>

      <Field
        label="Expected status"
        htmlFor={id("expected")}
        hint="e.g. 200, 2xx, or 200,204"
        className="sm:col-span-2"
      >
        <Input id={id("expected")} name="expectedStatus" defaultValue={monitor?.expected_status ?? "2xx"} />
      </Field>

      <Field
        label="Body must contain"
        htmlFor={id("match")}
        hint="Optional. Case-insensitive."
        className="sm:col-span-2"
      >
        <Input id={id("match")} name="bodyMatch" defaultValue={monitor?.body_match ?? ""} placeholder="ok" />
      </Field>

      <Field label="Interval" htmlFor={id("interval")} className="sm:col-span-2">
        <Select id={id("interval")} name="intervalS" defaultValue={String(monitor?.interval_s ?? 60)}>
          {INTERVALS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Timeout (ms)" htmlFor={id("timeout")} className="sm:col-span-2">
        <Input
          id={id("timeout")}
          name="timeoutMs"
          type="number"
          min={1000}
          max={30000}
          step={500}
          defaultValue={monitor?.timeout_ms ?? 10000}
        />
      </Field>

      <Field
        label="Degraded above (ms)"
        htmlFor={id("degraded")}
        hint="Blank disables latency grading."
        className="sm:col-span-2"
      >
        <Input
          id={id("degraded")}
          name="degradedMs"
          type="number"
          min={1}
          defaultValue={monitor?.degraded_ms ?? ""}
          placeholder="2000"
        />
      </Field>

      <Field label="On failure, set" htmlFor={id("failstatus")} className="sm:col-span-2">
        <Select
          id={id("failstatus")}
          name="failureStatus"
          defaultValue={monitor?.failure_status ?? "major_outage"}
        >
          {FAILURE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {COMPONENT_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Failures before alerting"
        htmlFor={id("failthreshold")}
        className="sm:col-span-3"
      >
        <Input
          id={id("failthreshold")}
          name="failureThreshold"
          type="number"
          min={1}
          max={10}
          defaultValue={monitor?.failure_threshold ?? 2}
        />
      </Field>

      <Field label="Successes before clearing" htmlFor={id("recthreshold")} className="sm:col-span-3">
        <Input
          id={id("recthreshold")}
          name="recoveryThreshold"
          type="number"
          min={1}
          max={10}
          defaultValue={monitor?.recovery_threshold ?? 2}
        />
      </Field>

      <Field
        label="Request headers (JSON)"
        htmlFor={id("headers")}
        hint='e.g. {"authorization": "Bearer …"}'
        className="sm:col-span-3"
      >
        <Textarea
          id={id("headers")}
          name="headers"
          rows={2}
          defaultValue={monitor?.headers ?? ""}
          className="font-mono text-xs"
        />
      </Field>

      <Field
        label="Request body"
        htmlFor={id("body")}
        hint="Sent for POST, PUT, and PATCH."
        className="sm:col-span-3"
      >
        <Textarea
          id={id("body")}
          name="body"
          rows={2}
          defaultValue={monitor?.body ?? ""}
          className="font-mono text-xs"
        />
      </Field>

      <div className="flex flex-col gap-2 sm:col-span-6">
        <CheckboxField name="enabled" label="Enabled" defaultChecked={monitor ? monitor.enabled === 1 : true} />
        <CheckboxField
          name="autoIncident"
          label="Open and resolve incidents automatically"
          hint="Posts an incident when the failure threshold trips, and resolves it on recovery."
          defaultChecked={monitor ? monitor.auto_incident === 1 : true}
        />
      </div>
    </div>
  );
}

export default async function MonitorsPage() {
  const [settings, components, monitors, recentChecks] = await Promise.all([
    getSettings(),
    listComponents(),
    db().prepare("SELECT * FROM monitors ORDER BY name").all<MonitorRow>(),
    db()
      .prepare(
        `SELECT c.* FROM checks c
          JOIN (SELECT monitor_id, MAX(checked_at) AS latest FROM checks GROUP BY monitor_id) m
            ON m.monitor_id = c.monitor_id AND m.latest = c.checked_at`,
      )
      .all<CheckRow>(),
  ]);

  const lastCheck = new Map(recentChecks.results.map((c) => [c.monitor_id, c]));

  return (
    <>
      <PageHeader
        title="Monitors"
        description="Synthetic HTTP checks. The cron runs every due monitor each minute."
        action={
          <form action={runAllChecksAction}>
            <SubmitButton variant="outline" size="sm" pendingLabel="Running…">
              <RefreshCwIcon className="size-3.5" />
              Run all due checks
            </SubmitButton>
          </form>
        }
      />

      <div className="flex flex-col gap-6">
        {monitors.results.map((monitor) => {
          const check = lastCheck.get(monitor.id);
          return (
            <Section
              key={monitor.id}
              title={monitor.name}
              description={
                monitor.last_checked_at
                  ? `Last checked ${relativeTime(monitor.last_checked_at)} · ${formatDateTime(monitor.last_checked_at, settings.timezone)}` +
                    (monitor.last_latency_ms != null ? ` · ${monitor.last_latency_ms}ms` : "") +
                    (monitor.last_error ? ` · ${monitor.last_error}` : "")
                  : "Never checked."
              }
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <StatusDot
                      status={
                        monitor.enabled === 0
                          ? "under_maintenance"
                          : monitor.last_ok === 0
                            ? "major_outage"
                            : check?.outcome === "degraded"
                              ? "degraded_performance"
                              : "operational"
                      }
                      pulse={false}
                    />
                    <span className="text-muted-foreground">
                      {monitor.consecutive_failures > 0
                        ? `${monitor.consecutive_failures} consecutive failures`
                        : `${monitor.consecutive_successes} consecutive successes`}
                    </span>
                  </div>

                  <form action={runMonitorAction} className="ml-auto">
                    <input type="hidden" name="id" value={monitor.id} />
                    <SubmitButton size="sm" variant="secondary" pendingLabel="Checking…">
                      <PlayIcon className="size-3.5" />
                      Check now
                    </SubmitButton>
                  </form>

                  <form action={deleteMonitorAction}>
                    <input type="hidden" name="id" value={monitor.id} />
                    <SubmitButton
                      size="sm"
                      variant="ghost"
                      confirm={`Delete the "${monitor.name}" monitor and its check history?`}
                    >
                      <Trash2Icon className="size-3.5" />
                    </SubmitButton>
                  </form>
                </div>
              }
            >
              <form action={updateMonitorAction} className="px-5 py-4">
                <input type="hidden" name="id" value={monitor.id} />
                <MonitorFields monitor={monitor} components={components} idPrefix={monitor.id} />
                <div className="mt-4 flex justify-end">
                  <SubmitButton variant="outline" pendingLabel="Saving…">
                    Save monitor
                  </SubmitButton>
                </div>
              </form>
            </Section>
          );
        })}

        <Section
          title="Add a monitor"
          description="Probes run from Cloudflare's network on the schedule you pick."
        >
          <form action={createMonitorAction} className="px-5 py-4">
            <MonitorFields components={components} idPrefix="new" />
            <div className="mt-4 flex justify-end">
              <SubmitButton pendingLabel="Adding…">Add monitor</SubmitButton>
            </div>
          </form>
        </Section>
      </div>
    </>
  );
}
