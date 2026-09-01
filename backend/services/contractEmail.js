// Builds the client-facing email accompanying a sent contract. Deliberately
// NOT AI-generated: the spec is explicit that "the email must NOT change
// the contractual terms" and "the contract itself is the authoritative
// document" — a fixed, reviewable template is the safer choice for a short
// transactional email than another AI generation pass with its own chance
// of drifting from the approved contract. The admin still reviews/edits
// the subject and body in the builder before anything is sent (see
// frontend/js/contracts.js's email section) — this is just the starting
// draft.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildContractEmailDraft(contract) {
  const firstName = (contract.clientName || "").trim().split(/\s+/)[0] || "there";
  const subject = `Your contract from BrindLeaf — ${contract.contractNumber}`;

  const body = `Hi ${escapeHtml(firstName)},

Thanks for working with us on ${escapeHtml(contract.projectName || "your project")}. Please find your contract (${escapeHtml(contract.contractNumber)}) attached as a PDF.

Please review it and reach out with any questions. Once you're ready to move forward, sign and return it and we'll get started.

Looking forward to working with you.

The BrindLeaf Team`;

  const html = `
    <div style="font-family:sans-serif;max-width:480px;white-space:pre-wrap;">
      ${escapeHtml(body).replace(/\n/g, "<br>")}
    </div>
  `;

  return { subject, body, html };
}

module.exports = { buildContractEmailDraft };
