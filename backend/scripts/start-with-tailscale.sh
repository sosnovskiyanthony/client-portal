#!/bin/sh
# Only used in production (Railway) — see railpack.json's deploy.startCommand.
# Local dev keeps using `npm start` / `node server.js` directly, untouched.
#
# Brings this container onto the same private Tailscale network as the
# machine running Ollama (see ai/README.md's "self-hosted Ollama behind a
# private tunnel" production option), then hands off to the actual app.
# TAILSCALE_AUTHKEY must be set in Railway — generate one at
# https://login.tailscale.com/admin/settings/keys.
#
# Installs the tailscale binary itself, at boot, via Tailscale's own
# official installer — rather than relying on Railpack's build-time apt
# config, whose exact behavior across Railpack's build vs. deploy image
# stages wasn't something that could be verified without a live deploy
# attempt. This is slightly slower on a cold start (a real download +
# install happens once at boot) but removes that whole class of uncertainty.
#
# Runs tailscaled in userspace-networking mode with an outbound HTTP proxy,
# not the normal TUN-based mode — confirmed via a real deploy's logs that
# this container has neither a TUN device nor root/NET_ADMIN (iptables
# permission denied), so the default mode can never work here. Userspace
# mode needs neither. The tradeoff: nothing on this container gets a real
# network route to tailnet peers "for free" the way TUN mode provides — the
# app has to explicitly route requests through the proxy this starts (see
# ai/providers/ollamaProvider.js's TAILSCALE_HTTP_PROXY handling), which is
# also why this can't transparently help any other network call in the app;
# it's wired up for the one thing that needs it.
set -e

# /tmp is wiped on every redeploy — if that's where tailscaled's --state
# lives, every redeploy registers as a brand-new Tailscale device and has to
# renegotiate its network path (direct P2P vs. DERP relay) to the Ollama
# host from scratch. Confirmed directly: 8 separate "brindleaf-backend"-ish
# device identities piled up in one day of iterating on this app, and
# connectivity got flakier the more that churned. If a Railway Volume is
# mounted at /data (see ai/README.md's "Persisting Tailscale's identity"
# section for how to add one), state survives redeploys and the container
# keeps the same identity — falls back to /tmp (today's behavior) if no
# volume is mounted, so this script still works without one, just with the
# same churn as before.
if [ -d /data ]; then
  TAILSCALE_STATE_DIR=/data
else
  echo "[tailscale] WARNING: /data is not mounted (no Railway Volume) — falling back to /tmp, so this container's Tailscale identity will NOT survive the next redeploy."
  TAILSCALE_STATE_DIR=/tmp
fi

if [ -n "$TAILSCALE_AUTHKEY" ]; then
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "[tailscale] Installing tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh || {
      echo "[tailscale] WARNING: install failed — continuing without it."
    }
  fi

  if command -v tailscaled >/dev/null 2>&1; then
    echo "[tailscale] Starting tailscaled (userspace networking, state dir: $TAILSCALE_STATE_DIR)..."
    tailscaled \
      --state="$TAILSCALE_STATE_DIR/tailscaled.state" \
      --socket=/tmp/tailscaled.sock \
      --tun=userspace-networking \
      --outbound-http-proxy-listen=localhost:1055 &

    # Give the daemon a moment to create its socket before the client tries
    # to talk to it.
    sleep 2

    echo "[tailscale] Connecting to tailnet..."
    if tailscale --socket=/tmp/tailscaled.sock up --authkey="$TAILSCALE_AUTHKEY" --hostname=brindleaf-backend --accept-routes; then
      # Only the app itself needs this — it's read in
      # ai/providers/ollamaProvider.js, nowhere else.
      export TAILSCALE_HTTP_PROXY="http://localhost:1055"
      echo "[tailscale] Connected. Ollama requests will route through the local proxy at $TAILSCALE_HTTP_PROXY."

      # One-time diagnostic, not guesswork: shows, on every boot, this
      # container's real NAT/DERP characteristics (direct path vs.
      # relay-only, latency, packet loss) rather than inferring it after the
      # fact from a failed request's own logs. `|| echo` so a failed
      # diagnostic (the actual thing being tested for) never aborts the
      # script under `set -e`.
      echo "[tailscale] Network condition report:"
      tailscale --socket=/tmp/tailscaled.sock netcheck || echo "[tailscale] netcheck failed to complete."

      # Confirmed via a real deploy: a `tailscale ping` right after boot
      # gets clean pongs via the DERP relay in well under 100ms — the relay
      # path itself works fine when it's actually being used. But Ollama
      # requests are infrequent by design (only when an admin clicks
      # Analyze), and Tailscale's own relay connection idles out and gets
      # torn down after ~60s of silence — so by the time a real request
      # happens, the connection is almost always cold and has to renegotiate
      # from scratch, which is what's been causing the timeouts/502s in
      # ai/README.md's "Known flakiness" section. A lightweight ping to the
      # Ollama host every 45s (comfortably under that idle window) for as
      # long as the container is up keeps the connection warm, so a real
      # request is never the thing that has to cold-start it. Runs detached
      # in the background — deliberately not logged per-ping (would just be
      # noise every 45s for the life of the deploy); only a failure to even
      # start it is worth surfacing.
      if [ -n "$OLLAMA_BASE_URL" ]; then
        OLLAMA_HOST_IP=$(echo "$OLLAMA_BASE_URL" | sed -E 's#^https?://##; s#:[0-9]+$##')
        (
          while true; do
            sleep 45
            tailscale --socket=/tmp/tailscaled.sock ping --c=1 --timeout=5s "$OLLAMA_HOST_IP" >/dev/null 2>&1 || true
          done
        ) &
        echo "[tailscale] Started a background keep-alive ping to $OLLAMA_HOST_IP every 45s, to keep the connection warm between Analyze clicks."
      fi
    else
      echo "[tailscale] WARNING: tailscale up failed — continuing without it. Ollama analysis will fail until this is fixed, but the rest of the app is unaffected."
    fi
  else
    echo "[tailscale] WARNING: tailscale binary not available after install attempt — continuing without it."
  fi
else
  echo "[tailscale] TAILSCALE_AUTHKEY not set — skipping, Ollama-based AI analysis will be unavailable."
fi

echo "[tailscale] Starting app..."
exec node server.js
