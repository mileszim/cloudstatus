import { authenticateRequest, badRequest, notFound, unauthorized } from "@/lib/auth/api-key";
import { addIncidentUpdate } from "@/lib/status/mutations";
import { getIncident } from "@/lib/status/queries";
import {
  COMPONENT_STATUSES,
  INCIDENT_STATUSES,
  MAINTENANCE_STATUSES,
  type AnyIncidentStatus,
  type ComponentStatus,
} from "@/lib/status/types";

const ALL_STATUSES = [...INCIDENT_STATUSES, ...MAINTENANCE_STATUSES] as readonly string[];

/**
 * POST /api/v1/incidents/:id/updates
 * Body: { "status": "resolved", "body": "…", "components": { … }, "notify": true }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateRequest(request);
  if (!key) return unauthorized();

  const { id } = await params;
  const incident = await getIncident(id);
  if (!incident) return notFound(`No incident with id "${id}".`);

  let payload: {
    status?: string;
    body?: string;
    components?: Record<string, string>;
    notify?: boolean;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return badRequest("Body must be JSON.");
  }

  if (!payload.body?.trim()) return badRequest('"body" is required.');

  const status = payload.status ?? incident.status;
  if (!ALL_STATUSES.includes(status)) {
    return badRequest(`"status" must be one of: ${ALL_STATUSES.join(", ")}.`);
  }

  const componentStatuses: Record<string, ComponentStatus> = {};
  for (const [componentId, value] of Object.entries(payload.components ?? {})) {
    if (!(COMPONENT_STATUSES as readonly string[]).includes(value)) {
      return badRequest(`Invalid status "${value}" for component "${componentId}".`);
    }
    componentStatuses[componentId] = value as ComponentStatus;
  }

  const updateId = await addIncidentUpdate(
    incident.id,
    {
      status: status as AnyIncidentStatus,
      body: payload.body,
      componentStatuses: Object.keys(componentStatuses).length > 0 ? componentStatuses : undefined,
      notify: payload.notify ?? true,
    },
    `api:${key.prefix}`,
  );

  return Response.json({ id: updateId, incident_id: incident.id, status }, { status: 201 });
}
