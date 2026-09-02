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
const { logSecurityEvent } = require("../../guardian/securityEvents");
const { checkCircuitBreaker } = require("../../guardian/circuitBreaker");

// The complete allowlist of tool names this app will ever actually execute
// for the model — see guardian/aiCapabilities.js for the declarative
// capability map this mirrors. Anything else the model asks for is a
// capability violation: not because a real dangerous capability was almost
// granted (there is no fs/exec/shell tool wired up anywhere near this loop
// to begin with — see guardian/rules.js), but because a model requesting
// something outside its declared toolset is exactly the kind of anomaly
// Guardian's circuit breaker needs visibility into.
const ALLOWED_TOOL_NAMES = ["web_search"];

// Local CPU inference on a 7B-class model generating a large structured JSON
// object realistically takes much longer than a hosted API call — a fixed
// 60s budget (reasonable for a hosted provider) would misclassify normal
// local inference as a timeout. This is the hard ceiling for the WHOLE
// operation (first attempt + retry combined, see FIRST_ATTEMPT_TIMEOUT_MS
// below) — a retry never extends it.
//
// Deliberately kept under 5 minutes, not just "generous" — a real
// production incident (2026-09-02) showed this set to exactly 300003ms
// produce a bare, unhelpful "Request failed." in the browser instead of
// the specific timeout message this module actually generates. Follow-up
// evidence (server logs confirming the client connection was already gone
// at both the ~139s and ~240s marks on two separate attempts) showed
// something ahead of this app was cutting the client-facing connection
// well under either mark, regardless of exactly where this ceiling sits —
// so shortening it further wasn't a reliable fix on its own. The actual
// fix for that reporting gap is chatController.js's paste-and-analyze
// routes now running this call in the background and returning
// immediately, so no single HTTP request needs to survive as long as this
// value allows in the first place. This timeout stays under 5 minutes
// regardless, as real margin: it still bounds how long a genuinely-stuck
// Ollama connection is left open, independent of anything client-facing.
const REQUEST_TIMEOUT_MS = 4 * 60 * 1000;

// Confirmed via a real deploy log: a Tailscale connection attempt (userspace-
// networking mode, see lib/tailscaleDispatcher.js) to the Ollama host can go
// completely silent — no error, no response, nothing — for the ENTIRE
// request budget, when its direct-path negotiation to the peer fails (the
// log showed a peer contact registering "via=direct" right as the request
// went out, then nothing at all until our own abort fired 5 minutes later,
// which Tailscale's proxy then logged as "context canceled" — that's our
// abort reaching it, not the proxy reporting its own failure the way the 502
// case does). Giving the first attempt only this long, then abandoning it
// for a fresh connection, means a bad path gets replaced quickly instead of
// silently eating the whole budget on a connection that was never going
// anywhere.
const FIRST_ATTEMPT_TIMEOUT_MS = 45 * 1000;

// Matches MAX_OUTPUT_TOKENS in anthropicProvider.js — plenty for this
// schema's structured JSON output, and a real ceiling so a runaway/repetitive
// generation can't run indefinitely on its own before the request timeout
// above even kicks in.
const MAX_OUTPUT_TOKENS = 4096;

// generateStructuredAnalysis and generateChatReply both request a streamed
// response (stream: true) rather than Ollama's default single-lump reply,
// specifically so the connection carries real, continuous data while a
// generation is in progress. This isn't a performance optimization — it's
// the actual fix for a real production pattern (2026-09-02): the
// non-streaming request, which sends literally zero bytes back until the
// entire generation is done, never once succeeded in any incident on this
// thread, while every short/fast call (a plain health-check GET, a raw
// `tailscale ping`) always did. That asymmetry pointed at something on the
// Railway-container-to-Mac path treating a connection that's alive but
// silent for too long as dead — the same class of bug already found and
// fixed on the browser-to-Railway leg (see chatController.js). Streaming
// means the connection is never actually silent while Ollama is working,
// which sidesteps that regardless of exactly what's enforcing it.
//
// This timeout governs inactivity specifically — no bytes of ANY kind
// (not even a partial line) for this long — not total generation time
// (REQUEST_TIMEOUT_MS above is still the hard ceiling on that). Real token
// generation, even on slow local hardware, produces some output well
// within a minute when it's actually working; going fully silent for a
// full minute during active generation is the real stall signal.
const STREAM_INACTIVITY_TIMEOUT_MS = 60 * 1000;

