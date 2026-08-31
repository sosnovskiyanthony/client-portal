const { z } = require("zod");

// Deliberately just two plain-text fields — this is the actual email
// content, not a structured internal artifact like AnalysisSchema. No
// markdown, no placeholder brackets: the prompt (see emailPrompt.js)
// instructs the model to write something ready to paste into an email client.
const EmailDraftSchema = z.object({
  subject: z.string().min(1).max(150).describe("Email subject line, plain text, no quotes around it."),
  body: z
    .string()
    .min(1)
    .max(4000)
    .describe("Full email body, plain text (no markdown), ready to send as-is."),
});

module.exports = { EmailDraftSchema };
