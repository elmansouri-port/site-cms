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
