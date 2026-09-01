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

module.exports = { notifyNewSubmission, buildEmailHtml };
