// Shared chrome for every page: cursor, spotlight, coordinate readout,
// magnetic tilt helper, the account menu, the auth modal, and the admin
// demo-auth + submission-storage helpers used by admin.html.
// Loaded before the page-specific script, which calls initCommon() and may
// call attachMagneticTilt() or saveSubmission() itself.

// BrindLeaf Guardian's frontend error monitoring — attached here, at the
// very top of common.js (not inside initCommon(), and not a separate
// <script> tag added to every page), so it's live for the entire page
// lifetime and catches errors from every script that loads after this one,
// including this file's own later code. Reuses the existing server-side
// Sentry pipe (see controllers/errorController.js) rather than adding the
// Sentry browser SDK or a second log store. Capped per page load so a
// broken page in an error loop can't turn into an unbounded request flood;
// never includes form contents or anything beyond the error's own
// message/stack/location — see errorController.js's own allowlist.
(function initErrorMonitor() {
  const MAX_REPORTS_PER_LOAD = 5;
  let reportCount = 0;

  function report(payload) {
    if (reportCount >= MAX_REPORTS_PER_LOAD) return;
    reportCount += 1;
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // An error handler must never itself throw.
    }
  }

  window.addEventListener("error", (event) => {
    // Ignore resource load errors (a missing image/script) — event.error is
    // only populated for an actual thrown JS exception.
    if (!event.error && !event.message) return;
    report({
      message: String(event.message || event.error?.message || "Unknown error"),
      stack: event.error?.stack,
      url: event.filename || location.href,
      line: event.lineno,
      col: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    report({
      message: String(reason?.message || reason || "Unhandled promise rejection"),
      stack: reason?.stack,
      url: location.href,
    });
  });
})();

const commonEls = {
  spotlight: document.getElementById("spotlight"),
  cursor: document.getElementById("cursor"),
  coordReadout: document.getElementById("coord-readout"),
  coordText: document.getElementById("coord-text"),
  menuToggle: document.getElementById("menu-toggle"),
  menuDropdown: document.getElementById("menu-dropdown"),
  modalOverlay: document.getElementById("modal-overlay"),
  modal: document.getElementById("modal"),
  modalBody: document.getElementById("modal-body"),
  modalClose: document.getElementById("modal-close"),
};

const mouse = { x: null, y: null };
const HOVER_SELECTOR = 'button, a, .hint-link, [role="button"]';
const TEXT_SELECTOR = ".field-input";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Shared field label maps ----------
// Single source of truth for human-readable labels for intake/contact field
// values. Used both by each form's own live-summary rendering
// (web-design.js, seo.js, contact.js) and by admin.js's dashboard display of
// the same submitted values — previously each of those four files kept an
// independent copy of these same maps, with no way to know they'd stayed in
// sync except by checking manually.
const FIELD_LABELS = {
  goal: {
    "lead-gen": "Lead Generation / Sales",
    ecommerce: "E-Commerce Storefront",
    brand: "Brand Authority / Portfolio",
    webapp: "Custom Web App / SaaS",
  },
  brandStatus: {
    established: "Fully established",
    expansion: "Needs expansion",
    scratch: "Starting from scratch",
  },
  features: {
    cms: "CMS Integration",
    animations: "Advanced Animations",
    integrations: "Third-Party Integrations",
    auth: "User Authentication / Portals",
    multilingual: "Multilingual Support",
  },
  contentReadiness: {
    ready: "Ready to go",
    draft: "Rough draft",
    help: "Need complete help",
  },
  timeline: {
    "2-4-weeks": "2–4 Weeks",
    "1-2-months": "1–2 Months",
    "3-plus-months": "3+ Months",
  },
  challenge: {
    "not-ranking": "Not ranking",
    "traffic-declining": "Traffic declining",
    "low-ctr": "Low click-through",
    "poor-conversion": "Poor conversion",
  },
  visibility: {
    "some-terms": "Ranking well for some terms",
    "barely-visible": "Barely visible",
    "not-sure": "Not sure",
  },
  reason: {
    "new-project": "New project inquiry",
    "seo-question": "Question about SEO",
    general: "General question",
    other: "Other",
  },
};

// Mirrors backend/lib/services.js's SERVICE_SLUGS/SERVICE_LABELS — kept
// here too (not shared, same reasoning as FIELD_LABELS above: this is
// frontend display code, that's backend validation code) since the site
// has no shared module system between them. Update both if the service
// catalog ever changes. Order here is the canonical display/step order
// used by services.html's dynamic section navigation.
const SERVICE_SLUGS = ["web-design", "seo", "ai-integration", "app-building", "web-management"];
const SERVICE_LABELS = {
  "web-design": "Web Design",
  seo: "SEO",
  "ai-integration": "AI Integration",
  "app-building": "App Building",
  "web-management": "Web Management",
};

// ---------- Cursor spotlight ----------

function initSpotlight() {
  let ticking = false;
  document.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;

    const isText = Boolean(e.target.closest(TEXT_SELECTOR));
    const isClickable = !isText && Boolean(e.target.closest(HOVER_SELECTOR));
    commonEls.cursor.classList.toggle("text-mode", isText);
    commonEls.cursor.classList.toggle("hover", isClickable);

    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      commonEls.spotlight.style.setProperty("--mx", `${e.clientX}px`);
      commonEls.spotlight.style.setProperty("--my", `${e.clientY}px`);
      ticking = false;
    });
  });

  document.addEventListener("mouseleave", () => {
    commonEls.coordReadout.classList.remove("visible");
    commonEls.cursor.classList.remove("visible");
  });
}

