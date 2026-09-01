# AI project analysis

Structured, server-side-only AI analysis of `web-design.html` intake submissions. See `ai/aiService.js` for the entry point, `ai/providers/` for the swappable inference backends.

Two features share this same provider abstraction:
- **Project analysis** (`ai/schema.js`, `ai/prompt.js`) — an internal-only synthesis of an intake submission. Client name/email are deliberately excluded from what's sent to the model (see `sanitizeWebDesignSubmission`).
- **Outreach email drafting** (`ai/emailSchema.js`, `ai/emailPrompt.js`) — only available once analysis has completed, and the opposite privacy stance on purpose: the client's real name is included, because the output is meant to be sent to them. It's built from a narrow, client-safe subset of the analysis result — internal-only fields (`internal_notes`, `potential_risks`, `missing_information`, `confidence`, `priority`, `complexity`) are never forwarded (see `buildEmailContext`).

## Local development

1. Install Ollama:
   ```
   brew install ollama
   ```
2. Start the Ollama server (leave this running in its own terminal, or use `brew services start ollama` to run it in the background permanently):
   ```
   ollama serve
   ```
3. Pull the model:
   ```
   ollama pull qwen2.5:7b
   ```
4. Run the app as usual (`npm start` from `backend/`). No `.env` changes needed — `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://localhost:11434`, and `OLLAMA_MODEL=qwen2.5:7b` are all defaults in `config/env.js`.

AI analysis never runs automatically — submitting the intake form only ever saves the submission. From the admin dashboard, open a web-design submission and click **Analyze with AI**. This is the only thing that ever contacts Ollama, which is why Ollama can be left shut down entirely between uses. Check progress from the dashboard, or directly in Postgres:

```sql
SELECT status, error FROM submission_analyses ORDER BY id DESC LIMIT 5;
```

## Live analysis progress

A request against a local model can genuinely take a couple of minutes — a static "Analyzing…" label gives no way to tell that apart from a hung request. Two independent, backend-confirmed signals cover this instead of a simulated/fake progress bar:

