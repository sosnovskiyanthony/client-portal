// Thin wrapper around the Brave Web Search API — the only thing in this
// codebase that makes a real live internet search. Deliberately isolated
// here, not inside ai/providers/: this has nothing to do with an LLM
// provider, it's a plain REST call, and ai/researchTool.js is the only
// caller. See ai/README.md's "Online research" section for the full
// picture of how this fits into the AI chat feature.
//
// Ollama and Brave never talk to each other directly — this module and
// ai/providers/ollamaProvider.js's generateChatReplyWithTools are the only
// two things that ever call out over the network here, and they're only
// ever bridged by services/runChat.js's tool loop, one HTTP call at a time.
const env = require("../config/env");
const { AiAnalysisError } = require("../ai/errors");

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const REQUEST_TIMEOUT_MS = 15_000;

// Cost/context-budget control: a search result's description can run long,
// and there's no reason to feed an entire page of text back into the
// model's context for what's meant to be a short snippet.
const MAX_SNIPPET_CHARS = 500;

function truncate(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) + "…" : value;
}

function isConfigured() {
  return Boolean(env.braveApiKey);
}

// Returns an array of { title, url, snippet } — never throws for "no
// results" (returns []), only for a genuine failure to reach/use the API.
async function braveSearch(query, { maxResults = 5 } = {}) {
  if (!env.braveApiKey) {
    throw new AiAnalysisError("missing_api_key", "BRAVE_API_KEY is not configured.");
  }
  if (typeof query !== "string" || !query.trim()) {
    return [];
  }

  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query.trim())}&count=${Math.min(Math.max(maxResults, 1), 20)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": env.braveApiKey },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new AiAnalysisError("timeout", `Brave search timed out after ${REQUEST_TIMEOUT_MS}ms.`, err);
    }
    throw new AiAnalysisError("network_error", "Could not reach the Brave Search API.", err);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AiAnalysisError("invalid_api_key", "Brave Search API key was rejected.");
  }
  if (res.status === 429) {
    throw new AiAnalysisError("rate_limited", "Brave Search API rate limit hit.");
  }
  if (!res.ok) {
    throw new AiAnalysisError("provider_error", `Brave Search API returned HTTP ${res.status}.`);
  }

  const body = await res.json().catch((err) => {
    throw new AiAnalysisError("invalid_json", "Brave Search API's response body was not valid JSON.", err);
  });

  const results = (body?.web?.results || []).slice(0, maxResults);
  return results.map((r) => ({
    title: truncate(r.title, 200),
    url: typeof r.url === "string" ? r.url : "",
    snippet: truncate(r.description, MAX_SNIPPET_CHARS),
  }));
}

module.exports = { braveSearch, isConfigured };
