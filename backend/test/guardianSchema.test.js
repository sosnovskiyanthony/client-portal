const test = require("node:test");
const assert = require("node:assert/strict");
const { GuardianReviewSchema } = require("../ai/guardianSchema");
const { z } = require("zod");

const BASE = {
  overall: "pass",
  confidence: 0.8,
  findings: [],
  missing_tests: [],
  architecture_violations: [],
  positive_observations: ["Parameterized SQL used throughout."],
  summary: "Small, low-risk change. No issues found.",
};

test("schema accepts a clean review with no findings — an honest, preferred answer", () => {
  const result = GuardianReviewSchema.safeParse(BASE);
  assert.equal(result.success, true);
});

test("schema accepts a review with populated findings/missing_tests/architecture_violations", () => {
  const withFindings = {
    ...BASE,
    overall: "warn",
    findings: [
      {
        severity: "medium",
        category: "regression-risk",
        file: "controllers/adminController.js",
        line: 42,
        title: "New route missing rate limiter",
        description: "The new endpoint has no limiter applied, unlike every other admin AI-calling route.",
        evidence: "router.post(\"/foo\", asyncHandler(...))",
        recommendation: "Add analysisLimiter, matching the other AI-calling routes.",
      },
    ],
    missing_tests: ["No test asserting the new route is JWT-protected."],
    architecture_violations: ["rate-limiting: new route has no limiter."],
  };
  const result = GuardianReviewSchema.safeParse(withFindings);
  assert.equal(result.success, true);
});

test("schema rejects an invalid 'overall' value", () => {
  const result = GuardianReviewSchema.safeParse({ ...BASE, overall: "maybe" });
  assert.equal(result.success, false);
});

test("schema rejects a finding missing required fields", () => {
  const bad = {
    ...BASE,
    findings: [{ severity: "high", category: "security" /* missing file/title/description/evidence/recommendation */ }],
  };
  const result = GuardianReviewSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema rejects an invalid finding severity", () => {
  const bad = {
    ...BASE,
    findings: [
      {
        severity: "catastrophic",
        category: "security",
        file: "a.js",
        title: "t",
        description: "d",
        evidence: "e",
        recommendation: "r",
      },
    ],
  };
  const result = GuardianReviewSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema rejects a confidence value outside 0-1", () => {
  const result = GuardianReviewSchema.safeParse({ ...BASE, confidence: 85 });
  assert.equal(result.success, false);
});

test("schema rejects a missing required top-level field", () => {
  const { summary, ...missing } = BASE;
  const result = GuardianReviewSchema.safeParse(missing);
  assert.equal(result.success, false);
});

test("schema produces a valid JSON Schema for structured-output use (Ollama format field)", () => {
  const jsonSchema = z.toJSONSchema(GuardianReviewSchema);
  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.findings);
  assert.equal(jsonSchema.properties.findings.type, "array");
});
