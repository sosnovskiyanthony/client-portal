// Unit tests for ollamaProvider.js's generateChatReplyWithTools — the
// multi-turn tool-calling loop backing the AI chat feature's "Research
// this" action (see ai/researchTool.js, services/runChat.js's
// runChatWithResearch). This is the highest-risk piece of new code in the
// research feature: a runaway loop, a lost tool result, or a duplicated
// message here would be a real bug, not just a display issue, so it gets
// direct coverage of the request/response shape at each step, not just an
// end-to-end happy path.
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateChatReplyWithTools } = require("../ai/providers/ollamaProvider");
const { AiAnalysisError } = require("../ai/errors");

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const TOOLS = [{ type: "function", function: { name: "web_search", parameters: { type: "object", properties: {} } } }];

test("no tool call needed: returns the model's direct answer, sources is empty", async () => {
  let requestCount = 0;
  await withMockedFetch(
    async (url, opts) => {
      requestCount++;
      const body = JSON.parse(opts.body);
      assert.ok(Array.isArray(body.tools), "tools should be offered on the first attempt");
      return { ok: true, status: 200, json: async () => ({ message: { content: "No search needed — here's the answer." } }) };
    },
    async () => {
      const result = await generateChatReplyWithTools({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "hi" }],
        model: "qwen2.5:7b",
        tools: TOOLS,
        executeTool: async () => [{ title: "T", url: "https://example.com", snippet: "s" }],
      });
      assert.equal(result.text, "No search needed — here's the answer.");
      assert.deepEqual(result.sources, []);
    }
  );
  assert.equal(requestCount, 1);
});

test("one tool call then a final answer: executes the tool, feeds results back, collects sources", async () => {
  let requestCount = 0;
  const capturedBodies = [];
  await withMockedFetch(
    async (url, opts) => {
      requestCount++;
      const body = JSON.parse(opts.body);
      capturedBodies.push(body);
      if (requestCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: {
              tool_calls: [{ type: "function", function: { name: "web_search", arguments: { query: "local seo bakery" } } }],
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: "Based on that search, here's my recommendation." } }) };
    },
    async () => {
      const result = await generateChatReplyWithTools({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "what's a good SEO move?" }],
        model: "qwen2.5:7b",
        tools: TOOLS,
        executeTool: async (args) => {
          assert.equal(args.query, "local seo bakery");
          return [{ title: "Local SEO 101", url: "https://example.com/seo", snippet: "..." }];
        },
      });
      assert.equal(result.text, "Based on that search, here's my recommendation.");
      assert.deepEqual(result.sources, [{ title: "Local SEO 101", url: "https://example.com/seo" }]);
    }
  );

  assert.equal(requestCount, 2);
  // Second request must include the assistant's tool_calls turn AND the
  // tool result turn, in that order, appended after the original messages.
  const secondRequestMessages = capturedBodies[1].messages;
  const roles = secondRequestMessages.map((m) => m.role);
  assert.ok(roles.includes("assistant") && roles.includes("tool"));
  const toolMsgIndex = roles.lastIndexOf("tool");
  const assistantToolCallIndex = secondRequestMessages.findIndex((m) => m.role === "assistant" && m.tool_calls);
  assert.ok(assistantToolCallIndex !== -1 && assistantToolCallIndex < toolMsgIndex);
});

test("deduplicates sources by URL across multiple tool calls", async () => {
  let requestCount = 0;
  await withMockedFetch(
    async () => {
      requestCount++;
      if (requestCount <= 2) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { tool_calls: [{ type: "function", function: { name: "web_search", arguments: { query: `q${requestCount}` } } }] },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: "Final answer." } }) };
    },
    async () => {
      const result = await generateChatReplyWithTools({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "research this" }],
        model: "qwen2.5:7b",
        tools: TOOLS,
        maxToolCalls: 3,
        executeTool: async () => [{ title: "Same page", url: "https://example.com/same", snippet: "s" }],
      });
      assert.equal(result.sources.length, 1);
    }
  );
});

test("caps tool calls at maxToolCalls — the final attempt omits tools, forcing a text answer", async () => {
  let requestCount = 0;
  const capturedBodies = [];
  await withMockedFetch(
    async (url, opts) => {
      requestCount++;
      const body = JSON.parse(opts.body);
      capturedBodies.push(body);
      // Keeps requesting a search every time tools are offered.
      if (body.tools) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { tool_calls: [{ type: "function", function: { name: "web_search", arguments: { query: "more" } } }] },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: "Forced final answer." } }) };
    },
    async () => {
      const result = await generateChatReplyWithTools({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "research relentlessly" }],
        model: "qwen2.5:7b",
        tools: TOOLS,
        maxToolCalls: 2,
        executeTool: async () => [{ title: "T", url: "https://example.com/x", snippet: "s" }],
      });
      assert.equal(result.text, "Forced final answer.");
    }
  );
  // 2 tool-enabled attempts + 1 forced no-tools attempt = 3 requests total.
  assert.equal(requestCount, 3);
  assert.equal(capturedBodies.filter((b) => b.tools).length, 2);
  assert.equal(capturedBodies.filter((b) => !b.tools).length, 1);
});

test("a failing tool execution doesn't crash the whole reply — the model gets told the search failed and can still answer", async () => {
  let requestCount = 0;
  await withMockedFetch(
    async () => {
      requestCount++;
      if (requestCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { tool_calls: [{ type: "function", function: { name: "web_search", arguments: { query: "q" } } }] },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: "Answering without the failed search." } }) };
    },
    async () => {
      const result = await generateChatReplyWithTools({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "research this" }],
        model: "qwen2.5:7b",
        tools: TOOLS,
        executeTool: async () => {
          throw new Error("Tavily is down");
        },
      });
      assert.equal(result.text, "Answering without the failed search.");
      assert.deepEqual(result.sources, []);
    }
  );
});

test("an empty final response is classified as invalid_json, not silently returned", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: "" } }) }),
    async () => {
      await assert.rejects(
        () =>
          generateChatReplyWithTools({
            systemPrompt: "sys",
            messages: [{ role: "user", content: "hi" }],
            model: "qwen2.5:7b",
            tools: TOOLS,
            executeTool: async () => [],
          }),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_json"
      );
    }
  );
});
