const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { ContractReviewSchema } = require("../ai/contractReviewSchema");
const { ContractDraftSchema } = require("../ai/contractSchema");

const VALID_REVIEW = {
  ready: false,
  warnings: [{ severity: "error", field: "pricing.price", message: "No price has been set." }],
  missing_information: ["pricing.price"],
  conflicts: [],
};

test("ContractReviewSchema accepts a fully valid review object", () => {
  const result = ContractReviewSchema.safeParse(VALID_REVIEW);
  assert.equal(result.success, true);
});

test("ContractReviewSchema rejects an invalid severity value", () => {
  const bad = { ...VALID_REVIEW, warnings: [{ severity: "catastrophic", field: "x", message: "y" }] };
  const result = ContractReviewSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("ContractReviewSchema rejects a missing required field", () => {
  const { ready, ...missingReady } = VALID_REVIEW;
  const result = ContractReviewSchema.safeParse(missingReady);
  assert.equal(result.success, false);
});

test("ContractReviewSchema produces a valid JSON Schema for structured-output use (Ollama format field)", () => {
  const jsonSchema = z.toJSONSchema(ContractReviewSchema);
  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.ready);
  assert.ok(jsonSchema.properties.warnings);
});

const VALID_DRAFT = {
  sections: [
    { key: "parties", title: "Parties", content: "This agreement is between BrindLeaf and the client." },
    { key: "pricing", title: "Pricing", content: "The total price is $3,000 USD." },
  ],
};

test("ContractDraftSchema accepts a fully valid draft object", () => {
  const result = ContractDraftSchema.safeParse(VALID_DRAFT);
  assert.equal(result.success, true);
});

test("ContractDraftSchema rejects a section missing content", () => {
  const bad = { sections: [{ key: "parties", title: "Parties" }] };
  const result = ContractDraftSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("ContractDraftSchema accepts an empty sections array (schema-valid; callers decide if that's usable)", () => {
  const result = ContractDraftSchema.safeParse({ sections: [] });
  assert.equal(result.success, true);
});

test("ContractDraftSchema produces a valid JSON Schema for structured-output use", () => {
  const jsonSchema = z.toJSONSchema(ContractDraftSchema);
  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.sections);
});
