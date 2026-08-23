import { maintenancesResponse, publicJsonHeaders } from "@/lib/status/api-shapes";

export async function GET() {
  return Response.json(await maintenancesResponse("all"), { headers: publicJsonHeaders(30) });
}
