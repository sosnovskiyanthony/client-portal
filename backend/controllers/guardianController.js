// Production-side Guardian: lightweight, admin-triggered deep diagnostics
// (DB / Supabase storage / Ollama / Resend / Tavily) plus a short history —
// NOT the CI-time deterministic checks (tests/lint/coverage/audit/CodeQL/
// secrets), which only ever run in GitHub Actions or locally (see
// guardian/README.md for why: no git history on the deployed Railway
// container, and `npm ci --omit=dev` in production means devDependencies
// like eslint aren't even installed there).
//
// Mounted under the existing JWT-protected admin router (routes/admin.js
// already applies authenticate+requireAdmin once at the top) — no second
// auth system.
const { pool } = require("../config/database");
const env = require("../config/env");
const storage = require("../services/storage");
const GuardianCheck = require("../models/GuardianCheck");
const SecurityEvent = require("../models/SecurityEvent");
const aiControl = require("../guardian/aiControl");
const { tailscaleDispatcher } = require("../lib/tailscaleDispatcher");

// Every dependency check returns one of these — distinct meanings, per
// guardian/README.md: HEALTHY (working normally), WARNING (degraded but not
// broken), FAILED (a real, mandatory-thing-is-broken problem), UNAVAILABLE
// (configured but currently unreachable — expected/normal for Ollama, which
// intentionally runs on the owner's local machine), NOT_CONFIGURED (an
// optional integration simply isn't set up).
const STATUS = {
  HEALTHY: "HEALTHY",
  WARNING: "WARNING",
  FAILED: "FAILED",
  UNAVAILABLE: "UNAVAILABLE",
  NOT_CONFIGURED: "NOT_CONFIGURED",
};

async function checkDatabase() {
  try {
    await pool.query("SELECT 1");
    return { configured: true, reachable: true, status: STATUS.HEALTHY };
  } catch (err) {
    return { configured: true, reachable: false, status: STATUS.FAILED, detail: "Database query failed." };
  }
}

async function checkStorage() {
  if (!storage.isConfigured()) {
    return { configured: false, reachable: false, status: STATUS.NOT_CONFIGURED };
  }
  try {
    // Lightweight existence check only — lists at most a handful of
    // objects, never uploads/deletes/downloads anything.
    await storage.listAllFiles();
    return { configured: true, reachable: true, status: STATUS.HEALTHY };
  } catch (err) {
    return { configured: true, reachable: false, status: STATUS.UNAVAILABLE, detail: "Could not reach Supabase Storage." };
  }
}

