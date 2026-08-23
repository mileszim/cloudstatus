import { db, now } from "@/lib/db/client";
import { runCheck, type CheckResult } from "@/lib/monitor/check";
import {
  addIncidentUpdate,
  createIncident,
  setComponentStatus,
} from "@/lib/status/mutations";
import type { ComponentStatus, IncidentRow, MonitorRow } from "@/lib/status/types";

/**
 * The check runner.
 *
 * Called from the minute cron and from the admin "run checks now" button, so
 * the monitoring path is exercisable without waiting for a scheduled trigger.
 */

/** Cap per invocation to stay inside the Worker's subrequest budget. */
const MAX_MONITORS_PER_RUN = 40;

export async function dueMonitors(limit = MAX_MONITORS_PER_RUN): Promise<MonitorRow[]> {
  const ts = now();
  const { results } = await db()
    .prepare(
      `SELECT * FROM monitors
        WHERE enabled = 1
          AND (last_checked_at IS NULL OR last_checked_at + interval_s <= ?)
        ORDER BY COALESCE(last_checked_at, 0)
        LIMIT ?`,
    )
    .bind(ts, limit)
    .all<MonitorRow>();
  return results;
}

/**
 * Records a probe result and, when a threshold trips, flips the linked
 * component and opens or resolves the auto-incident.
 *
 * Thresholds are consecutive-count based: a monitor must fail
 * `failure_threshold` times in a row before anything user-visible happens, and
 * succeed `recovery_threshold` times before it clears. Single blips stay
 * invisible, which is the whole point of having a threshold.
 */
export async function applyResult(monitor: MonitorRow, result: CheckResult): Promise<void> {
  const ts = now();
  const ok = result.outcome !== "down";

  const consecutiveFailures = ok ? 0 : monitor.consecutive_failures + 1;
  const consecutiveSuccesses = ok ? monitor.consecutive_successes + 1 : 0;

  await db().batch([
    db()
      .prepare(
        `INSERT INTO checks (monitor_id, checked_at, outcome, status_code, latency_ms, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(monitor.id, ts, result.outcome, result.statusCode, result.latencyMs, result.error),
    db()
      .prepare(
        `UPDATE monitors
            SET consecutive_failures = ?, consecutive_successes = ?, last_checked_at = ?,
                last_ok = ?, last_latency_ms = ?, last_error = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        consecutiveFailures,
        consecutiveSuccesses,
        ts,
        ok ? 1 : 0,
        result.latencyMs,
        result.error,
        ts,
        monitor.id,
      ),
  ]);

  if (!monitor.component_id) return;

  const actor = `monitor:${monitor.id}`;
  const openIncident = await findAutoIncident(monitor.id);

  // Failing: trip only on the exact crossing, so a monitor that stays down does
  // not post an update every minute.
  if (!ok && consecutiveFailures === monitor.failure_threshold) {
    await setComponentStatus(monitor.component_id, monitor.failure_status, actor, {
      notify: false,
      updateBase: false,
    });

    if (monitor.auto_incident && !openIncident) {
      await createIncident(
        {
          title: `${monitor.name} is not responding`,
          status: "investigating",
          body:
            `Automated monitoring detected ${monitor.failure_threshold} consecutive failed checks ` +
            `for **${monitor.name}**.\n\n` +
            `Last error: \`${result.error ?? "unknown"}\`\n\n` +
            "We are investigating. This incident was opened automatically and will resolve " +
            "itself once checks recover.",
          componentStatuses: { [monitor.component_id]: monitor.failure_status },
          source: "monitor",
          sourceMonitorId: monitor.id,
        },
        actor,
      );
    }
    return;
  }

  // Recovering: same idea in reverse.
  if (ok && consecutiveSuccesses === monitor.recovery_threshold && monitor.last_ok === 0) {
    if (openIncident) {
      await addIncidentUpdate(
        openIncident.id,
        {
          status: "resolved",
          body:
            `Automated checks for **${monitor.name}** have succeeded ` +
            `${monitor.recovery_threshold} times in a row. Resolving.`,
        },
        actor,
      );
    } else {
      await setComponentStatus(monitor.component_id, "operational", actor, { notify: false });
    }
  }
}

