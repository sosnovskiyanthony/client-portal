const { pool } = require("../config/database");

async function findAllByContractId(contractId) {
  const { rows } = await pool.query(
    "SELECT * FROM contract_selected_features WHERE contract_id = $1 ORDER BY category, sort_order, id",
    [contractId]
  );
  return rows.map(serialize);
}

// Replaces the entire selected-feature set for a contract in one
// transaction — the builder's "Scope of Work" checklist saves as a whole
// set each time (check/uncheck any box, save), not incrementally, so a
// delete-then-bulk-insert is both simpler and correct here. Runs inside a
// transaction so a mid-save failure can never leave a contract with a
// partially-replaced scope.
async function replaceAll(contractId, features) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM contract_selected_features WHERE contract_id = $1", [contractId]);

    let sortOrder = 0;
    const inserted = [];
    for (const f of features) {
      const { rows } = await client.query(
        `INSERT INTO contract_selected_features
           (contract_id, feature_id, is_custom, category, name, description, wording, price, notes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          contractId,
          f.featureId || null,
          Boolean(f.isCustom),
          f.category,
          f.name,
          f.description || null,
          f.wording || null,
          f.price ?? null,
          f.notes || null,
          sortOrder,
        ]
      );
      inserted.push(serialize(rows[0]));
      sortOrder += 1;
    }

    await client.query("COMMIT");
    return inserted;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Adds one custom feature without disturbing the existing selection —
// used by the "+ Add Custom Feature" action, distinct from replaceAll's
// bulk-save-the-whole-checklist behavior.
async function addOne(contractId, feature) {
  const { rows: sortRows } = await pool.query(
    "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM contract_selected_features WHERE contract_id = $1",
    [contractId]
  );
  const { rows } = await pool.query(
    `INSERT INTO contract_selected_features
       (contract_id, feature_id, is_custom, category, name, description, wording, price, notes, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      contractId,
      feature.featureId || null,
      Boolean(feature.isCustom),
      feature.category || "Custom",
      feature.name,
      feature.description || null,
      feature.wording || null,
      feature.price ?? null,
      feature.notes || null,
      sortRows[0].max_sort + 1,
    ]
  );
  return serialize(rows[0]);
}

async function removeOne(contractId, rowId) {
  await pool.query(
    "DELETE FROM contract_selected_features WHERE id = $1 AND contract_id = $2",
    [rowId, contractId]
  );
}

function serialize(row) {
  return {
    id: row.id,
    contractId: row.contract_id,
    featureId: row.feature_id,
    isCustom: row.is_custom,
    category: row.category,
    name: row.name,
    description: row.description,
    wording: row.wording,
    price: row.price === null ? null : Number(row.price),
    notes: row.notes,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

module.exports = { findAllByContractId, replaceAll, addOne, removeOne };
