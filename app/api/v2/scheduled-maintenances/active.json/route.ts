import { maintenancesResponse, publicJsonHeaders } from "@/lib/status/api-shapes";

export async function GET() {
  return Response.json(await maintenancesResponse("active"), { headers: publicJsonHeaders() });
}
