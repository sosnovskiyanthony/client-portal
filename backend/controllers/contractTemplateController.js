// Admin-editable master template — see models/ContractTemplate.js. The
// legal section skeleton is owned by the business (and should be reviewed
// by real legal counsel), never invented by the AI; this is what makes
// that editable without a code change.
const ContractTemplate = require("../models/ContractTemplate");

async function listTemplates(req, res) {
  const templates = await ContractTemplate.findAll();
  res.json({ templates });
}

async function getTemplate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid template id." });
  }
  const template = await ContractTemplate.findById(id);
  if (!template) {
    return res.status(404).json({ error: "Template not found." });
  }
  res.json({ template });
}

function validateSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return "sections must be a non-empty array.";
  }
  for (const s of sections) {
    if (!s || typeof s.key !== "string" || !s.key.trim()) return "Every section needs a key.";
    if (typeof s.title !== "string" || !s.title.trim()) return "Every section needs a title.";
    if (typeof s.body_template !== "string") return "Every section needs body_template text (can be empty).";
  }
  const keys = sections.map((s) => s.key);
  if (new Set(keys).size !== keys.length) return "Section keys must be unique.";
  return null;
}

async function updateTemplate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid template id." });
  }

  const existing = await ContractTemplate.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Template not found." });
  }

  const body = req.body || {};
  if ("sections" in body) {
    const validationError = validateSections(body.sections);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
  }
  if ("name" in body && (typeof body.name !== "string" || !body.name.trim())) {
    return res.status(400).json({ error: "name must be a non-empty string." });
  }

  const template = await ContractTemplate.update(id, body);
  res.json({ template });
}

async function createTemplate(req, res) {
  const body = req.body || {};
  if (typeof body.name !== "string" || !body.name.trim()) {
    return res.status(400).json({ error: "name is required." });
  }
  const validationError = validateSections(body.sections);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const template = await ContractTemplate.create({ name: body.name.trim(), sections: body.sections });
  res.status(201).json({ template });
}

async function activateTemplate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid template id." });
  }
  const existing = await ContractTemplate.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Template not found." });
  }

  const template = await ContractTemplate.activate(id);
  res.json({ template });
}

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, activateTemplate };
