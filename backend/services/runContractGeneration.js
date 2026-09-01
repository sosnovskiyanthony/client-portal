// Orchestrates one AI Task 2 (contract drafting) attempt. Same shape as
// services/runContractReview.js — throws on failure rather than swallowing
// it, since the caller (contractController.generateContract) is awaiting
// this directly. On success: saves the draft to contracts.generated_content,
// records a new 'ai_generated' contract_versions row (version history is
// never overwritten — see models/ContractVersion.js), snapshots the scope
// that was actually sent, and ALWAYS sets status to 'ready_for_approval' —
// not just the first time. Caught in review: an earlier version only did
// this when status was still 'draft', which meant regenerating a NEW draft
// after an admin had already approved an earlier one left status stuck at
// 'approved' with content nobody had actually reviewed — finalize would
// then snapshot that unreviewed draft as authoritative, silently bypassing
// the human-approval-before-finalization requirement the whole feature is
// built around. Every successful generation now requires fresh approval,
// regardless of what state the contract was in before.
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
    await Contract.setGeneratedContent(contract.id, outcome.result);
    await ContractVersion.create({
      contractId: contract.id,
      source: "ai_generated",
      content: outcome.result,
      createdBy: actorUserId,
    });
    return Contract.updateStatus(contract.id, "ready_for_approval");
  } finally {
    analysisProgress.finish("contract-generate", contract.id);
  }
}

module.exports = { runContractGeneration };
