import { advanceMaintenances, rollupAndPrune, runDueChecks } from "@/lib/monitor/runner";
import { drain } from "@/lib/notify/dispatch";

/**
 * Cron entry point. Two schedules share one handler, distinguished by `cron`:
 *
 *   "* * * * *"  minute  — probe due monitors, advance maintenance windows,
 *                          retry notifications that failed earlier
 *   "17 3 * * *" nightly — fold raw checks into daily uptime buckets and prune
 *
 * The nightly cron fires at :17 rather than on the hour to stay off the
 * thundering-herd minute that every other scheduled job picks.
 */
export async function runScheduled(cron: string, _env: Env): Promise<void> {
  if (cron === "17 3 * * *") {
    const { days, pruned } = await rollupAndPrune();
    console.log(`[cron] rollup: ${days} day buckets written, ${pruned} raw checks pruned`);
    return;
  }

  // Each task is independent: a failing probe must not stop notification
  // retries, and a broken notification must not stop the next probe cycle.
  const [checks, maintenance, notifications] = await Promise.allSettled([
    runDueChecks(),
    advanceMaintenances(),
    drain(),
  ]);

  if (checks.status === "fulfilled" && checks.value.checked > 0) {
    const { checked, up, degraded, down } = checks.value;
    console.log(`[cron] checked ${checked}: ${up} up, ${degraded} degraded, ${down} down`);
  } else if (checks.status === "rejected") {
    console.error("[cron] check run failed", checks.reason);
  }

  if (maintenance.status === "fulfilled" && maintenance.value > 0) {
    console.log(`[cron] advanced ${maintenance.value} maintenance windows`);
  } else if (maintenance.status === "rejected") {
    console.error("[cron] maintenance transitions failed", maintenance.reason);
  }

  if (notifications.status === "fulfilled" && notifications.value.sent > 0) {
    console.log(
      `[cron] notifications: ${notifications.value.sent} sent, ${notifications.value.failed} failed`,
    );
  } else if (notifications.status === "rejected") {
    console.error("[cron] notification drain failed", notifications.reason);
  }
}