// ---------- Custom crosshair cursor (fluid follow) ----------

function initCursor() {
  let curX = 0;
  let curY = 0;
  let hasStarted = false;

  function loop() {
    if (mouse.x !== null) {
      if (!hasStarted) {
        curX = mouse.x;
        curY = mouse.y;
        hasStarted = true;
        commonEls.cursor.classList.add("visible");
      }
      curX += (mouse.x - curX) * 0.35;
      curY += (mouse.y - curY) * 0.35;

      commonEls.cursor.style.transform = `translate3d(${curX - 11}px, ${curY - 11}px, 0)`;
    }
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// ---------- Coordinate readout (trails the cursor with easing) ----------

function initCoordReadout() {
  let lagX = 0;
  let lagY = 0;
  let hasStarted = false;

  function loop() {
    if (mouse.x !== null) {
      if (!hasStarted) {
        lagX = mouse.x;
        lagY = mouse.y;
        hasStarted = true;
        commonEls.coordReadout.classList.add("visible");
      }
      lagX += (mouse.x - lagX) * 0.14;
      lagY += (mouse.y - lagY) * 0.14;

      commonEls.coordReadout.style.transform = `translate3d(${lagX + 16}px, ${lagY + 14}px, 0)`;
      commonEls.coordText.textContent = `${Math.round(mouse.x)}, ${Math.round(mouse.y)}`;
    }
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// ---------- Magnetic tilt (reusable on any card element) ----------

function attachMagneticTilt(el) {
  const strength = 8;

  el.addEventListener("mousemove", (e) => {
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transition = "transform 0.08s linear";
    el.style.transform = `perspective(700px) rotateX(${(-py * strength).toFixed(2)}deg) rotateY(${(px * strength).toFixed(2)}deg) translateY(-2px)`;
  });

  el.addEventListener("mouseleave", () => {
    el.style.transition = "transform 0.5s var(--ease-spring)";
    el.style.transform = "perspective(700px) rotateX(0) rotateY(0) translateY(0)";
  });
}

// ---------- Multi-step questionnaire helpers ----------
// Shared by web-design.js and seo.js — both are 3-section questionnaires
// built on the same .step-panel/.bento-card/.summary-row DOM conventions.
// These three are pure, stateless, and were byte-identical in both files.

function panelFor(section) {
  return document.querySelector(`.step-panel[data-step="${section}"]`);
}

function initMagneticCards() {
  document.querySelectorAll(".bento-card").forEach(attachMagneticTilt);
}

// Was a byte-identical copy in both home.js and web-design-services.js
// (each defining its own initAccordion() for the FAQ sections on those two
// pages) — same reasoning as the other shared helpers in this section.
function initAccordion() {
  const items = Array.from(document.querySelectorAll(".accordion-item"));

  items.forEach((item) => {
    const btn = item.querySelector(".accordion-question");

    btn.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");

      items.forEach((other) => {
        if (other === item) return;
        other.classList.remove("open");
        other.querySelector(".accordion-question").setAttribute("aria-expanded", "false");
      });

      item.classList.toggle("open", !isOpen);
      btn.setAttribute("aria-expanded", String(!isOpen));
    });
  });
}

function summaryRow(label, value, empty) {
  return `
    <div class="summary-row">
      <span class="summary-row-label">${label}</span>
      <span class="summary-row-value${empty ? " empty" : ""}">${empty ? "Not selected yet" : escapeHtml(value)}</span>
    </div>
  `;
}

// ---------- Draft persistence (save-and-return) ----------
// Each intake page auto-saves its in-progress state.data to localStorage on
// every change (see the saveDraft calls in web-design.js/seo.js/contact.js)
// and offers it back via the #draft-banner markup if the visitor returns
// before submitting. Cleared automatically on successful submit and on
// explicit dismissal.
const DRAFT_PREFIX = "studio:draft:";
// A draft older than this is more likely stale than actually wanted back.
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function saveDraft(key, data) {
  try {
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch (err) {
    // localStorage can throw (private browsing, full quota) — losing draft
    // persistence silently is fine, it's a convenience, not a requirement.
  }
}

function clearDraft(key) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
  } catch (err) {
    // ignore — see saveDraft
  }
}

function loadDraft(key) {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.data || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(DRAFT_PREFIX + key);
      return null;
    }
    return parsed;
  } catch (err) {
    return null;
  }
}

