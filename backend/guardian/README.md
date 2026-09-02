# BrindLeaf Guardian

Guardian is a layered safety net around BrindLeaf: deterministic checks (tests, coverage, lint, dependency audit, secret scanning, CodeQL) as the mandatory gate, an Ollama-based AI code reviewer as an additional advisory layer, and production health/smoke monitoring. It does not prove BrindLeaf is bug-free or perfectly secure — it reduces risk, and it says so honestly rather than claiming more than it can.

## The three tiers

Guardian runs in three places, matched to what's actually available in each:

1. **CI-time** (`.github/workflows/ci.yml`, `codeql.yml`, `smoke.yml`, `.github/dependabot.yml`) — runs on every push/PR to GitHub-hosted runners. Tests/coverage/lint/audit are mandatory gates. CodeQL and Dependabot run separately. The AI review step is advisory and usually reports "unavailable" here — see [Why CI-based AI review is usually unavailable](#why-ci-based-ai-review-is-usually-unavailable).
2. **Local** (`npm run guardian`, `npm run guardian:ai`, `npm run guardian:smoke`) — the same checks, runnable on a developer machine before pushing. `guardian:ai` *can* reach a local Ollama instance.
3. **Production** (the admin dashboard's Guardian panel, `GET/POST /api/admin/guardian/*`) — lightweight, JWT-protected deep diagnostics (database/storage/Ollama/Resend/Tavily reachability), stored in the `guardian_checks` table. This tier deliberately does **not** run tests, lint, or code review against the live Railway container — see [Why production Guardian is diagnostics-only](#why-production-guardian-is-diagnostics-only).

## What each check does

| Check | Where | What it does |
|---|---|---|
| Tests | CI + local (`npm test` / `npm run test:coverage`) | `node --test`, the existing 218+ tests plus Guardian's own. A failure blocks CI. |
| Coverage | CI + local (`npm run test:coverage`) | Node's built-in `--experimental-test-coverage`, gated on `--test-coverage-lines/-functions/-branches` thresholds (see [Coverage thresholds](#coverage-thresholds)). |
| Lint | CI + local (`npm run lint`) | ESLint, flat config (`eslint.config.js`), `eslint:recommended` only — no Prettier, no style rules. See [Lint policy](#lint-policy). |
| Dependency audit | CI + local (`npm audit --audit-level=high`) | Fails CI on a high/critical severity finding. Never auto-upgrades — a human reviews and applies the fix. |
| Secret scanning | GitHub (built-in secret scanning + push protection, free for this public repo) | Blocks a push containing a recognizable credential pattern. **Requires enabling in the repo's Settings → Security → Code security page — this is a one-time manual toggle, not something a file in this repo can turn on for you.** |
| Security scanning | GitHub (`codeql.yml`) | CodeQL's default JavaScript/TypeScript query pack, on push/PR + weekly. Findings appear under the repo's Security tab. |
| AI code review | CI (advisory) + local (`npm run guardian:ai`) | Ollama reviews the diff against `guardian/rules.js`'s architecture rules. Never blocks unless run with `--strict` and the result is `fail`. |
| Production diagnostics | Admin dashboard ("Run Guardian Check") | DB/storage/Ollama/Resend/Tavily configured+reachable status, stored in `guardian_checks`. |
| Production smoke test | CI (`smoke.yml`, scheduled) + local (`npm run guardian:smoke`) | Read-only GET checks against the live public site. Never submits a form or touches real customer data. |
| Frontend error monitoring | Always-on (`frontend/js/common.js`) | `window.onerror`/`unhandledrejection` → `POST /api/client-error` → the existing Sentry pipe. |
| Server error monitoring | Always-on (already existed before Guardian) | Sentry, wired in `server.js`/`instrument.js`. Guardian didn't change this — see [What Guardian reused vs. added](#what-guardian-reused-vs-added). |

## Running Guardian locally

```bash
npm test                 # existing + Guardian tests
npm run lint              # ESLint
npm run test:coverage     # tests + coverage thresholds
npm audit --audit-level=high
npm run guardian:ai       # AI code review against origin/main...HEAD (needs local Ollama)
npm run guardian:ai -- --base <ref> --head <ref> --strict
npm run guardian:smoke    # production smoke test (SITE_URL env var to override)
```

There is no single `npm run guardian` that bundles all of the above into one command with pass/warn/fail aggregation — deliberately: CodeQL and GitHub's secret scanning have no clean local equivalent, and re-implementing that aggregation logic locally would be a second, drifting copy of what CI already does. `npm test && npm run lint && npm run test:coverage && npm audit --audit-level=high` is the real local-parity command; `npm run guardian:ai` and `npm run guardian:smoke` are separate because they hit real external systems (Ollama, the live site) that a plain `npm test` shouldn't depend on.

## How CI works

`ci.yml` runs on every push to `main` and every pull request: `npm ci` → lint → `test:coverage` → `npm audit --audit-level=high`, against a real Postgres service container (matching what the integration tests actually need — no mocking). Any of these failing fails the workflow. A separate `ai-review` job (needs the deterministic job to pass first) runs `guardian:ai` with `continue-on-error: true` — it can never fail the workflow, by design.

`codeql.yml` and `smoke.yml` are separate workflows on their own schedules, independent of `ci.yml`.

## How to interpret failures

- **`ci.yml` failed on the deterministic job** — a real test/lint/coverage/audit regression. Fix it; don't disable the check.
- **`ci.yml`'s `ai-review` job shows a red X** — this can only happen from an infrastructure problem in the job itself (e.g. `npm ci` failing), never from the AI review's own verdict — see `guardian/reviewCli.js`, which always exits 0 for a `pass`/`warn`/`fail`/`unavailable` result. Check the job log's last lines for what actually broke.
- **CodeQL flags something** — read the finding on the repo's Security tab. If it's a genuine false positive for this codebase's actual data flow, document why in a code comment near the flagged line rather than suppressing it blindly.
- **`smoke.yml` failed** — the live site (or a specific page) is down or returned unexpected content. GitHub's own failure-email notification is the alert mechanism for this first pass (see [Alerting](#alerting)).
- **The admin dashboard's Guardian panel shows WARNING** — an optional integration (Ollama, Resend, Tavily, Supabase Storage) is unreachable or unconfigured. This is expected and normal for Ollama specifically (it runs on the owner's local machine). It only shows FAILED if the database itself is unreachable — that's the one dependency Guardian treats as mandatory.

## Coverage thresholds

Measured baseline at the time Guardian was added: **67.9% lines, 70.1% branches, 46.6% functions** (`node --test --experimental-test-coverage`, no flags). The configured gate (`package.json`'s `test:coverage` script) is set a few points below that — **65% lines, 65% branches, 42% functions** — to catch a real regression without being so tight that ordinary, non-regressive changes fail it. Function coverage is the lowest of the three because several files (`config/database.js`'s seed helpers, some provider error branches) are exercised more by manual/live testing than by the automated suite; that's a known, accepted gap, not a new one Guardian introduced.

**To raise a threshold**: run `npm run test:coverage`, note the new real percentage, and only then raise the corresponding `--test-coverage-*` flag in `package.json` to a few points below it — never guess a number, and never raise it past what's currently actually covered (that would just make CI permanently red).

## Lint policy

`eslint.config.js` uses `eslint:recommended` only, split across three file groups (Node backend, browser-global frontend scripts, tests) because this project has no bundler and no `type: module` — `frontend/js/*.js` files share globals across `<script>` tags the way a pre-module-system site always has, and the config's frontend block explicitly lists `common.js`'s cross-file exports as known globals for that reason (see the comment in `eslint.config.js` itself).

Two rules were deliberately scoped down rather than left at their default `eslint:recommended` severity, both documented inline in `eslint.config.js`:
- **`preserve-caught-error`** (new in ESLint 10) → downgraded to `warn`. ~15 pre-existing, intentional "catch a raw fetch failure, throw a cleaner user-facing message" call sites in `frontend/js/common.js` trip it; fixing all of them was out of scope for the change that introduced linting. New code is still expected to pass `{ cause: err }` when rethrowing.
- **`no-unused-vars`** on `frontend/js/common.js` specifically → scoped to local-only (`vars: "local"`). That file's entire purpose is declaring functions/consts consumed by sibling `<script>` tags, so nearly everything it declares looks "unused" from ESLint's single-file perspective.

**To add a rule**: edit `eslint.config.js`'s `rules` block. Run `npx eslint .` against the whole repo first — if it surfaces a wall of pre-existing findings, investigate whether they're real (fix them, ideally in a focused follow-up) or a structural false positive like the two above (scope the rule, document why, same as this file does).

## How the AI reviewer works

`guardian/collectDiff.js` runs `git diff <base>...<head>`, filtered to changed `.js` files (excluding `node_modules`/lockfiles), and best-effort-matches existing `test/*.test.js` files by name for "relevant tests" context. `ai/guardianPrompt.js` builds a fixed system prompt (embedding `guardian/rules.js`'s real, audit-derived architecture rules) plus a user message wrapping the diff/file-list/tests in `<CODE_DIFF>`/`<CHANGED_FILES>`/`<RELEVANT_TESTS>` delimiter tags — the exact same "data, never instructions" defense every other AI prompt in this codebase already uses (see `ai/prompt.js`). `ai/aiService.js`'s `reviewCodeChange` runs this through the same `PROVIDERS` dispatch, confidence-normalization, and `GuardianReviewSchema.safeParse()` validation every other AI call in this app goes through — not a second AI architecture.

### Why CI-based AI review is usually unavailable

Ollama runs on the owner's local machine, reachable from Railway (production) only via Tailscale. A standard GitHub-hosted Actions runner has no route into that Tailscale network, so `guardian:ai` in `ci.yml` will almost always report `AI REVIEW: unavailable — ollama_unavailable: ...` — this is expected, not a bug, and the job is explicitly `continue-on-error: true` so it never blocks anything. A self-hosted runner joined to the same Tailscale network (or a Tailscale GitHub Action establishing a route) could change this in the future; that setup work is out of scope for this pass.

### What the AI reviewer can and cannot guarantee

It can: identify suspicious patterns, flag likely architecture-rule violations, suggest missing tests, and explain its reasoning with cited evidence. It cannot: prove code is secure, replace CodeQL or the test suite, replace a human reviewer, or override a deterministic check's failure. Its `overall` verdict only blocks anything when the CLI is explicitly run with `--strict` — the default is fully advisory, matching the mandatory-vs-advisory split in [CI gating policy](#ci-gating-policy) below.

### CI gating policy

- **Mandatory** (blocks): tests, coverage thresholds, ESLint errors (not warnings), `npm audit --audit-level=high` findings.
- **Advisory** (visible, never blocks): the AI reviewer's findings/verdict when run without `--strict`, CodeQL findings (unless branch protection is separately configured to require the check), an available-but-not-yet-applied Dependabot update, ESLint warnings.

## How to add a Guardian rule

Edit `guardian/rules.js`'s `RULES` array — one `{ id, rule }` entry, id in kebab-case, `rule` a single factual sentence describing something actually true of the codebase right now (verify against the real code, don't describe an aspiration). It's automatically included in the AI reviewer's system prompt via `renderRulesForPrompt()` — no other wiring needed. Delete or edit a rule the moment the code it describes changes, or the reviewer will start flagging correct code as a violation.

## Production diagnostics

`GET /api/admin/guardian/diagnostics` (read-only) and `POST /api/admin/guardian/run` (same checks, persists a row) both live under the existing JWT-protected admin router (`routes/admin.js` already applies `authenticate`+`requireAdmin` once at the top — Guardian's routes inherit it, no second auth system). Each dependency reports one of five states:

- **HEALTHY** — working normally.
- **WARNING** *(only as the overall status, not a per-dependency one)* — something optional is degraded; the app itself is fine.
- **FAILED** — the database is unreachable. The only dependency Guardian treats as mandatory; everything else degrading only ever produces an overall `WARNING`, never `FAILED` (see `guardian/rules.js`'s `graceful-degradation` rule).
- **UNAVAILABLE** — configured, but not currently reachable (e.g. Ollama, or Supabase Storage down).
- **NOT_CONFIGURED** — an optional integration (Storage, Resend, Tavily) simply isn't set up on this deployment.

None of these checks ever send a real email, ever run against the local `git` history (the deployed Railway container has no working tree to diff), or run the test suite/lint on the live server — see [Why production Guardian is diagnostics-only](#why-production-guardian-is-diagnostics-only).

### Why production Guardian is diagnostics-only

Two structural reasons, not an oversight:
1. **No git history in production.** Railway's deployed container doesn't carry the `.git` directory or working tree needed for `guardian/collectDiff.js` to produce a diff — code review fundamentally needs a source-controlled checkout, which only CI and local development actually have.
2. **`npm ci --omit=dev` in production.** ESLint (a `devDependency`) isn't even installed on the deployed server, and running the full test suite against the live database on every "health check" click would be wasteful and risky. Tests/lint/coverage/audit are CI-time and local-time concerns by design.

CI results are not synced into the `guardian_checks` table for the same reason described in the original design: doing so would mean inventing a second, non-JWT authentication path (a CI-to-server webhook secret) for marginal benefit, when GitHub Actions already gives free, complete history and logs for every CI run. Production's Guardian panel and CI's checks are two genuinely separate systems, on purpose.

## Alerting

`smoke.yml`'s scheduled run failing trips GitHub Actions' own built-in failure-email notification to the repository's watchers — no additional service (PagerDuty, a custom Resend-based alert, etc.) is wired up in this first pass. If that turns out to be too noisy or too easy to miss, `services/email.js`'s existing Resend integration (`notifyNewSubmission`'s pattern) is the natural next step to reuse for a dedicated "Guardian alert" email — not a new email provider.

## How to safely disable or repair a broken check

- **A lint rule is newly noisy after an ESLint version bump**: downgrade it to `warn` in `eslint.config.js` with a comment explaining why (see [Lint policy](#lint-policy) for the two existing examples) — don't remove the rule outright unless it's genuinely wrong for this codebase.
- **Coverage threshold suddenly fails after a legitimate refactor** (code moved, not lost coverage): re-measure with `npm run test:coverage`, confirm the real percentage, and adjust the threshold to match — see [Coverage thresholds](#coverage-thresholds).
- **CI's Postgres service container itself is unstable**: this is GitHub Actions infrastructure, not Guardian's logic — check the Actions status page before assuming a code regression.
- **`guardian:smoke` is flaky against a slow-but-healthy deploy**: the `SLOW_MS` constant in `guardian/smokeTest.js` only annotates a slow response, it doesn't fail the check — a genuine failure is a non-2xx status or a missing content marker, not raw latency. If a specific page's content marker is too brittle (e.g. copy changes often), pick a more stable marker rather than removing the check for that page.
- **Never**: delete a test to make CI pass, weaken a security check's threshold to make a finding disappear, or silence a whole rule/category just because one instance was inconvenient — see `guardian/rules.js`'s `no-weakening-security` and `no-deleting-tests` rules, which the AI reviewer is specifically told to watch for.

## What Guardian reused vs. added

Reused, unmodified in spirit: `ai/aiService.js`'s `PROVIDERS` dispatch and confidence-normalization pattern, the delimiter-tag injection defense (`ai/prompt.js`'s exact wording, replicated in `ai/guardianPrompt.js`), Zod central validation via `.safeParse()`, the idempotent `CREATE TABLE IF NOT EXISTS` migration convention (`config/database.js`), the existing JWT/`requireAdmin` admin router, `middleware/rateLimit.js`'s limiter pattern, and the already-wired Sentry integration (`instrument.js`, the global error handler) — Guardian's frontend error monitoring feeds into this existing pipe rather than adding the Sentry browser SDK or a second log store.

Genuinely new: the `guardian_checks` table/model, the Guardian admin routes/controller, `ai/guardianSchema.js`/`ai/guardianPrompt.js` (a structurally distinct schema/prompt, same infrastructure), the diff collector and CLI, the smoke test script, ESLint + coverage tooling (previously entirely absent), and the four GitHub Actions workflows + Dependabot config (previously no `.github/` directory existed at all).

## Known limitations

- CI-based AI review is realistically unavailable most of the time (see above) — it's a local/optional-self-hosted-runner capability today, not a CI guarantee.
- CodeQL and pattern-based secret scanning are best-effort, not a formal proof of security — a determined, novel attack can still slip past both.
- The AI reviewer is a small local model (`qwen2.5:7b` by default) reviewing a size-budgeted diff — it can miss things a careful human reviewer, or a larger model, would catch. Treat its findings as a second opinion, not a verdict.
- Guardian cannot guarantee zero bugs, cannot guarantee perfect security, and does not replace human code review before a meaningful production change ships.
