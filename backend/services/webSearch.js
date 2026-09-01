// Thin wrapper around the Tavily Search API — the only thing in this
// codebase that makes a real live internet search. Deliberately isolated
// here, not inside ai/providers/: this has nothing to do with an LLM
// provider, it's a plain REST call, and ai/researchTool.js is the only
// caller. See ai/README.md's "Online research" section for the full
// picture of how this fits into the AI chat feature.
//
// Tavily specifically because its free tier (1,000 requests/month) needs
// no credit card at all — verified directly against tavily.com/pricing,
// not a secondhand summary. Also explicitly built for AI agents: results
// come back as cleaned content, not raw HTML to parse ourselves.
//
// Ollama and Tavily never talk to each other directly — this module and
// ai/providers/ollamaProvider.js's generateChatReplyWithTools are the only
// two things that ever call out over the network here, and they're only
// ever bridged by services/runChat.js's tool loop, one HTTP call at a time.
const env = require("../config/env");
const { AiAnalysisError } = require("../ai/errors");

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 15_000;

// Cost/context-budget control: a result's content can run long, and
// there's no reason to feed a whole page of text back into the model's
// context for what's meant to be a short snippet.
const MAX_SNIPPET_CHARS = 500;

function truncate(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) + "…" : value;
}

function isConfigured() {
  return Boolean(env.tavilyApiKey);
}

// Returns an array of { title, url, snippet } — never throws for "no
// results" (returns []), only for a genuine failure to reach/use the API.
async function tavilySearch(query, { maxResults = 5 } = {}) {
  if (!env.tavilyApiKey) {
    throw new AiAnalysisError("missing_api_key", "TAVILY_API_KEY is not configured.");
  }
  if (typeof query !== "string" || !query.trim()) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.tavilyApiKey}`,
      },
      body: JSON.stringify({
        query: query.trim(),
        max_results: Math.min(Math.max(maxResults, 1), 20),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new AiAnalysisError("timeout", `Tavily search timed out after ${REQUEST_TIMEOUT_MS}ms.`, err);
    }
    throw new AiAnalysisError("network_error", "Could not reach the Tavily Search API.", err);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AiAnalysisError("invalid_api_key", "Tavily Search API key was rejected.");
  }
  if (res.status === 429) {
    throw new AiAnalysisError("rate_limited", "Tavily Search API rate limit hit.");
  }
  if (!res.ok) {
    throw new AiAnalysisError("provider_error", `Tavily Search API returned HTTP ${res.status}.`);
  }

  const body = await res.json().catch((err) => {
    throw new AiAnalysisError("invalid_json", "Tavily Search API's response body was not valid JSON.", err);
  });

  const results = (body?.results || []).slice(0, maxResults);
  return results.map((r) => ({
    title: truncate(r.title, 200),
    url: typeof r.url === "string" ? r.url : "",
    snippet: truncate(r.content, MAX_SNIPPET_CHARS),
  }));
}

module.exports = { tavilySearch, isConfigured };
