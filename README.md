# Cloudstatus

A self-hosted status page on Cloudflare Workers. Synthetic monitoring, incident
communication, scheduled maintenance, subscriber notifications, and a
Statuspage-compatible public API — all on D1, Cron Triggers, and the Email
Service binding, with no other infrastructure.

Built with [vinext](https://vinext.io) (Next.js App Router on Vite),
[shadcn/ui](https://ui.shadcn.com), and Tailwind CSS v4.

## What it does

**Public page** — overall status banner, components grouped into sections, a
90-day uptime bar per service, active incidents with their update timeline,
scheduled maintenance windows, and recent history.

**Monitoring** — HTTP checks against your endpoints on a schedule, with expected
status codes, keyword matching, timeouts, and a latency threshold that marks a
check degraded rather than failed. A monitor must fail *N* times in a row before
anything user-visible happens, and succeed *N* times before it clears, so single
blips stay invisible. When a threshold trips, the linked component changes status
and an incident opens automatically; when it recovers, the incident resolves
itself.

**Incidents** — the four-stage lifecycle (investigating → identified → monitoring
→ resolved), four impact levels, markdown updates, per-component status changes,
and postmortems. Resolving an incident restores every component it touched to the
status it held beforehand.

**Maintenance** — schedule a window; the cron moves it to in-progress and
completed at the times you set, degrading and restoring components as it goes.

**Subscribers** — email (double opt-in, one-click unsubscribe), Slack incoming
webhooks, and signed HTTP webhooks, each optionally filtered to specific
components. Delivery goes through a ledger in D1 that doubles as the retry queue
and the idempotency guard.

**Integrations** — inbound webhooks for PagerDuty, Datadog, and a signed generic
hook; an authenticated write API for your own automation; Atom and RSS feeds; SVG
status and uptime badges for READMEs; and a drop-in banner script for your
marketing site.

**Public API** — `/api/v2/*` mirrors Atlassian Statuspage's response shapes
field-for-field, so dashboards, Slack apps, and uptime aggregators that already
speak that format work against this page unmodified.

## Setup

### 1. Create the database

```bash
npx wrangler d1 create cloudstatus
```

Put the returned `database_id` into [wrangler.jsonc](wrangler.jsonc), then apply
the schema:

```bash
npm run migrate:local
```

### 2. Set secrets

Generate an admin password verifier:

```bash
npm run hash-password -- "your-admin-password"
```

Create `.dev.vars` for local development:

```
ADMIN_PASSWORD_HASH=pbkdf2$210000$...
SESSION_SECRET=<random string>
INGEST_SECRET=<random string>
EMAIL_FROM=status@yourdomain.com
```

For production, set the same four with `npx wrangler secret put <NAME>`.

| Secret | Purpose |
| --- | --- |
| `ADMIN_PASSWORD_HASH` | PBKDF2 verifier for the admin password |
| `SESSION_SECRET` | Signs admin session cookies. Rotating it signs everyone out |
| `INGEST_SECRET` | Verifies the generic ingest webhook's HMAC |
| `EMAIL_FROM` | Sender address, on a domain onboarded to Cloudflare Email Service |

#### Or keep them in seekrit

Set one secret instead of four and let [seekrit](https://seekrit.dev) hold the
rest:

```bash
npx wrangler secret put SEEKRIT_TOKEN     # skt_... service token
```

[lib/secrets.ts](lib/secrets.ts) resolves the table above through
`@seekrit/sdk` — the API returns ciphertext and the Worker decrypts it, so the
values are readable only by the token. Rotating one in seekrit reaches the
deployment within a minute, with no redeploy and no `wrangler secret put`.

Two things make that safe for a status page:

- **A Worker secret still wins.** Any name set with `wrangler secret put` is
  used as-is and seekrit is never consulted for it. That is the break-glass
  path, and it makes the migration reversible one name at a time.
- **Stale beats down.** Resolved values are cached per isolate for a minute; if
  a revalidation fails, the last good set keeps being served and the failure is
  logged. Only a cold isolate with nothing cached fails closed.

The public status page reads no secrets at all, so it is unaffected either way
— only `/admin`, the generic ingest webhook, and subscriber email resolve
anything.

### 3. Run it

```bash
npm run dev
```

The page is at `http://localhost:3000`, the dashboard at `/admin`.

To load demo data — components, monitors, 90 days of uptime history, a resolved
incident with a postmortem, an open incident, and an upcoming maintenance window:

```bash
npm run seed
```

### 4. Deploy

```bash
npm run migrate:remote
npm run deploy
```

Then open `/admin/settings` and set the public URL, page name, and time zone.

## How it fits together

```
worker/index.ts          fetch → vinext handler; scheduled → cron tasks
app/(public)/            status page, incident history, uptime, subscribe
app/(admin)/admin/       dashboard behind a signed session cookie
app/api/v2/*             Statuspage-compatible public JSON
app/api/v1/*             authenticated write API (Bearer key)
app/api/hooks/*          PagerDuty / Datadog / generic ingest
lib/status/mutations.ts  every write that changes what the page says
lib/monitor/             check runner, thresholds, rollups
lib/notify/              channel adapters and the delivery ledger
```

vinext's default entry only exports `fetch`, so [worker/index.ts](worker/index.ts)
delegates to it and adds `scheduled()`. One Worker serves the page and runs the
cron.

Two schedules share that handler:

- `* * * * *` — run due monitor checks, advance maintenance windows, retry
  failed notifications
- `17 3 * * *` — fold raw checks into daily uptime buckets, prune history older
  than seven days

All four ways of changing state — the admin UI, the write API, the ingest hooks,
and the check runner — go through
[lib/status/mutations.ts](lib/status/mutations.ts), so they apply identical rules
about component status, incident lifecycle, and who gets notified.

## Public API

Unauthenticated, CORS-enabled, briefly cached at the edge:

| Endpoint | Returns |
| --- | --- |
| `/api/v2/summary.json` | Everything: page, components, incidents, maintenance, status |
| `/api/v2/status.json` | Just the overall indicator and description |
| `/api/v2/components.json` | Components and groups |
| `/api/v2/incidents.json` | All incidents from the last year |
| `/api/v2/incidents/unresolved.json` | Currently open incidents |
| `/api/v2/scheduled-maintenances.json` | All maintenance windows |
| `/api/v2/scheduled-maintenances/upcoming.json` | Scheduled but not started |
| `/api/v2/scheduled-maintenances/active.json` | Currently running |
| `/history.atom`, `/history.rss` | Incident feeds |
| `/badge/overall.svg` | Overall status badge |
| `/badge/<component-id>.svg` | Per-component badge; `?metric=uptime&days=90` for a percentage |
| `/embed/status.js` | Banner script for your own site |

## Write API

Create a key under **Integrations** in the dashboard. Only its SHA-256 is stored,
so the plaintext is shown once.

```bash
curl -X POST https://status.example.com/api/v1/incidents \
  -H "Authorization: Bearer cs_..." \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Elevated API error rates",
    "status": "investigating",
    "body": "We are investigating elevated error rates.",
    "components": { "cmp_api": "major_outage" }
  }'
```

```bash
curl -X POST https://status.example.com/api/v1/incidents/<id>/updates \
  -H "Authorization: Bearer cs_..." \
  -H "Content-Type: application/json" \
  -d '{ "status": "resolved", "body": "Error rates are back to normal." }'
```

```bash
curl -X POST https://status.example.com/api/v1/components/<id>/status \
  -H "Authorization: Bearer cs_..." \
  -H "Content-Type: application/json" \
  -d '{ "status": "degraded_performance", "notify": true }'
```

## Ingest webhooks

Add a rule under **Integrations** mapping a provider's service or alert name to a
component. Alerts with no matching rule are acknowledged and ignored.

**PagerDuty** — add a v3 webhook subscription pointing at
`/api/hooks/pagerduty`. Triggered incidents degrade the mapped component and open
an incident; resolved ones clear it.

**Datadog** — add a webhook pointing at `/api/hooks/datadog` with this body:

```json
{
  "key": "$ALERT_TITLE",
  "state": "$ALERT_TRANSITION",
  "detail": "$EVENT_MSG",
  "id": "$ALERT_ID"
}
```

**Anything else** — POST to `/api/hooks/generic`, signed with `INGEST_SECRET`:

```bash
BODY='{"key":"checkout-api","state":"triggered","title":"Checkout is down"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$INGEST_SECRET" | awk '{print $NF}')
curl -X POST https://status.example.com/api/hooks/generic \
  -H "X-Cloudstatus-Signature: sha256=$SIG" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

The vendor hooks are unauthenticated: their signing secrets are issued
per-subscription in the vendor's own UI, and there is nowhere here to configure
them. That is safe because an alert has no effect without a matching rule you
created. If it still concerns you, put those two routes behind Cloudflare Access.

## Outbound webhooks

Webhook subscribers receive a POST on every update, signed over
`<timestamp>.<body>` so a captured payload cannot be replayed:

```
X-Cloudstatus-Signature: sha256=<hex>
X-Cloudstatus-Timestamp: <unix seconds>
X-Cloudstatus-Event: incident_update | component_status
```

## Notes on a few choices

**No Cloudflare Queues.** Queues would be the textbook fan-out for
notifications, but it needs a paid Workers plan. The `notifications` table serves
as both retry ledger and idempotency guard — a unique index on
`(subscriber_id, dedupe_key)` means a retry cannot double-send — which keeps the
whole thing deployable on the free tier. Swapping a Queue in later touches only
[lib/notify/dispatch.ts](lib/notify/dispatch.ts).

**No KV for API caching.** KV's minimum TTL is 60 seconds, too coarse for status
data. The public endpoints use `Cache-Control` and let Cloudflare's CDN cache
them for ten seconds instead, which is fresher and one less resource to
provision.

**The latency chart is hand-rolled SVG.** It renders on the server with no client
JavaScript, which matters on the one page people load while something is already
broken.

**Uptime percentages are floored, never rounded.** 99.996% prints as 99.99%.
Claiming a perfect record you did not have is the one rounding error a status
page cannot afford.

**Degraded checks count against uptime.** A row of amber ticks next to
"100.00% uptime" reads as a bug even when the arithmetic is defensible.

## Local development

```bash
npm run dev              # dev server on :3000
npm run seed             # load demo data
npm run migrate:local    # apply migrations locally
npm run typecheck
npm run build
npm run preview          # build, then serve with wrangler
```

Cron triggers do not fire under `npm run dev`. Use **Run checks now** in the
dashboard to exercise the monitoring path, or `npm run preview` and hit
`http://localhost:8787/__scheduled?cron=*+*+*+*+*`.

Email is simulated locally — `wrangler dev` writes each message to
`.wrangler/tmp/email/` and logs the paths. Set `"remote": true` on the
`send_email` binding in [wrangler.jsonc](wrangler.jsonc) to send real mail from
local development.
