/**
 * Cron entry point. Two schedules share one handler, distinguished by `cron`:
 *   "* * * * *"  minute tick  — probe due monitors, advance maintenance, retry notifications
 *   "17 3 * * *" nightly tick — roll checks into daily uptime buckets, prune old rows
 */
export async function runScheduled(cron: string, _env: Env): Promise<void> {
  console.log(`[cron] ${cron}`);
}
