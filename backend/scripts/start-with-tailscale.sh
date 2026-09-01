#!/bin/sh
# Only used in production (Railway) — see nixpacks.toml's [start] override.
# Local dev keeps using `npm start` / `node server.js` directly, untouched.
#
# Brings this container onto the same private Tailscale network as the
# machine running Ollama (see ai/README.md's "self-hosted Ollama behind a
# private tunnel" production option), then hands off to the actual app.
# TAILSCALE_AUTHKEY must be set in Railway — generate one at
# https://login.tailscale.com/admin/settings/keys (a reusable key tagged for
# this service is reasonable; an ephemeral one works too but re-authenticates
# on every deploy).
set -e

if [ -n "$TAILSCALE_AUTHKEY" ]; then
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
  echo "[tailscale] TAILSCALE_AUTHKEY not set — skipping, Ollama-based AI analysis will be unavailable."
fi

echo "[tailscale] Starting app..."
exec node server.js
