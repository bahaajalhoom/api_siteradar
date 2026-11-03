# api_siteradar

Backend services for SiteRadar.

This repository contains the crawler, Chromium/Lighthouse/axe measurement
pipeline, ranking provider integration, SQLite persistence, authentication
helpers, and the durable worker queue. It is designed to run as a persistent
Node.js service at `https://api.siteradar.apps.taqat.academy`.

## Current contents

- `server/worker.ts` — queue consumer and audit lifecycle.
- `server/browser-audit.ts` — Chromium, Lighthouse, and axe.
- `server/safe-fetch.ts` and `server/browser-proxy.ts` — public HTTPS boundary.
- `server/checks.ts` — HTML observations and scoring.
- `server/rankings.ts` — optional SerpApi integration.
- `server/db.ts`, `auth.ts`, `secrets.ts` — local persistence and security helpers.

## Local setup

Requires Node.js 24.11+.

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run worker
```

`data/` contains the local SQLite database and encryption key. It must never be
committed or copied into a public repository.

## Production persistence

The API uses `DATA_DIR` for SQLite and the encryption key. In production, set
`DATA_DIR` to the path of a persistent volume (for example `/data`) and mount
that volume before deploying. A Git commit/redeploy is not a database backup;
without a persistent volume every container restart can lose users, sessions,
audits, projects, and encrypted integrations. Back up `siteradar.sqlite` and
`.secrets-key` together; the database cannot decrypt saved integrations without
the same key.

## Important separation status

The worker and measurement layer have been extracted first. The HTTP API
handlers and frontend authentication client still need to be migrated from the
Next.js repository to this service before production deployment.
