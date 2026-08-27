# Operations

## Deploying

```bash
cp .env.example .env       # generate real secrets
docker compose up -d --build
docker compose exec api node apps/api/src/seed/seed.js
```

Before the first public deploy:

- [ ] `JWT_SECRET`, `PREVIEW_SECRET`, `REVALIDATE_SECRET` — 32 random bytes each
      (`openssl rand -hex 32`)
- [ ] `MONGO_ROOT_PASSWORD` changed
- [ ] `ADMIN_PASSWORD` changed, and changed again from inside the CMS after the
      first sign-in
- [ ] `SITE_URL` set to the public origin — canonical URLs, OG tags and the
      sitemap are built from it
- [ ] `SECURE_COOKIES=true` once TLS is in front of the gateway
- [ ] TLS terminated ahead of the gateway; it speaks plain HTTP on purpose

Nothing but the gateway publishes a port. MongoDB and Redis are reachable only
on the compose network.

## Health

| Endpoint | Answers |
|---|---|
| `GET /healthz` (gateway) | The gateway itself |
| `GET /api/v1/../healthz` | The API process |
| `GET /readyz` on the API | MongoDB, Redis and the current cache revision |

Every service has a Docker healthcheck, and `web` waits for `api` to be healthy
before it starts.

## Getting content back

Two different problems, two different answers.

**Somebody broke a page.** Use the CMS. Every page, article, menu, the header
and footer, and the settings carry a **History** tab: a list of restore points,
what changed at each, and a Restore button. A restore point is written by the
API before every edit, every delete, every conversion and every publish — not by
somebody remembering to make one — and an editor can save a named one before a
change they are unsure about.

Restoring is itself undoable: the state it replaces is snapshotted first, and
the interface offers the undo immediately.

A **deleted page** is recovered from **Pages → Trash**, which is those same
snapshots rather than a second copy that could disagree with them. It comes back
as a draft.

The last 40 automatic snapshots are kept per item. Named restore points are
never trimmed.

**The database is gone.** That is what the backups below are for.

## Backups

The database and the uploads volume are the state; everything else is rebuilt
from the repository.

```bash
make backup                      # mongodump to ./backups
docker run --rm -v rainbow-site-cms_uploads:/data \
  -v "$PWD/backups:/backup" alpine \
  tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

Restore:

```bash
docker compose exec -T mongo mongorestore --username … --archive --gzip < backups/rainbow-….gz
```

## Cache

Publishing invalidates everything automatically. To force it:

- **CMS → Dashboard → Clear cache**, or
- `POST /api/v1/cache/purge` as an editor, or
- `make purge` (flushes Redis outright)

If the site looks stale after a database change made outside the CMS, that is
the reason: the revision counter never moved. Run the purge.

## Logs

```bash
docker compose logs -f api        # structured JSON, one line per request
docker compose logs -f web
```

The API redacts `authorization`, `cookie` and anything password-shaped before
writing.

## Checking a deploy

```bash
npm run verify:live   -- https://your-host        # the site still ships the authored bytes
npm run verify:chrome -- https://your-host        # one header and one footer, in every language
npm run verify:assets -- https://your-host        # every image and link resolves
```

Two more write to the database, so they belong on staging:

```bash
ADMIN_PASSWORD=… npm run verify:editor -- https://staging --confirm
ADMIN_PASSWORD=… npm run verify:ui     -- https://staging --confirm
```

`verify:ui` drives a real browser through the flows an editor uses — creating a
landing page with no header or footer, adding a form block and submitting it as a
visitor, pointing a button at a page by reference, restoring from history,
recovering from the trash — and checks each result on the rendered site rather
than in the admin's own state. `npm run ui:shots` photographs every admin screen
in both themes, which is the fastest way to spot a visual regression.

## Common problems

**The site returns 503.** The frontend cannot reach the API. Check
`docker compose ps` and `docker compose logs api`. The message is deliberate:
serving a plain 503 with `retry-after` beats rendering a page with no content.

**A page shows old copy.** Something wrote to MongoDB without bumping the
revision. Clear the cache.

**A published article does not appear.** Check its status *and* its
`publishedAt`: a future date is treated as scheduled. Check that the language
is active in Settings.

**`npm run seed` says a page was skipped.** Someone edited it in the CMS and
the source template changed too. Decide which wins; `--force` takes the file.

**A form on the site posts into a 404 in development.** The gateway routes
`/api` and `/media` to the API; in development the Astro and Vite dev servers
proxy the same prefixes themselves (`apps/web/astro.config.mjs`,
`apps/cms/vite.config.js`). If you add a prefix the gateway owns, add it there
too or the two environments will disagree.

**A form is submitted and the visitor sees "we have your details — the
confirmation may take a few minutes".** That is a 502 with `stored: true`: the
lead is in MongoDB and the automation refused or timed out. Open Integrations,
run the endpoint's **Test**, and open the form under Forms and press **Check** —
the usual cause is a required field the form does not send, and the check names
it. Nothing is lost; the follow-up is not running.

**A form's automation reports `not-registered`.** The workflow behind that path
is not active on the automation platform. Nothing in the CMS can fix it, which is
why the verdict says so rather than reporting a bare 404. Submissions are still
stored.

**The visual editor's canvas is blank, or clicking a block does nothing.** The
editor talks to the canvas over `postMessage`, which requires them to be one
origin. Behind the gateway they are; in development the admin's dev server proxies
the site for exactly that reason. The preview endpoints return a *path* rather
than an absolute URL so the frame resolves against whichever origin is serving
the admin — if you change that to an absolute URL, the bridge goes silent and the
canvas looks broken while the page inside it renders fine.

**A build baked in the wrong config.** Configuration is read from
`process.env` at runtime, never from `import.meta.env`, and `**/.env` is in
`.dockerignore`. If you add a new setting, follow that pattern — otherwise Vite
freezes the build machine's value into the image.

## Rotating secrets

- **JWT_SECRET** — restart the API; every session is signed out.
- **PREVIEW_SECRET / REVALIDATE_SECRET** — must match between `api` and `web`;
  update both and restart them together.
- **A user's password** — change it in the CMS. Their other sessions end
  immediately (the token version is bumped).

## Scaling

`web` and `api` are stateless and can be replicated behind the gateway. Redis
and the uploads volume are shared state; MongoDB should be a replica set in
production. The uploads volume must be shared (or moved to object storage)
before running more than one `api` replica.