// Consumes an Ollama streamed /api/chat response — newline-delimited JSON,
// one object per token/chunk, a final line marked done:true carrying the
// generation's stats — and accumulates it into one result shaped like
// Ollama's old single-lump response body, so callers work with it exactly
// the same way regardless of which mode fetched it. Calls onChunk() on
// every raw chunk received (before it's even known to contain a complete
// JSON line) so callers can reset an inactivity timer on real proof of
// activity, not just on fully-parsed data.
//
// Deliberately does NOT catch/reclassify errors from the network read
// itself (a mid-stream abort, a dropped connection) — those propagate as
// whatever raw error type they already are (e.g. AbortError), so the
// existing retry-then-classify logic in each caller below, built around
// exactly those raw error shapes, keeps working unchanged. Only a
// genuinely malformed/incomplete STREAM (bad JSON on a line, or the
// stream ending with no done:true marker at all) is wrapped as an
// AiAnalysisError here — that's a real-response-but-broken-content case,
// not a connectivity one, and callers let it propagate straight through
// rather than folding it into the connectivity retry/classification path
// (see the `if (err instanceof AiAnalysisError) throw err;` guard in
// each attempt() below).
async function consumeOllamaStream(body, onChunk) {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let toolCalls = null;
  let finalLine = null;

  for await (const rawChunk of body) {
    onChunk();
    buffer += decoder.decode(rawChunk, { stream: true });
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (parseErr) {
        throw new AiAnalysisError("invalid_json", "Ollama's streamed response contained a malformed line.", parseErr);
      }
      if (typeof parsed?.message?.content === "string") content += parsed.message.content;
      if (Array.isArray(parsed?.message?.tool_calls) && parsed.message.tool_calls.length > 0) {
        toolCalls = parsed.message.tool_calls;
      }
      if (parsed?.done) finalLine = parsed;
    }
  }

  if (!finalLine) {
    throw new AiAnalysisError("invalid_json", "Ollama's streamed response ended without a completion marker.");
  }
  return {
    ...finalLine,
    message: { ...(finalLine.message || {}), content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
  };
}

