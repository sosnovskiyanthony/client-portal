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

This repo has a ready-to-use setup for exactly this (Railway + Tailscale):
- `nixpacks.toml` adds the `tailscale` binary to the build and swaps the start command to `scripts/start-with-tailscale.sh`
- That script brings the Railway container onto your tailnet on boot (using a `TAILSCALE_AUTHKEY` you generate from your [Tailscale admin console → Keys](https://login.tailscale.com/admin/settings/keys)), then starts the app — designed to fail *safely*: if Tailscale can't connect for any reason, it logs a warning and starts the app anyway, so a Tailscale problem never takes down the whole site, only AI analysis
- On the machine actually running Ollama, it needs to (a) be joined to the same tailnet (`tailscale up`) and (b) bind to more than just `localhost` — `OLLAMA_HOST=0.0.0.0:11434 ollama serve` — since Tailscale's virtual network interface isn't reachable via the default loopback-only binding
- Set `OLLAMA_BASE_URL` in Railway to that machine's Tailscale IP (`tailscale ip -4` on that machine), e.g. `http://100.x.x.x:11434`
- **To roll this back** if the build ever breaks: delete `nixpacks.toml` — Railway falls straight back to its normal auto-detected Node build, no other changes needed
- This was not tested against a live Railway deployment before landing in this repo — the container's exact networking capabilities (whether it grants a real TUN device) weren't verifiable without an actual deploy. Watch Railway's build/deploy logs the first time this ships; if `tailscaled`/`tailscale up` fail, the app still boots fine (see the safe-failure design above), you'll just see a `[tailscale]` warning in the logs and Ollama analysis will stay unavailable until it's resolved

**2. Self-hosted Ollama behind an authenticated reverse proxy.** Put Ollama on a VPS behind Nginx/Caddy configured with Basic Auth or mTLS, and IP-allowlist Railway's egress addresses. More moving parts than option 1, but doesn't require a mesh VPN.

**3. Switch `AI_PROVIDER=anthropic` in production only.** The provider abstraction already supports this with zero code changes — set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in Railway's environment variables, keep `AI_PROVIDER=ollama` in local `.env`. This means production analysis has a real per-request cost (Claude API pricing) while local development stays free. Simplest option if you don't want to run/maintain your own inference server.

Whichever you choose, `OLLAMA_BASE_URL` (or the Anthropic key) is an environment variable — never hardcode a production endpoint or credential into source.
