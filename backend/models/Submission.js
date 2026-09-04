const { pool } = require("../config/database");

// A real sales pipeline, not just "seen it or not" — lets the admin
// dashboard track a lead all the way through to whether it actually became
// paying work.
const VALID_STATUSES = [
  "new",
  "reviewed",
  "contacted",
  "qualified",
  "discovery",
  "proposal_sent",
  "won",
  "lost",
];

// `services` (array of service slugs — see ai/services.js's SERVICE_SLUGS)
// is optional and only meaningful for the new type: 'services' multi-select
// intake (routes/intake.js); every other caller either omits it or passes
// null, same as before this column existed.
async function create({ type, clientName, email, projectDetails, flexiblePaymentPreference, services }) {
  const { rows } = await pool.query(
    `INSERT INTO submissions (type, client_name, email, project_details, flexible_payment_preference, services, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'new')
     RETURNING *`,
    [
      type,
      clientName || null,
      email || null,
      projectDetails || null,
      flexiblePaymentPreference === undefined ? null : flexiblePaymentPreference,
      Array.isArray(services) && services.length > 0 ? services : null,
    ]
  );
  return serialize(rows[0]);
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM submissions WHERE id = $1", [id]);
  return rows[0] ? serialize(rows[0]) : null;
}

// Admin dashboard page size — kept here (not env-configurable) since it's a
// UI decision, not deployment config.
const PAGE_SIZE = 20;

// Shared by findPage/findAll/count below — `type` filters the existing
// exact-match column (web-design|seo|contact|services|"all"); `service`
// filters the new services array via containment (ai-integration|
// app-building|web-management|web-design|seo — see ai/services.js's
// SERVICE_SLUGS), matching a 'services'-type submission that selected it
// alongside others, OR a legacy web-design/seo submission (backfilled at
// migration time — see config/database.js). Mutually exclusive in the
// admin UI (one filter pill active at a time — frontend/js/admin.js), but
// nothing here assumes that; if both are somehow passed, both apply.
// `search` matches client_name/email with a plain ILIKE, plus
// project_details cast to text — a simple, no-new-index substring match
// (there's no full-text/trigram index on this table), not a ranked or
// tokenized search. Deliberately simple for this table's realistic size
// (a solo business's lead list, not a high-volume table); a plain ILIKE
// against project_details::text can surface a false-positive match against
// a JSON key name rather than a value (e.g. searching "email" matches the
// literal key in every row), which is an accepted tradeoff for not building
// field-aware JSONB search across a field set that varies per service type.
function buildWhereClause({ type, service, search }) {
  const params = [];
  const conditions = [];
  if (type && type !== "all") {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }
  if (service) {
    params.push(service);
    conditions.push(`$${params.length} = ANY(services)`);
  }
  const trimmedSearch = typeof search === "string" ? search.trim() : "";
  if (trimmedSearch) {
    params.push(`%${trimmedSearch}%`);
    const p = params.length;
    conditions.push(`(client_name ILIKE $${p} OR email ILIKE $${p} OR project_details::text ILIKE $${p})`);
  }
  return { whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

// type/service/search: see buildWhereClause above. page: 1-indexed.
async function findPage({ type, service, search, page = 1 } = {}) {
  const { whereClause, params } = buildWhereClause({ type, service, search });

  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  params.push(PAGE_SIZE, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const { rows } = await pool.query(
    `SELECT * FROM submissions ${whereClause} ORDER BY created_at DESC, id DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  return rows.map(serialize);
}

// Unpaginated — used only by the CSV export, which needs every matching row
// at once. findPage() above stays paginated for the dashboard's own list.
async function findAll({ type, service, search } = {}) {
  const { whereClause, params } = buildWhereClause({ type, service, search });
  const { rows } = await pool.query(
    `SELECT * FROM submissions ${whereClause} ORDER BY created_at DESC, id DESC`,
    params
  );
  return rows.map(serialize);
}

async function count({ type, service, search } = {}) {
  const { whereClause, params } = buildWhereClause({ type, service, search });
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM submissions ${whereClause}`, params);
  return rows[0].count;
}

async function updateStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  const { rows } = await pool.query(
    "UPDATE submissions SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [status, id]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

// Used to remove a single attached brand asset from projectDetails.brandAssets
// (adminController.removeAsset) without touching any other field.
async function updateProjectDetails(id, projectDetails) {
  const { rows } = await pool.query(
    "UPDATE submissions SET project_details = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [projectDetails, id]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

// FK ON DELETE CASCADE on project_outcomes/submission_analyses/email_drafts
// (see config/database.js) means this is the only query needed — deleting
// the submission row cleans up every related child row automatically. It
// does NOT touch any attached brand-asset files in Supabase Storage — that
// has to happen before this is called (see adminController.deleteSubmission).
async function deleteById(id) {
  const { rows } = await pool.query("DELETE FROM submissions WHERE id = $1 RETURNING *", [id]);
  return rows[0] ? serialize(rows[0]) : null;
}

// Every brand-asset path any submission currently references — used only by
// services/orphanCleanup.js to tell "still in use" storage objects apart
// from abandoned ones. Reads project_details directly rather than a
// relational table (brandAssets lives in the JSONB column, not its own
// table — see intakeController.js's sanitizeBrandAssets). Unpaginated, same
// reasoning as findAll(): fine at this app's realistic data volume.
async function getAllReferencedAssetPaths() {
  const { rows } = await pool.query("SELECT project_details FROM submissions WHERE project_details IS NOT NULL");
  const paths = new Set();
  for (const row of rows) {
    const assets = row.project_details && row.project_details.brandAssets;
    if (!Array.isArray(assets)) continue;
    for (const a of assets) {
      if (a && typeof a === "object" && typeof a.path === "string") paths.add(a.path);
    }
  }
  return paths;
}

function serialize(row) {
  return {
    id: row.id,
    type: row.type,
    clientName: row.client_name,
    email: row.email,
    projectDetails: row.project_details,
    flexiblePaymentPreference: row.flexible_payment_preference,
    services: row.services || [],
    status: row.status,
    contextVersion: row.context_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  create,
  findById,
  findPage,
  findAll,
  count,
  updateStatus,
  updateProjectDetails,
  deleteById,
  getAllReferencedAssetPaths,
  VALID_STATUSES,
  PAGE_SIZE,
};
