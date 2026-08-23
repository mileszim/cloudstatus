import { STATUS_CHIP } from "@/lib/status/ui";
import {
  COMPONENT_STATUS_LABEL,
  INCIDENT_STATUS_LABEL,
  type AnyIncidentStatus,
  type ComponentStatus,
} from "@/lib/status/types";
import { cn } from "@/lib/utils";

export function StatusChip({
  status,
  className,
}: {
  status: ComponentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_CHIP[status],
        className,
      )}
    >
      {COMPONENT_STATUS_LABEL[status]}
    </span>
  );
}

const INCIDENT_CHIP: Record<AnyIncidentStatus, string> = {
  investigating: "bg-major-soft text-major",
  identified: "bg-partial-soft text-partial",
  monitoring: "bg-degraded-soft text-degraded",
  resolved: "bg-operational-soft text-operational",
  scheduled: "bg-maintenance-soft text-maintenance",
  in_progress: "bg-maintenance-soft text-maintenance",
  verifying: "bg-degraded-soft text-degraded",
  completed: "bg-operational-soft text-operational",
};

export function IncidentStatusChip({
  status,
  className,
}: {
  status: AnyIncidentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        INCIDENT_CHIP[status],
        className,
      )}
    >
      {INCIDENT_STATUS_LABEL[status]}
    </span>
  );
}
