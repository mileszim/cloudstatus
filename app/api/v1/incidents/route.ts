import { authenticateRequest, badRequest, unauthorized } from "@/lib/auth/api-key";
import { createIncident } from "@/lib/status/mutations";
import { getIncident } from "@/lib/status/queries";
import {
  COMPONENT_STATUSES,
  IMPACTS,
  INCIDENT_STATUSES,
  MAINTENANCE_STATUSES,
  type AnyIncidentStatus,
  type ComponentStatus,
  type Impact,
} from "@/lib/status/types";

interface CreateBody {
  title?: string;
  status?: string;
  body?: string;
  impact?: string;
  components?: Record<string, string>;
  is_maintenance?: boolean;
  scheduled_for?: number;
  scheduled_until?: number;
  notify?: boolean;
}

const ALL_STATUSES = [...INCIDENT_STATUSES, ...MAINTENANCE_STATUSES] as readonly string[];

/**
 * POST /api/v1/incidents
 * Body: { "title", "status", "body", "components": { "<component-id>": "major_outage" } }
 */
export async function POST(request: Request) {
  const key = await authenticateRequest(request);
  if (!key) return unauthorized();

  let payload: CreateBody;
  try {
    payload = (await request.json()) as CreateBody;
  } catch {
    return badRequest("Body must be JSON.");
  }

  if (!payload.title?.trim()) return badRequest('"title" is required.');
  if (!payload.body?.trim()) return badRequest('"body" is required — it becomes the first update.');

  const status = payload.status ?? "investigating";
  if (!ALL_STATUSES.includes(status)) {
    return badRequest(`"status" must be one of: ${ALL_STATUSES.join(", ")}.`);
  }

  const componentStatuses: Record<string, ComponentStatus> = {};
  for (const [id, value] of Object.entries(payload.components ?? {})) {
    if (!(COMPONENT_STATUSES as readonly string[]).includes(value)) {
      return badRequest(`Invalid status "${value}" for component "${id}".`);
    }
    componentStatuses[id] = value as ComponentStatus;
  }

  if (payload.impact && !(IMPACTS as readonly string[]).includes(payload.impact)) {
    return badRequest(`"impact" must be one of: ${IMPACTS.join(", ")}.`);
  }

  const id = await createIncident(
    {
      title: payload.title.trim(),
      status: status as AnyIncidentStatus,
      body: payload.body,
      componentStatuses,
      impact: payload.impact as Impact | undefined,
      isMaintenance: payload.is_maintenance ?? false,
      scheduledFor: payload.scheduled_for ?? null,
      scheduledUntil: payload.scheduled_until ?? null,
      notify: payload.notify ?? true,
      source: "api",
    },
    `api:${key.prefix}`,
  );

  const incident = await getIncident(id);
  return Response.json(
    { id, shortlink: incident?.shortlink, status: incident?.status },
    { status: 201 },
  );
}
