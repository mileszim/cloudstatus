import { STATUS_DOT } from "@/lib/status/ui";
import { COMPONENT_STATUS_LABEL, type ComponentStatus } from "@/lib/status/types";
import { cn } from "@/lib/utils";

/**
 * A status dot. Non-operational states get a slow pulse ring so the eye lands on
 * them first — colour alone is not enough to carry the signal.
 */
export function StatusDot({
  status,
  className,
  pulse = true,
}: {
  status: ComponentStatus;
  className?: string;
  pulse?: boolean;
}) {
  const active = status !== "operational";
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0", className)} title={COMPONENT_STATUS_LABEL[status]}>
      {active && pulse && (
        <span
          className={cn("absolute inset-0 animate-ping rounded-full opacity-60", STATUS_DOT[status])}
          aria-hidden
        />
      )}
      <span className={cn("relative size-full rounded-full", STATUS_DOT[status])} />
      <span className="sr-only">{COMPONENT_STATUS_LABEL[status]}</span>
    </span>
  );
}
