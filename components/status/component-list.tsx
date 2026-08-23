import { StatusDot } from "@/components/status/status-dot";
import { UptimeBar } from "@/components/status/uptime-bar";
import {
  COMPONENT_STATUS_LABEL,
  type ComponentGroupWithComponents,
  type ComponentWithUptime,
} from "@/lib/status/types";
import { STATUS_TEXT } from "@/lib/status/ui";
import { cn } from "@/lib/utils";

function ComponentRow({ component }: { component: ComponentWithUptime }) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={component.status} />
            <span className="truncate text-sm font-medium">{component.name}</span>
          </div>
          {component.description && (
            <p className="text-muted-foreground mt-1 ml-[18px] text-xs">{component.description}</p>
          )}
        </div>
        <span className={cn("shrink-0 text-xs font-medium", STATUS_TEXT[component.status])}>
          {COMPONENT_STATUS_LABEL[component.status]}
        </span>
      </div>

      {component.showcase === 1 && (
        <UptimeBar days={component.uptime} uptimePct={component.uptimePct} className="mt-3" />
      )}
    </div>
  );
}

function GroupHeader({ group }: { group: ComponentGroupWithComponents }) {
  return (
    <div className="bg-muted/40 flex items-center justify-between gap-3 border-b px-5 py-2.5">
      <div className="flex items-center gap-2">
        <StatusDot status={group.status} pulse={false} />
        <span className="text-sm font-semibold">{group.name}</span>
      </div>
      <span className="text-muted-foreground text-xs">
        {group.components.length} {group.components.length === 1 ? "service" : "services"}
      </span>
    </div>
  );
}

export function ComponentList({
  groups,
  ungrouped,
}: {
  groups: ComponentGroupWithComponents[];
  ungrouped: ComponentWithUptime[];
}) {
  if (groups.length === 0 && ungrouped.length === 0) {
    return (
      <div className="bg-card text-muted-foreground rounded-lg border px-5 py-10 text-center text-sm">
        No components configured yet. Add them from the admin dashboard.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.id} className="bg-card overflow-hidden rounded-lg border">
          <GroupHeader group={group} />
          <div className="divide-y">
            {group.components.map((c) => (
              <ComponentRow key={c.id} component={c} />
            ))}
          </div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div className="bg-card divide-y overflow-hidden rounded-lg border">
          {ungrouped.map((c) => (
            <ComponentRow key={c.id} component={c} />
          ))}
        </div>
      )}
    </div>
  );
}
