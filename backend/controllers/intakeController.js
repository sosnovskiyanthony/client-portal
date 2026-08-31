const Submission = require("../models/Submission");
const { notifyNewSubmission } = require("../services/email");

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function makeIntakeHandler(type) {
  return async function handleIntake(req, res) {
    const data = req.body || {};
    const { name, email } = data;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "A name is required." });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email is required." });
    }

    const submission = await Submission.create({
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

    // AI analysis is deliberately NOT triggered here. It only ever runs when
    // an authenticated admin clicks "Analyze with AI" (or "Re-analyze") in
    // the dashboard — see adminController.analyzeSubmission /
    // services/runAnalysis.js. That's what lets Ollama stay completely shut
    // down between uses instead of needing to be running for every intake.
  };
}

module.exports = {
  webDesign: makeIntakeHandler("web-design"),
  seo: makeIntakeHandler("seo"),
};
