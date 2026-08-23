import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSettings } from "@/lib/status/settings";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();

  return (
    <div className="min-h-screen">
      <SiteHeader settings={settings} />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>
      <SiteFooter settings={settings} />
    </div>
  );
}
