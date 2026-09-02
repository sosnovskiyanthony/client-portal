// BrindLeaf Guardian's central AI control plane — the single chokepoint
// every real AI operation in ai/aiService.js passes through before it's
// allowed to reach a provider. See guardian/README.md's "AI trust
// hierarchy" section for the full design; the short version:
//
//   HUMAN / EXTERNAL INFRASTRUCTURE
//     -> Guardian control plane (this file)
//     -> deterministic policy
//     -> application
//     -> AI service
//     -> model
//
// The model is the least-trusted component. It never gets to decide
// whether it's allowed to run — only this file, driven by a database row
// (or an infrastructure-level env var override) that only a human or
// automated deterministic policy (the circuit breaker) ever writes to.
//
// FAIL CLOSED: any error determining the current state — a DB query
// throwing, an unexpected row shape — resolves to DISABLED, never ENABLED.
// There is no cache: every check queries fresh. AI calls in this app are
// inherently slow (multi-second generations), so one extra ~5-50ms
// Postgres query is negligible, and skipping a cache avoids an entire
// class of "serving stale state past a lockdown" bugs.
const { pool } = require("../config/database");
const env = require("../config/env");
const { AiAnalysisError } = require("../ai/errors");
const { logSecurityEvent } = require("./securityEvents");
const SecurityEvent = require("../models/SecurityEvent");

const STATES = ["ENABLED", "DISABLED", "LOCKDOWN"];

// Checked first, unconditionally. Only "false" (the literal string) forces
// DISABLED — anything else (unset, "true", a typo) defers to the database.
// This is the "no website needed, but needs a redeploy" kill switch — see
// guardian/setAiState.js for the faster, no-redeploy alternative.
function envOverrideState() {
  if (env.aiEnabledOverride === "false") {
    return { state: "DISABLED", reason: "Disabled via BRINDLEAF_AI_ENABLED environment variable.", source: "env_override" };
  }
  return null;
}

// The actual, current, authoritative AI state. Never throws — a query
// failure is itself the fail-closed case, not an error the caller has to
// remember to handle specially.
async function getAiState() {
  const override = envOverrideState();
  if (override) return override;

  try {
    const { rows } = await pool.query(
      `SELECT state, reason, source, created_at FROM ai_control_state ORDER BY created_at DESC LIMIT 1`
    );
    const row = rows[0];
    if (!row || !STATES.includes(row.state)) {
      // Empty table only happens before the boot-time seed row exists
      // (shouldn't happen in practice — see config/database.js's init()) —
      // treat exactly like a query failure: unknown state, fail closed.
      return { state: "DISABLED", reason: "AI control state is unknown (no valid state row found).", source: "system" };
    }
    return { state: row.state, reason: row.reason, source: row.source, since: row.created_at };
  } catch (err) {
    return { state: "DISABLED", reason: "AI control state is unknown (control database unreachable).", source: "system" };
  }
}

// Writes a new state row (append-only — never UPDATEs a prior row) and logs
// a security event. Re-enabling is deliberately harder than disabling: it's
// refused if the most recent CRITICAL event is still unacknowledged — an
// automatic circuit-breaker lockdown can't be silently waved away by
// clicking "enable" without first acknowledging why it happened.
async function setAiState({ state, reason, source, actorUserId }) {
  if (!STATES.includes(state)) {
    throw new Error(`Invalid AI control state "${state}". Expected one of: ${STATES.join(", ")}.`);
  }

  if (state === "ENABLED") {
    const latestCritical = await SecurityEvent.findLatestBySeverity("CRITICAL");
    if (latestCritical && !latestCritical.acknowledgedAt) {
      const err = new Error(
        `AI cannot be re-enabled: a CRITICAL security event (#${latestCritical.id}, "${latestCritical.eventType}") has not been acknowledged yet.`
      );
      err.code = "unacknowledged_critical_event";
      err.blockingEvent = latestCritical;
      throw err;
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO ai_control_state (state, reason, source, actor_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, state, reason, source, created_at`,
    [state, reason || null, source || "admin", actorUserId || null]
  );
  const row = rows[0];

  await logSecurityEvent({
    severity: state === "ENABLED" ? "INFO" : state === "LOCKDOWN" ? "CRITICAL" : "WARNING",
    eventType: `ai_state_changed_to_${state.toLowerCase()}`,
    actorType: source === "circuit_breaker" ? "system" : source === "env_override" ? "infrastructure" : "admin",
    actorId: actorUserId || source,
    source: "aiControl",
    description: reason || `AI state set to ${state}.`,
    metadata: { previousCheckSource: source },
  });

  return { state: row.state, reason: row.reason, source: row.source, since: row.created_at };
}

// The actual chokepoint — called as the first line of every real AI
// operation in ai/aiService.js. Throws a typed AiAnalysisError (never
// pretends the operation succeeded) when AI isn't ENABLED; the caller
// (every controller in this app) already knows how to turn an
// AiAnalysisError into a clean HTTP response.
async function assertAiAllowed(operationName) {
  const current = await getAiState();
  if (current.state === "ENABLED") return;

  // Logged at INFO for an expected/routine DISABLED (env override or a
  // deliberate admin action), WARNING for LOCKDOWN (unexpected, should
  // draw attention) — cheap at this app's actual traffic volume, and gives
  // a real, queryable record of every AI call that was blocked and why.
  await logSecurityEvent({
    severity: current.state === "LOCKDOWN" ? "WARNING" : "INFO",
    eventType: "ai_operation_blocked",
    actorType: "ai_caller",
    source: "aiControl",
    resourceType: "ai_operation",
    resourceId: operationName,
    description: `Blocked "${operationName}" — AI state is ${current.state}.`,
    metadata: { state: current.state, reason: current.reason },
  });

  throw new AiAnalysisError(
    current.state === "LOCKDOWN" ? "ai_lockdown" : "ai_disabled",
    `AI is currently ${current.state}${current.reason ? ` (${current.reason})` : ""}.`
  );
}

module.exports = { STATES, getAiState, setAiState, assertAiAllowed };
