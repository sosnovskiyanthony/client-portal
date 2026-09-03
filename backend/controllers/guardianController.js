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
const { checkIntegrity } = require("../guardian/integrityCheck");
const railwayStatus = require("../guardian/railwayStatus");
const githubStatus = require("../guardian/githubStatus");
const sentryStatus = require("../guardian/sentryStatus");
const { CATEGORIES, sourcesForCategory, categoryForEvent } = require("../guardian/eventCategory");

// Every dependency check returns one of these — distinct meanings, per
// guardian/README.md: HEALTHY (working normally), WARNING (degraded but not
// broken), FAILED (a real, mandatory-thing-is-broken problem), UNAVAILABLE
// (configured but currently unreachable — expected/normal for Ollama, which
// intentionally runs on the owner's local machine), NOT_CONFIGURED (an
// optional integration simply isn't set up). CRITICAL is a distinct, more
// severe tier added for the Security Center (2026-09-03): a security-
// specific incident (AI lockdown, integrity-manifest drift), not a plain
// infrastructure failure — kept separate from FAILED so the two read
// differently on the status banner. Every value here must have a matching
// entry wherever a UI derives a CSS class/label from a status string
// (frontend/js/security.js's STATUS_LABELS) — a value present here but
// missing there fails visibly (falls back to a plain "Unknown" label)
// rather than silently, but keep them in sync regardless.
const STATUS = {
  HEALTHY: "HEALTHY",
  WARNING: "WARNING",
  FAILED: "FAILED",
  CRITICAL: "CRITICAL",
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

// --- Security Center (2026-09-03) ---
//
// Everything below is a thin adapter over the systems above — no second
// Guardian, no second event log, no second AI control plane. This is the
// aggregate "top of page" endpoint the Security Center polls once instead
// of separately hitting /guardian/diagnostics, /guardian/ai/state, and
// three external APIs on every tick (see "avoid excessive requests" in
// guardian/README.md's Security Center section).

function shortSha(sha) {
  return typeof sha === "string" ? sha.slice(0, 7) : null;
}

// The only per-system statuses this app can derive real evidence for
// without a Sentry client-error signal are the server-side ones already
// covered by runDiagnostics() above, plus the three external
// integrations. "Frontend" specifically has no direct signal unless
// Sentry is configured and tagging browser errors (see
// controllers/errorController.js) — reported as NOT_CONFIGURED rather
// than a guessed HEALTHY when Sentry isn't set up, per this feature's
// one hard rule: never claim healthy without evidence.
function computeFrontendStatus(sentry) {
  if (!sentry.configured) {
    return { status: STATUS.NOT_CONFIGURED, detail: "No error monitoring configured — set SENTRY_DSN and SENTRY_AUTH_TOKEN to see real browser error status." };
  }
  if (!sentry.available) {
    return { status: STATUS.UNAVAILABLE, detail: sentry.detail };
  }
  if (sentry.browserUnresolvedShown > 0) {
    return { status: STATUS.WARNING, detail: `${sentry.browserUnresolvedShown}${sentry.browserUnresolvedHasMore ? "+" : ""} unresolved browser error(s) in Sentry.` };
  }
  return { status: STATUS.HEALTHY, detail: "No unresolved browser errors in Sentry." };
}

function externalIntegrationStatus(result) {
  if (!result.configured) return { status: STATUS.NOT_CONFIGURED };
  if (!result.available) return { status: STATUS.UNAVAILABLE, detail: result.detail };
  return { status: STATUS.HEALTHY };
}

// AI's own status folds in the kill switch state, not just Ollama
// reachability — DISABLED/LOCKDOWN is a deliberate state, not a failure,
// but it's not "healthy and operating" either, and the two must read
// differently on the status banner.
function computeAiStatus(aiState, ollamaDiagnostic) {
  if (aiState.state === "LOCKDOWN") return { status: STATUS.CRITICAL, detail: aiState.reason };
  if (aiState.state === "DISABLED") return { status: STATUS.WARNING, detail: aiState.reason || "AI is disabled." };
  return { status: ollamaDiagnostic.status === STATUS.HEALTHY ? STATUS.HEALTHY : STATUS.WARNING, detail: ollamaDiagnostic.detail };
}

// Only rolls FAILED/CRITICAL up to the overall banner — an unconfigured or
// unreachable optional integration (Railway/GitHub/Sentry, or Ollama/
// Resend/Tavily via the existing computeOverall above) stays a WARNING at
// most, matching this app's existing graceful-degradation philosophy
// rather than inventing a stricter standard for the new panels alone.
function computeSecurityOverall(systems, aiState) {
  const values = Object.values(systems).map((s) => s.status);
  if (aiState.state === "LOCKDOWN" || values.includes(STATUS.CRITICAL)) return STATUS.CRITICAL;
  if (values.includes(STATUS.FAILED)) return STATUS.FAILED;
  if (values.includes(STATUS.WARNING) || values.includes(STATUS.UNAVAILABLE) || aiState.state === "DISABLED") return STATUS.WARNING;
  return STATUS.HEALTHY;
}

async function getSecurityStatus(req, res) {
  const [diagnostics, aiState, railway, github, sentry] = await Promise.all([
    runDiagnostics(),
    aiControl.getAiState(),
    railwayStatus.getCurrentDeploymentStatus(),
    githubStatus.isConfigured() ? githubStatus.getWorkflowRunsForCommit(process.env.RAILWAY_GIT_COMMIT_SHA) : { configured: false, available: false },
    sentryStatus.getIssueSummary(),
  ]);

  const integrity = checkIntegrity();
  const commitSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null;

  const systems = {
    backend: { status: STATUS.HEALTHY }, // this response existing at all proves it
    database: { status: diagnostics.database.status, detail: diagnostics.database.detail },
    storage: { status: diagnostics.storage.status, detail: diagnostics.storage.detail },
    ai: computeAiStatus(aiState, diagnostics.ollama),
    guardian: { status: integrity.ok ? STATUS.HEALTHY : STATUS.CRITICAL, detail: integrity.ok ? null : `${integrity.drifted.length} file(s) modified, ${integrity.missing.length} missing.` },
    integrity: { status: integrity.ok ? STATUS.HEALTHY : STATUS.CRITICAL },
    ollama: { status: diagnostics.ollama.status, detail: diagnostics.ollama.detail },
    resend: { status: diagnostics.resend.status },
    tavily: { status: diagnostics.tavily.status },
    railway: externalIntegrationStatus(railway),
    github: externalIntegrationStatus(github),
    sentry: externalIntegrationStatus(sentry),
    frontend: computeFrontendStatus(sentry),
  };

  res.json({
    overall: computeSecurityOverall(systems, aiState),
    systems,
    version: {
      commitSha,
      shortSha: shortSha(commitSha),
      branch: process.env.RAILWAY_GIT_BRANCH || null,
      environment: process.env.NODE_ENV || "development",
      // Deliberately never labeled "version" — package.json's own field
      // isn't a real release identifier for this app (never bumped per
      // release; see guardian/README.md's Security Center section for
      // why this shows the commit, not a fabricated semver).
      packageJsonVersion: require("../package.json").version,
      integrityOk: integrity.ok,
    },
    versionConsistency: {
      git: commitSha,
      railway: railway.available ? railway.commitSha : null,
      runningApplication: commitSha,
      integrity: integrity.ok ? "PASS" : "FAIL",
      consistent: !railway.available || railway.commitSha === commitSha,
    },
    aiControl: aiState,
    railway,
    github,
    sentry,
  });
}

// Activity feed — filters/pagination live entirely in the model
// (SecurityEvent.findPage) and the category->source translation
// (guardian/eventCategory.js); this is just query-param parsing.
async function getSecurityEventsPage(req, res) {
  const { severity, category, source, eventType, from, to, resolved, limit, cursorCreatedAt, cursorId } = req.query;

  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(", ")}` });
  }

  let sources;
  if (category) sources = sourcesForCategory(category);
  else if (source) sources = [source];

  const cursor = cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: Number(cursorId) } : null;
  const resolvedFilter = resolved === "true" ? true : resolved === "false" ? false : undefined;

  const page = await SecurityEvent.findPage({
    severity: severity || undefined,
    sources,
    eventType: eventType || undefined,
    from: from || undefined,
    to: to || undefined,
    resolved: resolvedFilter,
    cursor,
    limit,
  });

  res.json({
    events: page.events.map((e) => ({ ...e, category: categoryForEvent({ source: e.source, eventType: e.eventType }) })),
    nextCursor: page.nextCursor,
  });
}

// Deployment history + (where the commit's CI status is known) a
// correlated GitHub Actions result per deployment — the "what changed /
// did it pass" view. GitHub calls here are per-deployment, so this is
// deliberately NOT polled — the frontend calls it once when the
// deployment-history section is actually opened, not on every tick.
async function getDeploymentHistory(req, res) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const railway = await railwayStatus.getDeploymentHistory(limit);
  if (!railway.available) {
    return res.json({ railway, deployments: [] });
  }

  const deployments = await Promise.all(
    railway.deployments.map(async (d) => {
      if (!githubStatus.isConfigured()) return { ...d, ci: { configured: false } };
      // Railway's deployment list doesn't include the commit SHA per
      // entry (confirmed against its docs — see guardian/railwayStatus.js)
      // — CI correlation is only available for the CURRENT deployment,
      // where the SHA is known from this process's own env, not for every
      // historical entry. Older entries show ci: {configured:true,
      // available:false} honestly rather than a guessed status.
      if (d.id !== process.env.RAILWAY_DEPLOYMENT_ID) return { ...d, ci: { configured: true, available: false, detail: "CI status is only available for the current deployment." } };
      const ci = await githubStatus.getWorkflowRunsForCommit(process.env.RAILWAY_GIT_COMMIT_SHA);
      return { ...d, ci };
    })
  );

  res.json({ railway: { configured: true, available: true }, deployments });
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
  getSecurityStatus,
  getSecurityEventsPage,
  getDeploymentHistory,
  STATUS,
};