async function generateStructuredAnalysis({ systemPrompt, userMessage, zodSchema, model, onProgress }) {
  const url = `${env.ollamaBaseUrl}/api/chat`;
  const jsonSchema = z.toJSONSchema(zodSchema);

  // Server-side timing log, meant to be watched live in Railway's log tab.
  // onProgress (see lib/analysisProgress.js) is the matching signal for the
  // dashboard itself — "generating" covers this whole fetch, since Ollama's
  // stream:false response only arrives as one lump; there's no real
  // sub-stage between "request sent" and "response received" without
  // switching to streaming.
  const startedAt = Date.now();
  const overallDeadline = startedAt + REQUEST_TIMEOUT_MS;
  console.log(`[ollamaProvider] Sending request to Ollama at ${env.ollamaBaseUrl} (model=${model})...`);
  onProgress?.("generating");

  const requestBody = JSON.stringify({
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
    stream: true,
    options: { temperature: 0.2, num_predict: MAX_OUTPUT_TOKENS },
  });

  // One attempt = one fresh connection with its own timeout/AbortController,
  // so a retry genuinely starts over rather than reusing whatever the first
  // attempt's connection was doing. Returns { res, body } on a full success,
  // { res } for a non-2xx status (no stream to consume — the caller's
  // status-code handling deals with it), or { err } for anything that never
  // produced a usable response at all. Never throws for a connectivity-
  // shaped failure — the caller decides what that means at each stage —
  // but DOES throw directly for a malformed/incomplete stream (see
  // consumeOllamaStream's own comment on why that's not folded into { err }).
  async function attempt(timeoutMs) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), timeoutMs);
    // Swaps the fixed connect-phase timer for a per-chunk inactivity timer
    // once real data starts arriving — a connection that's already proven
    // itself alive by delivering bytes deserves the (looser, generation-
    // appropriate) STREAM_INACTIVITY_TIMEOUT_MS budget per gap, not the
    // (tighter, dead-connection-detecting) budget this attempt started
    // with, still bounded by the overall deadline regardless.
    const resetInactivityTimer = () => {
      clearTimeout(timer);
      const remainingMs = Math.max(1000, overallDeadline - Date.now());
      timer = setTimeout(() => controller.abort(), Math.min(STREAM_INACTIVITY_TIMEOUT_MS, remainingMs));
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: controller.signal,
        dispatcher: tailscaleDispatcher,
      });
      if (!res.ok) return { res };
      console.log(`[ollamaProvider] Ollama accepted the request after ${Date.now() - startedAt}ms — streaming response (HTTP ${res.status})...`);
      const body = await consumeOllamaStream(res.body, resetInactivityTimer);
      console.log(`[ollamaProvider] Ollama finished streaming after ${Date.now() - startedAt}ms.`);
      return { res, body };
    } catch (err) {
      if (err instanceof AiAnalysisError) throw err;
      return { err };
    } finally {
      clearTimeout(timer);
    }
  }

  let { res, body, err } = await attempt(Math.min(FIRST_ATTEMPT_TIMEOUT_MS, REQUEST_TIMEOUT_MS));

  // Retry once, with a fresh connection, on anything that isn't a clean
  // success: a hang (err.name === "AbortError" — either the connect-phase
  // timeout or the streaming inactivity timeout above firing, not the
  // overall one), a connection-level error, or a 502 (see the comment on
  // the 502 branch further below). A real, non-502 HTTP response — even an
  // error one like 404/500 — is Ollama itself actually answering, which a
  // retry can't fix, so that's left to the normal status handling after
  // this block.
  if (err || (res && res.status === 502)) {
    const reason = err ? (err.name === "AbortError" ? `timed out waiting on Ollama (${Date.now() - startedAt}ms elapsed)` : err.message) : "HTTP 502";
    const remainingMs = Math.max(5000, overallDeadline - Date.now());
    console.log(`[ollamaProvider] First attempt failed (${reason}) — retrying once with a fresh connection (${Math.round(remainingMs / 1000)}s left)...`);
    ({ res, body, err } = await attempt(remainingMs));
  }

  if (err) {
    const elapsedMs = Date.now() - startedAt;
    if (err.name === "AbortError") {
      console.error(`[ollamaProvider] Timed out after ${elapsedMs}ms waiting on Ollama.`);
      throw new AiAnalysisError("timeout", `Ollama request timed out after ${elapsedMs}ms.`, err);
    }
    // fetch() throws a plain TypeError ("fetch failed") for connection
    // refused / DNS failure / host unreachable — exactly the "Ollama is
    // stopped" case this whole feature is required to survive.
    console.error(`[ollamaProvider] Could not reach Ollama after ${elapsedMs}ms:`, err.message);
    throw new AiAnalysisError(
      "ollama_unavailable",
      `Could not reach Ollama at ${env.ollamaBaseUrl}. Is it running?`,
      err
    );
  }

  if (res.status === 404) {
    throw new AiAnalysisError(
      "model_unavailable",
      `Ollama model "${model}" is not available. Run: ollama pull ${model}`,
    );
  }
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    // A 502 here is Tailscale's own proxy reporting it couldn't reach the
    // Ollama host (see the retry above) — never a response Ollama itself
    // sent. "Ollama returned HTTP 502" would be actively misleading (it
    // reads as Ollama responding with an error, when Ollama was never
    // reached at all), so this is worded around the real cause instead.
    if (res.status === 502) {
      throw new AiAnalysisError(
        "ollama_unavailable",
        `Could not reach Ollama at ${env.ollamaBaseUrl} through the Tailscale connection (tried twice). Is it running, and is the connection stable?`,
        errorBody
      );
    }
    throw new AiAnalysisError("provider_error", `Ollama returned HTTP ${res.status}.`, errorBody);
  }

  const content = body?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiAnalysisError("invalid_json", "Ollama returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (parseErr) {
    throw new AiAnalysisError("invalid_json", "Ollama's response content was not valid JSON.", parseErr);
  }

  return { parsed, raw: body };
}

