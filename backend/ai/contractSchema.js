// Structured-output schema for AI Task 2 (contract drafting) — see
// ai/contractPrompt.js. An array of {key, title, content} sections, keyed
// to the active template's own section list (see models/ContractTemplate.js)
// rather than a rigid fixed-shape object — the admin can add/remove/reorder
// template sections without this schema ever needing to change, and each
// entry maps directly to one editable block in the builder and one section
// of the eventual PDF.
const { z } = require("zod");

const ContractDraftSchema = z.object({
  sections: z.array(
    z.object({
      key: z.string().describe("Must match one of the template section keys given in the prompt"),
      title: z.string(),
      content: z.string().describe("Professional contract prose for this section, grounded only in the approved data provided"),
    })
  ),
});

module.exports = { ContractDraftSchema };
