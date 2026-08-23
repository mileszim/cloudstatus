import { publicJsonHeaders, statusPayload } from "@/lib/status/api-shapes";

export async function GET() {
  return Response.json(await statusPayload(), { headers: publicJsonHeaders() });
}
