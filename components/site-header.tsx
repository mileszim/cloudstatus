import Link from "next/link";
import { ActivityIcon, RssIcon } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import type { Settings } from "@/lib/status/settings";

const NAV = [
  { href: "/", label: "Status" },
  { href: "/incidents", label: "History" },
  { href: "/uptime", label: "Uptime" },
];

export function SiteHeader({ settings }: { settings: Settings }) {
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <ActivityIcon className="text-operational size-4" />
          <span className="truncate">{settings.pageName}</span>
        </Link>

        <nav className="text-muted-foreground ml-auto hidden items-center gap-1 text-sm sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hover:text-foreground hover:bg-secondary rounded-md px-2.5 py-1.5 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:ml-0">
          <Button variant="ghost" size="icon" asChild className="text-muted-foreground hover:text-foreground">
            <a href="/history.atom" title="Atom feed" aria-label="Atom feed">
              <RssIcon className="size-4" />
            </a>
          </Button>
          <ThemeToggle />
          {settings.allowSubscriptions && (
            <Button size="sm" asChild className="ml-1">
              <Link href="/subscribe">Subscribe</Link>
            </Button>
          )}
        </div>
      </div>

      <nav className="text-muted-foreground flex items-center gap-1 border-t px-4 py-1.5 text-sm sm:hidden">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="hover:text-foreground rounded-md px-2 py-1"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
