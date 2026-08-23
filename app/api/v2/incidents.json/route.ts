import { incidentsResponse, publicJsonHeaders } from "@/lib/status/api-shapes";

export async function GET() {
  return Response.json(await incidentsResponse("all"), { headers: publicJsonHeaders(30) });
}
