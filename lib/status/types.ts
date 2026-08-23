/**
 * Domain vocabulary for the status page.
 *
 * The component/incident/impact enums deliberately match Atlassian Statuspage's
 * so that `/api/v2/*` consumers — Slack apps, uptime aggregators, dashboards —
 * work against this page unmodified.
 */

export const COMPONENT_STATUSES = [
  "operational",
  "under_maintenance",
  "degraded_performance",
  "partial_outage",
  "major_outage",
] as const;

export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/**
 * Severity ordering. The page's overall status is the highest-ranked status held
 * by any visible component, so maintenance never masks a real outage but does
 * outrank "everything is fine".
 */
const COMPONENT_STATUS_RANK: Record<ComponentStatus, number> = {
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};

export function componentStatusRank(status: ComponentStatus): number {
  return COMPONENT_STATUS_RANK[status];
}

export function worstComponentStatus(statuses: ComponentStatus[]): ComponentStatus {
  return statuses.reduce<ComponentStatus>(
    (worst, s) => (componentStatusRank(s) > componentStatusRank(worst) ? s : worst),
    "operational",
  );
}

export const COMPONENT_STATUS_LABEL: Record<ComponentStatus, string> = {
  operational: "Operational",
  under_maintenance: "Under maintenance",
  degraded_performance: "Degraded performance",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
};

/** Overall page indicator, mirroring Statuspage's `status.indicator`. */
export const PAGE_INDICATORS = ["none", "maintenance", "minor", "major", "critical"] as const;
export type PageIndicator = (typeof PAGE_INDICATORS)[number];

export const PAGE_INDICATOR_LABEL: Record<PageIndicator, string> = {
  none: "All systems operational",
  maintenance: "Maintenance in progress",
  minor: "Partially degraded service",
  major: "Partial system outage",
  critical: "Major system outage",
};

/** Maps the worst component status onto the page-level indicator. */
export function indicatorForComponentStatus(status: ComponentStatus): PageIndicator {
  switch (status) {
    case "operational":
      return "none";
    case "under_maintenance":
      return "maintenance";
    case "degraded_performance":
      return "minor";
    case "partial_outage":
      return "major";
    case "major_outage":
      return "critical";
  }
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const INCIDENT_STATUSES = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const MAINTENANCE_STATUSES = [
  "scheduled",
  "in_progress",
  "verifying",
  "completed",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export type AnyIncidentStatus = IncidentStatus | MaintenanceStatus;

export const INCIDENT_STATUS_LABEL: Record<AnyIncidentStatus, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  verifying: "Verifying",
  completed: "Completed",
};

/** Terminal statuses — the incident no longer affects the page. */
export function isClosedStatus(status: AnyIncidentStatus): boolean {
  return status === "resolved" || status === "completed";
}

export const IMPACTS = ["none", "minor", "major", "critical", "maintenance"] as const;
export type Impact = (typeof IMPACTS)[number];

export const IMPACT_LABEL: Record<Impact, string> = {
  none: "None",
  minor: "Minor",
  major: "Major",
  critical: "Critical",
  maintenance: "Maintenance",
};

/** Impact implied by the worst component status an incident touches. */
export function impactForComponentStatus(status: ComponentStatus): Impact {
  switch (status) {
    case "operational":
      return "none";
    case "under_maintenance":
      return "maintenance";
    case "degraded_performance":
      return "minor";
    case "partial_outage":
      return "major";
    case "major_outage":
      return "critical";
  }
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export const CHECK_OUTCOMES = ["up", "degraded", "down"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

export const SUBSCRIBER_TYPES = ["email", "slack", "webhook"] as const;
export type SubscriberType = (typeof SUBSCRIBER_TYPES)[number];

export const SUBSCRIBER_STATES = ["pending", "active", "unsubscribed", "bounced"] as const;
export type SubscriberState = (typeof SUBSCRIBER_STATES)[number];

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface ComponentGroupRow {
  id: string;
  name: string;
  description: string | null;
  position: number;
  collapsed: number;
  created_at: number;
  updated_at: number;
}

export interface ComponentRow {
  id: string;
  group_id: string | null;
  name: string;
  description: string | null;
  status: ComponentStatus;
  base_status: ComponentStatus;
  position: number;
  showcase: number;
  only_show_if_degraded: number;
  status_since: number;
  created_at: number;
  updated_at: number;
}

export interface MonitorRow {
  id: string;
  component_id: string | null;
  name: string;
  method: HttpMethod;
  url: string;
  headers: string | null;
  body: string | null;
  expected_status: string;
  body_match: string | null;
  timeout_ms: number;
  interval_s: number;
  degraded_ms: number | null;
  failure_threshold: number;
  recovery_threshold: number;
  failure_status: Exclude<ComponentStatus, "operational" | "under_maintenance">;
  enabled: number;
  auto_incident: number;
  consecutive_failures: number;
  consecutive_successes: number;
  last_checked_at: number | null;
  last_ok: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface CheckRow {
  id: number;
  monitor_id: string;
  checked_at: number;
  outcome: CheckOutcome;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
}

export interface IncidentRow {
  id: string;
  title: string;
  status: AnyIncidentStatus;
  impact: Impact;
  is_maintenance: number;
  scheduled_for: number | null;
  scheduled_until: number | null;
  auto_transition: number;
  auto_component_status: number;
  source: "manual" | "monitor" | "webhook" | "api";
  source_monitor_id: string | null;
  shortlink: string | null;
  started_at: number;
  resolved_at: number | null;
  postmortem_body: string | null;
  postmortem_published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface IncidentUpdateRow {
  id: string;
  incident_id: string;
  status: AnyIncidentStatus;
  body: string;
  display_at: number;
  notify: number;
  created_at: number;
}

export interface IncidentComponentRow {
  incident_id: string;
  component_id: string;
  status_before: ComponentStatus;
  status_during: ComponentStatus;
}

export interface SubscriberRow {
  id: string;
  type: SubscriberType;
  endpoint: string;
  secret: string | null;
  state: SubscriberState;
  component_ids: string | null;
  confirm_token: string | null;
  unsub_token: string;
  created_at: number;
  confirmed_at: number | null;
  last_sent_at: number | null;
}

export interface NotificationRow {
  id: string;
  subscriber_id: string;
  dedupe_key: string;
  kind: string;
  payload: string;
  state: "pending" | "sent" | "failed" | "abandoned";
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  created_at: number;
  sent_at: number | null;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  hash: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface IntegrationRuleRow {
  id: string;
  provider: "generic" | "pagerduty" | "datadog";
  match_key: string;
  component_id: string;
  degrade_to: Exclude<ComponentStatus, "operational" | "under_maintenance">;
  open_incident: number;
  enabled: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Composed view models
// ---------------------------------------------------------------------------

/** A component plus the uptime series the public page renders next to it. */
export interface ComponentWithUptime extends ComponentRow {
  uptime: DailyUptime[];
  uptimePct: number | null;
}

export interface DailyUptime {
  /** 'YYYY-MM-DD', UTC. */
  day: string;
  outcome: CheckOutcome | "no_data";
  /** 0–100, or null when no checks ran that day. */
  uptimePct: number | null;
  avgLatencyMs: number | null;
  total: number;
}

export interface ComponentGroupWithComponents extends ComponentGroupRow {
  components: ComponentWithUptime[];
  status: ComponentStatus;
}

export interface IncidentWithUpdates extends IncidentRow {
  updates: IncidentUpdateRow[];
  components: Array<{ id: string; name: string; status_during: ComponentStatus }>;
}
