// Shared helper for mocking Ollama's streamed /api/chat response in tests.
// generateStructuredAnalysis/generateChatReply (ai/providers/ollamaProvider.js)
// request stream:true and consume newline-delimited JSON via `for await
// (const chunk of res.body)` — see that file's module comment on why
// (2026-09-02 production incident: a non-streaming request that sends zero
// bytes until the whole generation is done never once succeeded over the
// Railway-to-Ollama Tailscale path, while short/fast calls always did).
// Every test across this suite that mocks a successful Ollama chat/analysis
// response needs a `res.body` shaped like a real streamed response, not a
// `res.json()` — this is that shape, in one place instead of duplicated
// per test file.

// Builds an async-iterable matching what a real fetch() Response.body
// looks like when consumed with `for await`. Split into deliberately tiny,
// uneven chunks so a single JSON line is guaranteed to straddle more than
// one read — proves line-buffering, not just whole-line-per-chunk luck.
function ndjsonBody(lines) {
  const full = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const bytes = Buffer.from(full, "utf8");
  return {
    async *[Symbol.asyncIterator]() {
      const CHUNK_SIZE = 7;
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        yield bytes.subarray(i, i + CHUNK_SIZE);
      }
    },
  };
}

// The minimum shape consumeOllamaStream requires to resolve: one message
// chunk carrying the full content, then the required done:true final line.
// Matches what a real (non-token-by-token-relevant) test needs — these
// tests care about the assembled content, not the token-by-token shape.
function ndjsonSuccess(content, { extra = {} } = {}) {
  return ndjsonBody([
    { message: { role: "assistant", content } },
    { message: { role: "assistant", content: "" }, done: true, ...extra },
  ]);
}

module.exports = { ndjsonBody, ndjsonSuccess };
