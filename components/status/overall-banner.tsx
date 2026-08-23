import { CheckCircle2Icon, WrenchIcon, AlertTriangleIcon, XOctagonIcon } from "lucide-react";

import { PAGE_INDICATOR_LABEL, type PageIndicator } from "@/lib/status/types";
import { INDICATOR_ACCENT, INDICATOR_SURFACE, INDICATOR_TEXT } from "@/lib/status/ui";
import { relativeTime } from "@/lib/status/time";
import { cn } from "@/lib/utils";

const ICON: Record<PageIndicator, typeof CheckCircle2Icon> = {
  none: CheckCircle2Icon,
  maintenance: WrenchIcon,
  minor: AlertTriangleIcon,
  major: AlertTriangleIcon,
  critical: XOctagonIcon,
};

/**
 * The one thing a visitor came to read. Colour carries the signal but never
 * alone — the icon and the sentence say the same thing.
 */
export function OverallBanner({
  indicator,
  lastCheckedAt,
  detail,
}: {
  indicator: PageIndicator;
  lastCheckedAt: number | null;
  detail?: string;
}) {
  const Icon = ICON[indicator];

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border",
        INDICATOR_SURFACE[indicator],
      )}
      aria-live="polite"
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", INDICATOR_ACCENT[indicator])} aria-hidden />
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 pl-7">
        <div className="flex items-center gap-3">
          <Icon className={cn("size-6 shrink-0", INDICATOR_TEXT[indicator])} />
          <div>
            <h1 className="text-lg leading-tight font-semibold text-balance sm:text-xl">
              {PAGE_INDICATOR_LABEL[indicator]}
            </h1>
            {detail && <p className="text-muted-foreground mt-0.5 text-sm">{detail}</p>}
          </div>
        </div>
        {lastCheckedAt != null && (
          <p className="text-muted-foreground text-xs">
            Last checked {relativeTime(lastCheckedAt)}
          </p>
        )}
      </div>
    </section>
  );
}