function formatDraftAge(savedAt) {
  const minutes = Math.round((Date.now() - savedAt) / 60000);
  if (minutes < 1) return "moments ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// Wires up the standard #draft-banner markup (present on web-design.html,
// seo.html, contact.html) against one page's saved draft. onRestore receives
// the saved data object and is responsible for writing it back into the
// page's own state + re-rendering — each page's fields are shaped
// differently, but the DOM-level restoration is handled by the two
// hydrate helpers below, shared across all three.
function initDraftBanner(key, onRestore) {
  const banner = document.getElementById("draft-banner");
  if (!banner) return;

  const draft = loadDraft(key);
  if (!draft) return;

  document.getElementById("draft-banner-text").textContent =
    `You have an unsaved draft from ${formatDraftAge(draft.savedAt)}.`;
  banner.hidden = false;

  document.getElementById("draft-restore-btn").addEventListener("click", () => {
    onRestore(draft.data);
    banner.hidden = true;
  });

  document.getElementById("draft-dismiss-btn").addEventListener("click", () => {
    clearDraft(key);
    banner.hidden = true;
  });
}

// Rehydrates the visual selection state of every [data-field] group (pill
// rows and bento-card grids) from a plain data object — the inverse of the
// click handlers each page's initSelectors() defines. Used to restore a
// saved draft's selections back onto the page.
function hydrateFieldSelectors(data) {
  document.querySelectorAll("[data-field]").forEach((group) => {
    const field = group.dataset.field;
    const mode = group.dataset.mode;
    const selector = group.classList.contains("pill-row") ? ".pill" : ".bento-card";
    const value = data[field];

    group.querySelectorAll(selector).forEach((c) => {
      const isSelected =
        mode === "single" ? c.dataset.value === value : Array.isArray(value) && value.includes(c.dataset.value);
      c.classList.toggle("selected", isSelected);
      c.setAttribute("aria-pressed", String(isSelected));
    });
  });
}

// Rehydrates plain text/textarea inputs from a plain data object. `bindings`
// is the same [[elementId, dataKey], ...] shape each page's initTextInputs()
// already defines.
function hydrateTextInputs(bindings, data) {
  bindings.forEach(([id, field]) => {
    const el = document.getElementById(id);
    if (el) el.value = data[field] || "";
  });
}

// The opposite direction of hydrateTextInputs — reads the CURRENT DOM
// value into the state object, rather than relying on the field's own
// "input" event having already kept state in sync. Call this right before
// validating/submitting a form, as a safety net: iOS Safari's QuickType
// autofill bar (triggered by autocomplete="name"/"email"/etc. — see
// web-design.html/seo.html/contact.html's contact fields) has a real,
// documented history of filling a field's visible value without reliably
// firing a standard "input" event in every iOS version. Without this, a
// client tapping an autofill suggestion sees the field fill in correctly
// on screen while the page's own JS state silently stays empty — the
// submit button then stays disabled (or, worse, a stale click handler
// silently no-ops) with no error a non-technical visitor would connect to
// "the name field I can see is filled in." A real lost-lead bug, not
// hypothetical — caught from a live client report.
function syncTextInputsFromDom(bindings, data) {
  bindings.forEach(([id, field]) => {
    const el = document.getElementById(id);
    if (el) data[field] = el.value;
  });
}

// The animated section-to-section transition (measure the incoming panel,
// resize the container, crossfade the panels) — was a ~45-line byte-
// identical block in both web-design.js and seo.js. This was the single
// most duplicated, most fragile piece (a future timing tweak would need to
// be made in two places and could easily drift). Everything page-specific
// (current section, how to update it, tab styling) is passed in rather than
// assumed, so this stays a pure animation mechanism with no knowledge of
// either questionnaire's own state shape.
function createSectionNavigator({ totalSections, stepContentEl, getCurrentSection, onSectionChange }) {
  let transitioning = false;

  return function goToSection(newSection) {
    const current = getCurrentSection();
    if (transitioning || newSection === current || newSection < 1 || newSection > totalSections) return;
    transitioning = true;

    const container = stepContentEl;
    const oldPanel = panelFor(current);
    const newPanel = panelFor(newSection);

    // Lock the current height as the transition's starting point.
    container.style.height = `${container.offsetHeight}px`;
    void container.offsetHeight;

    // Measure the incoming panel's natural height before touching layout.
    newPanel.classList.add("measuring");
    const targetHeight = newPanel.scrollHeight;
    newPanel.classList.remove("measuring");

    // Pull the outgoing panel out of flow immediately so it can't hold the
    // container open while it fades — this is what caused the empty-space
    // glitch when jumping from a tall section to a short one.
    oldPanel.classList.remove("active");
    oldPanel.classList.add("leaving");

    // Bring the incoming panel into flow and animate to its target height
    // in the same tick, so the resize and the crossfade run concurrently.
    newPanel.classList.add("visible");
    container.style.height = `${targetHeight}px`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => newPanel.classList.add("active"));
    });

    window.setTimeout(() => {
      oldPanel.classList.remove("visible", "leaving");
    }, 420);

    window.setTimeout(() => {
      container.style.height = "auto";
      transitioning = false;
    }, 520);

    onSectionChange(newSection);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

// ---------- Admin auth ----------
// Backed by the real API — POST /api/auth/login verifies the password
// server-side (bcrypt) and returns a JWT. We only keep the token itself in
// localStorage; every admin request sends it as a Bearer header, and the
// server independently re-checks it (and the user's role) on every call.

const ADMIN_TOKEN_KEY = "studio-admin-token";

function isAdminLoggedIn() {
  return Boolean(localStorage.getItem(ADMIN_TOKEN_KEY));
}

function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

async function loginAdmin(email, password) {
  let res;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    return { ok: false, error: "Can't reach the server. Is the backend running?" };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body.error || "Login failed." };
  }

  localStorage.setItem(ADMIN_TOKEN_KEY, body.token);
  window.dispatchEvent(new CustomEvent("studio:admin-auth-change"));
  return { ok: true, user: body.user };
}

function logoutAdmin() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  window.dispatchEvent(new CustomEvent("studio:admin-auth-change"));
}

// Real server-side logout (POST /api/auth/logout) — invalidates the
// current token via middleware/auth.js's token_version check, not just
// clearing it client-side the way logoutAdmin() alone does. Deliberately
// a SEPARATE function, not folded into logoutAdmin() itself:
// logoutAdmin() is called from ~20 "your session already expired, clean
// up" paths throughout this file (every 401/403 handler), where the
// token is already known-bad and hitting the server again would just be
// a wasted request. Call this first, only from an actual "Log Out"
// button click, while the token is still valid and attached — then call
// logoutAdmin() to clear it locally. Best-effort: if this fails (offline,
// server hiccup), the token still expires naturally at its normal TTL,
// exactly like today — never blocks the local logout from completing.
async function requestServerLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch {
    // Offline or server unreachable — the local logout below still runs.
  }
}

