import { Select } from "@/components/admin/select";
import {
  COMPONENT_STATUSES,
  COMPONENT_STATUS_LABEL,
  type ComponentRow,
  type ComponentStatus,
} from "@/lib/status/types";

/**
 * Per-component status pickers for the incident forms.
 *
 * Each row posts `component:<id>`. The sentinel value "unaffected" means
 * "leave this component alone", which is different from "operational" — the
 * latter would actively clear a status some other incident set.
 */
export function ComponentStatusPicker({
  components,
  current,
}: {
  components: ComponentRow[];
  /** Component id → status already recorded for this incident. */
  current?: Record<string, ComponentStatus>;
}) {
  if (components.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No components exist yet, so this incident cannot be linked to one.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-md border">
      {components.map((component) => (
        <li key={component.id} className="flex items-center gap-3 px-3 py-2">
          <span className="flex-1 truncate text-sm">{component.name}</span>
          <Select
            name={`component:${component.id}`}
            defaultValue={current?.[component.id] ?? "unaffected"}
            aria-label={`Status for ${component.name}`}
            className="h-8 w-52 text-xs"
          >
            <option value="unaffected">Unaffected</option>
            {COMPONENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {COMPONENT_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
        </li>
      ))}
    </ul>
  );
}
