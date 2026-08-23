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
components. Delivery runs on Cloudflare Queues, off the request path, with
automatic retries and a dead-letter queue.

**Integrations** — inbound webhooks for PagerDuty, Datadog, and a signed generic
hook; an authenticated write API for your own automation; Atom and RSS feeds; SVG
status and uptime badges for READMEs; and a drop-in banner script for your
marketing site.

**Public API** — `/api/v2/*` mirrors Atlassian Statuspage's response shapes
field-for-field, so dashboards, Slack apps, and uptime aggregators that already
speak that format work against this page unmodified.

## Setup

### 1. Create the database and queues

```bash
npx wrangler d1 create cloudstatus
npx wrangler queues create cloudstatus-notifications
npx wrangler queues create cloudstatus-notifications-dlq
```

Put the returned `database_id` into [wrangler.jsonc](wrangler.jsonc), then apply
the schema:

```bash
npm run migrate:local
```

### 2. Set secrets

Generate an admin password verifier. Run it with no argument so the password
is typed rather than passed through the shell — a shell rewrites `$`, `!`, and
backticks inside double quotes, which silently hashes something other than the
password you will type at sign-in:

```bash
npm run hash-password
```

Create `.dev.vars` for local development:

```
ADMIN_PASSWORD_HASH=pbkdf2$210000$...
SESSION_SECRET=<random string>
INGEST_SECRET=<random string>
EMAIL_FROM=status@yourdomain.com
```

For production, set the same four with `npx wrangler secret put <NAME>`. When
prompted, paste **only** the `pbkdf2$…` value — not the whole
`ADMIN_PASSWORD_HASH=pbkdf2$…` line the generator prints for `.dev.vars`.

To confirm a password and a stored verifier agree, without deploying anything:

```bash
npm run hash-password -- --check
```

With no second argument it reads `ADMIN_PASSWORD_HASH` from `.dev.vars`; pass a
verifier to check one you have copied from somewhere else. If sign-in rejects a
password you are sure of, run this first — it distinguishes a wrong password
from a verifier that was damaged in transit.

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
worker/index.ts          fetch → vinext handler; scheduled → cron; queue → delivery
app/(public)/            status page, incident history, uptime, subscribe
app/(admin)/admin/       dashboard behind a signed session cookie
app/api/v2/*             Statuspage-compatible public JSON
app/api/v1/*             authenticated write API (Bearer key)
app/api/hooks/*          PagerDuty / Datadog / generic ingest
lib/status/mutations.ts  every write that changes what the page says
lib/monitor/             check runner, thresholds, rollups
lib/notify/              channel adapters, queue producer, delivery ledger
worker/queue.ts          queue consumer and dead-letter handler
```

vinext's default entry only exports `fetch`, so [worker/index.ts](worker/index.ts)
delegates to it and adds `scheduled()` and `queue()`. One Worker serves the page,
runs the crons, and consumes the notification queues.

Two schedules share the cron handler:

- `* * * * *` — run due monitor checks, advance maintenance windows, re-queue
  any notification whose queue message was lost
- `17 3 * * *` — fold raw checks into daily uptime buckets, prune history older
  than seven days

### Notification delivery

A write that notifies subscribers inserts one row per subscriber into
`notifications` and puts that row's id on the queue. The request returns there —
an operator posting an update during an outage waits on D1, not on a mail
provider.

The consumer acks or retries each message individually. Letting the handler
throw would retry the whole batch, so one unreachable webhook would resend nine
emails that already arrived. Retries back off 1m → 5m → 15m → 1h → 4h; after
five attempts the message lands on `cloudstatus-notifications-dlq`, whose
consumer marks the row `abandoned` with the reason, so the delivery log in the
dashboard shows what happened instead of leaving a row stuck on "failed".

The table is still the durable record and the idempotency guard: a unique index
on `(subscriber_id, dedupe_key)` means a replayed event inserts nothing and
therefore queues nothing. Payloads live in D1 rather than in the message body,
so a notification queued before a deploy is rendered by the code that delivers
it.

On the Workers Free plan Queues allows 10,000 operations per day and holds
messages for 24 hours. A delivered notification costs roughly three operations
(write, read, delete), so the free tier covers a few thousand notifications a
day — an incident fanning out to 500 subscribers is about 1,500 of them.

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

**Queues, not a polling loop.** Notification delivery is a real queue with a
dead-letter queue rather than a cron that scans a table. Queues is available on
the Workers Free plan, and it owns retry scheduling, backoff, and concurrency
limits — all things a hand-rolled loop gets subtly wrong. The cron still runs a
reconciliation sweep, but only for rows that were written and never queued at
all; it is a safety net, not the retry path.

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

Queues *do* run locally — miniflare produces and consumes them in-process, so
subscribing, delivery, retries, and the dead-letter hand-off all work under
`npm run dev` with no extra setup.

Email is simulated locally — `wrangler dev` writes each message to
`.wrangler/tmp/email/` and logs the paths. Set `"remote": true` on the
`send_email` binding in [wrangler.jsonc](wrangler.jsonc) to send real mail from
local development.
