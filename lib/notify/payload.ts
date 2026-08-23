import type { AnyIncidentStatus, ComponentStatus, Impact } from "@/lib/status/types";

/**
 * The channel-neutral description of something worth telling subscribers about.
 * Stored as JSON in `notifications.payload` and rendered per channel at send
 * time, so a queued notification survives a deploy that changes the templates.
 */
export type NotificationPayload =
  | IncidentNotification
  | ComponentNotification
  | ConfirmNotification;

export interface IncidentNotification {
  kind: "incident_update";
  incidentId: string;
  title: string;
  status: AnyIncidentStatus;
  impact: Impact;
  isMaintenance: boolean;
  body: string;
  url: string;
  components: Array<{ id: string; name: string; status: ComponentStatus }>;
  /** Unix seconds the update was published. */
  at: number;
}

export interface ComponentNotification {
  kind: "component_status";
  componentId: string;
  name: string;
  from: ComponentStatus;
  to: ComponentStatus;
  url: string;
  at: number;
}

export interface ConfirmNotification {
  kind: "confirm";
  confirmUrl: string;
  pageName: string;
}

/** Component ids a payload concerns, for per-component subscriber filtering. */
export function payloadComponentIds(payload: NotificationPayload): string[] | null {
  switch (payload.kind) {
    case "incident_update":
      return payload.components.map((c) => c.id);
    case "component_status":
      return [payload.componentId];
    case "confirm":
      return null;
  }
}
