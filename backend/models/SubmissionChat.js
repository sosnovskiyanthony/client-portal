const { pool } = require("../config/database");

// One row per submission, holding a growing array of chat turns — not the
// pending/processing/completed/failed lifecycle Analysis/EmailDraft use,
// since a conversation doesn't have a single "result" to overwrite. See
// config/database.js's submission_chats table comment for the message shape.
async function findBySubmissionId(submissionId) {
  const { rows } = await pool.query(
    "SELECT * FROM submission_chats WHERE submission_id = $1",
    [submissionId]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

// Creates the row (empty history) if this is the first turn, otherwise
// appends. Done as a single atomic INSERT ... ON CONFLICT DO UPDATE using
// jsonb's `||` array-concat operator, rather than read-then-write in JS —
// avoids a lost-update race if two requests ever land close together.
async function appendMessages(submissionId, newMessages) {
  const { rows } = await pool.query(
    `INSERT INTO submission_chats (submission_id, messages)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (submission_id)
     DO UPDATE SET messages = submission_chats.messages || $2::jsonb, updated_at = now()
     RETURNING *`,
    [submissionId, JSON.stringify(newMessages)]
  );
  return serialize(rows[0]);
}

// Full overwrite — used by regenerate (services/runChat.js's
// regenerateLastReply), which needs to replace one specific message in
// place rather than append. Callers are responsible for computing the full
// next array; this just persists it atomically.
async function setMessages(submissionId, messages) {
  const { rows } = await pool.query(
    `UPDATE submission_chats
     SET messages = $2::jsonb, updated_at = now()
     WHERE submission_id = $1
     RETURNING *`,
    [submissionId, JSON.stringify(messages)]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

function serialize(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    messages: row.messages || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { findBySubmissionId, appendMessages, setMessages };
