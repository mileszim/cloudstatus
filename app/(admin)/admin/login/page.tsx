import Link from "next/link";
import { ActivityIcon } from "lucide-react";

import { LoginForm } from "./login-form";
import { getSettings } from "@/lib/status/settings";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, settings] = await Promise.all([searchParams, getSettings()]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 font-semibold">
          <ActivityIcon className="text-operational size-4" />
          {settings.pageName}
        </Link>

        <div className="bg-card rounded-lg border px-6 py-6">
          <h1 className="text-lg font-semibold">Admin sign in</h1>
          <p className="text-muted-foreground mt-1 mb-5 text-sm">
            Manage components, incidents, and subscribers.
          </p>
          <LoginForm next={next ?? "/admin"} />
        </div>

        <p className="text-muted-foreground mt-4 text-center text-xs">
          <Link href="/" className="hover:text-foreground">
            ← Back to the status page
          </Link>
        </p>
      </div>
    </div>
  );
}
