const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { generateStructuredAnalysis } = require("../ai/providers/ollamaProvider");
const { AiAnalysisError } = require("../ai/errors");
const { ndjsonSuccess } = require("./helpers/ollamaStream");

const TINY_SCHEMA = z.object({ foo: z.string() });

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("ollama unavailable (connection refused) classifies as ollama_unavailable, submission-safe error", async () => {
  await withMockedFetch(
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" }),
        (err) => {
          assert.ok(err instanceof AiAnalysisError);
          assert.equal(err.code, "ollama_unavailable");
          return true;
        }
      );
    }
  );
});

test("ollama model not found (404) classifies as model_unavailable", async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 404, text: async () => "" }),
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "nonexistent-model" }),
        (err) => {
          assert.ok(err instanceof AiAnalysisError);
          assert.equal(err.code, "model_unavailable");
          return true;
        }
      );
    }
  );
});

test("malformed JSON content in Ollama's response classifies as invalid_json", async () => {
  await withMockedFetch(
    async () => ({
      ok: true,
      status: 200,
      body: ndjsonSuccess("{not valid json"),
    }),
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" }),
        (err) => {
          assert.ok(err instanceof AiAnalysisError);
          assert.equal(err.code, "invalid_json");
          return true;
        }
      );
    }
  );
});

test("empty response content classifies as invalid_json", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess("") }),
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" }),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_json"
      );
    }
  );
});

test("valid JSON content parses successfully and passes the JSON schema for the request format", async () => {
  let capturedBody;
  await withMockedFetch(
    async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      // Split into deliberately tiny, uneven chunks (see ndjsonBody) —
      // proves the streamed content reassembles correctly even when a
      // single JSON line arrives split across multiple network reads.
      return { ok: true, status: 200, body: ndjsonSuccess('{"foo":"bar"}') };
    },
    async () => {
      const result = await generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" });
      assert.deepEqual(result.parsed, { foo: "bar" });
    }
  );
  assert.equal(capturedBody.model, "qwen2.5:7b");
  assert.equal(capturedBody.format.type, "object");
  assert.equal(capturedBody.messages[0].role, "system");
  assert.equal(capturedBody.messages[1].role, "user");
  assert.equal(capturedBody.stream, true, "must request a streamed response — see ollamaProvider.js's module comment on why");
});

test("HTTP 500 from Ollama classifies as provider_error", async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 500, text: async () => "internal error" }),
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" }),
        (err) => err instanceof AiAnalysisError && err.code === "provider_error"
      );
    }
  );
});

// Reproduces a real production failure: Tailscale's outbound proxy logged
// "http: proxy error: EOF" and returned 502 to this app when its relay
// connection to the Ollama host idled out mid-reconnect — never a response
// from Ollama itself. One retry is worth it before treating this as real.
test("a single transient 502 (Tailscale proxy hiccup) is retried once and succeeds", async () => {
  let callCount = 0;
  await withMockedFetch(
    async () => {
      callCount += 1;
      if (callCount === 1) return { ok: false, status: 502, text: async () => "" };
      return { ok: true, status: 200, body: ndjsonSuccess('{"foo":"bar"}') };
    },
    async () => {
      const result = await generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" });
      assert.deepEqual(result.parsed, { foo: "bar" });
    }
  );
  assert.equal(callCount, 2);
});

// The following tests exercise the actual mechanism this streaming switch
// exists for: a connection that stalls mid-generation (real bytes arrived,
// then nothing) — as opposed to never responding at all, which the tests
// above already cover. A real stall is a fetch()-level AbortError thrown
// partway through iterating res.body (see ai/providers/ollamaProvider.js's
// resetInactivityTimer, and the empirical confirmation in this session's
// notes that aborting a fetch's controller mid-stream does exactly this).
// These mocks simulate that exact shape directly rather than waiting out a
// real STREAM_INACTIVITY_TIMEOUT_MS, matching this file's existing
// convention of never letting a real multi-second/minute timeout elapse in
// a unit test.
function abortMidStream() {
  return {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ message: { content: "partial output before it went silent" } }) + "\n");
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      throw err;
    },
  };
}

test("a stream that stalls mid-generation is retried once and can still succeed", async () => {
  let callCount = 0;
  await withMockedFetch(
    async () => {
      callCount += 1;
      if (callCount === 1) return { ok: true, status: 200, body: abortMidStream() };
      return { ok: true, status: 200, body: ndjsonSuccess('{"foo":"bar"}') };
    },
    async () => {
      const result = await generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" });
      assert.deepEqual(result.parsed, { foo: "bar" });
    }
  );
  assert.equal(callCount, 2);
});

test("a stream that stalls mid-generation through both attempts classifies as timeout, not ollama_unavailable", async () => {
  let callCount = 0;
  await withMockedFetch(
    async () => {
      callCount += 1;
      return { ok: true, status: 200, body: abortMidStream() };
    },
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" }),
        (err) => {
          assert.ok(err instanceof AiAnalysisError);
          assert.equal(err.code, "timeout");
          return true;
        }
      );
    }
  );
  assert.equal(callCount, 2, "a mid-stream stall gets the same one retry as never responding at all");
});

test("a malformed JSON line within the stream classifies as invalid_json and is not retried", async () => {
  let callCount = 0;
  await withMockedFetch(
    async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from("{not valid json at all\n");
          },
        },
      };
    },
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" }),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_json"
      );
    }
  );
  assert.equal(callCount, 1, "a malformed stream is a broken-response case, not a connectivity one — retrying it wouldn't help");
});

test("a stream that ends without a done:true completion marker classifies as invalid_json and is not retried", async () => {
  let callCount = 0;
  await withMockedFetch(
    async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        body: {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from(JSON.stringify({ message: { content: "partial" } }) + "\n");
            // stream just ends here — connection closed cleanly, but with
            // no done:true line, which is the only signal a generation
            // actually finished rather than being cut off mid-flight.
          },
        },
      };
    },
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" }),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_json"
      );
    }
  );
  assert.equal(callCount, 1);
});

test("a 502 that persists through the retry classifies as ollama_unavailable, not a misleading provider_error", async () => {
  let callCount = 0;
  await withMockedFetch(
    async () => {
      callCount += 1;
      return { ok: false, status: 502, text: async () => "" };
    },
    async () => {
      await assert.rejects(
        () => generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" }),
        (err) => {
          assert.ok(err instanceof AiAnalysisError);
          assert.equal(err.code, "ollama_unavailable");
          return true;
        }
      );
    }
  );
  assert.equal(callCount, 2);
});