// ---------- Submission storage ----------
// Questionnaire pages call saveSubmission() on submit, which POSTs to the
// matching intake/contact endpoint. admin.html reads the saved submissions
// back with fetchSubmissions(), authenticated with the admin's JWT.

const INTAKE_ENDPOINTS = {
  "web-design": "/api/intake/web-design",
  seo: "/api/intake/seo",
  contact: "/api/contact",
  services: "/api/intake/services",
};

async function saveSubmission(type, data) {
  const endpoint = INTAKE_ENDPOINTS[type];
  if (!endpoint) throw new Error(`Unknown submission type: ${type}`);

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Submission failed. Please try again.");
  }
  return body.submission;
}

// Returns the full paginated response — { submissions, total, page,
// pageSize, totalPages } — not just the submissions array, since the admin
// dashboard needs the pagination metadata to render Prev/Next controls.
async function fetchSubmissions({ type, service, search, page } = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (service) params.set("service", service);
  if (search) params.set("search", search);
  if (page) params.set("page", String(page));
  const query = params.toString() ? `?${params.toString()}` : "";

  let res;
  try {
    res = await fetch(`/api/admin/submissions${query}`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't load submissions.");
  }
  return body;
}

async function updateSubmissionStatus(id, status) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAdminToken()}`,
      },
      body: JSON.stringify({ status }),
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't update status.");
  }
  return body.submission;
}

// Kicks off (or confirms an already-running) AI project analysis for one
// web-design submission and returns as soon as that's acknowledged (202) —
// the actual analysis runs in the background and can legitimately take
// several minutes against a local Ollama model, so this alone is never the
// full picture. Callers must poll getAnalysisProgress (see admin.js's
// pollForAnalysisOutcome) for the real, eventual result — same fire-and-
// poll shape as chat.js's paste-and-analyze flow, and for the same reason:
// no request in this flow should be held open long enough for anything
// ahead of this app to cut it off before the real answer is known.
async function analyzeSubmission(id) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${id}/analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Analysis request failed.");
  }
  return body;
}

// Triggers (or re-triggers) drafting a client-facing outreach email from a
// completed AI analysis. Admin-only server-side; only meaningful once
// analysis has completed for this submission (see routes/admin.js).
async function draftEmail(id) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${id}/draft-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Email draft request failed.");
  }
  return body.emailDraft;
}

// Records (or edits) the actual outcome of a project — works for any
// submission type, not just web-design. This is manually-entered, post-hoc
// data (final scope, actual timeline, quoted vs. final price, features
// delivered, notes) — the seed of a future predictive dataset.
async function upsertOutcome(id, data) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${id}/outcome`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAdminToken()}`,
      },
      body: JSON.stringify(data),
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't save outcome.");
  }
  return body.outcome;
}

// Downloads a CSV export of submissions (optionally filtered by type) as a
// Blob rather than a plain link — the export endpoint is admin-only and
// needs the Authorization header, which a plain <a href> navigation can't
// send. The caller turns the returned blob into an actual file download
// (see admin.js's initExport()).
async function exportSubmissionsCsv(type, service, search) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (service) params.set("service", service);
  if (search) params.set("search", search);
  let res;
  try {
    res = await fetch(`/api/admin/submissions/export?${params.toString()}`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Export failed.");
  }

  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : "submissions.csv";
  const blob = await res.blob();
  return { blob, filename };
}

// Gets a short-lived signed URL for viewing one brand asset (the storage
// bucket is private — see services/storage.js). Admin-only server-side.
async function getAssetSignedUrl(submissionId, path) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${submissionId}/storage/signed-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminToken()}` },
      body: JSON.stringify({ path }),
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't load this file.");
  }
  return body.url;
}

// Permanently deletes a submission and best-effort deletes any attached
// brand-asset files. Admin-only, irreversible — the caller is responsible
// for confirming with the admin first (see admin.js's delete button).
async function deleteSubmission(id) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Couldn't delete this submission.");
  }
}

// Removes one attached brand-asset file from a submission — the submission
// itself stays. Admin-only.
async function deleteAsset(id, path) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${id}/assets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminToken()}` },
      body: JSON.stringify({ path }),
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't remove this file.");
  }
  return body.submission;
}

// Deletes any Supabase Storage file no submission references, past a 24h
// safety window (see services/orphanCleanup.js). Admin-only, admin-
// triggered — there's no automatic schedule.
async function cleanupOrphanedAssets() {
  let res;
  try {
    res = await fetch("/api/admin/storage/cleanup-orphans", {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Cleanup failed.");
  }
  return body;
}

// Checks whether the remote Ollama host is currently running, via the
// control helper proxied through routes/admin.js's ollama/status route.
// Returns { running } normally; a 503 (control helper not configured on
// this server) is reported as a message rather than thrown, since that's
// an expected, non-error state for any deployment that hasn't set up
// remote control — see admin.js's renderOllamaControl().
async function getOllamaStatus() {
  let res;
  try {
    res = await fetch("/api/admin/ollama/status", {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  if (res.status === 503) {
    return { configured: false };
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't reach the Ollama host.");
  }
  return { configured: true, running: body.running };
}

// Shared by startOllamaRemote/stopOllamaRemote below — same request shape,
// just a different path and result field.
async function postOllamaControl(path) {
  let res;
  try {
    res = await fetch(`/api/admin/ollama/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Couldn't reach the Ollama host.`);
  }
  return body;
}

