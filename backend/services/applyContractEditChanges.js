// Applies an admin-approved subset of an AI Agreement Editor proposal (see
// ai/contractEditSchema.js, ai/aiService.js's interpretContractEditInstruction)
// to a contract's generated_content — the ONLY place that ever writes as a
// result of that AI operation (see guardian/rules.js's
// ai-contract-edit-propose-only rule). The AI itself never reaches this
// file directly; controllers/contractController.js's
// applyContractEditChanges calls in only after an admin has explicitly
// approved each individual change.
//
// Runs as a single transaction spanning both the contracts row and the new
// contract_versions row, mirroring models/ContractSelectedFeature.js's
// replaceAll() pattern exactly (pool.connect()/BEGIN/COMMIT/ROLLBACK) —
// deliberately NOT reusing Contract.setGeneratedContent/ContractVersion.create,
// since those each acquire and release their own pool connection, which
// would make the two writes non-atomic (a crash between them could persist
// new content with no matching version row, or vice versa).
const { pool } = require("../config/database");
const Contract = require("../models/Contract");

class ContractEditApplyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ContractEditApplyError";
    this.code = code;
  }
}

// changes: array of { type, sectionKey, sectionTitle, proposedText } — the
// admin-approved (and possibly admin-edited, per spec section 26) final
// wording, not necessarily byte-identical to the AI's original proposal.
function applyChangesToSections(currentSections, changes) {
  const sections = currentSections.map((s) => ({ ...s }));

  for (const change of changes) {
    const idx = sections.findIndex((s) => s.key === change.sectionKey);

    if (change.type === "ADD") {
      if (idx !== -1) {
        throw new ContractEditApplyError(
          "section_key_collision",
          `Cannot add section "${change.sectionKey}" — a section with that key already exists. The contract may have changed since this proposal was generated; re-run the interpretation.`
        );
      }
      sections.push({ key: change.sectionKey, title: change.sectionTitle, content: change.proposedText || "" });
      continue;
    }

    if (idx === -1) {
      throw new ContractEditApplyError(
        "section_not_found",
        `Cannot apply a ${change.type} to section "${change.sectionKey}" — it no longer exists on this contract. The contract may have changed since this proposal was generated; re-run the interpretation.`
      );
    }

    if (change.type === "REMOVE") {
      sections.splice(idx, 1);
    } else {
      // MODIFY and AMEND both resolve to "this section's content is now
      // exactly this text" at our data model's granularity (sections have
      // no sub-structure to amend in place) — the distinction is AI-prompt-
      // level guidance (prefer AMEND's framing over ADD), not a different
      // write here.
      sections[idx] = {
        key: change.sectionKey,
        title: change.sectionTitle || sections[idx].title,
        content: change.proposedText || "",
      };
    }
  }

  return sections;
}

async function applyContractEditChanges({ contractId, currentSections, changes, actorUserId }) {
  const newSections = applyChangesToSections(currentSections, changes);
  const content = { sections: newSections };

  const client = await pool.connect();
  let versionRows;
  try {
    await client.query("BEGIN");

    const { rows: contractRows } = await client.query(
      "UPDATE contracts SET generated_content = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [contractId, JSON.stringify(content)]
    );
    if (!contractRows[0]) {
      throw new ContractEditApplyError("contract_not_found", "Contract not found.");
    }

    const { rows: maxRows } = await client.query(
      "SELECT COALESCE(MAX(version_number), 0) AS max_version FROM contract_versions WHERE contract_id = $1",
      [contractId]
    );
    const versionNumber = maxRows[0].max_version + 1;

    ({ rows: versionRows } = await client.query(
      `INSERT INTO contract_versions (contract_id, version_number, source, content, change_note, created_by)
       VALUES ($1, $2, 'ai_assisted_edit', $3, $4, $5)
       RETURNING *`,
      [contractId, versionNumber, JSON.stringify(content), `AI-assisted edit: ${changes.length} change(s) approved`, actorUserId]
    ));

    // Same reasoning as saveContractContent's existing status reset: once
    // content diverges from what was approved, the approval no longer
    // describes what's here.
    await client.query(
      "UPDATE contracts SET status = CASE WHEN status = 'approved' THEN 'ready_for_approval' ELSE status END, updated_at = now() WHERE id = $1",
      [contractId]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Re-read post-commit via the normal model so the returned shape matches
  // every other contract endpoint's serialization exactly, rather than
  // hand-duplicating Contract.serialize/ContractVersion's row->camelCase
  // mapping here.
  const contract = await Contract.findById(contractId);
  const versionRow = versionRows[0];
  const version = {
    id: versionRow.id,
    contractId: versionRow.contract_id,
    versionNumber: versionRow.version_number,
    source: versionRow.source,
    content: versionRow.content,
    changeNote: versionRow.change_note,
    createdBy: versionRow.created_by,
    createdAt: versionRow.created_at,
  };
  return { contract, version, sections: newSections };
}

module.exports = { applyContractEditChanges, applyChangesToSections, ContractEditApplyError };
