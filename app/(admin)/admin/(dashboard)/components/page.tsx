import { ChevronDownIcon, ChevronUpIcon, Trash2Icon } from "lucide-react";

import {
  createComponentAction,
  createGroupAction,
  deleteComponentAction,
  deleteGroupAction,
  moveComponentAction,
  setComponentStatusAction,
  updateComponentAction,
  updateGroupAction,
} from "../actions";
import { CheckboxField, Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/form";
import { PageHeader, Section } from "@/components/admin/page-header";
import { Select } from "@/components/admin/select";
import { StatusDot } from "@/components/status/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listComponentGroups, listComponents } from "@/lib/status/queries";
import {
  COMPONENT_STATUSES,
  COMPONENT_STATUS_LABEL,
  type ComponentGroupRow,
  type ComponentRow,
} from "@/lib/status/types";

export const metadata = { title: "Components" };

function ComponentRowEditor({
  component,
  groups,
}: {
  component: ComponentRow;
  groups: ComponentGroupRow[];
}) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex items-center gap-1 pt-1.5">
          <form action={moveComponentAction}>
            <input type="hidden" name="id" value={component.id} />
            <input type="hidden" name="direction" value="up" />
            <Button variant="ghost" size="icon" type="submit" aria-label="Move up" className="size-6">
              <ChevronUpIcon className="size-3.5" />
            </Button>
          </form>
          <form action={moveComponentAction}>
            <input type="hidden" name="id" value={component.id} />
            <input type="hidden" name="direction" value="down" />
            <Button variant="ghost" size="icon" type="submit" aria-label="Move down" className="size-6">
              <ChevronDownIcon className="size-3.5" />
            </Button>
          </form>
        </div>

        <form action={updateComponentAction} className="grid flex-1 gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={component.id} />

          <Field label="Name" htmlFor={`name-${component.id}`}>
            <Input id={`name-${component.id}`} name="name" defaultValue={component.name} required />
          </Field>

          <Field label="Group" htmlFor={`group-${component.id}`}>
            <Select id={`group-${component.id}`} name="groupId" defaultValue={component.group_id ?? ""}>
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Description" htmlFor={`desc-${component.id}`} className="sm:col-span-2">
            <Input
              id={`desc-${component.id}`}
              name="description"
              defaultValue={component.description ?? ""}
              placeholder="Shown under the component name"
            />
          </Field>

          <div className="flex flex-col gap-2">
            <CheckboxField
              name="showcase"
              label="Show uptime history"
              defaultChecked={component.showcase === 1}
            />
            <CheckboxField
              name="onlyShowIfDegraded"
              label="Hide while operational"
              defaultChecked={component.only_show_if_degraded === 1}
            />
          </div>

          <div className="flex items-end justify-end gap-2">
            <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </div>
        </form>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <StatusDot status={component.status} pulse={false} />
        <span className="text-muted-foreground text-xs">Set status:</span>

        <form action={setComponentStatusAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={component.id} />
          <Select name="status" defaultValue={component.status} className="h-8 w-auto text-xs">
            {COMPONENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {COMPONENT_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
          <CheckboxField name="notify" label="Notify subscribers" />
          <SubmitButton size="sm" variant="secondary" pendingLabel="Applying…">
            Apply
          </SubmitButton>
        </form>

        <form action={deleteComponentAction} className="ml-auto">
          <input type="hidden" name="id" value={component.id} />
          <SubmitButton
            size="sm"
            variant="ghost"
            confirm={`Delete "${component.name}"? Its uptime history and incident links go with it.`}
          >
            <Trash2Icon className="size-3.5" />
            Delete
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}

export default async function ComponentsPage() {
  const [components, groups] = await Promise.all([listComponents(), listComponentGroups()]);

  return (
    <>
      <PageHeader
        title="Components"
        description="The services listed on your status page, in display order."
      />

      <div className="flex flex-col gap-6">
        <Section title="Add a component">
          <form action={createComponentAction} className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="new-name">
              <Input id="new-name" name="name" placeholder="API" required />
            </Field>
            <Field label="Group" htmlFor="new-group">
              <Select id="new-group" name="groupId">
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" htmlFor="new-desc" className="sm:col-span-2">
              <Input id="new-desc" name="description" placeholder="REST and GraphQL endpoints" />
            </Field>
            <div className="flex flex-col gap-2">
              <CheckboxField name="showcase" label="Show uptime history" defaultChecked />
              <CheckboxField name="onlyShowIfDegraded" label="Hide while operational" />
            </div>
            <div className="flex items-end justify-end">
              <SubmitButton pendingLabel="Adding…">Add component</SubmitButton>
            </div>
          </form>
        </Section>

        <Section
          title="Components"
          description={`${components.length} configured. Order here is the order on the public page.`}
        >
          <ul className="divide-y">
            {components.map((component) => (
              <ComponentRowEditor key={component.id} component={component} groups={groups} />
            ))}
            {components.length === 0 && (
              <li className="text-muted-foreground px-5 py-8 text-center text-sm">
                No components yet.
              </li>
            )}
          </ul>
        </Section>

        <Section
          title="Groups"
          description="Group related services so the page reads as sections rather than a flat list."
        >
          <ul className="divide-y">
            {groups.map((group) => (
              <li key={group.id} className="flex flex-wrap items-end gap-3 px-5 py-3">
                <form action={updateGroupAction} className="flex flex-1 flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={group.id} />
                  <Field label="Name" htmlFor={`gname-${group.id}`} className="min-w-40 flex-1">
                    <Input id={`gname-${group.id}`} name="name" defaultValue={group.name} required />
                  </Field>
                  <Field
                    label="Description"
                    htmlFor={`gdesc-${group.id}`}
                    className="min-w-40 flex-[2]"
                  >
                    <Input
                      id={`gdesc-${group.id}`}
                      name="description"
                      defaultValue={group.description ?? ""}
                    />
                  </Field>
                  <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
                    Save
                  </SubmitButton>
                </form>
                <form action={deleteGroupAction}>
                  <input type="hidden" name="id" value={group.id} />
                  <SubmitButton
                    size="sm"
                    variant="ghost"
                    confirm={`Delete the "${group.name}" group? Its components stay, ungrouped.`}
                  >
                    <Trash2Icon className="size-3.5" />
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>

          <form action={createGroupAction} className="flex flex-wrap items-end gap-3 border-t px-5 py-4">
            <Field label="New group" htmlFor="new-group-name" className="min-w-40 flex-1">
              <Input id="new-group-name" name="name" placeholder="Core platform" required />
            </Field>
            <Field label="Description" htmlFor="new-group-desc" className="min-w-40 flex-[2]">
              <Textarea
                id="new-group-desc"
                name="description"
                rows={1}
                placeholder="Services every customer depends on"
                className="min-h-9"
              />
            </Field>
            <SubmitButton pendingLabel="Adding…">Add group</SubmitButton>
          </form>
        </Section>
      </div>
    </>
  );
}
