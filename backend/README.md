# Client Portal — Backend

API and static server for the client portal: web design / SEO intake forms, a contact form, admin authentication, an admin dashboard (with submission/asset deletion), an optional AI project-analysis feature (with AI-drafted outreach emails once analysis completes), CSV export, optional brand-asset uploads via Supabase Storage (with admin-triggered orphaned-file cleanup), a health-check endpoint, and optional Sentry error tracking.

## Stack

- Node.js (Express 4) — API + static file server, same origin, no separate frontend build
- PostgreSQL (`pg`) — submissions, admin users, AI analyses
- JWT (`jsonwebtoken`) + `bcryptjs` — admin authentication
- Plain HTML/CSS/vanilla JS frontend, served from `frontend/` — no bundler, no framework
- Ollama (local, free) or Anthropic (opt-in, paid) — AI project analysis, see `ai/README.md`

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and adjust as needed (see comments in that file for what each one does and where to get it). Every value has a working local-dev default — you don't strictly need to change anything to get started.
3. Have a local Postgres instance running and reachable at `DATABASE_URL` (defaults to `postgresql://localhost:5432/client_portal_dev` — create that database if it doesn't exist yet). The app creates its own tables and seeds an admin user on first run — no manual migration step.
4. If you want AI analysis working locally, see `ai/README.md` (Ollama install + model pull). Everything else works fine without it — analysis just fails gracefully and can be retried later.
5. If you want brand-asset uploads working, set `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_BUCKET` in `.env` (see the comments there for where to get them and how to create the bucket). Optional — the upload UI on the web-design intake form and the "View" button in the admin dashboard just respond with a clear error until these are set; nothing else depends on them.
6. If you want error tracking, set `SENTRY_DSN` in `.env` (sign up at sentry.io, create a Node project, copy the DSN — see the comment in `.env.example`). Optional — everything works identically without it, errors just aren't reported anywhere external to this app's own logs. `GET /api/health` (unauthenticated) is separate from this and always available for an uptime monitor regardless.

## Running

```
npm start        # node server.js
npm run dev       # same, with --watch (auto-restart on file changes)
```

Serves on `PORT` from `.env` (default `8743`). Visit `http://localhost:<port>/` for the site, `/admin.html` for the dashboard (seeded admin credentials are in `.env` — `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

## Testing

```
npm test
```

Runs the full suite via Node's built-in test runner (`node --test`, zero extra test dependencies) — unit tests plus real integration tests against your local Postgres and a spawned instance of the actual server. Requires local Postgres to be running; does **not** require Ollama (the integration suite deliberately runs with an invalid AI provider so it's deterministic and fast, independent of whether Ollama happens to be installed).

## Project structure

```
instrument.js         Optional Sentry init — must load before every other
                      module (see server.js's first line); dormant unless
                      SENTRY_DSN is set
server.js            Entry point — Express app, security headers, static file
                      serving (with domain/GA templating), 404 handling,
                      GET /api/health for uptime monitors
config/               env.js (all env vars, one place), database.js (schema + migrations)
routes/                One file per resource: auth, intake, contact, admin
controllers/           Request handling for each route
models/                 Database access (Submission, User, Analysis) — all
                        queries parameterized, no raw string interpolation
middleware/            auth (JWT verification), rateLimit, asyncHandler
lib/                    Small shared utilities (e.g. email validation)
services/               Side effects: email notifications, AI analysis/email-draft
                        orchestration, Supabase Storage wrapper
ai/                     AI project analysis — see ai/README.md for the full picture
                        (provider abstraction, prompt, schema, sanitization)
frontend/               The entire static site — plain HTML/CSS/JS, no build step
test/                   node:test suite (unit + integration)
```

## Deployment (Railway)

The app deploys as-is — `npm start` is the start command, `PORT` is read from the environment. Required environment variables are documented in `.env.example`; set the real ones (database URL, JWT secret, admin credentials, site URL once you have a real domain) in Railway's dashboard, not in source.

AI analysis needs its own setup in production since Ollama can't run on Railway — see **"Why Ollama can't run on Railway"** and the production options in `ai/README.md` before expecting `/admin.html`'s "Analyze with AI" to work on the live site.
