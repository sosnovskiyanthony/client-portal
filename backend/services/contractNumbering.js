// Generates unique, human-readable contract numbers like "CONTRACT-2026-0001".
// Atomic under concurrency via a single upsert-and-increment statement — no
// explicit transaction or app-level locking needed, since Postgres's own
// row-level lock on the UPDATE serializes concurrent callers. This closes
// the exact numbering race condition called out in the feature spec's own
// security checklist (two admins/tabs clicking "Create Contract" at the
// same instant must never receive the same number).
const { pool } = require("../config/database");

async function getNextContractNumber() {
  const year = new Date().getFullYear();
  const { rows } = await pool.query(
    `INSERT INTO contract_number_counters (year, next_number)
     VALUES ($1, 2)
     ON CONFLICT (year) DO UPDATE SET next_number = contract_number_counters.next_number + 1
     RETURNING next_number - 1 AS number`,
    [year]
  );
  const number = rows[0].number;
  return `CONTRACT-${year}-${String(number).padStart(4, "0")}`;
}

module.exports = { getNextContractNumber };
