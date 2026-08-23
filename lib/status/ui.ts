import type { ComponentStatus, PageIndicator } from "@/lib/status/types";

/**
 * Class lookups for status colour. Written as literal strings rather than
 * interpolated names so Tailwind's scanner can see every class.
 */

export const STATUS_DOT: Record<ComponentStatus, string> = {
  operational: "bg-operational",
  under_maintenance: "bg-maintenance",
  degraded_performance: "bg-degraded",
  partial_outage: "bg-partial",
  major_outage: "bg-major",
};

export const STATUS_TEXT: Record<ComponentStatus, string> = {
  operational: "text-operational",
  under_maintenance: "text-maintenance",
  degraded_performance: "text-degraded",
  partial_outage: "text-partial",
  major_outage: "text-major",
};

export const STATUS_CHIP: Record<ComponentStatus, string> = {
  operational: "bg-operational-soft text-operational",
  under_maintenance: "bg-maintenance-soft text-maintenance",
  degraded_performance: "bg-degraded-soft text-degraded",
  partial_outage: "bg-partial-soft text-partial",
  major_outage: "bg-major-soft text-major",
};

export const INDICATOR_ACCENT: Record<PageIndicator, string> = {
  none: "bg-operational",
  maintenance: "bg-maintenance",
  minor: "bg-degraded",
  major: "bg-partial",
  critical: "bg-major",
};

export const INDICATOR_TEXT: Record<PageIndicator, string> = {
  none: "text-operational",
  maintenance: "text-maintenance",
  minor: "text-degraded",
  major: "text-partial",
  critical: "text-major",
};

export const INDICATOR_SURFACE: Record<PageIndicator, string> = {
  none: "bg-operational-soft/60",
  maintenance: "bg-maintenance-soft/60",
  minor: "bg-degraded-soft/60",
  major: "bg-partial-soft/60",
  critical: "bg-major-soft/60",
};

/** Uptime bar tick colour, keyed by the day's worst outcome. */
export const UPTIME_TICK: Record<"up" | "degraded" | "down" | "no_data", string> = {
  up: "bg-operational",
  degraded: "bg-degraded",
  down: "bg-major",
  no_data: "bg-unknown",
};
