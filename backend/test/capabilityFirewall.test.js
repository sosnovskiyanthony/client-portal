// Proves the capability firewall's runtime enforcement point: an
// unrecognized tool-call name from the model (previously a silent no-op —
// see ai/providers/ollamaProvider.js's own comment) is now explicitly
// rejected, logged as a capability violation, and the conversation
// continues safely instead of crashing or silently granting anything.
const test = require("node:test");
const assert = require("node:assert/strict");
const { pool } = require("../config/database");
const { generateChatReplyWithTools } = require("../ai/providers/ollamaProvider");
const { AI_CAPABILITIES } = require("../guardian/aiCapabilities");

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// The capability-violation log write in ollamaProvider.js is deliberately
// fire-and-forget (never awaited by the tool loop itself, same as every
// other security-event log call in this app) — a test asserting on the
// resulting row can't just query immediately after the loop resolves, or
// it races the write. Short poll instead of a fixed sleep, since local
// Postgres round-trips are normally sub-millisecond and a fixed delay
// would either be flaky (too short) or needlessly slow the suite (safely
// long).
async function waitForRow(query, params, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query(query, params);
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return [];
}

const TOOLS = [{ type: "function", function: { name: "web_search", parameters: { type: "object", properties: {} } } }];

test.after(async () => {
  await pool.query("DELETE FROM security_events WHERE event_type = 'ai_capability_violation'");
  await pool.end();
});

test("every declared AI operation has execute/modifyCode/modifyInfrastructure = false today", () => {
  for (const [name, cap] of Object.entries(AI_CAPABILITIES)) {
    assert.equal(cap.execute, false, `${name}.execute must be false`);
    assert.equal(cap.modifyCode, false, `${name}.modifyCode must be false`);
    assert.equal(cap.modifyInfrastructure, false, `${name}.modifyInfrastructure must be false`);
  }
});

test("an unrecognized tool-call name is rejected with a safe message, not silently no-op'd", async () => {
  let requestCount = 0;
  await withMockedFetch(
    async () => {
      requestCount++;
      if (requestCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            message: { tool_calls: [{ type: "function", function: { name: "execute_shell_command", arguments: { cmd: "rm -rf /" } } }] },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: "I don't have access to that tool." } }) };
    },
    async () => {
      const result = await generateChatReplyWithTools({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "do something dangerous" }],
        model: "qwen2.5:7b",
        tools: TOOLS,
        executeTool: async () => {
          throw new Error("executeTool must never be called for a disallowed tool name");
        },
      });
      assert.equal(result.text, "I don't have access to that tool.");
    }
  );
  assert.equal(requestCount, 2, "the loop must continue safely to a final answer, not crash");
});

test("the rejected tool-call attempt is logged as a HIGH-severity capability violation", async () => {
  let requestCount = 0;
  await withMockedFetch(
    async () => {
      requestCount++;
      if (requestCount === 1) {
        return { ok: true, status: 200, json: async () => ({ message: { tool_calls: [{ type: "function", function: { name: "delete_all_files", arguments: {} } }] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: "done" } }) };
    },
    async () => {
      await generateChatReplyWithTools({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "test" }],
        model: "qwen2.5:7b",
        tools: TOOLS,
        executeTool: async () => [],
      });
    }
  );

  const rows = await waitForRow(
    `SELECT severity, event_type, resource_id FROM security_events WHERE event_type = 'ai_capability_violation' AND resource_id = $1 ORDER BY created_at DESC LIMIT 1`,
    ["delete_all_files"]
  );
  assert.equal(rows.length, 1, "expected the fire-and-forget capability-violation log to land within the timeout");
  assert.equal(rows[0].severity, "HIGH");
  assert.equal(rows[0].resource_id, "delete_all_files");
});

test("web_search (the one allowed tool) still executes normally, unaffected by the firewall", async () => {
  let executed = false;
  let requestCount = 0;
  await withMockedFetch(
    async () => {
      requestCount++;
      if (requestCount === 1) {
        return { ok: true, status: 200, json: async () => ({ message: { tool_calls: [{ type: "function", function: { name: "web_search", arguments: { query: "test" } } }] } }) };
      }
      return { ok: true, status: 200, json: async () => ({ message: { content: "answer" } }) };
    },
    async () => {
      await generateChatReplyWithTools({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "search something" }],
        model: "qwen2.5:7b",
        tools: TOOLS,
        executeTool: async () => {
          executed = true;
          return [];
        },
      });
    }
  );
  assert.equal(executed, true);
});
