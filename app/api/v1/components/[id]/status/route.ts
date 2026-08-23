import { authenticateRequest, badRequest, notFound, unauthorized } from "@/lib/auth/api-key";
import { getComponent } from "@/lib/status/queries";
import { setComponentStatus } from "@/lib/status/mutations";
import { COMPONENT_STATUSES, type ComponentStatus } from "@/lib/status/types";

/**
 * POST /api/v1/components/:id/status
 * Body: { "status": "major_outage", "notify": false }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateRequest(request);
  if (!key) return unauthorized();

  const { id } = await params;
  const component = await getComponent(id);
  if (!component) return notFound(`No component with id "${id}".`);

  let body: { status?: string; notify?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Body must be JSON.");
  }

  if (!body.status || !(COMPONENT_STATUSES as readonly string[]).includes(body.status)) {
    return badRequest(`"status" must be one of: ${COMPONENT_STATUSES.join(", ")}.`);
  }

  await setComponentStatus(id, body.status as ComponentStatus, `api:${key.prefix}`, {
    notify: body.notify,
  });

  const updated = await getComponent(id);
  return Response.json({ id, name: component.name, status: updated?.status });
}
