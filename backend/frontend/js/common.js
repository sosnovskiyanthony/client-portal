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

async function fetchSubmissions() {
  let res;
  try {
    res = await fetch("/api/admin/submissions", {
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
  return body.submissions;
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

function initModal() {
  commonEls.modalClose.addEventListener("click", closeModal);
  commonEls.modalOverlay.addEventListener("click", (e) => {
    if (e.target === commonEls.modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && commonEls.modalOverlay.classList.contains("visible")) closeModal();
  });
}

function openModal(type) {
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
    <div class="modal-demo-hint">Seeded admin account: <strong>admin@studio.dev</strong> / <strong>studio-admin</strong> (set via the backend's .env). Verified server-side against a hashed password.</div>
    <div class="modal-form">
      <label class="field">
        <span class="field-label">Email</span>
        <input class="field-input" type="email" id="login-email" placeholder="admin@studio.dev" autocomplete="username" />
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
}

// ---------- Entry point ----------

function initCommon() {
  initSpotlight();
  initCursor();
  initCoordReadout();
  initMenu();
  initModal();
}
