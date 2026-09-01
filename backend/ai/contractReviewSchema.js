// Structured-output schema for AI Task 1 (contract completeness/conflict
// review) — see ai/contractReviewPrompt.js. Deliberately typed, not one
// giant free-text string, same reasoning as ai/schema.js.
const { z } = require("zod");

const ContractReviewSchema = z.object({
  ready: z.boolean().describe("True only if there is nothing missing or contradictory enough to block drafting the contract."),
  warnings: z.array(
    z.object({
      severity: z.enum(["info", "warning", "error"]),
      field: z.string().describe("Which piece of data this concerns, e.g. 'pricing', 'timeline', 'scope_of_work'"),
      message: z.string(),
    })
  ),
  missing_information: z.array(z.string()).describe("Concrete gaps — e.g. 'No estimated completion date has been set.'"),
  conflicts: z.array(
    z.object({
      field: z.string(),
      description: z.string().describe("What contradicts what, grounded only in the approved data actually provided"),
    })
  ),
});

module.exports = { ContractReviewSchema };
