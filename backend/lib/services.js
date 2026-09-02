// Canonical service catalog for the multi-select "services" intake (see
// routes/intake.js, controllers/intakeController.js's handleServicesIntake,
// frontend/services.html + frontend/js/services.js). Single source of
// truth for both backend validation and the AI pipeline (ai/servicesSchema.js
// / ai/servicesPrompt.js) — never redefined per file.
//
// "web-design" and "seo" are included here too (not just the three new
// services) because a prospect can combine them with the new services in
// one submission — see the multi-select requirement in the services intake
// form. The dedicated web-design.html/seo.html forms are untouched and
// still exist as focused single-service entry points; this is the combined
// path.
const SERVICE_SLUGS = ["web-design", "seo", "ai-integration", "app-building", "web-management"];

// Maps a service slug to the key its answers live under in a 'services'
// submission's projectDetails (see intakeController.js) — camelCase, to
// match every other field name convention in this codebase.
const SERVICE_DATA_KEYS = {
  "web-design": "webDesign",
  seo: "seo",
  "ai-integration": "aiIntegration",
  "app-building": "appBuilding",
  "web-management": "webManagement",
};

const SERVICE_LABELS = {
  "web-design": "Web Design",
  seo: "SEO",
  "ai-integration": "AI Integration",
  "app-building": "App Building",
  "web-management": "Web Management",
};

function isValidServiceSlug(value) {
  return typeof value === "string" && SERVICE_SLUGS.includes(value);
}

module.exports = { SERVICE_SLUGS, SERVICE_DATA_KEYS, SERVICE_LABELS, isValidServiceSlug };
