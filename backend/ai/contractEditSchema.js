// Structured-output schema for the AI Agreement Editor (see
// ai/contractEditPrompt.js, ai/aiService.js's interpretContractEditInstruction).
// The AI never writes to a contract directly — this schema is what it's
// allowed to PROPOSE; controllers/contractController.js's
// applyContractEditChanges is the only thing that ever actually writes,
// and only for changes an admin explicitly approved. See
// guardian/rules.js's consequential-ops-need-human-approval rule.
const { z } = require("zod");

const ContractChangeSchema = z.object({
  type: z.enum(["ADD", "MODIFY", "REMOVE", "AMEND"]).describe(
    "ADD: a new section. MODIFY: replace an existing section's content outright. AMEND: add to/adjust an existing section while keeping its existing content's intent — prefer this over ADD when the requested change belongs inside a section that already exists, so near-duplicate sections don't pile up. REMOVE: delete an existing section entirely."
  ),
  sectionKey: z.string().describe(
    "Must exactly match an existing contract section's key for MODIFY/REMOVE/AMEND. For ADD, a new short snake_case key that doesn't collide with an existing one."
  ),
  sectionTitle: z.string().describe("Human-readable section title"),
  currentText: z.string().nullable().describe("The section's existing content this change affects — null only for type ADD, where there is no existing content"),
  proposedText: z.string().nullable().describe("The new or updated section content in full (not a diff/patch) — null only for type REMOVE, where nothing remains"),
  rationale: z.string().describe("Plain-English explanation of why this specific change follows from the administrator's instruction — must cite the instruction, never just restate the change"),
  confidence: z.enum(["low", "medium", "high"]).describe("How directly the instruction supports this specific change — low if you had to infer or guess at intent"),
});

const ContractEditProposalSchema = z.object({
  summary: z.string().describe("Plain-English restatement of what the administrator's instruction actually requires, before any proposed wording"),
  interpretation: z.string().describe("How the instruction was understood in the context of this specific contract's current sections"),
  changes: z.array(ContractChangeSchema).describe("Empty when clarificationNeeded is true — do not propose a best-guess change alongside a clarification request"),
  clarificationNeeded: z.boolean().describe("True when the instruction is genuinely too ambiguous to propose specific, safe changes — see clarificationQuestions"),
  clarificationQuestions: z.array(z.string()).describe("Specific, targeted questions the administrator would need to answer before this instruction can be turned into real changes. Populated only when clarificationNeeded is true."),
});

module.exports = { ContractChangeSchema, ContractEditProposalSchema };
