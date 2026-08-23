import Link from "next/link";
import { CheckCircle2Icon, XCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmSubscriber } from "@/lib/status/mutations";

export const metadata = { title: "Confirm subscription" };

/**
 * Confirmation is a GET because it arrives as a link in an email. The token is
 * single-use: confirming clears it, so a link leaked from a forwarded email
 * cannot be replayed to re-subscribe someone who has since opted out.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const confirmed = token ? await confirmSubscriber(token) : false;

  return (
    <div className="mx-auto max-w-md text-center">
      {confirmed ? (
        <>
          <CheckCircle2Icon className="text-operational mx-auto size-10" />
          <h1 className="mt-4 text-xl font-semibold">Subscription confirmed</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            You will receive an update whenever an incident is posted or a maintenance window is
            scheduled. Every message includes an unsubscribe link.
          </p>
        </>
      ) : (
        <>
          <XCircleIcon className="text-muted-foreground mx-auto size-10" />
          <h1 className="mt-4 text-xl font-semibold">That link is no longer valid</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Confirmation links work once. If you have already confirmed, you are subscribed and
            nothing more is needed.
          </p>
        </>
      )}

      <Button variant="outline" className="mt-6" asChild>
        <Link href="/">Back to the status page</Link>
      </Button>
    </div>
  );
}
