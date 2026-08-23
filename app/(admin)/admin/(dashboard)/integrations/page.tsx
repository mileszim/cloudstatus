import { KeyIcon, Trash2Icon } from "lucide-react";

import {
  createApiKeyAction,
  createIntegrationRuleAction,
  deleteIntegrationRuleAction,
  revokeApiKeyAction,
} from "../actions";
import { CheckboxField, Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/form";
import { PageHeader, Section } from "@/components/admin/page-header";
import { Select } from "@/components/admin/select";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db/client";
import { listComponents } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";
import { formatDateTime, relativeTime } from "@/lib/status/time";
import {
  COMPONENT_STATUS_LABEL,
  type ApiKeyRow,
  type IntegrationRuleRow,
} from "@/lib/status/types";

export const metadata = { title: "Integrations" };

const FAILURE_STATUSES = ["degraded_performance", "partial_outage", "major_outage"] as const;

const PROVIDERS = [
  {
    value: "pagerduty",
    label: "PagerDuty",
    hint: "Match on the service name in the webhook payload.",
  },
  { value: "datadog", label: "Datadog", hint: "Match on the monitor name or a tag value." },
  { value: "generic", label: "Generic", hint: "Match on the `key` field you post." },
];

function Endpoint({ method, path, note }: { method: string; path: string; note: string }) {
  return (
    <li className="px-5 py-2.5">
      <p className="font-mono text-xs">
        <span className="text-muted-foreground">{method}</span> {path}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">{note}</p>
    </li>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ token }, settings, components, keys, rules] = await Promise.all([
    searchParams,
    getSettings(),
    listComponents(),
    db().prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all<ApiKeyRow>(),
    db()
      .prepare(
        `SELECT r.*, c.name AS component_name
           FROM integration_rules r
           JOIN components c ON c.id = r.component_id
          ORDER BY r.provider, r.match_key`,
      )
      .all<IntegrationRuleRow & { component_name: string }>(),
  ]);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Drive this page from your existing monitoring and alerting stack."
      />

      {token && (
        <div className="bg-operational-soft mb-6 rounded-lg border px-5 py-4">
          <p className="text-operational flex items-center gap-2 text-sm font-medium">
            <KeyIcon className="size-4" />
            New API key created
          </p>
          <p className="mt-2 font-mono text-xs break-all select-all">{token}</p>
          <p className="text-muted-foreground mt-2 text-xs">
            Copy it now — only its hash is stored, so this is the only time it is shown.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6">
        <Section
          title="API keys"
          description="Bearer tokens for the write API. Send as `Authorization: Bearer <key>`."
        >
          <ul className="divide-y">
            {keys.results.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div>
                  <p className="text-sm">
                    {key.name}
                    {key.revoked_at && (
                      <span className="text-muted-foreground ml-2 text-xs">revoked</span>
                    )}
                  </p>
                  <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                    {key.prefix}… · created {relativeTime(key.created_at)}
                    {key.last_used_at
                      ? ` · last used ${formatDateTime(key.last_used_at, settings.timezone)}`
                      : " · never used"}
                  </p>
                </div>
                {!key.revoked_at && (
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="id" value={key.id} />
                    <SubmitButton size="sm" variant="ghost" confirm={`Revoke "${key.name}"?`}>
                      Revoke
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
            {keys.results.length === 0 && (
              <li className="text-muted-foreground px-5 py-6 text-center text-sm">No keys yet.</li>
            )}
          </ul>

          <form action={createApiKeyAction} className="flex items-end gap-3 border-t px-5 py-4">
            <Field label="Key name" htmlFor="key-name" className="flex-1">
              <Input id="key-name" name="name" placeholder="CI pipeline" required />
            </Field>
            <SubmitButton pendingLabel="Creating…">Create key</SubmitButton>
          </form>
        </Section>

        <Section
          title="Ingest rules"
          description="Map an inbound alert onto a component. Unmatched alerts are acknowledged and ignored."
        >
          <ul className="divide-y">
            {rules.results.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div>
                  <p className="text-sm">
                    <span className="text-muted-foreground">{rule.provider}</span>{" "}
                    <span className="font-mono text-xs">{rule.match_key}</span> →{" "}
                    {rule.component_name}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Sets {COMPONENT_STATUS_LABEL[rule.degrade_to].toLowerCase()}
                    {rule.open_incident === 1 ? " and opens an incident" : " without an incident"}
                  </p>
                </div>
                <form action={deleteIntegrationRuleAction}>
                  <input type="hidden" name="id" value={rule.id} />
                  <SubmitButton size="sm" variant="ghost" confirm="Delete this rule?">
                    <Trash2Icon className="size-3.5" />
                  </SubmitButton>
                </form>
              </li>
            ))}
            {rules.results.length === 0 && (
              <li className="text-muted-foreground px-5 py-6 text-center text-sm">
                No rules yet.
              </li>
            )}
          </ul>

          <form
            action={createIntegrationRuleAction}
            className="grid gap-3 border-t px-5 py-4 sm:grid-cols-4"
          >
            <Field label="Provider" htmlFor="rule-provider">
              <Select id="rule-provider" name="provider" defaultValue="pagerduty">
                {PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Match on" htmlFor="rule-key" hint="Service or monitor name.">
              <Input id="rule-key" name="matchKey" required placeholder="Acme API" />
            </Field>
            <Field label="Component" htmlFor="rule-component">
              <Select id="rule-component" name="componentId" required>
                {components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Set status to" htmlFor="rule-status">
              <Select id="rule-status" name="degradeTo" defaultValue="major_outage">
                {FAILURE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {COMPONENT_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-3">
              <CheckboxField
                name="openIncident"
                label="Open an incident when this fires"
                defaultChecked
              />
            </div>
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Saving…">Add rule</SubmitButton>
            </div>
          </form>
        </Section>

        <Section
          title="Endpoints"
          description={`Base URL: ${settings.siteUrl}`}
        >
          <ul className="divide-y">
            <Endpoint
              method="POST"
              path="/api/hooks/pagerduty"
              note="PagerDuty v3 webhook subscription. Triggered incidents degrade the mapped component; resolved incidents clear it."
            />
            <Endpoint
              method="POST"
              path="/api/hooks/datadog"
              note="Datadog webhook. Use a body of {&quot;key&quot;: &quot;$ALERT_TITLE&quot;, &quot;state&quot;: &quot;$ALERT_TRANSITION&quot;}."
            />
            <Endpoint
              method="POST"
              path="/api/hooks/generic"
              note="Any tool that can POST JSON. Signed with INGEST_SECRET via the X-Cloudstatus-Signature header."
            />
            <Endpoint
              method="POST"
              path="/api/v1/components/:id/status"
              note="Set a component's status directly. Requires a Bearer API key."
            />
            <Endpoint
              method="POST"
              path="/api/v1/incidents"
              note="Create an incident with its first update. Requires a Bearer API key."
            />
            <Endpoint
              method="POST"
              path="/api/v1/incidents/:id/updates"
              note="Post an update to an existing incident. Requires a Bearer API key."
            />
            <Endpoint
              method="GET"
              path="/api/v2/summary.json"
              note="Public, unauthenticated, and Statuspage-compatible — existing dashboards work unmodified."
            />
          </ul>
        </Section>
      </div>
    </>
  );
}
