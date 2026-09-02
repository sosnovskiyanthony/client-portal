const { Resend } = require("resend");
const env = require("../config/env");

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

const TYPE_LABELS = {
  "web-design": "Web Design",
  seo: "SEO",
  contact: "Contact",
};

// Fire-and-forget: a failed or unconfigured email must never block or fail
// the submission itself, which has already saved successfully by the time
// this runs. Errors are logged, not thrown.
async function notifyNewSubmission(submission) {
  if (!resend || !env.notifyEmail) {
    console.log(
      `[email] Notification skipped (RESEND_API_KEY/NOTIFY_EMAIL not set) — submission #${submission.id}`
    );
    return;
  }

  const typeLabel = TYPE_LABELS[submission.type] || submission.type;

  try {
    // The Resend SDK does NOT throw on an API-level rejection (invalid
    // from-address, unverified domain, quota exceeded, etc.) — it resolves
    // normally with { data: null, error: {...} }, the same convention
    // Supabase's SDK uses. Checking only for a thrown exception here would
    // silently treat a rejected send as a success — which is exactly what
    // this code used to do.
    const { error } = await resend.emails.send({
      from: env.notifyFromEmail,
      to: env.notifyEmail,
      subject: `New ${typeLabel} submission — ${submission.clientName || "unknown"}`,
      html: buildEmailHtml(submission, typeLabel),
    });
    if (error) {
      console.error(
        `[email] Resend rejected notification for submission #${submission.id} (${error.name}):`,
        error.message
      );
      return;
    }
    console.log(`[email] Notified ${env.notifyEmail} of submission #${submission.id}`);
  } catch (err) {
    console.error(`[email] Failed to send notification for submission #${submission.id}:`, err.message);
  }
}

// Distinct from notifyNewSubmission on purpose: that one is a fire-and-
// forget internal notification where a failure must never block the
// caller. This is a real, admin-initiated action (contractController.js's
// send-contract-email endpoint) — the admin needs to know definitively
// whether it worked, so this throws on both a rejected send (same
// check-.error-not-just-try/catch fix as notifyNewSubmission above needed)
// and an unconfigured Resend setup, rather than silently no-op-ing.
async function sendContractEmail({ to, subject, html, pdfBuffer, pdfFilename }) {
  if (!resend) {
    throw new Error("Email sending is not configured on this server (RESEND_API_KEY not set).");
  }

  const attachments = pdfBuffer ? [{ filename: pdfFilename || "contract.pdf", content: pdfBuffer, contentType: "application/pdf" }] : undefined;

  const { error } = await resend.emails.send({
    from: env.notifyFromEmail,
    to,
    subject,
    html,
    attachments,
  });
  if (error) {
    throw new Error(`Resend rejected the email (${error.name}): ${error.message}`);
  }
}

// BrindLeaf Guardian's security alert email (see guardian/securityEvents.js
// — triggered automatically for a CRITICAL-severity security_events row).
// Fire-and-forget like notifyNewSubmission, deliberately NOT like
// sendContractEmail: a failure to send an alert email must never crash the
// application or block the security event itself from being persisted —
// the event already exists in the database and is visible in the admin
// dashboard regardless of whether this succeeds. Never includes secrets,
// tokens, or raw prompts/responses — only the same allowlisted fields
// already stored on the security_events row.
async function sendSecurityAlertEmail(event) {
  if (!resend || !env.notifyEmail) {
    console.log(`[email] Security alert email skipped (RESEND_API_KEY/NOTIFY_EMAIL not set) — event #${event.id}`);
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: env.notifyFromEmail,
      to: env.notifyEmail,
      subject: `BRINDLEAF GUARDIAN — ${event.severity}: ${event.eventType}`,
      html: buildSecurityAlertHtml(event),
    });
    if (error) {
      console.error(`[email] Resend rejected security alert for event #${event.id} (${error.name}):`, error.message);
      return;
    }
    console.log(`[email] Sent security alert for event #${event.id} to ${env.notifyEmail}`);
  } catch (err) {
    console.error(`[email] Failed to send security alert for event #${event.id}:`, err.message);
  }
}

function buildSecurityAlertHtml(event) {
  const metadataRows = Object.entries(event.metadata || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#71717a;font-size:13px;white-space:nowrap;">${escapeHtml(key)}</td><td style="padding:4px 0;font-size:13px;color:#18181b;">${escapeHtml(typeof value === "object" ? JSON.stringify(value) : String(value))}</td></tr>`
    )
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:520px;">
      <h2 style="margin:0 0 4px;color:#b91c1c;">BRINDLEAF GUARDIAN — ${escapeHtml(event.severity)}</h2>
      <p style="margin:0 0 4px;font-size:15px;color:#18181b;"><strong>${escapeHtml(event.eventType)}</strong></p>
      <p style="margin:0 0 16px;color:#71717a;font-size:13px;">Event #${event.id} · ${escapeHtml(String(event.createdAt))}</p>
      <p style="margin:0 0 16px;font-size:14px;color:#18181b;">${escapeHtml(event.description || "")}</p>
      ${metadataRows ? `<table style="border-collapse:collapse;margin-bottom:16px;">${metadataRows}</table>` : ""}
      <p style="margin:0;font-size:13px;color:#71717a;">Review this incident and, if it triggered an AI lockdown, acknowledge it in the admin dashboard's Guardian panel before re-enabling AI.</p>
    </div>
  `;
}

function buildEmailHtml(submission, typeLabel) {
  const rows = Object.entries(submission.projectDetails || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => {
      // brandAssets is an array of {path, filename, ...} objects, not
      // strings — the generic Array.isArray(value).join(", ") branch below
      // would otherwise render it as literal "[object Object]" text.
      const display =
        key === "brandAssets" && Array.isArray(value)
          ? value.map((a) => (a && typeof a === "object" ? a.filename || a.path : String(a))).join(", ")
          : Array.isArray(value)
            ? value.join(", ")
            : String(value);
      return `<tr><td style="padding:4px 12px 4px 0;color:#71717a;font-size:13px;white-space:nowrap;">${escapeHtml(key)}</td><td style="padding:4px 0;font-size:13px;color:#18181b;">${escapeHtml(display)}</td></tr>`;
    })
    .join("");

  return `
    <div style="font-family:sans-serif;max-width:480px;">
      <h2 style="margin:0 0 4px;">New ${escapeHtml(typeLabel)} submission</h2>
      <p style="margin:0 0 16px;color:#71717a;font-size:13px;">Submission #${submission.id} · ${escapeHtml(submission.createdAt)}</p>
      <table style="border-collapse:collapse;">${rows}</table>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { notifyNewSubmission, sendContractEmail, sendSecurityAlertEmail, buildEmailHtml };
