const { z } = require("zod");

// Three genuinely different deliverables from one call, kept as separate
// typed fields (not one undifferentiated blob) so the app can route each
// to the right place and enforce the right visibility for each — see
// ai/emailPrompt.js's own header comment for the full reasoning.
const EmailDraftSchema = z.object({
  // The AI's actual strategic reasoning (objectives, architecture, MVP vs.
  // future features, design direction, user journeys, risks, etc.) as
  // markdown, starting with "# INTERNAL PROJECT ANALYSIS" and the full set
  // of "##" subsections the prompt requires. Admin-only — never surfaced
  // to the client (see guardian/rules.js's no-internal-leak rule) and
  // never sent as part of the email/text message.
  internalAnalysisMarkdown: z.string().min(1).describe(
    "Full internal strategic analysis as markdown, starting with '# INTERNAL PROJECT ANALYSIS'. Admin-only — must never contain anything meant to be sent to the client, and the email/textMessage fields must never reference it."
  ),
  subject: z.string().min(1).max(150).describe("Email subject line, plain text, no quotes around it."),
  body: z
    .string()
    .min(1)
    .max(4000)
    .describe("Full email body, plain text (no markdown other than the '* ' bullets the prompt calls for), ready to send as-is."),
  textMessage: z.string().min(1).max(500).describe("A short, conversational text message that accompanies the email — never repeats the whole email, never exposes internal analysis."),
});

module.exports = { EmailDraftSchema };
