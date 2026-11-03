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

## Discovery and content checks

Discovery reports inspect fetched robots directives, sitemap XML/URLs, and
llms Markdown. Editorial checks flag short explanations, repeated passages,
generic link labels, excluded observed link targets, duplicate full-text
companions, and claims requiring evidence. These are disclosed heuristics,
not semantic truth verification or predictions of search/AI rankings.
Repair guidance can include drafts from fetched page metadata; drafts retain
untrusted-data markers and require human review. Missing optional files are
Medium findings; a homepage Googlebot block is High and requires intent review.
Reference guidance: https://llmstxt.org/ and
https://developers.google.com/search/docs/appearance/ai-features .

## Production persistence details

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
