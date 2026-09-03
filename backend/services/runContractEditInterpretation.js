// Orchestrates one AI Agreement Editor interpretation attempt — turns an
// admin's plain-English instruction into a structured, reviewable
// proposal (see ai/contractEditSchema.js). Writes nothing: unlike
// runContractReview.js/runContractGeneration.js, there is no contract
// column this result gets saved to here — the proposal is purely
// returned for the admin to approve/reject via
// controllers/contractController.js's applyContractEditChanges, which is
// the only thing that ever writes.
//
// Deliberately DOES throw on failure (the caller classifies it) — same
// convention as runContractReview.js. Unlike that file, though, the
// caller (contractController.interpretContractEditInstruction) does NOT
// await this directly for its HTTP response — it runs this in the
// background and reports the outcome via polling instead (see that
// controller's own comment for why: a real 2026-09 production incident
// showed holding a request open for a slow AI call risks losing the
// response to something ahead of this app cutting the connection first).
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");

async function runContractEditInterpretation(contractId, currentSections, instruction) {
  analysisProgress.start("contract-edit", contractId, { model: aiService.getActiveProviderInfo().model });
  try {
    const outcome = await aiService.interpretContractEditInstruction(currentSections, instruction, {
      onProgress: (stage) => analysisProgress.setStage("contract-edit", contractId, stage),
    });
    return outcome.result;
  } finally {
    analysisProgress.finish("contract-edit", contractId);
  }
}

module.exports = { runContractEditInterpretation };
