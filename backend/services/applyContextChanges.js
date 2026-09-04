// Applies an admin-approved subset of an "Add Context" interpretation (see
// ai/contextInterpretSchema.js, ai/aiService.js's interpretSubmissionContext)
// to a submission's admin-added context — the ONLY place that ever writes
// as a result of that AI operation (see guardian/rules.js's
// ai-context-interpret-propose-only rule). The AI itself never reaches
// this file directly; controllers/adminController.js's applyContextChanges
// calls in only after an admin has explicitly approved each individual
// change.
//
// Runs as a single transaction spanning submission_context_facts,
// submission_context_changes, and submissions.context_version — mirroring
// services/applyContractEditChanges.js's exact pattern (pool.connect()/
// BEGIN/COMMIT/ROLLBACK), for the same reason: these three writes must
// never be allowed to partially land.
const { pool } = require("../config/database");
const Submission = require("../models/Submission");
const SubmissionContextChange = require("../models/SubmissionContextChange");

class ContextApplyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ContextApplyError";
    this.code = code;
  }
}

async function applyContextChanges({ submissionId, changeRecordId, approvedChanges, rawInstruction, actorUserId }) {
  const client = await pool.connect();
  let newContextVersion;
  try {
    await client.query("BEGIN");

    const { rows: submissionRows } = await client.query("SELECT context_version FROM submissions WHERE id = $1 FOR UPDATE", [submissionId]);
    if (!submissionRows[0]) {
      throw new ContextApplyError("submission_not_found", "Submission not found.");
    }

    for (const change of approvedChanges) {
      const { rows: activeRows } = await client.query(
        "SELECT id FROM submission_context_facts WHERE submission_id = $1 AND category = $2 AND field = $3 AND superseded_at IS NULL",
        [submissionId, change.category, change.field]
      );
      const activeId = activeRows[0]?.id || null;

      if (change.action === "ADD") {
        if (activeId) {
          throw new ContextApplyError(
            "field_already_active",
            `Cannot add "${change.category}.${change.field}" — an active fact already exists for it. The project context may have changed since this proposal was generated; re-run the interpretation.`
          );
        }
        await client.query(
          `INSERT INTO submission_context_facts (submission_id, category, field, value, source, source_text, confidence, created_by)
           VALUES ($1, $2, $3, $4, 'admin_context', $5, $6, $7)`,
          [submissionId, change.category, change.field, change.proposedValue, rawInstruction || null, change.confidence, actorUserId]
        );
      } else {
        if (!activeId) {
          throw new ContextApplyError(
            "field_not_found",
            `Cannot apply a ${change.action} to "${change.category}.${change.field}" — no active fact exists for it. The project context may have changed since this proposal was generated; re-run the interpretation.`
          );
        }
        await client.query("UPDATE submission_context_facts SET superseded_at = now() WHERE id = $1", [activeId]);
        if (change.action === "MODIFY") {
          await client.query(
            `INSERT INTO submission_context_facts (submission_id, category, field, value, source, source_text, confidence, created_by)
             VALUES ($1, $2, $3, $4, 'admin_context', $5, $6, $7)`,
            [submissionId, change.category, change.field, change.proposedValue, rawInstruction || null, change.confidence, actorUserId]
          );
        }
        // REMOVE: superseding with no replacement row is the entire operation.
      }
    }

    newContextVersion = submissionRows[0].context_version + 1;
    await client.query("UPDATE submissions SET context_version = $2, updated_at = now() WHERE id = $1", [submissionId, newContextVersion]);

    await client.query(
      `UPDATE submission_context_changes
       SET approved_changes = $2, status = 'applied', resulting_context_version = $3, applied_by = $4, applied_at = now()
       WHERE id = $1 AND status = 'pending_review'`,
      [changeRecordId, JSON.stringify(approvedChanges), newContextVersion, actorUserId]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const submission = await Submission.findById(submissionId);
  const changeRecord = await SubmissionContextChange.findById(changeRecordId);
  return { submission, changeRecord, contextVersion: newContextVersion };
}

module.exports = { applyContextChanges, ContextApplyError };
