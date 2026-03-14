# Newsletter Reader

A focused reading app that turns your Gmail newsletters and subscribed RSS feeds into one calm, keyboard-friendly inbox.

## What it does

- Sign in with Google and read newsletter emails in an app UI instead of your mailbox.
- Subscribe to RSS sources and sync recent articles into the same reading flow.
- Track read progress and saved items across both newsletters and RSS.
- Generate a daily RSS recommendation set with deterministic ranking plus optional AI ranking via OpenRouter.
- Run retention jobs to keep storage bounded.

## Tech stack

- **Framework:** Next.js (App Router) + React
- **Auth:** NextAuth (Google OAuth)
- **Database/ORM:** PostgreSQL + Prisma
- **Integrations:** Gmail API, RSS feeds, OpenRouter (optional)

## Quick start

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Create `.env.local` and set at least the required values.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string for Prisma. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID for sign-in and Gmail access. |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret. |
| `CRON_SECRET` | Recommended | Shared secret for protected cron/maintenance routes. |
| `GMAIL_LOOKBACK_DAYS` | Optional | How many days of newsletter email history to fetch. |
| `RSS_LOOKBACK_DAYS` | Optional | How many days of RSS content to retain during sync. |
| `RSS_DAILY_TARGET_MIN` | Optional | Minimum recommended RSS items/day. |
| `RSS_DAILY_TARGET_DEFAULT` | Optional | Default recommended RSS items/day. |
| `RSS_DAILY_TARGET_MAX` | Optional | Maximum recommended RSS items/day. |
| `RETENTION_RSS_DAYS` | Optional | Age-based retention limit for RSS items. |
| `RETENTION_RSS_MAX_ITEMS_PER_SOURCE` | Optional | Per-source cap for RSS items. |
| `OPENROUTER_API_KEY` | Optional | Enables AI-based daily RSS ranking. |
| `OPENROUTER_MODEL` | Optional | Primary OpenRouter model for ranking. |
| `OPENROUTER_FALLBACK_MODELS` | Optional | Comma-separated fallback models. |
| `OPENROUTER_MAX_MODEL_ATTEMPTS` | Optional | Maximum models to try per ranking request. |
| `OPENROUTER_TIMEOUT_MS` | Optional | Timeout for ranking requests. |
| `OPENROUTER_MAX_TOKENS` | Optional | Max token budget for ranking responses. |
| `OPENROUTER_RANK_CACHE_TTL_MS` | Optional | In-memory ranking cache TTL. |
| `OPENROUTER_FAILURE_COOLDOWN_MS` | Optional | Cooldown after provider failure/rate limit. |
| `OPENROUTER_APP_NAME` | Optional | Sent to OpenRouter for attribution. |
| `OPENROUTER_SITE_URL` | Optional | Sent to OpenRouter for attribution. |

### 3) Initialize the database

```bash
npx prisma migrate deploy
# or, during local development
npx prisma migrate dev
```

### 4) Run the app

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## NPM scripts

- `npm run dev` — Start local dev server.
- `npm run build` — Build production bundle.
- `npm run start` — Run production server.
- `npm run lint` — Run ESLint.

## Cron and maintenance endpoints

These routes require `CRON_SECRET` via either:

- `Authorization: Bearer <CRON_SECRET>`
- `x-cron-secret: <CRON_SECRET>`

Endpoints:

- `GET /api/cron/rss-refresh-rank` — Sync active RSS sources and refresh each user’s daily recommendation snapshot.
- `GET|POST /api/maintenance/retention` — Execute retention cleanup.

## Project layout (high level)

- `app/` — Pages and API routes.
- `lib/` — Auth, Gmail/RSS ingestion, ranking, retention, and shared server logic.
- `prisma/` — Prisma schema and migrations.

## Notes

- AI ranking is optional; when unavailable/failing, the app falls back to deterministic ranking.
- RSS article full content is fetched on demand in the reader flow; synced RSS storage is intentionally lightweight.
