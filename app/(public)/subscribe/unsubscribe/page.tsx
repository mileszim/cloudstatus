import Link from "next/link";

import { Button } from "@/components/ui/button";
import { unsubscribe } from "@/lib/status/mutations";

export const metadata = { title: "Unsubscribe" };

/**
 * A token in the URL unsubscribes on sight — one click from the email, no
 * confirmation screen, which is what List-Unsubscribe promises. Without a
 * token, the page just explains where to find the link.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-xl font-semibold">Unsubscribe</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Every notification we send includes a personal unsubscribe link at the bottom. Open the
          most recent one and follow that link — it removes you immediately, with no confirmation
          step.
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/">Back to the status page</Link>
        </Button>
      </div>
    );
  }

  const removed = await unsubscribe(token);

  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-xl font-semibold">
        {removed ? "You have been unsubscribed" : "That link is no longer valid"}
      </h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {removed
          ? "You will not receive further notifications. You can subscribe again at any time."
          : "You may already have unsubscribed. Either way, you are not on the list."}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button variant="outline" asChild>
          <Link href="/">Back to the status page</Link>
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/subscribe">Subscribe again</Link>
        </Button>
      </div>
    </div>
  );
}
