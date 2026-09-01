// Admin-managed feature/service catalog — see models/ContractFeature.js.
// Deliberately never referenced by ai/contractPrompt.js as a hardcoded
// list; the AI only ever sees whatever a specific contract's admin
// actually selected (see contractController.js's selected-features
// endpoints), not this whole catalog.
const ContractFeature = require("../models/ContractFeature");

async function listFeatures(req, res) {
  const includeInactive = req.query.includeInactive === "true";
  const features = await ContractFeature.findAll({ includeInactive });

  const byCategory = {};
  for (const f of features) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }
  res.json({ features, byCategory });
}

function validateFeatureBody(body, { partial }) {
  if (!partial || "category" in body) {
    if (typeof body.category !== "string" || !body.category.trim()) return "category is required.";
  }
  if (!partial || "name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) return "name is required.";
  }
  if ("defaultPrice" in body && body.defaultPrice !== null) {
    if (typeof body.defaultPrice !== "number" || !Number.isFinite(body.defaultPrice) || body.defaultPrice < 0) {
      return "defaultPrice must be a non-negative number.";
    }
  }
  return null;
}

async function createFeature(req, res) {
  const body = req.body || {};
  const validationError = validateFeatureBody(body, { partial: false });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const feature = await ContractFeature.create({
    category: body.category.trim(),
    name: body.name.trim(),
    description: body.description,
    defaultWording: body.defaultWording,
    defaultPrice: body.defaultPrice,
    sortOrder: body.sortOrder,
  });
  res.status(201).json({ feature });
}

async function updateFeature(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid feature id." });
  }

  const existing = await ContractFeature.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Feature not found." });
  }

  const body = req.body || {};
  const validationError = validateFeatureBody(body, { partial: true });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const feature = await ContractFeature.update(id, body);
  res.json({ feature });
}

// Deactivate, never a hard delete — see models/ContractFeature.js's
// deactivate() for why (past contracts' selected-feature snapshots must
// keep resolving).
async function deactivateFeature(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid feature id." });
  }

  const existing = await ContractFeature.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Feature not found." });
  }

  const feature = await ContractFeature.deactivate(id);
  res.json({ feature });
}

module.exports = { listFeatures, createFeature, updateFeature, deactivateFeature };
