import Link from "next/link";
import { notFound } from "next/navigation";

import { SubscribeForm } from "./subscribe-form";
import { listComponents } from "@/lib/status/queries";
import { getSettings } from "@/lib/status/settings";

export const metadata = { title: "Subscribe" };

export default async function SubscribePage() {
  const [settings, components] = await Promise.all([getSettings(), listComponents()]);
  if (!settings.allowSubscriptions) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">Subscribe to updates</h1>
      <p className="text-muted-foreground mt-1 mb-6 text-sm">
        Get notified when {settings.pageName} posts an incident or schedules maintenance.
      </p>

      <div className="bg-card rounded-lg border px-5 py-5">
        <SubscribeForm components={components} />
      </div>

      <p className="text-muted-foreground mt-4 text-xs">
        Prefer a feed reader? Subscribe to the{" "}
        <a href="/history.atom" className="underline underline-offset-2">
          Atom
        </a>{" "}
        or{" "}
        <a href="/history.rss" className="underline underline-offset-2">
          RSS
        </a>{" "}
        feed instead — no address required. Already subscribed and want out?{" "}
        <Link href="/subscribe/unsubscribe" className="underline underline-offset-2">
          Unsubscribe
        </Link>
        .
      </p>
    </div>
  );
}
