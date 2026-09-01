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
set -e

if [ -n "$TAILSCALE_AUTHKEY" ]; then
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "[tailscale] Installing tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh || {
      echo "[tailscale] WARNING: install failed — continuing without it."
    }
  fi

  if command -v tailscaled >/dev/null 2>&1; then
    echo "[tailscale] Starting tailscaled..."
    tailscaled --state=/tmp/tailscaled.state --socket=/tmp/tailscaled.sock &

    # Give the daemon a moment to create its socket before the client tries
    # to talk to it.
    sleep 2

    echo "[tailscale] Connecting to tailnet..."
    tailscale --socket=/tmp/tailscaled.sock up --authkey="$TAILSCALE_AUTHKEY" --hostname=brindleaf-backend --accept-routes || {
      echo "[tailscale] WARNING: tailscale up failed — continuing without it. Ollama analysis will fail until this is fixed, but the rest of the app is unaffected."
    }
  else
    echo "[tailscale] WARNING: tailscale binary not available after install attempt — continuing without it."
  fi
else
  echo "[tailscale] TAILSCALE_AUTHKEY not set — skipping, Ollama-based AI analysis will be unavailable."
fi

echo "[tailscale] Starting app..."
exec node server.js