// Ollama always has a base URL (defaults to localhost) so "configured" is
// always true here — the meaningful signal is reachability. A short timeout
// and the cheapest possible endpoint (list local models, no generation).
async function checkOllama() {
  try {
    const res = await fetch(`${env.ollamaBaseUrl}/api/tags`, {
      dispatcher: tailscaleDispatcher,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { configured: true, reachable: false, status: STATUS.UNAVAILABLE, detail: `Ollama returned HTTP ${res.status}.` };
    }
    return { configured: true, reachable: true, status: STATUS.HEALTHY };
  } catch (err) {
    // Expected/normal — Ollama runs on the owner's local machine and is
    // understood to be intermittently offline by design (see
    // guardian/rules.js's no-ollama-hard-dependency rule).
    return { configured: true, reachable: false, status: STATUS.UNAVAILABLE, detail: "Could not reach Ollama." };
  }
}

// Never sends a real email to verify Resend — that would be an expensive,
// side-effecting "health check." Configured-or-not is the only signal here.
function checkResend() {
  const configured = Boolean(env.resendApiKey && env.notifyEmail);
  return { configured, reachable: null, status: configured ? STATUS.HEALTHY : STATUS.NOT_CONFIGURED };
}

// Same reasoning as Resend — configured-or-not only, matching
// ai/aiService.js's isResearchAvailable() pattern.
function checkTavily() {
  const configured = Boolean(env.tavilyApiKey);
  return { configured, reachable: null, status: configured ? STATUS.HEALTHY : STATUS.NOT_CONFIGURED };
}

// Database is the only mandatory dependency — everything else degrading is
// a WARNING, never a FAILED, matching guardian/rules.js's
// graceful-degradation rule (Ollama/Resend/Tavily/Storage are all allowed
// to be offline without the application itself being "broken").
function computeOverall(diagnostics) {
  if (diagnostics.database.status === STATUS.FAILED) return STATUS.FAILED;
  const degraded = [diagnostics.storage, diagnostics.ollama, diagnostics.resend, diagnostics.tavily].some(
    (d) => d.status === STATUS.UNAVAILABLE || d.status === STATUS.NOT_CONFIGURED
  );
  return degraded ? STATUS.WARNING : STATUS.HEALTHY;
}

async function runDiagnostics() {
  const [database, storageStatus, ollama] = await Promise.all([checkDatabase(), checkStorage(), checkOllama()]);
  const resend = checkResend();
  const tavily = checkTavily();
  const diagnostics = { database, storage: storageStatus, ollama, resend, tavily };
  return { ...diagnostics, overall: computeOverall(diagnostics) };
}

async function getDiagnostics(req, res) {
  const diagnostics = await runDiagnostics();
  res.json(diagnostics);
}

async function runGuardianCheck(req, res) {
  const start = Date.now();
  const diagnostics = await runDiagnostics();
  const durationMs = Date.now() - start;

  const summary = `Guardian diagnostics: ${diagnostics.overall}. ` +
    Object.entries({ database: diagnostics.database, storage: diagnostics.storage, ollama: diagnostics.ollama, resend: diagnostics.resend, tavily: diagnostics.tavily })
      .map(([name, d]) => `${name}=${d.status}`)
      .join(", ");

  const row = await GuardianCheck.create({
    checkType: "diagnostics",
    status: diagnostics.overall,
    summary,
    commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
    findings: diagnostics,
    durationMs,
  });

  res.json(row);
}

async function getGuardianHistory(req, res) {
  const rows = await GuardianCheck.findRecent(req.query.limit);
  res.json({ history: rows });
}

// AI safety control plane surface — see guardian/aiControl.js for the
// actual chokepoint every AI operation passes through. These endpoints
// only ever write via aiControl.setAiState() (never directly to the
// table), so the same "blocked while an unacknowledged CRITICAL event
// exists" and audit-logging behavior applies here exactly as it does to
// guardian/setAiState.js's CLI path.
async function getAiControlState(req, res) {
  const state = await aiControl.getAiState();
  res.json(state);
}

async function disableAi(req, res) {
  const { reason } = req.body || {};
  const result = await aiControl.setAiState({
    state: "DISABLED",
    reason: reason || "Disabled from the admin dashboard.",
    source: "admin",
    actorUserId: req.user?.sub,
  });
  res.json(result);
}

async function lockdownAi(req, res) {
  const { reason } = req.body || {};
  const result = await aiControl.setAiState({
    state: "LOCKDOWN",
    reason: reason || "Manually locked down from the admin dashboard.",
    source: "admin",
    actorUserId: req.user?.sub,
  });
  res.json(result);
}

// Deliberately the one control action that can fail with a specific,
// actionable error (see aiControl.js's setAiState) — an unacknowledged
// CRITICAL event blocks this, and the response includes which event is
// blocking it so the admin UI can link straight to it.
async function enableAi(req, res) {
  const { reason } = req.body || {};
  try {
    const result = await aiControl.setAiState({
      state: "ENABLED",
      reason: reason || "Re-enabled from the admin dashboard.",
      source: "admin",
      actorUserId: req.user?.sub,
    });
    res.json(result);
  } catch (err) {
    if (err.code === "unacknowledged_critical_event") {
      return res.status(409).json({ error: err.message, blockingEvent: err.blockingEvent });
    }
    throw err;
  }
}

async function getSecurityEvents(req, res) {
  const rows = req.query.unacknowledgedOnly === "true"
    ? await SecurityEvent.findUnacknowledged({ limit: req.query.limit })
    : await SecurityEvent.findRecent(req.query.limit);
  res.json({ events: rows });
}

async function acknowledgeSecurityEvent(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid event id." });
  }
  const event = await SecurityEvent.acknowledge(id, req.user?.sub);
  if (!event) {
    return res.status(404).json({ error: "Security event not found." });
  }
  res.json(event);
}

module.exports = {
  getDiagnostics,
  runGuardianCheck,
  getGuardianHistory,
  getAiControlState,
  disableAi,
  lockdownAi,
  enableAi,
  getSecurityEvents,
  acknowledgeSecurityEvent,
  STATUS,
};
