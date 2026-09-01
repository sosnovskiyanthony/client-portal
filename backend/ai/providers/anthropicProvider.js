// Anthropic (Claude API) provider — kept for future use but NOT the active
// provider by default (AI_PROVIDER defaults to "ollama", see config/env.js).
// This module is only ever invoked when an operator explicitly sets
// AI_PROVIDER=anthropic, and even then only runs if ANTHROPIC_API_KEY is
// also set — no request is made, and no cost incurred, unless both are
// explicitly configured.
const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const env = require("../../config/env");
const { AiAnalysisError } = require("../errors");

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 4096;

let cachedClient = null;
function getClient() {
  if (!env.anthropicApiKey) return null;
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return cachedClient;
}

function classifyError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiAnalysisError("invalid_api_key", "Anthropic API key was rejected.", err);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiAnalysisError("rate_limited", "Anthropic API rate limit hit.", err);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiAnalysisError("timeout", "Anthropic API request timed out.", err);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiAnalysisError("model_unavailable", `Model "${env.aiModel}" was not found.`, err);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiAnalysisError("network_error", "Could not reach the Anthropic API.", err);
  }
  if (err instanceof Anthropic.APIError) {
    return new AiAnalysisError("provider_error", `Anthropic API error (status ${err.status}).`, err);
  }
  if (err instanceof AiAnalysisError) return err;
  return new AiAnalysisError("unknown_error", err?.message || "Unknown Anthropic provider error.", err);
}

async function generateStructuredAnalysis({ systemPrompt, userMessage, zodSchema, model, client, onProgress }) {
  const activeClient = client || getClient();
  if (!activeClient) {
    throw new AiAnalysisError("missing_api_key", "ANTHROPIC_API_KEY is not configured.");
  }

  onProgress?.("generating");
  let response;
  try {
    response = await activeClient.messages.parse(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        output_config: { format: zodOutputFormat(zodSchema, "project_analysis") },
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    throw classifyError(err);
  }

  if (!response.parsed_output) {
    throw new AiAnalysisError("invalid_schema", "Claude's response did not match the required analysis schema.");
  }

  return { parsed: response.parsed_output, raw: response };
}

// Free-text, multi-turn variant of generateStructuredAnalysis() above, for
// the AI chat feature. Uses messages.create (not .parse) since there's no
// output schema to constrain a conversational reply to — see
// ollamaProvider.js's generateChatReply for the matching Ollama-side
// implementation and ai/aiService.js's chatReply for the shared caller.
async function generateChatReply({ systemPrompt, messages, model, client, onProgress, temperature = 1 }) {
  const activeClient = client || getClient();
  if (!activeClient) {
    throw new AiAnalysisError("missing_api_key", "ANTHROPIC_API_KEY is not configured.");
  }

  onProgress?.("generating");
  let response;
  try {
    response = await activeClient.messages.create(
      {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt,
        messages,
        temperature,
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    throw classifyError(err);
  }

  const textBlock = (response.content || []).find((block) => block.type === "text");
  if (!textBlock || !textBlock.text || !textBlock.text.trim()) {
    throw new AiAnalysisError("invalid_json", "Claude returned an empty chat response.");
  }

  return { text: textBlock.text.trim(), raw: response };
}

module.exports = { generateStructuredAnalysis, generateChatReply, REQUEST_TIMEOUT_MS, MAX_OUTPUT_TOKENS };
