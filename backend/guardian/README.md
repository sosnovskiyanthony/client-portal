# BrindLeaf Guardian

Guardian is BrindLeaf's security, reliability, and AI safety control plane: deterministic CI checks (tests, coverage, lint, dependency audit, secret scanning, CodeQL) as the mandatory gate, production health/smoke monitoring, an Ollama-based AI code reviewer as an advisory layer, and — the newest layer — a real AI kill switch, capability firewall, and circuit breaker sitting between the AI and the rest of the application.

**Core principle: the AI is an untrusted component.** It may hallucinate, be prompt-injected, receive malicious input, produce malformed output, or request an operation it has no business requesting. Guardian assumes all of that is possible and never lets the AI possess authority merely because it asked for something — every consequential decision is made by deterministic application code, not by the model.

Guardian does not prove BrindLeaf is bug-free or perfectly secure. It reduces risk, and says so honestly rather than claiming more than it can.

---

## Emergency runbook: "I think the AI is behaving dangerously — what do I do right now?"

You do not need to read any code to do this. Pick whichever is fastest for your situation:

1. **Fastest, works even if the website is down, no redeploy needed:** from any machine with the production database connection string,
   ```bash
   node guardian/setAiState.js lockdown --reason "Emergency: <what you saw>"
   ```
   (Using Railway's CLI: `railway run node guardian/setAiState.js lockdown --reason "..."`.) This takes effect on the very next AI request the live server handles — there is no cache to wait out.

2. **If you have the Security Center open:** go to the AI Control Center and click **"Lockdown All AI"**. One click, immediate.

3. **If neither of the above is reachable** (e.g. the database itself is also having problems): set the Railway environment variable `BRINDLEAF_AI_ENABLED=false` and redeploy/restart. This is a hard floor — it overrides the database state unconditionally, but it needs a restart to take effect, so it's the slowest of the three.

4. **It might already be locked down for you:** Guardian's circuit breaker automatically locks AI down if it detects a burst of schema-validation failures or capability violations — check the Security Center's System Status grid or run `node guardian/setAiState.js status` to see the current state and why.

**What "lockdown" actually does:** every one of the 10 real AI operations in `ai/aiService.js` — analysis, chat, contract review/drafting, email drafting, the code reviewer, everything — starts rejecting immediately with a clear error, before any request ever reaches Ollama or Anthropic. No AI feature partially works. Nothing else in the app is affected: public pages, intake forms, submissions, admin login, and every non-AI admin feature keep working normally.

**Re-enabling afterward:** requires a deliberate action (the CLI's `enable` command or the dashboard's "Re-enable AI" button, which shows you why it was disabled first) — and if the lockdown was triggered by a CRITICAL security event (the circuit breaker, or a manual lockdown), you must acknowledge that event first. AI never re-enables itself.

---

## The AI trust hierarchy

```
HUMAN / EXTERNAL INFRASTRUCTURE
        |
GUARDIAN CONTROL PLANE   (guardian/aiControl.js)
        |
DETERMINISTIC POLICY     (guardian/aiCapabilities.js, circuitBreaker.js, rules.js)
        |
APPLICATION               (controllers/, services/)
        |
AI SERVICE                (ai/aiService.js)
        |
MODEL                     (Ollama / Anthropic)
```

The model is the least-trusted component in this stack. It never decides whether it's allowed to run, never grants itself a capability, and never approves anything on its own output alone.

## The three tiers

Guardian runs in three places, matched to what's actually available in each:

1. **CI-time** (`.github/workflows/ci.yml`, `codeql.yml`, `smoke.yml`, `.github/dependabot.yml`) — runs on every push/PR to GitHub-hosted runners. Tests/coverage/lint/audit/integrity-manifest are mandatory gates. CodeQL and Dependabot run separately. The AI review step is advisory and usually reports "unavailable" here — see [Why CI-based AI review is usually unavailable](#why-ci-based-ai-review-is-usually-unavailable).
2. **Local** (`npm run guardian:ai`, `npm run guardian:smoke`, `npm run guardian:ai-control`, `npm run guardian:integrity:*`) — the same checks, runnable on a developer machine before pushing.
3. **Production** (the Security Center, `GET/POST /api/admin/guardian/*` and `/api/admin/security/*`) — lightweight, JWT-protected deep diagnostics plus the AI control plane itself (kill switch, security events). This tier deliberately does **not** run tests, lint, or code review against the live Railway container — see [Why production Guardian is diagnostics-only](#why-production-guardian-is-diagnostics-only).

## What each check does

| Check | Where | What it does |
|---|---|---|
| Tests | CI + local (`npm test` / `npm run test:coverage`) | `node --test` via `scripts/run-tests.sh` (see [Running tests locally](#running-guardian-and-the-test-suite-locally) for why two files run in isolation). ~300 tests. A failure blocks CI. |
| Coverage | CI + local (`npm run test:coverage`) | Node's built-in `--experimental-test-coverage`, gated on `--test-coverage-lines/-functions/-branches` thresholds (see [Coverage thresholds](#coverage-thresholds)). |
| Lint | CI + local (`npm run lint`) | ESLint, flat config (`eslint.config.js`), `eslint:recommended` only. See [Lint policy](#lint-policy). |
| Dependency audit | CI + local (`npm audit --audit-level=high`) | Fails CI on a high/critical severity finding. Never auto-upgrades. |
| Integrity manifest | CI + local (`npm run guardian:integrity:check`) | SHA-256 tripwire on security-critical files. See [Production code integrity](#production-code-integrity). |
| Secret scanning | GitHub (built-in, free for this public repo) | Blocks a push containing a recognizable credential pattern. **Requires a one-time manual toggle in Settings → Security → Code security.** |
| Security scanning | GitHub (`codeql.yml`) | CodeQL's default JavaScript/TypeScript query pack, on push/PR + weekly. |
| AI code review | CI (advisory) + local (`npm run guardian:ai`) | Ollama reviews the diff against `guardian/rules.js`'s architecture rules and `guardian/aiCapabilities.js`'s capability map. Never blocks unless run with `--strict`. |
| Production diagnostics | Security Center ("Run Guardian Check") | DB/storage/Ollama/Resend/Tavily configured+reachable status, stored in `guardian_checks`. |
| Production smoke test | CI (`smoke.yml`, scheduled) + local (`npm run guardian:smoke`) | Read-only GET checks against the live public site. |
| **AI kill switch** | Always-on (`ai/aiService.js` + `guardian/aiControl.js`) | ENABLED/DISABLED/LOCKDOWN, checked before every real AI call. See [The AI kill switch](#the-ai-kill-switch). |
| **AI capability firewall** | Always-on (`guardian/aiCapabilities.js`, `ai/providers/ollamaProvider.js`) | Deterministic allowlist of what each AI operation can read/write/execute. See [Capability firewall](#capability-firewall). |
| **AI circuit breaker** | Always-on (`guardian/circuitBreaker.js`) | Automatic LOCKDOWN on a burst of schema failures or capability violations. See [Circuit breaker](#circuit-breaker). |
| **Security event log** | Always-on (`security_events` table) | Every AI state change, rejection, violation, and auth attempt. See [Security event log and audit trail](#security-event-log-and-audit-trail). |
| Frontend error monitoring | Always-on (`frontend/js/common.js`) | `window.onerror`/`unhandledrejection` → `POST /api/client-error` → the Sentry pipe. |
| Server error monitoring | Always-on (Sentry) | `instrument.js`'s `beforeSend` scrubs secret-shaped substrings — see [Sentry privacy](#sentry-privacy). |

## Running Guardian and the test suite locally

```bash
npm test                  # scripts/run-tests.sh — see below for why
npm run lint
npm run test:coverage
npm audit --audit-level=high
npm run guardian:integrity:check
npm run guardian:ai              # AI code review against origin/main...HEAD (needs local Ollama)
npm run guardian:ai -- --base <ref> --head <ref> --strict
npm run guardian:smoke           # production smoke test (SITE_URL env var to override)
npm run guardian:ai-control       # the CLI kill switch — see the emergency runbook above
```

`npm test`/`npm run test:coverage` run via `scripts/run-tests.sh`, not a bare `node --test`. Reason: `test/aiControl.test.js` and `test/aiControlRoutes.test.js` deliberately write real ENABLED/DISABLED/LOCKDOWN rows to the shared `ai_control_state` table to prove the real database-backed kill switch works (as opposed to `test/circuitBreaker.test.js`, which mocks that same boundary specifically to avoid this). Since `node --test` runs different test files concurrently by default against one shared local Postgres database, a real LOCKDOWN written by one file was observed, repeatedly, to make another concurrently-running file's real AI call fail for an unrelated reason. The script runs those two files alone, sequentially, first, then the rest of the suite together at normal speed — a couple of seconds slower than one unified invocation, nowhere near the ~5x cost a blanket `--test-concurrency=1` for the whole suite would add.

There is no single `npm run guardian` that bundles everything into one pass/warn/fail command — deliberately: CodeQL and GitHub's secret scanning have no clean local equivalent.

## How CI works

`ci.yml`: `npm ci` → lint → `test:coverage` → `npm audit --audit-level=high` → integrity manifest check, against a real Postgres service container. Any of these failing fails the workflow. A separate `ai-review` job (`continue-on-error: true`) runs `guardian:ai` and can never fail the workflow.

`codeql.yml` and `smoke.yml` are separate workflows on their own schedules.

## How to interpret failures

- **`ci.yml` failed on the deterministic job** — a real regression. Fix it; don't disable the check.
- **Integrity manifest check failed** — either real tampering (investigate before anything else) or you legitimately edited a protected file and forgot to run `npm run guardian:integrity:update` — see [Production code integrity](#production-code-integrity).
- **`ci.yml`'s `ai-review` job shows a red X** — an infrastructure problem in the job itself, never the AI review's own verdict (`guardian/reviewCli.js` always exits 0).
- **CodeQL flags something** — read the finding on the repo's Security tab; document a genuine false positive near the flagged line rather than suppressing it blindly.
- **`smoke.yml` failed** — the live site is down or returned unexpected content; GitHub's failure-email is the alert.
- **The Security Center's Guardian card shows WARNING** — an optional integration is unreachable/unconfigured; only FAILED means the database itself is down.
- **The Security Center shows AI: LOCKDOWN and you didn't do it** — the circuit breaker tripped automatically. Check Recent Security Events for the CRITICAL entry that explains why before acknowledging/re-enabling.

## Coverage thresholds

Real measured baseline as of the AI-safety-control-plane work: **~70% lines, ~69% branches, ~52% functions**. The configured gate is **65% lines, 65% branches, 42% functions** — a few points below, to catch a real regression without failing on ordinary non-regressive changes.

**To raise a threshold**: run `npm run test:coverage`, note the new real percentage, then raise the flag in `package.json` to a few points below it — never guess, never raise past what's actually covered.

## Lint policy

`eslint.config.js` uses `eslint:recommended` only, split across Node backend / browser-global frontend / test file groups (no bundler, no `type: module`). Two rules are deliberately scoped down, both documented inline: `preserve-caught-error` → `warn` (pre-existing intentional call sites), and `no-unused-vars` on `frontend/js/common.js` → local-only (that file exists to declare cross-`<script>`-tag globals).

## How the AI reviewer works

`guardian/collectDiff.js` builds a size-budgeted diff + matched tests. `ai/guardianPrompt.js` embeds `guardian/rules.js`'s rules AND `guardian/aiCapabilities.js`'s capability map, wrapped in the same delimiter-tag "data, never instructions" defense every other AI prompt in this app uses. `ai/aiService.js`'s `reviewCodeChange` runs through the exact same provider dispatch/validation infrastructure as every other AI operation.

### Why CI-based AI review is usually unavailable

Ollama is reachable from production only via Tailscale; a GitHub-hosted runner has no route into that network, so `guardian:ai` in CI will almost always report `unavailable` — expected, and `continue-on-error: true` means it never blocks.

### What the AI reviewer can and cannot guarantee

It can identify suspicious patterns, flag architecture-rule violations, and suggest missing tests. It cannot prove code is secure, replace CodeQL/tests/human review, or override a deterministic failure — its verdict only blocks anything when explicitly run with `--strict`.

### CI gating policy

- **Mandatory** (blocks): tests, coverage thresholds, ESLint errors, `npm audit --audit-level=high` findings, integrity manifest drift.
- **Advisory** (visible, never blocks): the AI reviewer without `--strict`, CodeQL findings, Dependabot updates, ESLint warnings.

---

# The AI safety control plane

## The AI kill switch

Three states, tracked in the `ai_control_state` table (append-only — every row is a transition, current state = the latest row):

- **ENABLED** — normal operation.
- **DISABLED** — every AI operation rejects immediately with a clear error. Used for routine "I want AI off for a while" situations.
- **LOCKDOWN** — same rejection behavior as DISABLED, but implies a security-relevant reason (manual or circuit-breaker-triggered) and requires acknowledging the triggering CRITICAL event before re-enabling.

`guardian/aiControl.js`'s `assertAiAllowed(operationName)` is called as the literal first line of all 10 real operations in `ai/aiService.js` (`analyzeSubmission`, `analyzeServicesSubmission`, `analyzeRawText`, `chatReply`, `chatReplyWithResearch`, `updateAnalysisFromConversation`, `draftEmail`, `reviewContract`, `generateContract`, `reviewCodeChange`) — not a controller-level check, because a controller-level check could be forgotten by a future call site. `ai/aiService.js` itself is the chokepoint. When not ENABLED, it throws before any provider request is built — Ollama/Anthropic never see the request.

**Fail closed, by design and by test** (`test/aiControl.test.js`'s "fails closed when the control database is unreachable" test proves this directly): if the state can't be determined — a DB query throws, an unexpected row shape — `getAiState()` returns DISABLED, never ENABLED. There is deliberately no caching layer: every check queries fresh, since this app's AI calls are already multi-second operations where one more ~5-50ms query is negligible, and a cache would risk serving a stale "enabled" value past a real lockdown.

### The three ways to change it, and the one way you can't

| Method | Needs the website? | Needs a redeploy? | Speed |
|---|---|---|---|
| `node guardian/setAiState.js <enable\|disable\|lockdown>` | No | No | Fastest — next AI call sees it |
| Security Center | Yes | No | Fast |
| `BRINDLEAF_AI_ENABLED=false` env var | No | Yes (restart needed — `config/env.js` reads `process.env` once at boot) | Slowest, but a hard floor no DB state can override |
| The AI itself | **Never.** No code path lets an AI response set, modify, or bypass any of the above. | — | — |

## Capability firewall

`guardian/aiCapabilities.js` is a declarative map — `{ read, write, execute, modifyCode, modifyInfrastructure }` per operation. As of this writing, every single operation has `execute`/`modifyCode`/`modifyInfrastructure` = `false`. This reflects reality, not aspiration: direct code inspection confirms there is no `fs`/`child_process`/`exec`/`spawn` anywhere near the AI code path in this app. The only "tool" any AI operation can invoke is `web_search` (`ai/researchTool.js`, a read-only Tavily HTTP call), gated by `ai/providers/ollamaProvider.js`'s `ALLOWED_TOOL_NAMES` allowlist.

**What changed with this work isn't revoking a real privilege — it's making the already-safe default observable.** Before, if a model hallucinated a tool call outside `web_search` (e.g. requesting `execute_shell_command`), the tool loop silently no-op'd: safe, but invisible — no log, no event, nothing for a human or the circuit breaker to see. Now, an unrecognized tool name is explicitly detected, logged as an `ai_capability_violation` security event (HIGH severity, counted by the circuit breaker), and the model receives a plain "that tool is not available" message so the conversation continues safely instead of hanging.

**The map is deterministic and consumed, never asked.** The application never queries the AI about whether an operation should be allowed — `aiCapabilities.js` and the actual code are the only authorities. The map is also embedded in the AI reviewer's own system prompt, so a future PR that would set any of these flags to `true`, or add a new AI operation without a corresponding entry, gets flagged by the reviewer itself.

## Human approval policy

BrindLeaf has no code today that autonomously executes a consequential operation (deploying, modifying production code/infrastructure/credentials, deleting data) — and this work didn't add one, per the explicit instruction it was built against. What it does add is the *policy boundary* so a future feature can't accidentally cross it without noticing:

- **Safe, can stay automatic**: analyzing a lead, drafting an email, suggesting features, reviewing code, reviewing a contract, producing a proposed change.
- **Consequential, always needs a separate, explicit human-triggered action**: modifying production code, changing production data, deleting information, changing infrastructure/credentials/security policy, deploying, changing Guardian's own configuration, modifying AI permissions.
- An AI response is **never** treated as authorization for anything in the second category — see `guardian/rules.js`'s `ai-no-self-authorization` and `consequential-ops-need-human-approval` rules, both embedded in the AI reviewer's prompt so it watches for violations in future PRs too.

## Security event log and audit trail

One table, `security_events`, deliberately serves both the security-incident log and the routine AI-operation audit trail — they're the same underlying concept (an event, at a severity) rather than two near-duplicate tables. Severities:

- **INFO** — routine (a successful AI state change to ENABLED, a rejected call while merely DISABLED, an admin login success).
- **WARNING** — worth noticing but not alarming (a login failure, a schema-validation failure, a rejected call while LOCKDOWN).
- **HIGH** — a capability violation (the model asked for something outside its allowlist).
- **CRITICAL** — an automatic circuit-breaker lockdown, or a manual lockdown. Triggers an email alert (see below) and blocks re-enabling until acknowledged.

Write sites: `controllers/authController.js` (login success/failure — fire-and-forget, never adds timing variance to the fixed-cost bcrypt comparison that already protects against email enumeration), `guardian/aiControl.js` (every state change and every rejected call), `ai/providers/ollamaProvider.js` (capability violations), `ai/aiService.js` (schema-validation failures at all 8 relevant call sites), `server.js` (an optional boot-time integrity-check failure).

**Never logged**: full prompts/responses, API keys, JWTs, passwords, cookies, signed URLs, database credentials, raw Authorization headers. Metadata is small, structured, identifier-based fields only.

## Circuit breaker

Deterministic, not AI-judged — `guardian/circuitBreaker.js` never asks a model whether another model is behaving dangerously; it's a plain count-over-a-time-window SQL query compared to a fixed threshold. After a schema-validation-failure or capability-violation event is logged, it checks the last 15 minutes:

- **5 `ai_schema_validation_failed` events** → LOCKDOWN.
- **3 `ai_capability_violation` events** → LOCKDOWN (lower threshold — a capability violation is a more serious signal than a malformed response).

State is derived from a real database query (not an in-memory counter), so it survives a Railway restart. **Ordinary Ollama downtime never trips this** — provider-connectivity error codes (`ollama_unavailable`, `timeout`, `model_unavailable`, `network_error`, `research_unavailable`) are a completely different code path from schema failures/capability violations and are never counted; Ollama running on the owner's local machine is understood to be intermittently offline by design.

**Disabled entirely when `NODE_ENV=test`** (see `scripts/run-tests.sh`) — the existing test suite deliberately triggers `invalid_schema` errors many times across many files to prove the app rejects them correctly, which is expected test behavior, not a real attack pattern, and must never cascade into a real lockdown that breaks unrelated tests. The real trip logic still has its own direct test coverage (`test/circuitBreaker.test.js`, which mocks the DB boundary and explicitly overrides `NODE_ENV` for the duration of each test).

**AI can never reset it.** Only `guardian/setAiState.js` or the Security Center (both human-driven) can move out of LOCKDOWN, and only after the triggering CRITICAL event is acknowledged.

## Critical incidents and email alerting

A CRITICAL security event (circuit-breaker lockdown, or a manual one) does all of the following automatically: persists the event, sends an email alert (below), surfaces in the Security Center's Critical Events section, and blocks AI from being re-enabled until a human explicitly acknowledges that specific event via the "Acknowledge" button or `models/SecurityEvent.js`'s `acknowledge()`.

`services/email.js`'s `sendSecurityAlertEmail` reuses the existing Resend client/config (no new email provider) and is fire-and-forget, matching `notifyNewSubmission`'s style, not `sendContractEmail`'s throw-on-failure style — **a failed or unconfigured email never crashes the app, and the security event already exists in the database/dashboard regardless of whether the email sends.** The email states: severity, event type, when, a description, and relevant metadata (never secrets). It never claims AI is safe again — re-enabling is always a separate, deliberate step.

## Security Center (`frontend/admin-security.html`, `js/security.js`)

Guardian's UI lived on the Submissions page (`admin.html`) through 2026-09-02 — as of 2026-09-03 it's a dedicated page, `admin-security.html`, reached from the admin header and the account menu on every admin page. Submissions went back to being purely about leads/clients/AI analysis/outreach; nothing about *how* Guardian works changed, only where its controls live. Same JWT+admin gate as everywhere else (`routes/admin.js`'s existing `router.use(authenticate, requireAdmin)`) — no second auth system, and no second Guardian: every control on this page still calls the exact same `guardian/aiControl.js` / `guardian/securityEvents.js` functions the old panel did.

What's on it:
- **Overall System Status** banner + a per-system grid (Frontend/Backend/Database/Storage/AI/Guardian/Integrity/Ollama/Resend/Tavily/Railway/GitHub Actions/Sentry) — `GET /api/admin/security/status`, one aggregate call instead of polling each subsystem separately. Never shows a status without real evidence behind it — an unconfigured or unreachable integration says so explicitly (`NOT_CONFIGURED`/`UNAVAILABLE`), never a guessed `HEALTHY`.
- **Production Version** / **Version Consistency** — the commit SHA Railway auto-injects (`RAILWAY_GIT_COMMIT_SHA`), shown as "Production Commit", deliberately never as a fabricated semantic version (`package.json`'s own version field is shown, labeled explicitly as not a release identifier, since it's never bumped per release). Compared against Railway's own API-reported commit when `RAILWAY_API_TOKEN` is configured.
- **Deployment History** (`guardian/railwayStatus.js`, needs `RAILWAY_API_TOKEN`) and **GitHub Actions status** (`guardian/githubStatus.js`, needs `GITHUB_TOKEN`) — read-only, cached (30s), correlated per-deployment where possible. Both degrade to a clear "not configured"/"unavailable" state rather than fabricating pipeline status.
- **Sentry** (`guardian/sentryStatus.js`, needs `SENTRY_AUTH_TOKEN` — distinct from the write-only `SENTRY_DSN` used for reporting) — unresolved issue counts (explicitly "at least N", never a fabricated precise total — Sentry's list API is cursor-paginated with no total-count field), split Browser (`source:frontend`, matching `controllers/errorController.js`'s own tag) vs. everything else.
- **Critical Events** — unacknowledged CRITICAL events, pulled to the top regardless of whatever filter the activity feed below has active. Acknowledgement still goes through `SecurityEvent.acknowledge()`, still required before AI can be re-enabled — unchanged.
- **AI Control Center** — the exact same kill-switch panel from the old Guardian panel (**Disable All AI** / **Lockdown All AI**, one click each behind `window.confirm()`; **Re-enable AI**, refused with a clear, linkable 409 if an unacknowledged CRITICAL event is blocking it), visually split into a read-only status row and a labeled "Administrator Controls" actions row.
- **Activity feed** — filterable (category/severity/resolved) and keyset-paginated (`SecurityEvent.findPage`, `GET /api/admin/security/events`) — never loads unlimited events into the browser. "Category" (AI/Browser/Backend/Infrastructure) is derived from each event's existing `source` field via a static map (`guardian/eventCategory.js`), not a new database column — update that map alongside any new `logSecurityEvent()` call site.
- **Copy System Snapshot** / **Copy JSON** — formats the already-fetched status data client-side into a plain-text report meant for pasting into a bug report or an AI chat. No extra network request, and it can only ever contain what's already rendered on screen.

New routes (`GET /api/admin/security/status`, `GET /api/admin/security/events`, `GET /api/admin/security/deployments`) live in `controllers/guardianController.js` alongside the original `/guardian/*` ones — thin adapters over the same underlying modules, not a parallel controller.

## Production code integrity

`guardian/integrityCheck.js` computes SHA-256 hashes of ~14 security-critical files (the AI control plane itself, `ai/aiService.js`, `ai/providers/ollamaProvider.js`, `server.js`, `instrument.js`, `middleware/auth.js`, `middleware/rateLimit.js`, `config/env.js`, `package.json` — the full list is `guardian/integrityCheck.js`'s `PROTECTED_FILES`) and compares them to a committed manifest (`guardian/integrity-manifest.json`).

- `npm run guardian:integrity:check` — CI-time gate; fails on any drift.
- `npm run guardian:integrity:update` — regenerates the manifest; run this and commit the result whenever you legitimately change a protected file.
- An **optional** boot-time check (`GUARDIAN_INTEGRITY_CHECK_ON_BOOT=true`, off by default) — a mismatch at boot logs a CRITICAL event and locks AI down, but never blocks the app from starting or serving non-AI traffic. Off by default specifically so enabling it is a deliberate operator decision, not a default that could surprise an existing deploy.

**This is a tripwire, not a guarantee.** It detects unexpected drift between what's on disk and what was deliberately shipped and reviewed — a tampered deploy pipeline, a supply-chain issue, a file modified after the fact. It does not defend against a sophisticated attacker who also updates the manifest.

## Sentry privacy

`instrument.js`'s `Sentry.init()` now has a `beforeSend` hook (`guardian/sentryScrub.js`) — regex-based redaction of Bearer tokens, JWT-shaped strings, known provider key prefixes (Resend/Anthropic/Tavily/generic `sk-`), Postgres connection-string credentials, and Supabase signed-URL tokens, applied to `event.message`, exception values, breadcrumbs, and `extra`. Authorization/Cookie headers are dropped entirely if ever present on request data. This closes a real gap: the three raw `Sentry.captureException(err)` call sites in `server.js` (the global error handler, `uncaughtException`, `unhandledRejection`) previously forwarded whatever a caught error's message happened to contain, with zero scrubbing — `controllers/errorController.js`'s frontend-error path was already safe by construction (an explicit field allowlist), but nothing protected the other three.

## Storage security

`getAssetSignedUrl` (`controllers/adminController.js`) is now submission-scoped (`POST /api/admin/submissions/:id/storage/signed-url`), mirroring the ownership check its sibling `removeAsset` already had. Previously, the route took no submission id at all — any valid admin JWT plus any well-formed brand-asset UUID path was sufficient to get a signed URL, regardless of which submission (if any) it actually belonged to. Not a live incident (this app has exactly one admin, and asset paths are random UUIDs from `crypto.randomUUID()`, not guessable), but real defense-in-depth against a leaked/stolen admin token or a future bug being used to enumerate arbitrary client files. `BRAND_ASSET_PATH_RE` (`lib/validators.js`) remains the path-traversal defense underneath.

Confirmed elsewhere in the storage layer: uploaded file paths are always server-generated random UUIDs (never user-supplied filenames), signed URLs expire after 300 seconds at every call site, `services/storage.js` never treats uploaded content as executable, and bucket privacy itself is an out-of-band Supabase dashboard setting (not represented in this codebase — verify it directly in the Supabase project if you haven't).

## Ollama/Tailscale boundary

Production reaches Ollama through `scripts/start-with-tailscale.sh`, which runs `tailscaled` in **userspace networking mode**, not the normal TUN-based mode (confirmed via a real deploy: this container has neither a TUN device nor `NET_ADMIN`). This matters: userspace mode gives the container **no transparent network route to any tailnet peer** — only an explicit outbound HTTP proxy (`TAILSCALE_HTTP_PROXY`, started by that same script) can reach the tailnet at all, and only two call sites in this entire codebase reference it: `ai/providers/ollamaProvider.js` (talking to Ollama for real AI calls) and `controllers/adminController.js`'s admin-triggered remote Ollama start/stop control. Confirmed by direct grep — no other code path uses it.

Practically: **Ollama itself has no way to execute commands on the BrindLeaf server, modify BrindLeaf files, modify Guardian state, or reach any other machine on the tailnet through this application** — the only thing that ever crosses that boundary is an HTTP request/response carrying text, and the capability firewall above governs everything that happens with the response on this side. Model output is never trusted merely because Ollama is "local."

**Recommended operator-side hardening** (outside this repo, in the Tailscale admin console — cannot be configured from code here): scope this node's ACL tags to allow outbound access **only** to the specific Ollama host's port (and the remote-control helper's port, if used), not general tailnet reachability. The application-level boundary above is already real and already the primary defense; an ACL is deliberately narrower defense-in-depth on top of it, not a replacement for it.

## Authentication and session security

Reviewed, findings below. `middleware/auth.js`'s `authenticate` verifies a JWT (`Authorization: Bearer`) and `requireAdmin` checks `role === "admin"`; `controllers/authController.js`'s login already used a timing-safe dummy-hash comparison to prevent email enumeration (existing code, not new) and is now also rate-limited (`loginLimiter`, 5/15min) and every attempt (success and failure) is logged to `security_events`.

**Known gap, documented rather than silently fixed or silently ignored**: there is no logout/token-revocation mechanism. Sessions are pure JWT expiry (`JWT_EXPIRES_IN`, default 12h) — no server-side session store, no blacklist, no `jti`/token-version field. Building real revocation is a meaningfully separate initiative (it touches the shape of every authenticated request, not just login) and was judged out of scope for this pass rather than bolted on hastily. **Recommendation for a future pass**: add a `jti` claim at sign time plus a short-lived revocation table (or a `token_version` column on `users`, bumped on demand) checked in `authenticate` — either is a small, well-understood addition when it's actually prioritized.

## Data security review

Sensitive fields identified: client contact info and project details (`submissions`), AI analysis results and chat contents (`submission_analyses`, `submission_chats`), contract PII and financial terms (`contracts` and related tables), uploaded files (Supabase Storage), admin credentials (bcrypt-hashed, never logged — confirmed via grep, no call site anywhere prints a raw password/token/header).

**No field-level application encryption was added, deliberately.** Data is already encrypted at rest (Supabase) and in transit (TLS/HTTPS, enforced via `Strict-Transport-Security`). Field-level encryption of e.g. client email or project details would break the extensive search/filter/CSV-export functionality already built directly on plain-text SQL queries throughout the admin dashboard — a significant, invasive change — for a threat model (someone with raw, direct database access bypassing the app entirely) that JWT+admin gating and Postgres's own access control already address. This is a reviewed-and-declined outcome with reasoning, not an oversight — homemade or bolted-on cryptography for its own sake was explicitly out of scope.

---

## What Guardian reused vs. added

Reused, unmodified in spirit: `ai/aiService.js`'s `PROVIDERS` dispatch and confidence-normalization pattern, the delimiter-tag injection defense, Zod central validation, the idempotent `CREATE TABLE IF NOT EXISTS` convention, the existing JWT/admin router, `middleware/rateLimit.js`'s limiter pattern, the already-wired Sentry integration, and `services/contractAudit.js`'s exact fire-and-forget audit-log pattern (mirrored by `guardian/securityEvents.js`).

Genuinely new: `guardian/aiControl.js`, `circuitBreaker.js`, `aiCapabilities.js`, `securityEvents.js`, `sentryScrub.js`, `integrityCheck.js`, `setAiState.js`; the `ai_control_state` and `security_events` tables; the admin AI-control routes/UI; the storage ownership fix; the Sentry `beforeSend` hook; and the integrity manifest + CI gate.

## Known limitations

- CI-based AI review is realistically unavailable most of the time (no Tailscale route from GitHub-hosted runners).
- CodeQL, pattern-based secret scanning, and the integrity manifest are all best-effort tripwires, not formal proofs.
- The AI reviewer is a small local model reviewing a size-budgeted diff — treat its findings as a second opinion, not a verdict.
- No token revocation exists yet (see [Authentication and session security](#authentication-and-session-security)) — documented, not silently patched over.
- The Tailscale ACL hardening recommended above has not been applied from this repo — it requires action in the Tailscale admin console, outside what code here can configure.
- If Guardian's own database tables become unavailable, the AI kill switch fails closed (AI disabled) but the rest of the app — including Guardian's own diagnostics/history UI — may itself be degraded, since they share the same database. There is no fully independent-of-the-database fallback beyond the `BRINDLEAF_AI_ENABLED` env var.
- Guardian cannot guarantee zero bugs, cannot guarantee perfect security, and does not replace human judgment or human code review.
