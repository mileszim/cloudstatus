import Link from "next/link";

import type { Settings } from "@/lib/status/settings";

export function SiteFooter({ settings }: { settings: Settings }) {
  return (
    <footer className="text-muted-foreground mx-auto mt-12 max-w-4xl px-4 pb-10 text-xs sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-5">
        <span>{settings.pageName}</span>
        <span className="bg-border h-3 w-px" />
        <Link href="/incidents" className="hover:text-foreground">
          Incident history
        </Link>
        <a href="/history.atom" className="hover:text-foreground">
          Atom
        </a>
        <a href="/history.rss" className="hover:text-foreground">
          RSS
        </a>
        <a href="/api/v2/summary.json" className="hover:text-foreground">
          API
        </a>
        {settings.supportUrl && (
          <a href={settings.supportUrl} className="hover:text-foreground" rel="noreferrer">
            Support
          </a>
        )}
        <span className="ml-auto">
          Times shown in <span className="font-mono">{settings.timezone}</span>
        </span>
      </div>
    </footer>
  );
}
