const { pool } = require("../config/database");

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

async function create({ severity, eventType, actorType, actorId, source, resourceType, resourceId, description, metadata }) {
  const { rows } = await pool.query(
    `INSERT INTO security_events
       (severity, event_type, actor_type, actor_id, source, resource_type, resource_id, description, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      severity,
      eventType,
      actorType,
      actorId != null ? String(actorId) : null,
      source || null,
      resourceType || null,
      resourceId != null ? String(resourceId) : null,
      description || null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  return serialize(rows[0]);
}

// `limit` is always clamped server-side, never passed through raw to SQL.
async function findRecent(limit = DEFAULT_LIMIT) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const { rows } = await pool.query(
    `SELECT * FROM security_events ORDER BY created_at DESC LIMIT $1`,
    [safeLimit]
  );
  return rows.map(serialize);
}

async function findUnacknowledged({ severity, limit = DEFAULT_LIMIT } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const params = [safeLimit];
  let where = "acknowledged_at IS NULL";
  if (severity) {
    params.push(severity);
    where += ` AND severity = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM security_events WHERE ${where} ORDER BY created_at DESC LIMIT $1`,
    params
  );
  return rows.map(serialize);
}

// Finds the single most recent event of a given severity, regardless of
// acknowledgement — used by aiControl.js to decide whether the latest
// CRITICAL incident still requires acknowledgement before AI can be
// re-enabled (a stale, already-acknowledged CRITICAL event must never
// block re-enabling).
async function findLatestBySeverity(severity) {
  const { rows } = await pool.query(
    `SELECT * FROM security_events WHERE severity = $1 ORDER BY created_at DESC LIMIT 1`,
    [severity]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function countRecentByEventTypes(eventTypes, windowMinutes) {
  if (!Array.isArray(eventTypes) || eventTypes.length === 0) return 0;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM security_events
     WHERE event_type = ANY($1) AND created_at > now() - ($2 || ' minutes')::interval`,
    [eventTypes, String(windowMinutes)]
  );
  return rows[0]?.count || 0;
}

async function acknowledge(id, adminUserId) {
  const { rows } = await pool.query(
    `UPDATE security_events SET acknowledged_at = now(), acknowledged_by = $2
     WHERE id = $1
     RETURNING *`,
    [id, adminUserId]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    severity: row.severity,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    source: row.source,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    description: row.description,
    metadata: row.metadata || null,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    createdAt: row.created_at,
  };
}

module.exports = { create, findRecent, findUnacknowledged, findLatestBySeverity, countRecentByEventTypes, acknowledge };
