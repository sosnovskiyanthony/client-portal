const Submission = require("../models/Submission");
const { notifyNewSubmission } = require("../services/email");

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function makeIntakeHandler(type) {
  return function handleIntake(req, res) {
    const data = req.body || {};
    const { name, email } = data;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "A name is required." });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email is required." });
    }

    const submission = Submission.create({
      type,
      clientName: name.trim(),
      email: email.trim(),
      projectDetails: data,
      flexiblePaymentPreference: typeof data.flexiblePaymentPreference === "boolean"
        ? data.flexiblePaymentPreference
        : null,
    });

    res.status(201).json({ submission });

    // Fire-and-forget — the submission already succeeded and was returned
    // above; a slow or failed email must never affect the response.
    notifyNewSubmission(submission).catch(() => {});
  };
}

module.exports = {
  webDesign: makeIntakeHandler("web-design"),
  seo: makeIntakeHandler("seo"),
};
