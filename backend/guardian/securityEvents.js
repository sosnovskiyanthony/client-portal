// Thin wrapper around models/SecurityEvent.js — mirrors
// services/contractAudit.js's exact pattern: best-effort, fire-and-forget.
// A failed security-event write must never be the reason a real action
// (or its rejection) fails — logging a security event is itself a
// non-critical side effect, same philosophy as contract audit logging.
//
// Serves BOTH the security-incident log (Phase 7 of the spec this was
// built against) and the AI operation audit trail (Phase 8) — deliberately
// the same table at different severities, not two near-duplicate tables.
// Never pass a full prompt/response, a token, or a secret in `metadata` —
// identifiers, short strings, and status fields only.
const SecurityEvent = require("../models/SecurityEvent");
const { sendSecurityAlertEmail } = require("../services/email");

const SEVERITIES = ["INFO", "WARNING", "HIGH", "CRITICAL"];

async function logSecurityEvent({ severity, eventType, actorType, actorId, source, resourceType, resourceId, description, metadata }) {
  if (!SEVERITIES.includes(severity)) {
    console.error(`[securityEvents] Refusing to log with invalid severity "${severity}" (event_type="${eventType}")`);
    return null;
  }

  let event;
  try {
    event = await SecurityEvent.create({
      severity,
      eventType,
      actorType: actorType || "system",
      actorId,
      source,
      resourceType,
      resourceId,
      description,
      metadata,
    });
  } catch (err) {
    console.error(`[securityEvents] Failed to log "${eventType}" (${severity}):`, err.message);
    return null;
  }

  // CRITICAL is the one severity that triggers an immediate email — see
  // guardian/README.md's incident-severity section. Fire-and-forget: an
  // email failure must never affect the caller, and the event already
  // exists in the database (and the admin dashboard) regardless of whether
  // this succeeds.
  if (severity === "CRITICAL") {
    sendSecurityAlertEmail(event).catch((err) => {
      console.error(`[securityEvents] Failed to send alert email for event #${event.id}:`, err.message);
    });
  }

  return event;
}

module.exports = { logSecurityEvent, SEVERITIES };