async function startOllamaRemote() {
  return postOllamaControl("start");
}

async function stopOllamaRemote() {
  return postOllamaControl("stop");
}

// BrindLeaf Guardian's production diagnostics panel (see admin.js's
// initGuardianPanel) — same request/error shape as the Ollama control
// helpers above.
async function getGuardianDiagnostics() {
  let res;
  try {
    res = await fetch("/api/admin/guardian/diagnostics", {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't run Guardian diagnostics.");
  }
  return body;
}

async function runGuardianCheck() {
  let res;
  try {
    res = await fetch("/api/admin/guardian/run", {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't run the Guardian check.");
  }
  return body;
}

async function getGuardianHistory(limit = 5) {
  let res;
  try {
    res = await fetch(`/api/admin/guardian/history?limit=${encodeURIComponent(limit)}`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't load Guardian history.");
  }
  return body.history || [];
}

// BrindLeaf Guardian's AI safety control plane (see guardian/aiControl.js)
// — same request/error shape as the Guardian diagnostics helpers above.
async function getAiControlState() {
  let res;
  try {
    res = await fetch("/api/admin/guardian/ai/state", {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't load AI control state.");
  }
  return body;
}

// Shared by disableAi/lockdownAi/enableAi below — same request shape, just
// a different path and (for "enable") a possible 409 with a blockingEvent.
async function postAiControlAction(action, reason) {
  let res;
  try {
    res = await fetch(`/api/admin/guardian/ai/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAdminToken()}` },
      body: JSON.stringify({ reason }),
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Couldn't ${action} AI.`);
    if (body.blockingEvent) err.blockingEvent = body.blockingEvent;
    throw err;
  }
  return body;
}

async function disableAi(reason) {
  return postAiControlAction("disable", reason);
}

async function lockdownAi(reason) {
  return postAiControlAction("lockdown", reason);
}

async function enableAi(reason) {
  return postAiControlAction("enable", reason);
}

async function getSecurityEvents(limit = 10) {
  let res;
  try {
    res = await fetch(`/api/admin/guardian/events?limit=${encodeURIComponent(limit)}`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't load security events.");
  }
  return body.events || [];
}

async function acknowledgeSecurityEvent(id) {
  let res;
  try {
    res = await fetch(`/api/admin/guardian/events/${id}/acknowledge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't acknowledge this event.");
  }
  return body;
}

// Security Center (see js/security.js) — the aggregate status/version
// panel, the paginated activity feed, and deployment history. Same
// request/error shape as every other admin fetch wrapper in this file.
async function getSecurityStatus() {
  let res;
  try {
    res = await fetch("/api/admin/security/status", {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't load system status.");
  }
  return body;
}

// `filters` may include: category, severity, source, eventType, from, to,
// resolved ("true"/"false"), limit, cursorCreatedAt, cursorId — all
// optional, all validated/clamped server-side (see
// controllers/guardianController.js's getSecurityEventsPage).
async function getSecurityEventsPage(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  let res;
  try {
    res = await fetch(`/api/admin/security/events?${params}`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't load activity.");
  }
  return body;
}

async function getSecurityDeployments(limit = 10) {
  let res;
  try {
    res = await fetch(`/api/admin/security/deployments?limit=${encodeURIComponent(limit)}`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't load deployment history.");
  }
  return body;
}

// Polled every second or two by admin.js while an analysis/draft is in
// flight, to show real backend-confirmed stages instead of a static label.
// Deliberately fails soft (returns null) rather than throwing: a missed
// poll should just leave the dashboard showing its last-known stage until
// the next tick, not force a logout or an error message over a background
// convenience request. The two real fetch calls (analyzeSubmission,
// draftEmail above) already own the real error/auth handling for this
// feature — this is not that.
async function getAnalysisProgress(id) {
  try {
    const res = await fetch(`/api/admin/submissions/${id}/analyze/progress`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function getEmailDraftProgress(id) {
  try {
    const res = await fetch(`/api/admin/submissions/${id}/draft-email/progress`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// ---------- "Add Context" — submission project intelligence ----------
// Same conventions as analyzeSubmission/getAnalysisProgress above: the
// action calls throw a real Error on failure (401 logs out, other
// failures surface body.error); the progress polls fail soft (return null)
// since a single missed poll shouldn't force a logout or error message.

async function getSubmissionContext(id) {
  const data = await contractFetch(`/api/admin/submissions/${id}/context`, { errorFallback: "Couldn't load project context." });
  return data;
}

async function startContextInterpretation(id, instruction) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${id}/context/interpret`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ instruction }),
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't start interpreting that note.");
  }
  return body;
}

async function getContextInterpretProgress(id) {
  try {
    const res = await fetch(`/api/admin/submissions/${id}/context/interpret/progress`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function applyContextChanges(id, { changeRecordId, changes, rejectedChanges }) {
  const data = await contractFetch(`/api/admin/submissions/${id}/context/apply`, {
    method: "POST",
    body: { changeRecordId, changes, rejectedChanges },
    errorFallback: "Couldn't apply the approved changes.",
  });
  return data;
}

async function getContextReanalysisProgress(id) {
  try {
    const res = await fetch(`/api/admin/submissions/${id}/context/reanalysis/progress`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// ---------- AI Pricing & Offer Strategy ----------
// Same conventions as the "Add Context" wrappers above.

async function getPricingHistory(id) {
  const data = await contractFetch(`/api/admin/submissions/${id}/pricing`, { errorFallback: "Couldn't load pricing history." });
  return data;
}

async function startPricingGeneration(id) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/${id}/pricing/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }
  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Couldn't start generating a pricing strategy.");
  }
  return body;
}

async function getPricingProgress(id) {
  try {
    const res = await fetch(`/api/admin/submissions/${id}/pricing/progress`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// ---------- Contracts ----------

// Shared by every Contracts helper below — same network/401/error-body
// contract every other authenticated admin fetch in this file follows
// (see analyzeSubmission above), factored out here since the Contracts
// feature adds enough call sites that repeating it verbatim ten more times
// would just be noise. Existing functions are left as-is rather than
// retrofitted onto this, to avoid touching already-working code.
async function contractFetch(url, { method = "GET", body, errorFallback } = {}) {
  let res;
  try {
    const headers = { Authorization: `Bearer ${getAdminToken()}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new Error("Can't reach the server. Is the backend running?");
  }

  if (res.status === 401 || res.status === 403) {
    logoutAdmin();
    throw new Error("Your session expired. Please log in again.");
  }
  if (res.status === 204) return null;

  const responseBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(responseBody.error || errorFallback || "Request failed.");
  }
  return responseBody;
}

async function listContracts({ status = "all", search = "", page = 1 } = {}) {
  const params = new URLSearchParams({ status, search, page: String(page) });
  return contractFetch(`/api/admin/contracts?${params}`, { errorFallback: "Couldn't load contracts." });
}

async function getContractDetail(id) {
  return contractFetch(`/api/admin/contracts/${id}`, { errorFallback: "Couldn't load this contract." });
}

async function createContractFromSubmission(submissionId) {
  const data = await contractFetch(`/api/admin/contracts/from-submission/${submissionId}`, {
    method: "POST",
    body: {},
    errorFallback: "Couldn't create a contract for this submission.",
  });
  return data.contract;
}

async function updateContract(id, fields) {
  const data = await contractFetch(`/api/admin/contracts/${id}`, {
    method: "PATCH",
    body: fields,
    errorFallback: "Couldn't save changes.",
  });
  return data.contract;
}

async function deleteContract(id) {
  await contractFetch(`/api/admin/contracts/${id}`, { method: "DELETE", errorFallback: "Couldn't delete this contract." });
}

async function setContractFeatures(id, features) {
  const data = await contractFetch(`/api/admin/contracts/${id}/features`, {
    method: "PATCH",
    body: { features },
    errorFallback: "Couldn't save the scope of work.",
  });
  return data.selectedFeatures;
}

async function addCustomContractFeature(id, feature) {
  const data = await contractFetch(`/api/admin/contracts/${id}/features/custom`, {
    method: "POST",
    body: feature,
    errorFallback: "Couldn't add that feature.",
  });
  return data.feature;
}

async function removeContractFeature(id, featureRowId) {
  await contractFetch(`/api/admin/contracts/${id}/features/${featureRowId}`, {
    method: "DELETE",
    errorFallback: "Couldn't remove that feature.",
  });
}

async function getContractAuditLog(id) {
  const data = await contractFetch(`/api/admin/contracts/${id}/audit-log`, { errorFallback: "Couldn't load the audit log." });
  return data.auditLog;
}

async function listContractFeatureCatalog() {
  const data = await contractFetch("/api/admin/contract-features", { errorFallback: "Couldn't load the feature catalog." });
  return data;
}

// AI Task 1 — a real AI call (can take a couple of minutes against a local
// model), so returns the whole contract (with the new reviewResult) on
// success and throws with a clear message on failure — same contract as
// analyzeSubmission above.
async function reviewContractWithAi(id) {
  const data = await contractFetch(`/api/admin/contracts/${id}/review`, {
    method: "POST",
    errorFallback: "AI review failed.",
  });
  return data.contract;
}

// Fails soft (returns null instead of throwing) — same reasoning as
// getAnalysisProgress: a missed poll during a live review shouldn't force
// a logout or an error message, just leave the UI showing its last-known
// stage until the next tick.
async function getContractReviewProgress(id) {
  try {
    const res = await fetch(`/api/admin/contracts/${id}/review/progress`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// AI Task 2 — same contract as reviewContractWithAi above.
async function generateContractWithAi(id) {
  const data = await contractFetch(`/api/admin/contracts/${id}/generate`, {
    method: "POST",
    errorFallback: "AI draft generation failed.",
  });
  return data.contract;
}

async function getContractGenerationProgress(id) {
  try {
    const res = await fetch(`/api/admin/contracts/${id}/generate/progress`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function saveContractContent(id, sections) {
  const data = await contractFetch(`/api/admin/contracts/${id}/content`, {
    method: "PATCH",
    body: { sections },
    errorFallback: "Couldn't save your edits.",
  });
  return data.contract;
}

// AI Agreement Editor — interpretation step. Genuinely fire-and-poll on the
// backend (202 immediately, real result only via getContractEditProgress
// below) — unlike reviewContractWithAi/generateContractWithAi above, this
// POST resolves the instant the background run is scheduled, not when the
// AI call finishes. See services/runContractEditInterpretation.js's
// comment for why (the same production incident that motivated chat.js's
// paste-and-analyze polling).
async function startContractEditInterpretation(id, instruction) {
  await contractFetch(`/api/admin/contracts/${id}/edit/interpret`, {
    method: "POST",
    body: { instruction },
    errorFallback: "Couldn't start interpreting that instruction.",
  });
}

// Fails soft (returns null instead of throwing) — same reasoning as
// getContractReviewProgress: a missed poll shouldn't force a logout or
// surface an error, just leave the UI showing its last-known state.
async function getContractEditProgress(id) {
  try {
    const res = await fetch(`/api/admin/contracts/${id}/edit/progress`, {
      headers: { Authorization: `Bearer ${getAdminToken()}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// Apply step — the only call that actually writes contract content as a
// result of the AI Agreement Editor, and only for admin-approved changes.
async function applyContractEditChanges(id, { changes, rejectedChanges, originalInstruction }) {
  const data = await contractFetch(`/api/admin/contracts/${id}/edit/apply`, {
    method: "POST",
    body: { changes, rejectedChanges, originalInstruction },
    errorFallback: "Couldn't apply the approved changes.",
  });
  return data;
}

async function getContractVersions(id) {
  const data = await contractFetch(`/api/admin/contracts/${id}/versions`, { errorFallback: "Couldn't load version history." });
  return data.versions;
}

async function generateContractPdf(id) {
  const data = await contractFetch(`/api/admin/contracts/${id}/pdf`, {
    method: "POST",
    errorFallback: "Couldn't generate the PDF.",
  });
  return data.contract;
}

// Returns a short-lived signed URL, never a permanent/public one — the
// caller should use it immediately (open/download), not store it.
async function getContractPdfUrl(id) {
  const data = await contractFetch(`/api/admin/contracts/${id}/pdf`, { errorFallback: "Couldn't get a link to the PDF." });
  return data.signedUrl;
}

async function approveContract(id) {
  const data = await contractFetch(`/api/admin/contracts/${id}/approve`, { method: "POST", errorFallback: "Couldn't approve this contract." });
  return data.contract;
}

async function finalizeContract(id) {
  const data = await contractFetch(`/api/admin/contracts/${id}/finalize`, { method: "POST", errorFallback: "Couldn't finalize this contract." });
  return data.contract;
}

async function setContractStatus(id, status) {
  const data = await contractFetch(`/api/admin/contracts/${id}/status`, {
    method: "POST",
    body: { status },
    errorFallback: "Couldn't change the contract status.",
  });
  return data.contract;
}

// Computed fresh, never persisted — returns { subject, body, to } for the
// admin to review/edit in the UI before calling sendContractEmail below.
async function draftContractEmail(id) {
  return contractFetch(`/api/admin/contracts/${id}/email/draft`, { errorFallback: "Couldn't draft the email." });
}

// Sends exactly the { to, subject, body } given — this function never
// regenerates them, so what the admin reviewed is exactly what's sent.
async function sendContractEmail(id, { to, subject, body }) {
  const data = await contractFetch(`/api/admin/contracts/${id}/email/send`, {
    method: "POST",
    body: { to, subject, body },
    errorFallback: "Couldn't send the email.",
  });
  return data.contract;
}

// ---------- Account menu ----------

function initMenu() {
  renderMenu();

  commonEls.menuToggle.addEventListener("click", () => {
    commonEls.menuDropdown.hidden ? openMenu() : closeMenu();
  });

  commonEls.menuDropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item[data-action]");
    if (!item) return;
    const action = item.dataset.action;
    closeMenu();

    if (action === "logout") {
      logoutAdmin();
      renderMenu();
    } else {
      openModal(action);
    }
  });

  document.addEventListener("click", (e) => {
    if (commonEls.menuDropdown.hidden) return;
    if (e.target.closest(".menu-root")) return;
    closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  window.addEventListener("studio:admin-auth-change", renderMenu);
}

function renderMenu() {
  if (isAdminLoggedIn()) {
    commonEls.menuDropdown.innerHTML = `
      <a class="menu-item" href="admin.html">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/></svg>
        Admin Dashboard
      </a>
      <a class="menu-item" href="admin-contracts.html">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5.5H10.5M5.5 8H10.5M5.5 10.5H8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Contracts
      </a>
      <a class="menu-item" href="admin-security.html">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V4.8C5.5 3.25 6.75 2 8.3 2C9.85 2 11 3.25 11 4.8V7" stroke="currentColor" stroke-width="1.4"/></svg>
        Security Center
      </a>
      <button class="menu-item" data-action="logout" type="button">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6 2H3.5C2.67 2 2 2.67 2 3.5V12.5C2 13.33 2.67 14 3.5 14H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10.5 5.5L14 8L10.5 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 8H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Log out
      </button>
    `;
  } else {
    commonEls.menuDropdown.innerHTML = `
      <button class="menu-item" data-action="login" type="button">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V4.8C5.5 3.25 6.75 2 8.3 2C9.85 2 11 3.25 11 4.8V7" stroke="currentColor" stroke-width="1.4"/></svg>
        Login
      </button>
      <button class="menu-item" data-action="signup" type="button">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 14C1.9 11.2 3.9 9.5 6.5 9.5C7.3 9.5 8.05 9.66 8.7 9.96" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12 7.5V12.5M9.5 10H14.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        Sign Up
      </button>
    `;
  }
}

function openMenu() {
  commonEls.menuDropdown.hidden = false;
  commonEls.menuToggle.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  commonEls.menuDropdown.hidden = true;
  commonEls.menuToggle.setAttribute("aria-expanded", "false");
}

// ---------- Auth modal ----------

const SIGNUP_CONTENT = {
  icon: '<svg width="20" height="20" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6" r="3" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 14C1.9 11.2 3.9 9.5 6.5 9.5C7.3 9.5 8.05 9.66 8.7 9.96" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12 7.5V12.5M9.5 10H14.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  title: "Create an account",
  text: "Account creation isn't open yet — for now, submit an intake form and we'll follow up personally.",
  ctaLabel: "Start Web Design Intake",
};

// The element focus should return to when the modal closes — the button
// that opened it, so a keyboard user doesn't lose their place. Only set on a
// genuine open-from-closed (see the `hidden` check in openModal), not when
// switching between login/signup while the modal is already open, so it
// always points at the real external trigger and never at a button that
// gets removed from the DOM by the next re-render.
let modalTriggerEl = null;

function getFocusableElements(container) {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(selector)).filter((el) => el.offsetParent !== null);
}

function initModal() {
  commonEls.modalClose.addEventListener("click", closeModal);
  commonEls.modalOverlay.addEventListener("click", (e) => {
    if (e.target === commonEls.modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (!commonEls.modalOverlay.classList.contains("visible")) return;

    if (e.key === "Escape") {
      closeModal();
      return;
    }

    // Focus trap: while the modal is open, Tab/Shift+Tab should only cycle
    // through elements inside it. Only intervene at the boundaries — first
    // element wraps to last on Shift+Tab, last wraps to first on Tab —
    // normal in-between Tab navigation is left alone.
    if (e.key === "Tab") {
      const focusable = getFocusableElements(commonEls.modal);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

function openModal(type) {
  if (commonEls.modalOverlay.hidden) {
    modalTriggerEl = document.activeElement;
  }

  if (type === "login") renderLoginModal();
  else if (type === "signup") renderSignupModal();
  else return;

  commonEls.modalOverlay.hidden = false;
  requestAnimationFrame(() => commonEls.modalOverlay.classList.add("visible"));
  commonEls.modalClose.focus();
}

function renderSignupModal() {
  const c = SIGNUP_CONTENT;
  commonEls.modalBody.innerHTML = `
    <div class="modal-icon">${c.icon}</div>
    <h2 class="modal-title">${c.title}</h2>
    <p class="modal-text">${c.text}</p>
    <button class="btn btn-primary" id="modal-cta" type="button">${c.ctaLabel}</button>
  `;

  document.getElementById("modal-cta").addEventListener("click", () => {
    closeModal();
    window.location.href = "web-design.html";
  });
}

function renderLoginModal() {
  commonEls.modalBody.innerHTML = `
    <div class="modal-icon"><svg width="20" height="20" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V4.8C5.5 3.25 6.75 2 8.3 2C9.85 2 11 3.25 11 4.8V7" stroke="currentColor" stroke-width="1.4"/></svg></div>
    <h2 class="modal-title">Admin login</h2>
    <p class="modal-text">Sign in to review submitted questionnaires and SEO requests.</p>
    <div class="modal-form">
      <label class="field">
        <span class="field-label">Email</span>
        <input class="field-input" type="email" id="login-email" placeholder="admin@brindleaf.dev" autocomplete="username" />
      </label>
      <label class="field">
        <span class="field-label">Password</span>
        <input class="field-input" type="password" id="login-password" autocomplete="current-password" />
      </label>
      <p class="modal-error" id="login-error"></p>
    </div>
    <button class="btn btn-primary" id="modal-cta" type="button">Sign in</button>
    <p class="modal-switch">Not an admin? <button type="button" data-switch="signup">Get in touch instead</button></p>
  `;

  const emailEl = document.getElementById("login-email");
  const passwordEl = document.getElementById("login-password");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("modal-cta");

  async function attempt() {
    submitBtn.disabled = true;
    const result = await loginAdmin(emailEl.value.trim(), passwordEl.value);
    submitBtn.disabled = false;

    if (result.ok) {
      closeModal();
      renderMenu();
    } else {
      errorEl.textContent = result.error;
      errorEl.classList.add("visible");
    }
  }

  submitBtn.addEventListener("click", attempt);
  [emailEl, passwordEl].forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") attempt();
    });
    el.addEventListener("input", () => errorEl.classList.remove("visible"));
  });

  commonEls.modalBody.querySelector("[data-switch]").addEventListener("click", (e) => {
    openModal(e.currentTarget.dataset.switch);
  });
}

function closeModal() {
  commonEls.modalOverlay.classList.remove("visible");
  window.setTimeout(() => {
    commonEls.modalOverlay.hidden = true;
  }, 250);

  if (modalTriggerEl && typeof modalTriggerEl.focus === "function") {
    modalTriggerEl.focus();
  }
  modalTriggerEl = null;
}

// ---------- Entry point ----------

// On narrow viewports the header's nav-tabs row scrolls horizontally
// instead of fitting every tab on screen (see css/style.css's .nav-tabs) —
// without this, whichever page you're actually on could load with its own
// highlighted tab scrolled out of view off to the right, with nothing
// visible to confirm you're looking at the right page until you swipe to
// find it. A no-op wherever the row already fits (desktop, or a tab near
// the start on mobile) — scrollIntoView does nothing when the target is
// already visible.
function initNavPillScroll() {
  const activeTab = document.querySelector(".nav-tabs .nav-tab.active");
  if (!activeTab) return;
  activeTab.scrollIntoView({ block: "nearest", inline: "center" });
}

function initCommon() {
  initSpotlight();
  initCursor();
  initCoordReadout();
  initMenu();
  initModal();
  initNavPillScroll();
}
