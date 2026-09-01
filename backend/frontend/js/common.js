// Shared chrome for every page: cursor, spotlight, coordinate readout,
// magnetic tilt helper, the account menu, the auth modal, and the admin
// demo-auth + submission-storage helpers used by admin.html.
// Loaded before the page-specific script, which calls initCommon() and may
// call attachMagneticTilt() or saveSubmission() itself.

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

// ---------- Submission storage ----------
// Questionnaire pages call saveSubmission() on submit, which POSTs to the
// matching intake/contact endpoint. admin.html reads the saved submissions
// back with fetchSubmissions(), authenticated with the admin's JWT.

const INTAKE_ENDPOINTS = {
  "web-design": "/api/intake/web-design",
  seo: "/api/intake/seo",
  contact: "/api/contact",
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
async function fetchSubmissions({ type, page } = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
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

// Triggers (or re-triggers) the AI project analysis for one web-design
// submission. Admin-only server-side (see routes/admin.js); the request can
// legitimately take a couple of minutes against a local Ollama model, so
// callers should show a loading state rather than assume this resolves fast.
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
  return body.analysis;
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
async function exportSubmissionsCsv(type) {
  let res;
  try {
    res = await fetch(`/api/admin/submissions/export?type=${encodeURIComponent(type)}`, {
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
async function getAssetSignedUrl(path) {
  let res;
  try {
    res = await fetch("/api/admin/storage/signed-url", {
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

function initCommon() {
  initSpotlight();
  initCursor();
  initCoordReadout();
  initMenu();
  initModal();
}
