import Link from "next/link";
import {
  ActivityIcon,
  BellIcon,
  ExternalLinkIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  PlugIcon,
  RadarIcon,
  ServerIcon,
  SettingsIcon,
  SirenIcon,
} from "lucide-react";

import { logout } from "../login/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getSettings } from "@/lib/status/settings";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/admin/incidents", label: "Incidents", icon: SirenIcon },
  { href: "/admin/components", label: "Components", icon: ServerIcon },
  { href: "/admin/monitors", label: "Monitors", icon: RadarIcon },
  { href: "/admin/subscribers", label: "Subscribers", icon: BellIcon },
  { href: "/admin/integrations", label: "Integrations", icon: PlugIcon },
  { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/admin" className="flex items-center gap-2 font-semibold">
            <ActivityIcon className="text-operational size-4" />
            <span className="truncate">{settings.pageName}</span>
            <span className="text-muted-foreground text-xs font-normal">admin</span>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/" target="_blank">
                View page
                <ExternalLinkIcon className="size-3.5" />
              </Link>
            </Button>
            <ThemeToggle />
            <form action={logout}>
              <Button
                variant="ghost"
                size="icon"
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="text-muted-foreground hover:text-foreground"
              >
                <LogOutIcon className="size-4" />
              </Button>
            </form>
          </div>
        </div>

        <nav className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6">
          <ul className="flex min-w-max gap-1 pb-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-muted-foreground hover:text-foreground hover:bg-secondary flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors"
                >
                  <item.icon className="size-3.5" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