- **`lib/analysisProgress.js`** — an in-memory map of real pipeline stages (`preparing` → `sending` → `generating` → `validating` → `saving`) per in-flight submission, updated by `runAnalysis.js`/`draftEmail.js` via an `onProgress` callback threaded through `aiService.js` and each provider. Polled by the dashboard every ~1s via `GET /api/admin/submissions/:id/analyze/progress` and `.../draft-email/progress` while a request is in flight (see `admin.js`'s `tickElapsedLabels`). In-memory only, and only correct because this runs as a single Railway instance — see that file's own comment if this ever needs to scale horizontally.
- **`ollamaProvider.js`'s console logs** — the request-sent / response-received timing lines, visible live in Railway's log tab, useful when you want ground truth independent of the dashboard.

The dashboard's stage list also shows exactly what's being fed into the model — the same allowlisted fields `sanitizeWebDesignSubmission`/`buildEmailContext` actually send, nothing more. Ollama has no external "sources" of its own here: no web search, no retrieval, no data beyond the submission's own answers (and, for the email draft, the completed analysis).

## Analysis reasoning

`AnalysisSchema`'s `reasoning` field (`ai/schema.js`) asks the model to explain, per major judgment call, which specific thing the client said or didn't say led to that conclusion — not a restatement of the conclusion itself. Rendered as its own "How the AI reached these conclusions" section on the dashboard (`admin.js`), visually set apart from the rest of the analysis. Internal-only, like `internal_notes` — never forwarded into the email-draft context (see `buildEmailContext`).

## Why Ollama can't run on Railway

Railway's app containers aren't built for hosting a persistent multi-gigabyte model with sustained CPU/memory load — that's a different kind of infrastructure than a web app + Postgres. The web app and the inference layer need to stay logically separate, as designed:

```
Railway (Website + Backend + Database)
        ↓
Secure AI service connection
        ↓
Ollama server  (NOT on Railway)
        ↓
Local/open-source model
```

## Production options

Ollama's HTTP API has **no built-in authentication** — it must never be reachable from the public internet. Pick one:

**1. Self-hosted Ollama behind a private tunnel (Tailscale/WireGuard).** Run Ollama on a machine you control (a home server, a small VPS, a spare box), join it and your Railway service to the same private network (e.g. [Tailscale](https://tailscale.com) has a straightforward setup for this), and point `OLLAMA_BASE_URL` at its private network address. Ollama is never exposed publicly — only reachable over the private tunnel. This keeps AI inference at $0 in production too, at the cost of you keeping a machine running.

This repo has a ready-to-use setup for exactly this (Railway + Tailscale). Railway's actual build system for this project is **Railpack** (not Nixpacks, despite that being the more commonly documented one — confirmed from a real deploy's build log, which named `railpack-vX.X.X` as the build driver):
- `railpack.json` overrides the deploy start command to `scripts/start-with-tailscale.sh`
- That script installs the `tailscale` binary itself at boot (via Tailscale's own official installer script, `curl -fsSL https://tailscale.com/install.sh | sh`) — done at runtime rather than via Railpack's build-time `aptPackages`/`steps` config, since `tailscale` isn't in Debian's default apt repos (confirmed directly against packages.debian.org) and whether a build-time repo addition would even persist into Railpack's separate deploy-stage image wasn't verifiable without a live deploy. This costs a few extra seconds on a cold start; trades that for not depending on either of those unverified assumptions.
- It then brings the container onto your tailnet (using a `TAILSCALE_AUTHKEY` you generate from your [Tailscale admin console → Keys](https://login.tailscale.com/admin/settings/keys)) and starts the app — designed to fail *safely* at every step: if the install or the connection fails for any reason, it logs a warning and starts the app anyway, so a Tailscale problem never takes down the whole site, only AI analysis
- On the machine actually running Ollama, it needs to (a) be joined to the same tailnet (`tailscale up`) and (b) bind to more than just `localhost` — `OLLAMA_HOST=0.0.0.0:11434 ollama serve` — since Tailscale's virtual network interface isn't reachable via the default loopback-only binding
- Set `OLLAMA_BASE_URL` in Railway to that machine's Tailscale IP (`tailscale ip -4` on that machine), e.g. `http://100.x.x.x:11434`
- **To roll this back** if the build ever breaks: delete `railpack.json` — Railway falls straight back to its normal auto-detected Node build, no other changes needed
- **Confirmed via a real deploy**: this Railway container has neither a TUN device (`/dev/net/tun does not exist`) nor root/`NET_ADMIN` (`iptables ... Permission denied`), so normal `tailscaled` can never work here. `start-with-tailscale.sh` instead runs it with `--tun=userspace-networking --outbound-http-proxy-listen=localhost:1055` — needs neither. The tradeoff: userspace mode gives the container no free network route to tailnet peers the way TUN mode would, so the app has to explicitly route through that local proxy — see `ai/providers/ollamaProvider.js`'s `TAILSCALE_HTTP_PROXY` handling (via `undici`'s `ProxyAgent`, only applied to the Ollama call specifically, nothing else in the app). Verified locally end-to-end at the code level (a real, unauthenticated userspace-networking `tailscaled` run here confirmed Node correctly reaches the local proxy with no connection-refused error); the one thing that could only be confirmed by an actual live deploy — an authenticated `tailscaled` correctly forwarding through to a real tailnet peer — is Tailscale's own mature, well-tested core functionality, not new code.
- **Known flakiness, both confirmed via real deploy logs and mitigated in `ollamaProvider.js`**: this tunnel is used infrequently by design (Ollama only runs when an admin clicks Analyze), and Tailscale's own connection-management logic doesn't always cope cleanly with that. Two distinct failure modes have been observed so far: (1) the proxy's relay connection idles out and is mid-reconnect exactly when a request lands, logged as `http: proxy error: EOF` and surfaced to the app as an immediate HTTP 502 — the app retries once after this; (2) a direct peer-to-peer path negotiation silently fails (a peer contact registers `via=direct` in the logs, then nothing — no error, no response — until the app's own timeout fires, logged by Tailscale as `context canceled`). For (2), the first attempt is bounded to `FIRST_ATTEMPT_TIMEOUT_MS` (45s) rather than the full request budget, so a hung connection is abandoned for a fresh one quickly instead of silently burning the whole 5 minutes. If analysis requests keep failing even with these retries, that points to a more structural NAT/direct-path issue between Railway's network and wherever Ollama is running, worth investigating at the Tailscale admin console level (DERP relay assignment, NAT traversal) rather than in this app's code.
- **Persisting Tailscale's identity across redeploys**: `/tmp` (where `tailscaled --state` lived originally) is wiped on every redeploy, so every redeploy registered the container as a brand-new Tailscale device and forced a fresh network-path negotiation to the Ollama host from scratch — confirmed directly by watching `tailscale status` on the Ollama host accumulate a new offline `brindleaf-backend`-ish device on every redeploy (8 in one day of iterating on this app), with connectivity getting flakier as that churned. Fix: add a Railway Volume to the backend service (Railway dashboard → the service → **Settings → Volumes → New Volume**, any small size like 1GB, mount path `/data`) — `start-with-tailscale.sh` uses `/data` for `--state` whenever it's mounted, falling back to `/tmp` (today's churn-prone behavior) with a warning if it isn't. The very next deploy after adding the volume still registers as a new device (nothing persisted yet); every deploy after that reuses the same identity. Stale offline devices from before this fix can be removed from the tailnet in the [Tailscale admin console's Machines page](https://login.tailscale.com/admin/machines) — harmless to leave, but worth tidying up.

### Remote Ollama control

Since Ollama only ever runs when an admin actually clicks **Analyze with AI**, there's no reason to keep it running on the host machine the rest of the time — but that machine isn't Railway, so there's no dashboard for it either. A small always-on helper (`~/ollama-control/server.js` on the host machine, not part of this repo) exposes three endpoints over the same Tailscale connection Ollama itself uses:

- `GET /status` → `{ running: boolean }` (checks via `pgrep -f "ollama serve"`)
- `POST /start` → spawns `ollama serve` with `OLLAMA_HOST=0.0.0.0:11434` (detached, so it survives the helper restarting) and returns once the process exists
- `POST /stop` → `pkill -f "ollama serve"`, then polls until the process is actually gone (up to 3s) before responding — avoids reporting success while the process is still exiting

Every request needs `Authorization: Bearer <OLLAMA_CONTROL_SECRET>`; anything else gets a 401. This has to hold even over a private tailnet — a control endpoint that can start/stop a process on your machine with no auth at all is a bigger risk than being locked out of Ollama, so treat this secret exactly like `JWT_SECRET`: generate it randomly (`node -e "require('crypto').randomBytes(32).toString('hex')"`), never commit it, and set the same value in the helper's own environment and in Railway's `OLLAMA_CONTROL_SECRET`.

The helper runs as a macOS **LaunchAgent** (`~/Library/LaunchAgents/com.brindleaf.ollama-control.plist`, `RunAtLoad` + `KeepAlive` both true) — no `sudo` needed, and it restarts itself if it ever crashes. This is deliberately separate from Tailscale itself: the helper never touches the Tailscale connection, since killing that would also cut off the only channel able to reach the helper.

The Railway-side routes (`GET/POST /api/admin/ollama/status|start|stop` in `routes/admin.js`, admin-authenticated like every other admin route) proxy to the helper over the same `tailscaleDispatcher` used for Ollama calls (see `lib/tailscaleDispatcher.js`) and return **503** if `OLLAMA_CONTROL_URL`/`OLLAMA_CONTROL_SECRET` aren't set, or **502** if the helper can't be reached (machine off, Tailscale down, helper crashed and hasn't restarted yet).

**For this to survive a reboot or sleep**, three independent things all need to auto-start on the host machine — Tailscale itself (`sudo brew services start tailscale`, not just `tailscale up` run once by hand), the control helper (the LaunchAgent above), and Ollama only starts on demand via the toggle, so it doesn't need to.

**2. Self-hosted Ollama behind an authenticated reverse proxy.** Put Ollama on a VPS behind Nginx/Caddy configured with Basic Auth or mTLS, and IP-allowlist Railway's egress addresses. More moving parts than option 1, but doesn't require a mesh VPN.

**3. Switch `AI_PROVIDER=anthropic` in production only.** The provider abstraction already supports this with zero code changes — set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in Railway's environment variables, keep `AI_PROVIDER=ollama` in local `.env`. This means production analysis has a real per-request cost (Claude API pricing) while local development stays free. Simplest option if you don't want to run/maintain your own inference server.

Whichever you choose, `OLLAMA_BASE_URL` (or the Anthropic key) is an environment variable — never hardcode a production endpoint or credential into source.