/** The still-open incident this monitor opened, if any. */
async function findAutoIncident(monitorId: string): Promise<IncidentRow | null> {
  return db()
    .prepare(
      `SELECT * FROM incidents
        WHERE source_monitor_id = ? AND resolved_at IS NULL AND status != 'resolved'
        ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(monitorId)
    .first<IncidentRow>();
}

export interface RunSummary {
  checked: number;
  up: number;
  degraded: number;
  down: number;
}

export async function runDueChecks(limit?: number): Promise<RunSummary> {
  const monitors = await dueMonitors(limit);
  const summary: RunSummary = { checked: 0, up: 0, degraded: 0, down: 0 };
  if (monitors.length === 0) return summary;

  // Probes run concurrently; the D1 writes that follow are serialised per
  // monitor so two results for the same monitor cannot interleave.
  const results = await Promise.all(
    monitors.map(async (monitor) => ({ monitor, result: await runCheck(monitor) })),
  );

  for (const { monitor, result } of results) {
    summary.checked++;
    summary[result.outcome === "up" ? "up" : result.outcome]++;
    try {
      await applyResult(monitor, result);
    } catch (error) {
      console.error(`[monitor] failed to apply result for ${monitor.id}`, error);
    }
  }

  return summary;
}

/** Runs one monitor immediately, ignoring its interval. */
export async function runMonitorNow(monitorId: string): Promise<CheckResult | null> {
  const monitor = await db()
    .prepare("SELECT * FROM monitors WHERE id = ?")
    .bind(monitorId)
    .first<MonitorRow>();
  if (!monitor) return null;

  const result = await runCheck(monitor);
  await applyResult(monitor, result);
  return result;
}

// ---------------------------------------------------------------------------
// Scheduled maintenance transitions
// ---------------------------------------------------------------------------

/**
 * Moves maintenance windows through their lifecycle at the times the operator
 * set, so nobody has to be awake at 02:00 to click a button.
 */
export async function advanceMaintenances(): Promise<number> {
  const ts = now();
  let changed = 0;

  const { results: starting } = await db()
    .prepare(
      `SELECT * FROM incidents
        WHERE is_maintenance = 1 AND auto_transition = 1 AND status = 'scheduled'
          AND scheduled_for IS NOT NULL AND scheduled_for <= ?`,
    )
    .bind(ts)
    .all<IncidentRow>();

  for (const window of starting) {
    if (window.auto_component_status) {
      const components = await incidentComponents(window.id);
      for (const c of components) {
        await setComponentStatus(c.component_id, c.status_during, "cron", {
          notify: false,
          updateBase: false,
        });
      }
    }
    await addIncidentUpdate(
      window.id,
      { status: "in_progress", body: "Scheduled maintenance has started." },
      "cron",
      { skipComponentSync: true },
    );
    changed++;
  }

  const { results: finishing } = await db()
    .prepare(
      `SELECT * FROM incidents
        WHERE is_maintenance = 1 AND auto_transition = 1 AND status = 'in_progress'
          AND scheduled_until IS NOT NULL AND scheduled_until <= ?`,
    )
    .bind(ts)
    .all<IncidentRow>();

  for (const window of finishing) {
    await addIncidentUpdate(
      window.id,
      { status: "completed", body: "Scheduled maintenance is complete." },
      "cron",
    );
    changed++;
  }

  return changed;
}

async function incidentComponents(
  incidentId: string,
): Promise<Array<{ component_id: string; status_during: ComponentStatus }>> {
  const { results } = await db()
    .prepare("SELECT component_id, status_during FROM incident_components WHERE incident_id = ?")
    .bind(incidentId)
    .all<{ component_id: string; status_during: ComponentStatus }>();
  return results;
}

// ---------------------------------------------------------------------------
// Nightly maintenance of the check history
// ---------------------------------------------------------------------------

/** Days of raw check rows kept. Older days survive only as daily rollups. */
const RAW_RETENTION_DAYS = 7;

/**
 * Folds raw checks into `uptime_daily`, then prunes.
 *
 * Re-runnable: the upsert recomputes a day from scratch, so a missed night or a
 * manual re-run produces the same numbers rather than doubling them.
 */
export async function rollupAndPrune(): Promise<{ days: number; pruned: number }> {
  const ts = now();
  const cutoffDay = new Date((ts - RAW_RETENTION_DAYS * 86_400) * 1000).toISOString().slice(0, 10);

  const rollup = await db()
    .prepare(
      `INSERT INTO uptime_daily (monitor_id, day, up, degraded, down, avg_latency_ms, max_latency_ms, downtime_s)
       SELECT monitor_id,
              date(checked_at, 'unixepoch')                              AS day,
              SUM(CASE WHEN outcome = 'up'       THEN 1 ELSE 0 END),
              SUM(CASE WHEN outcome = 'degraded' THEN 1 ELSE 0 END),
              SUM(CASE WHEN outcome = 'down'     THEN 1 ELSE 0 END),
              AVG(latency_ms),
              MAX(latency_ms),
              0
         FROM checks
        WHERE date(checked_at, 'unixepoch') < date(?, 'unixepoch')
        GROUP BY monitor_id, day
       ON CONFLICT(monitor_id, day) DO UPDATE SET
              up             = excluded.up,
              degraded       = excluded.degraded,
              down           = excluded.down,
              avg_latency_ms = excluded.avg_latency_ms,
              max_latency_ms = excluded.max_latency_ms`,
    )
    .bind(ts)
    .run();

  const pruned = await db()
    .prepare("DELETE FROM checks WHERE date(checked_at, 'unixepoch') < ?")
    .bind(cutoffDay)
    .run();

  // Notifications that were delivered or given up on are not worth keeping
  // beyond a month; the audit log is the durable record.
  await db()
    .prepare(
      "DELETE FROM notifications WHERE state IN ('sent', 'abandoned') AND created_at < ?",
    )
    .bind(ts - 30 * 86_400)
    .run();

  return { days: rollup.meta.changes ?? 0, pruned: pruned.meta.changes ?? 0 };
}
