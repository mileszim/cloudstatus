import { incidentsResponse, publicJsonHeaders } from "@/lib/status/api-shapes";

export async function GET() {
  return Response.json(await incidentsResponse("unresolved"), { headers: publicJsonHeaders() });
}
