// Unit tests for services/runChat.js's findRegenerationTarget — the pure
// function that decides what gets re-asked and what gets kept when the
// admin clicks "Retry" on a chat reply. No DB, no mocked AI provider
// needed: this is exactly the logic that has to be right to guarantee the
// admin's message is never duplicated when a reply is regenerated.
const test = require("node:test");
const assert = require("node:assert/strict");
const { findRegenerationTarget, RegenerateValidationError } = require("../services/runChat");

test("regenerating the immediate last turn: re-asks the right prompt, keeps everything before it, drops only the trailing reply", () => {
  const messages = [
    { role: "admin", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "admin", content: "Second question" },
    { role: "assistant", content: "Second answer" },
  ];

  const { userMessage, historyForReply, messagesBeforeReply } = findRegenerationTarget(messages);

  assert.equal(userMessage, "Second question");
  assert.deepEqual(historyForReply, [
    { role: "admin", content: "First question" },
    { role: "assistant", content: "First answer" },
  ]);
  assert.deepEqual(messagesBeforeReply, [
    { role: "admin", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "admin", content: "Second question" },
  ]);
  // The admin's own message appears exactly once in what gets kept — the
  // caller appends exactly one new assistant reply to messagesBeforeReply,
  // so the final array can never end up with "Second question" twice.
  assert.equal(messagesBeforeReply.filter((m) => m.content === "Second question").length, 1);
});

test("walks back past an 'analysis' role entry to find the real prompt", () => {
  const messages = [
    { role: "admin", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
    { role: "admin", content: "Please analyze this" },
    { role: "analysis", content: { result: { project_summary: "s" } }, pastedText: "raw text" },
    { role: "assistant", content: "Here's my take" },
  ];

  const { userMessage, historyForReply } = findRegenerationTarget(messages);

  assert.equal(userMessage, "Please analyze this");
  assert.deepEqual(historyForReply, [
    { role: "admin", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
  ]);
});

test("rejects regenerating when the last message isn't an assistant reply", () => {
  const messages = [{ role: "admin", content: "Question with no reply yet" }];
  assert.throws(() => findRegenerationTarget(messages), RegenerateValidationError);
});

test("rejects regenerating an empty history", () => {
  assert.throws(() => findRegenerationTarget([]), RegenerateValidationError);
});

test("rejects when no preceding admin message exists at all", () => {
  const messages = [{ role: "assistant", content: "Somehow the only message" }];
  assert.throws(() => findRegenerationTarget(messages), RegenerateValidationError);
});
