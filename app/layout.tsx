import type { Metadata } from "next";
import { cookies } from "next/headers";

import { Toaster } from "@/components/ui/sonner";
import { getSettings } from "@/lib/status/settings";
import { THEME_COOKIE, THEME_INIT_SCRIPT, isTheme } from "@/lib/theme";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: { default: settings.pageName, template: `%s · ${settings.pageName}` },
    description: settings.pageDescription,
    icons: { icon: "/favicon.svg" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [cookieStore, settings] = await Promise.all([cookies(), getSettings()]);
  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
  const theme = isTheme(cookieTheme) ? cookieTheme : settings.defaultTheme;

  return (
    // The server resolves an explicit light/dark choice; THEME_INIT_SCRIPT
    // resolves "system" before paint so there is no flash either way.
    <html lang="en" className={theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
