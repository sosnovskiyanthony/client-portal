// Talks to a local Ollama server over plain HTTP — no API key, no per-request
// cost. Ollama is expected to be reachable at env.ollamaBaseUrl (defaults to
// http://localhost:11434, i.e. the same machine). This module never touches
// the frontend and is never reachable from the browser — see server.js and
// routes/admin.js for where it's actually invoked from (server-side only).
const { z } = require("zod");
const env = require("../../config/env");
const { AiAnalysisError } = require("../errors");
// Deliberately just the dispatcher, not a captured `fetch` — see
// lib/tailscaleDispatcher.js. test/ollamaProvider.test.js mocks network
// behavior by temporarily reassigning globalThis.fetch (see
// withMockedFetch there); capturing fetch as a module-level const from
// undici at require-time would read a fixed reference once and never see
// that reassignment again, silently breaking every one of those tests
// (they'd fall through to a real network call instead of the mock — this
// happened once already, caught by a real test run, not by inspection).
// Calling the bare `fetch` identifier below (no local binding) always
// resolves to whatever globalThis.fetch currently is.
const { tailscaleDispatcher } = require("../../lib/tailscaleDispatcher");

// Local CPU inference on a 7B-class model generating a large structured JSON
// object realistically takes much longer than a hosted API call — a fixed
// 60s budget (reasonable for a hosted provider) would misclassify normal
// local inference as a timeout. 5 minutes gives real hardware room to finish
// without leaving a hung request open indefinitely.
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

// Matches MAX_OUTPUT_TOKENS in anthropicProvider.js — plenty for this
// schema's structured JSON output, and a real ceiling so a runaway/repetitive
// generation can't run indefinitely on its own before the request timeout
// above even kicks in.
const MAX_OUTPUT_TOKENS = 4096;

async function generateStructuredAnalysis({ systemPrompt, userMessage, zodSchema, model }) {
  const url = `${env.ollamaBaseUrl}/api/chat`;
  const jsonSchema = z.toJSONSchema(zodSchema);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        // Ollama's structured-output mode: passing a JSON Schema object
        // (rather than the string "json") constrains token generation to
        // match it, not just a "please return JSON" instruction — this is
        // what "the appropriate Ollama-compatible structured-output
        // approach" means here. We still validate the parsed result against
        // the Zod schema afterward regardless (see ai/aiService.js) — this
        // constrains generation, it doesn't replace validation.
        format: jsonSchema,
        stream: false,
        options: { temperature: 0.2, num_predict: MAX_OUTPUT_TOKENS },
      }),
      signal: controller.signal,
      dispatcher: tailscaleDispatcher,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new AiAnalysisError("timeout", `Ollama request timed out after ${REQUEST_TIMEOUT_MS}ms.`, err);
    }
    // fetch() throws a plain TypeError ("fetch failed") for connection
    // refused / DNS failure / host unreachable — exactly the "Ollama is
    // stopped" case this whole feature is required to survive.
    throw new AiAnalysisError(
      "ollama_unavailable",
      `Could not reach Ollama at ${env.ollamaBaseUrl}. Is it running?`,
      err
    );
  }
  clearTimeout(timer);

  if (res.status === 404) {
    throw new AiAnalysisError(
      "model_unavailable",
      `Ollama model "${model}" is not available. Run: ollama pull ${model}`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiAnalysisError("provider_error", `Ollama returned HTTP ${res.status}.`, body);
  }

  const body = await res.json().catch((err) => {
    throw new AiAnalysisError("invalid_json", "Ollama's response body was not valid JSON.", err);
  });

  const content = body?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiAnalysisError("invalid_json", "Ollama returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new AiAnalysisError("invalid_json", "Ollama's response content was not valid JSON.", err);
  }

  return { parsed, raw: body };
}

module.exports = { generateStructuredAnalysis, REQUEST_TIMEOUT_MS, MAX_OUTPUT_TOKENS };
