// Orchestrates one "paste raw client text and analyze it" attempt — the AI
// chat feature's route into the exact same analysis pipeline
// analyzeSubmission() uses (see ai/aiService.js's analyzeRawText). Same
// throw-on-failure/progress-tracking shape as services/runContractReview.js
// — the caller awaits this directly for an HTTP response, and nothing is
// persisted here; the result only reaches submission_analyses if the admin
// explicitly saves it afterward (see chatController.js).
//
// `progressKey` is a submission id when this runs from an existing
// submission's chat drawer, or a client-generated request id string when it
// runs standalone (no submission open yet) — lib/analysisProgress.js's Map
// key works with either, so no submission has to exist yet for progress
// polling to work.
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");

async function runRawTextAnalysis(progressKey, rawText) {
  analysisProgress.start("chat-analyze", progressKey, { model: aiService.getActiveProviderInfo().model });
  try {
    return await aiService.analyzeRawText(rawText, {
      onProgress: (stage) => analysisProgress.setStage("chat-analyze", progressKey, stage),
    });
  } finally {
    analysisProgress.finish("chat-analyze", progressKey);
  }
}

module.exports = { runRawTextAnalysis };
