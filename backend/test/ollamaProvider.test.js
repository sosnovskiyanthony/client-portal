const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { generateStructuredAnalysis } = require("../ai/providers/ollamaProvider");
const { AiAnalysisError } = require("../ai/errors");

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
      json: async () => ({ message: { content: "{not valid json" } }),
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
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: "" } }) }),
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
      return { ok: true, status: 200, json: async () => ({ message: { content: '{"foo":"bar"}' } }) };
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
      return { ok: true, status: 200, json: async () => ({ message: { content: '{"foo":"bar"}' } }) };
    },
    async () => {
      const result = await generateStructuredAnalysis({ systemPrompt: "sys", userMessage: "msg", zodSchema: TINY_SCHEMA, model: "qwen2.5:7b" });
      assert.deepEqual(result.parsed, { foo: "bar" });
    }
  );
  assert.equal(callCount, 2);
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
