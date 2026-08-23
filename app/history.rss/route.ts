import { feedHeaders, rssFeed } from "@/lib/status/feed";

export async function GET() {
  return new Response(await rssFeed(), { headers: feedHeaders("application/rss+xml") });
}
