// Orchestrates one AI Pricing & Offer Strategy generation attempt —
// pending -> processing -> completed/failed, same lifecycle as
// services/runAnalysis.js, but against the append-only
// submission_pricing_versions table instead of a single overwritten row
// (see config/database.js's comment on why pricing history has to be
// preserved). Callable two ways: manually (adminController.
// generatePricingStrategy, an admin-triggered "Recalculate Pricing"), or
// automatically right after services/runContextReanalysis.js produces a
// fresh analysis — see that file's own chaining call. Either way this is
// the ONLY thing that ever writes a pricing version; ai/aiService.js's
// generatePricingStrategy is advisory-output-only (see guardian/rules.js's
// pricing-strategy-advisory-only rule) and never touches the database
// itself.
const aiService = require("../ai/aiService");
const { AiAnalysisError } = require("../ai/errors");
const { PRICING_PROMPT_VERSION } = require("../ai/pricingPrompt");
const analysisProgress = require("../lib/analysisProgress");
const PricingVersion = require("../models/PricingVersion");
const { buildCurrentContext } = require("./runContextInterpretation");

// Recorded via analysisProgress.complete() (success AND failure), same
// reasoning as services/runContextReanalysis.js: a failed background
// pricing run must never just vanish into a server log while the
// dashboard silently keeps showing an older (or no) pricing version with
// no explanation.
async function runPricingStrategy(submission, analysisResult) {
  const { provider, model } = aiService.getActiveProviderInfo();
  analysisProgress.start("pricing", submission.id, { model });

  let pricingVersion;
  try {
    pricingVersion = await PricingVersion.createPending(submission.id, submission.contextVersion || 0);
    await PricingVersion.markProcessing(pricingVersion.id, { provider, model, promptVersion: PRICING_PROMPT_VERSION });

    const currentContext = await buildCurrentContext(submission);
    const outcome = await aiService.generatePricingStrategy(currentContext, analysisResult, {
      onProgress: (stage) => analysisProgress.setStage("pricing", submission.id, stage),
    });

    analysisProgress.setStage("pricing", submission.id, "saving");
    const completed = await PricingVersion.markCompleted(pricingVersion.id, {
      result: outcome.result,
      provider: outcome.provider,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
    });
    analysisProgress.complete("pricing", submission.id, { ok: true, pricingVersion: completed });
    return completed;
  } catch (err) {
    const code = err instanceof AiAnalysisError ? err.code : "unknown_error";
    const detail = err instanceof AiAnalysisError ? err.message : "An unexpected internal error occurred.";
    if (!(err instanceof AiAnalysisError)) {
      console.error(`[runPricingStrategy] Unexpected error (submission ${submission.id}):`, err);
    }
    if (pricingVersion) {
      await PricingVersion.markFailed(pricingVersion.id, { error: `${code}: ${detail}`, provider, model, promptVersion: PRICING_PROMPT_VERSION }).catch((dbErr) => {
        console.error(`[runPricingStrategy] Failed to record pricing failure (submission ${submission.id}):`, dbErr);
      });
    }
    analysisProgress.complete("pricing", submission.id, { ok: false, error: detail, code });
    return null;
  }
}

module.exports = { runPricingStrategy };
