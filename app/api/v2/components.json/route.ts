import { componentsResponse, publicJsonHeaders } from "@/lib/status/api-shapes";

export async function GET() {
  return Response.json(await componentsResponse(), { headers: publicJsonHeaders() });
}
