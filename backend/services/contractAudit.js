// Thin wrapper around models/ContractAuditLog.js — every meaningful
// contract action (created/updated/reviewed/generated/edited/approved/
// finalized/pdf generated/emailed/status changed) calls logAction() from
// contractController.js. Best-effort: audit logging must never be the
// reason a real action fails, matching this codebase's existing philosophy
// for non-critical side effects (see services/orphanCleanup.js's error
// handling) — a failed audit write is logged server-side and swallowed,
// never surfaced to the admin or allowed to roll back the action itself.
const ContractAuditLog = require("../models/ContractAuditLog");

async function logAction(contractId, action, actorUserId, details) {
  try {
    await ContractAuditLog.create({ contractId, action, actorUserId, details });
  } catch (err) {
    console.error(`[contractAudit] Failed to log "${action}" for contract #${contractId}:`, err.message);
  }
}

module.exports = { logAction };
