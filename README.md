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

Ollama editorial review uses the configured Academy endpoint and `qwen2.5:1.5b`
from the backend worker. Override `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, or set
`OLLAMA_ENABLED=false` to disable. An optional `OLLAMA_API_KEY` is sent only
from the backend as a gateway Bearer header. Each audit samples at most three
pages, four discovery files and four keywords; snippets and generated output
are bounded, and the request has a 90-second deadline with no automatic retries.
Only supplied source IDs and exact source quotes are accepted. Suggestions
remain untrusted editorial opinions, require review, and do not alter scores.
Failures preserve technical results. The model can still misunderstand content;
uncertain or conflicting classifications are disclosed. No tokens or account
credentials are sent in prompts. The single worker serializes this project's
jobs; other projects using the same Ollama host need their own coordination.

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
