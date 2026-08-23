import { atomFeed, feedHeaders } from "@/lib/status/feed";

export async function GET() {
  return new Response(await atomFeed(), { headers: feedHeaders("application/atom+xml") });
}
