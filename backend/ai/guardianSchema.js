// Structured-output schema for the Guardian AI code reviewer (see
// guardian/reviewCli.js, ai/aiService.js's reviewCodeChange). Same
// discipline as ai/schema.js's AnalysisSchema: typed fields, controlled
// vocabulary via enums, validated centrally in aiService.js via
// `.safeParse()` before a caller ever sees the result — a malformed model
// response is rejected, never silently stored or reported as a pass.
const { z } = require("zod");

const GuardianFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  category: z.string().describe("e.g. security, authorization, sql-injection, prompt-injection, rate-limiting, regression-risk, architecture"),
  file: z.string().describe("Path of the file this finding is about, from the diff/changed-files context given"),
  line: z.number().int().optional().describe("Line number in the new version of the file, when identifiable"),
  title: z.string().describe("Short, specific summary of the finding"),
  description: z.string().describe("What the problem is and why it matters — concrete, not generic advice"),
  evidence: z.string().describe("The specific code/pattern in the diff that supports this finding — quote it, don't paraphrase"),
  recommendation: z.string().describe("What to change. A suggestion only — Guardian never applies this automatically."),
});

const GuardianReviewSchema = z.object({
  overall: z.enum(["pass", "warn", "fail"]).describe(
    "Your overall read of this change. 'fail' only for a finding you're genuinely confident is a real, serious problem (e.g. a clear auth bypass, unparameterized SQL, a broken injection defense) — not for style preferences or speculative concerns."
  ),
  confidence: z.number().min(0).max(1).describe(
    "Your confidence in this review overall, as a decimal fraction between 0.0 and 1.0 — never a percentage like 85."
  ),
  findings: z.array(GuardianFindingSchema).describe(
    "Concrete, specific findings only. An empty array is the correct, preferred answer when the change looks fine — never pad this with speculative or generic findings to seem thorough."
  ),
  missing_tests: z.array(z.string()).describe("Specific, meaningful gaps in test coverage for this change — not a generic 'add more tests' — or empty."),
  architecture_violations: z.array(z.string()).describe("Specific rule ids/descriptions (from the rules given to you) this change appears to violate, or empty."),
  positive_observations: z.array(z.string()).describe("Specific things this change does well, worth naming — optional, can be empty."),
  summary: z.string().describe("2-4 sentence plain-language summary of this review for a developer skimming CI output."),
});

module.exports = { GuardianFindingSchema, GuardianReviewSchema };