// Free-text, multi-turn variant of generateStructuredAnalysis() above, for
// the AI chat feature (ai/aiService.js's chatReply). Same request/retry/
// timeout handling — only two things differ: `messages` is a full
// pre-built array (system prompt + however much conversation history the
// caller wants replayed) rather than one fixed user message, and there's no
// `format` field, since a conversational reply has no schema to constrain
// generation to. Returns { text }, not { parsed } — nothing to validate
// against a Zod schema here.
async function generateChatReply({ systemPrompt, messages, model, onProgress, temperature = 0.4 }) {
  const url = `${env.ollamaBaseUrl}/api/chat`;

  const startedAt = Date.now();
  const overallDeadline = startedAt + REQUEST_TIMEOUT_MS;
  console.log(`[ollamaProvider] Sending chat request to Ollama at ${env.ollamaBaseUrl} (model=${model})...`);
  onProgress?.("generating");

  const requestBody = JSON.stringify({
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    stream: true,
    options: { temperature, num_predict: MAX_OUTPUT_TOKENS },
  });

  async function attempt(timeoutMs) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), timeoutMs);
    const resetInactivityTimer = () => {
      clearTimeout(timer);
      const remainingMs = Math.max(1000, overallDeadline - Date.now());
      timer = setTimeout(() => controller.abort(), Math.min(STREAM_INACTIVITY_TIMEOUT_MS, remainingMs));
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        signal: controller.signal,
        dispatcher: tailscaleDispatcher,
      });
      if (!res.ok) return { res };
      console.log(`[ollamaProvider] Ollama accepted the chat request after ${Date.now() - startedAt}ms — streaming response (HTTP ${res.status})...`);
      const body = await consumeOllamaStream(res.body, resetInactivityTimer);
      console.log(`[ollamaProvider] Ollama finished streaming the chat reply after ${Date.now() - startedAt}ms.`);
      return { res, body };
    } catch (err) {
      if (err instanceof AiAnalysisError) throw err;
      return { err };
    } finally {
      clearTimeout(timer);
    }
  }

  let { res, body, err } = await attempt(Math.min(FIRST_ATTEMPT_TIMEOUT_MS, REQUEST_TIMEOUT_MS));

  if (err || (res && res.status === 502)) {
    const reason = err ? (err.name === "AbortError" ? `timed out waiting on Ollama (${Date.now() - startedAt}ms elapsed)` : err.message) : "HTTP 502";
    const remainingMs = Math.max(5000, overallDeadline - Date.now());
    console.log(`[ollamaProvider] First chat attempt failed (${reason}) — retrying once with a fresh connection (${Math.round(remainingMs / 1000)}s left)...`);
    ({ res, body, err } = await attempt(remainingMs));
  }

  if (err) {
    const elapsedMs = Date.now() - startedAt;
    if (err.name === "AbortError") {
      console.error(`[ollamaProvider] Chat request timed out after ${elapsedMs}ms waiting on Ollama.`);
      throw new AiAnalysisError("timeout", `Ollama chat request timed out after ${elapsedMs}ms.`, err);
    }
    console.error(`[ollamaProvider] Could not reach Ollama after ${elapsedMs}ms:`, err.message);
    throw new AiAnalysisError(
      "ollama_unavailable",
      `Could not reach Ollama at ${env.ollamaBaseUrl}. Is it running?`,
      err
    );
  }

  if (res.status === 404) {
    throw new AiAnalysisError(
      "model_unavailable",
      `Ollama model "${model}" is not available. Run: ollama pull ${model}`,
    );
  }
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    if (res.status === 502) {
      throw new AiAnalysisError(
        "ollama_unavailable",
        `Could not reach Ollama at ${env.ollamaBaseUrl} through the Tailscale connection (tried twice). Is it running, and is the connection stable?`,
        errorBody
      );
    }
    throw new AiAnalysisError("provider_error", `Ollama returned HTTP ${res.status}.`, errorBody);
  }

  const content = body?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiAnalysisError("invalid_json", "Ollama returned an empty chat response.");
  }

  return { text: content.trim(), raw: body };
}

