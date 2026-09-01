// Shared undici dispatcher for reaching Tailscale peers when this app is
// running in a container without a real network route to them (see
// scripts/start-with-tailscale.sh and ai/README.md's "Confirmed via a real
// deploy" section) — set to the local outbound HTTP proxy tailscaled
// exposes in userspace-networking mode. Used both by ai/providers/
// ollamaProvider.js (talking to Ollama) and adminController.js's
// Ollama-control routes (talking to the control helper on the same
// machine as Ollama) — anything reaching a device on the tailnet needs
// this, nothing else in the app does.
//
// undefined (undici's default direct-connection dispatcher) whenever
// TAILSCALE_HTTP_PROXY isn't set, which is always true in local dev — dev
// machines reach Ollama/the control helper directly, no proxy involved.
const { ProxyAgent } = require("undici");

const tailscaleDispatcher = process.env.TAILSCALE_HTTP_PROXY
  ? new ProxyAgent(process.env.TAILSCALE_HTTP_PROXY)
  : undefined;

module.exports = { tailscaleDispatcher };
