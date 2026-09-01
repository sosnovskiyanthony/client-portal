// Orchestrates one AI Task 1 (contract completeness/conflict review)
// attempt. Simpler than services/runAnalysis.js's pending/processing/
// completed/failed DB lifecycle — a review's result is "last one wins" on
// the contract itself (see models/Contract.js's review_result column,
// same pattern as scope_snapshot/generated_content), and unlike analysis
// there's no cross-reload "is a request already running" concern to guard
// against, since a review is a single request the same open builder tab
// directly awaits. Progress is still tracked live via
// lib/analysisProgress.js, same UX pattern as analysis/email drafting.
//
// Deliberately DOES throw on failure (unlike runAnalysis.js) — the caller
// (contractController.reviewContract) is awaiting this directly and needs
// a real error to turn into an HTTP response, not a stored "failed"
// review row to reconcile later.
const Contract = require("../models/Contract");
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");
const { buildApprovedContractData } = require("../ai/contractData");

async function runContractReview(contract, selectedFeatures) {
  analysisProgress.start("contract-review", contract.id, { model: aiService.getActiveProviderInfo().model });
  try {
    const approvedData = buildApprovedContractData(contract, selectedFeatures);
    const outcome = await aiService.reviewContract(approvedData, {
      onProgress: (stage) => analysisProgress.setStage("contract-review", contract.id, stage),
    });
    return Contract.setReviewResult(contract.id, outcome.result);
  } finally {
    analysisProgress.finish("contract-review", contract.id);
  }
}

module.exports = { runContractReview };