// A single call's timeout, not the whole loop's. Deliberately larger than
// REQUEST_TIMEOUT_MS, not just equal to it — verified directly against a
// real local qwen2.5:7b instance that simply including a `tools` array in
// the request measurably slows generation even when the model ends up not
// calling the tool at all (~3 minutes for an 8-token "no search needed"
// answer, vs. well under a minute for the identical question with no
// tools offered). A real search-and-continue round trip needs more room
// than that on constrained hardware, and research is already a
// deliberate, occasional, manually-triggered action — there's little cost
// to giving a single attempt more time to actually finish.
const TOOL_CALL_TIMEOUT_MS = 8 * 60 * 1000;

// Logs at each step, same style/verbosity as generateStructuredAnalysis/
// generateChatReply above — this loop can make several of these calls in a
// row for one admin click, and without per-call visibility a failure or a
// long stall is a black box (this is what was missing when a real research
// request returned "Could not reach Ollama" after several minutes with
// nothing in the logs to say which of the loop's several requests that
// even happened on).
async function ollamaChatRequest(body, { attemptLabel } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_CALL_TIMEOUT_MS);
  const startedAt = Date.now();
  console.log(`[ollamaProvider] [tools] Sending ${attemptLabel || "request"} to Ollama at ${env.ollamaBaseUrl} (model=${body.model}, tools=${body.tools ? "yes" : "no"})...`);
  let res;
  try {
    res = await fetch(`${env.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      dispatcher: tailscaleDispatcher,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    if (err.name === "AbortError") {
      console.error(`[ollamaProvider] [tools] ${attemptLabel || "request"} timed out after ${elapsedMs}ms waiting on Ollama.`);
      throw new AiAnalysisError("timeout", `Ollama request timed out after ${TOOL_CALL_TIMEOUT_MS}ms.`, err);
    }
    console.error(`[ollamaProvider] [tools] Could not reach Ollama after ${elapsedMs}ms on ${attemptLabel || "request"}:`, err.message);
    throw new AiAnalysisError("ollama_unavailable", `Could not reach Ollama at ${env.ollamaBaseUrl}. Is it running?`, err);
  } finally {
    clearTimeout(timer);
  }
  console.log(`[ollamaProvider] [tools] Ollama responded to ${attemptLabel || "request"} after ${Date.now() - startedAt}ms (HTTP ${res.status}).`);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AiAnalysisError("provider_error", `Ollama returned HTTP ${res.status}.`, text);
  }
  return res.json().catch((err) => {
    throw new AiAnalysisError("invalid_json", "Ollama's response body was not valid JSON.", err);
  });
}

// Multi-turn tool-calling loop for the AI chat feature's "Research this"
// action (see ai/researchTool.js, services/runChat.js's
// runChatWithResearch). Ollama and the tool executor never talk to each
// other directly — this function is the only thing that reads a tool_call
// request out of Ollama's response and is the only thing that calls
// `executeTool`; every round-trip is a separate, ordinary HTTP call.
//
// Simpler failure handling than generateChatReply/generateStructuredAnalysis
// above (no retry-on-502 dance) — this is a manual, occasional admin action,
// not the default path every chat message takes, so a first, more direct
// implementation is the right amount of complexity for now.
//
// `maxToolCalls` bounds how many times the model can call the tool in one
// turn (cost/runaway-loop control — see ai/researchTool.js's caller for the
// actual configured cap). Once that's reached, one final request is made
// with `tools` omitted, forcing a text answer instead of another tool call.
async function generateChatReplyWithTools({ systemPrompt, messages, model, onProgress, tools, executeTool, maxToolCalls = 3 }) {
  onProgress?.("generating");
  let workingMessages = [{ role: "system", content: systemPrompt }, ...messages];
  const sources = [];
  const seenUrls = new Set();

  for (let attempt = 0; attempt <= maxToolCalls; attempt++) {
    const includeTools = attempt < maxToolCalls;
    const attemptLabel = includeTools ? `tool-loop attempt ${attempt + 1}/${maxToolCalls}` : "tool-loop final (forced) attempt";
    const body = await ollamaChatRequest(
      {
        model,
        messages: workingMessages,
        ...(includeTools ? { tools } : {}),
        stream: false,
        options: { temperature: 0.4, num_predict: MAX_OUTPUT_TOKENS },
      },
      { attemptLabel }
    );

    const message = body?.message || {};
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length === 0) {
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (!content) {
        throw new AiAnalysisError("invalid_json", "Ollama returned an empty chat response.");
      }
      console.log(`[ollamaProvider] [tools] Model answered directly on ${attemptLabel}, no search used.`);
      return { text: content, sources, raw: body };
    }

    console.log(`[ollamaProvider] [tools] Model requested ${toolCalls.length} tool call(s) on ${attemptLabel}: ${toolCalls.map((c) => c?.function?.name).join(", ")}`);

    // The assistant's own tool-call request has to become part of the
    // conversation before the tool result does, or the next request has no
    // record of what the model actually asked for.
    workingMessages = [...workingMessages, { role: "assistant", tool_calls: toolCalls }];

    for (const call of toolCalls) {
      const name = call?.function?.name;

      if (!ALLOWED_TOOL_NAMES.includes(name)) {
        // Previously a silent no-op (the model got back an empty-array
        // "success" for a tool that never ran, with no record anywhere
        // that it happened) — now explicit, logged, and visible to the
        // circuit breaker. The model itself has no way to act on this
        // beyond seeing the plain-text refusal below; nothing here grants
        // it anything.
        logSecurityEvent({
          severity: "HIGH",
          eventType: "ai_capability_violation",
          actorType: "ai_caller",
          source: "ollamaProvider",
          resourceType: "tool_call",
          resourceId: name || "(unnamed)",
          description: `Model requested a tool call outside its declared capability set: "${name}".`,
          metadata: { allowedTools: ALLOWED_TOOL_NAMES },
        }).then(() => checkCircuitBreaker()).catch(() => {});

        workingMessages.push({
          role: "tool",
          tool_name: name || "unknown",
          content: `Tool "${name}" is not available. Only these tools may be used: ${ALLOWED_TOOL_NAMES.join(", ")}.`,
        });
        continue;
      }

      let results = [];
      try {
        if (name === "web_search") {
          results = (await executeTool(call.function.arguments)) || [];
        }
      } catch (err) {
        // A failed search shouldn't take down the whole reply — tell the
        // model the search failed (as tool content, not a thrown error)
        // and let it continue/answer with what it has.
        workingMessages.push({
          role: "tool",
          tool_name: name || "web_search",
          content: `Search failed: ${err instanceof Error ? err.message : "unknown error"}`,
        });
        continue;
      }

      for (const r of results) {
        if (r.url && !seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          sources.push({ title: r.title || r.url, url: r.url });
        }
      }

      workingMessages.push({
        role: "tool",
        tool_name: name || "web_search",
        content: JSON.stringify(results),
      });
    }
  }

  throw new AiAnalysisError("provider_error", "The model kept requesting searches without producing an answer.");
}

module.exports = {
  generateStructuredAnalysis,
  generateChatReply,
  generateChatReplyWithTools,
  REQUEST_TIMEOUT_MS,
  MAX_OUTPUT_TOKENS,
};
