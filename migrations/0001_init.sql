-- Cloudstatus initial schema.
--
-- Conventions:
--   * ids are short opaque strings generated in application code (lib/db/id.ts)
--   * timestamps are INTEGER unix seconds, UTC, never local time
--   * booleans are INTEGER 0/1
--   * enum-ish columns carry CHECK constraints so bad writes fail loudly at the edge

-- ---------------------------------------------------------------------------
-- Page configuration
-- ---------------------------------------------------------------------------

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Components
-- ---------------------------------------------------------------------------

CREATE TABLE component_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  collapsed   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE components (
  id          TEXT PRIMARY KEY,
  group_id    TEXT REFERENCES component_groups(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'operational'
              CHECK (status IN ('operational', 'degraded_performance', 'partial_outage',
                                'major_outage', 'under_maintenance')),
  -- Status the component returns to when an incident clears. Lets a component sit in
  -- maintenance and still remember it was healthy underneath.
  base_status TEXT NOT NULL DEFAULT 'operational'
              CHECK (base_status IN ('operational', 'degraded_performance', 'partial_outage',
                                     'major_outage', 'under_maintenance')),
  position    INTEGER NOT NULL DEFAULT 0,
  -- Show the 90-day uptime bar for this component on the public page.
  showcase    INTEGER NOT NULL DEFAULT 1,
  -- Hide the component entirely while it is operational (Statuspage's
  -- "only show if degraded" — useful for long-tail internal services).
  only_show_if_degraded INTEGER NOT NULL DEFAULT 0,
  -- When the component entered its current status.
  status_since INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX idx_components_group ON components(group_id, position);

-- ---------------------------------------------------------------------------
-- Synthetic monitoring
-- ---------------------------------------------------------------------------

CREATE TABLE monitors (
  id           TEXT PRIMARY KEY,
  component_id TEXT REFERENCES components(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  method       TEXT NOT NULL DEFAULT 'GET'
               CHECK (method IN ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE')),
  url          TEXT NOT NULL,
  -- JSON object of request headers, or NULL.
  headers      TEXT,
  body         TEXT,
  -- Comma-separated list of acceptable statuses; entries may be exact ("204")
  -- or a class ("2xx"). Empty means "any 2xx or 3xx".
  expected_status TEXT NOT NULL DEFAULT '2xx',
  -- Case-insensitive substring the response body must contain, or NULL.
  body_match   TEXT,
  timeout_ms   INTEGER NOT NULL DEFAULT 10000,
  -- How often to probe. The minute cron picks up monitors whose interval has elapsed.
  interval_s   INTEGER NOT NULL DEFAULT 60,
  -- Latency above this marks the check degraded (not failed). NULL disables.
  degraded_ms  INTEGER,
  -- Consecutive results required before the component status flips. Prevents
  -- a single blip from paging everyone.
  failure_threshold  INTEGER NOT NULL DEFAULT 2,
  recovery_threshold INTEGER NOT NULL DEFAULT 2,
  -- Status to apply to the linked component when the failure threshold trips.
  failure_status TEXT NOT NULL DEFAULT 'major_outage'
                 CHECK (failure_status IN ('degraded_performance', 'partial_outage', 'major_outage')),
  enabled       INTEGER NOT NULL DEFAULT 1,
  -- Open (and later auto-resolve) an incident when the threshold trips.
  auto_incident INTEGER NOT NULL DEFAULT 1,
  -- Rolling counters maintained by the check runner.
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_ok         INTEGER,
  last_latency_ms INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_monitors_due ON monitors(enabled, last_checked_at);
CREATE INDEX idx_monitors_component ON monitors(component_id);

-- Raw probe results. Pruned to 7 days by the nightly cron; anything older lives
-- in uptime_daily.
CREATE TABLE checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id  TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at  INTEGER NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('up', 'degraded', 'down')),
  status_code INTEGER,
  latency_ms  INTEGER,
  error       TEXT
);

CREATE INDEX idx_checks_monitor_time ON checks(monitor_id, checked_at DESC);
CREATE INDEX idx_checks_time ON checks(checked_at);

-- One row per monitor per UTC day. Powers the 90-day bars and uptime percentages
-- without scanning raw checks.
CREATE TABLE uptime_daily (
  monitor_id     TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  day            TEXT NOT NULL,              -- 'YYYY-MM-DD', UTC
  up             INTEGER NOT NULL DEFAULT 0,
  degraded       INTEGER NOT NULL DEFAULT 0,
  down           INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms REAL,
  max_latency_ms INTEGER,
  -- Seconds the linked component spent in a non-operational status that day.
  downtime_s     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, day)
);

CREATE INDEX idx_uptime_daily_day ON uptime_daily(day);

-- ---------------------------------------------------------------------------
-- Incidents and scheduled maintenance
--
-- Maintenance windows are incidents with is_maintenance = 1. They share the
-- update timeline, component links, and subscriber plumbing; only the status
-- vocabulary and scheduling columns differ.
-- ---------------------------------------------------------------------------

CREATE TABLE incidents (
  id     TEXT PRIMARY KEY,
  title  TEXT NOT NULL,
  -- Incidents:   investigating | identified | monitoring | resolved
  -- Maintenance: scheduled | in_progress | verifying | completed
  status TEXT NOT NULL
         CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved',
                           'scheduled', 'in_progress', 'verifying', 'completed')),
  impact TEXT NOT NULL DEFAULT 'minor'
         CHECK (impact IN ('none', 'minor', 'major', 'critical', 'maintenance')),
  is_maintenance INTEGER NOT NULL DEFAULT 0,
  -- Maintenance window bounds (NULL for incidents).
  scheduled_for   INTEGER,
  scheduled_until INTEGER,
  -- Move the window to in_progress / completed automatically at its bounds.
  auto_transition INTEGER NOT NULL DEFAULT 1,
  -- Put affected components into under_maintenance for the duration.
  auto_component_status INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual'
         CHECK (source IN ('manual', 'monitor', 'webhook', 'api')),
  -- Set when a monitor opened this incident, so the same monitor can resolve it.
  source_monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
  -- Short URL slug, e.g. /i/abc123.
  shortlink   TEXT UNIQUE,
  started_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  postmortem_body         TEXT,
  postmortem_published_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_incidents_started ON incidents(started_at DESC);
CREATE INDEX idx_incidents_open ON incidents(resolved_at, started_at DESC);
CREATE INDEX idx_incidents_maintenance ON incidents(is_maintenance, scheduled_for);
CREATE INDEX idx_incidents_source_monitor ON incidents(source_monitor_id, resolved_at);

CREATE TABLE incident_updates (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  body        TEXT NOT NULL,          -- markdown
  -- Lets an operator post-date or pre-date an update (Statuspage's display_at).
  display_at  INTEGER NOT NULL,
  -- Whether this update fanned out to subscribers.
  notify      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_incident_updates_incident ON incident_updates(incident_id, display_at DESC);

CREATE TABLE incident_components (
  incident_id   TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  component_id  TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  -- Status the component held before the incident, so it can be restored.
  status_before TEXT NOT NULL,
  status_during TEXT NOT NULL,
  PRIMARY KEY (incident_id, component_id)
);

CREATE INDEX idx_incident_components_component ON incident_components(component_id);

-- ---------------------------------------------------------------------------
-- Subscribers and notification delivery
-- ---------------------------------------------------------------------------

CREATE TABLE subscribers (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL CHECK (type IN ('email', 'slack', 'webhook')),
  -- Email address, Slack incoming-webhook URL, or target URL.
  endpoint TEXT NOT NULL,
  -- HMAC signing secret for webhook subscribers.
  secret   TEXT,
  state    TEXT NOT NULL DEFAULT 'pending'
           CHECK (state IN ('pending', 'active', 'unsubscribed', 'bounced')),
  -- JSON array of component ids, or NULL for "everything".
  component_ids TEXT,
  confirm_token TEXT,
  unsub_token   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  confirmed_at  INTEGER,
  last_sent_at  INTEGER
);

CREATE UNIQUE INDEX idx_subscribers_endpoint ON subscribers(type, endpoint);
CREATE INDEX idx_subscribers_state ON subscribers(state);
CREATE UNIQUE INDEX idx_subscribers_unsub ON subscribers(unsub_token);

-- Delivery ledger. Rows are inserted synchronously with the event that caused
-- them, then drained by waitUntil and retried by the minute cron. Doubles as
-- an idempotency guard: (subscriber_id, dedupe_key) is unique.
CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  -- 'incident_update:<id>', 'confirm:<token>', 'maintenance_reminder:<id>', ...
  dedupe_key    TEXT NOT NULL,
  kind          TEXT NOT NULL,
  -- JSON payload rendered per channel at send time.
  payload       TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending', 'sent', 'failed', 'abandoned')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  -- Earliest time the next attempt may run (exponential backoff).
  next_attempt_at INTEGER NOT NULL,
  last_error    TEXT,
  created_at    INTEGER NOT NULL,
  sent_at       INTEGER
);

CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(subscriber_id, dedupe_key);
CREATE INDEX idx_notifications_queue ON notifications(state, next_attempt_at);

-- ---------------------------------------------------------------------------
-- Automation surface
-- ---------------------------------------------------------------------------

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  -- SHA-256 of the full token. The plaintext is shown once at creation.
  hash         TEXT NOT NULL UNIQUE,
  -- First 8 characters, for identifying a key in the UI.
  prefix       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);

-- Maps an inbound webhook from a monitoring vendor onto a component action.
CREATE TABLE integration_rules (
  id       TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('generic', 'pagerduty', 'datadog')),
  -- Value matched against the provider's identifying field: PagerDuty service name,
  -- Datadog monitor tag, or the generic hook's `key`.
  match_key    TEXT NOT NULL,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  -- Status applied to the component when the alert fires.
  degrade_to   TEXT NOT NULL DEFAULT 'major_outage'
               CHECK (degrade_to IN ('degraded_performance', 'partial_outage', 'major_outage')),
  open_incident INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_integration_rules_match ON integration_rules(provider, match_key);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT NOT NULL,        -- 'admin', 'api:<key prefix>', 'monitor:<id>', 'cron'
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  meta        TEXT,                 -- JSON
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_audit_log_time ON audit_log(created_at DESC);
