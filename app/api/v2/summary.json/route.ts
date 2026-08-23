import { publicJsonHeaders, summaryResponse } from "@/lib/status/api-shapes";

export async function GET() {
  return Response.json(await summaryResponse(), { headers: publicJsonHeaders() });
}
