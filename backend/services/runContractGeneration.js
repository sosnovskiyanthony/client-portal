// Orchestrates one AI Task 2 (contract drafting) attempt. Same shape as
// services/runContractReview.js — throws on failure rather than swallowing
// it, since the caller (contractController.generateContract) is awaiting
// this directly. On success: saves the draft to contracts.generated_content,
// records a new 'ai_generated' contract_versions row (version history is
// never overwritten — see models/ContractVersion.js), snapshots the scope
// that was actually sent, and advances status to 'ready_for_approval' — a
// completed AI draft is exactly the point at which an admin needs to
// review it, not before and not automatically further than that (approval
// itself is always a separate, explicit admin action — see phase 8).
const Contract = require("../models/Contract");
const ContractVersion = require("../models/ContractVersion");
const ContractTemplate = require("../models/ContractTemplate");
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");
const { buildApprovedContractData } = require("../ai/contractData");
const { AiAnalysisError } = require("../ai/errors");

async function runContractGeneration(contract, selectedFeatures, actorUserId) {
  const template = await ContractTemplate.findActive();
  if (!template) {
    throw new AiAnalysisError("no_template", "No active contract template is configured.");
  }

  analysisProgress.start("contract-generate", contract.id, { model: aiService.getActiveProviderInfo().model });
  try {
    const approvedData = buildApprovedContractData(contract, selectedFeatures);
    const outcome = await aiService.generateContract(approvedData, template.sections, {
      onProgress: (stage) => analysisProgress.setStage("contract-generate", contract.id, stage),
    });

    await Contract.setScopeSnapshot(contract.id, approvedData.scope_of_work);
    const updated = await Contract.setGeneratedContent(contract.id, outcome.result);
    await ContractVersion.create({
      contractId: contract.id,
      source: "ai_generated",
      content: outcome.result,
      createdBy: actorUserId,
    });
    return updated.status === "draft" ? await Contract.updateStatus(contract.id, "ready_for_approval") : updated;
  } finally {
    analysisProgress.finish("contract-generate", contract.id);
  }
}

module.exports = { runContractGeneration };
