// Security & System Monitoring Center — a consolidated, readable interface
// over the existing Guardian/AI-control/security-event infrastructure (see
// guardian/*.js, controllers/guardianController.js). Nothing here is a
// second security system: every control action still goes through the
// exact same aiControl.setAiState()/logSecurityEvent() chokepoints the
// Submissions page's old panel used — this file only relocates and
// expands the UI around them. Shares common.js's auth/menu/modal exactly
// the way admin.js and chat.js do; no separate auth path.
(() => {
  const els = {
    gate: document.getElementById("admin-gate"),
    dashboard: document.getElementById("admin-dashboard"),
    adminSub: document.getElementById("admin-sub"),
    btnLogin: document.getElementById("btn-admin-login"),
    btnLogout: document.getElementById("btn-admin-logout"),
    snapshotBtn: document.getElementById("sec-snapshot-btn"),
    snapshotJsonBtn: document.getElementById("sec-snapshot-json-btn"),

    overallDot: document.getElementById("sec-overall-dot"),
    overallValue: document.getElementById("sec-overall-value"),
    systemsGrid: document.getElementById("sec-systems-grid"),
    versionBody: document.getElementById("sec-version-body"),
    consistencyBody: document.getElementById("sec-consistency-body"),
    criticalPanel: document.getElementById("sec-critical-panel"),
    criticalList: document.getElementById("sec-critical-list"),
    deploymentsBody: document.getElementById("sec-deployments-body"),

    aiControlDot: document.getElementById("ai-control-dot"),
    aiControlText: document.getElementById("ai-control-text"),
    aiControlReason: document.getElementById("ai-control-reason"),
    aiDisableBtn: document.getElementById("ai-disable-btn"),
    aiLockdownBtn: document.getElementById("ai-lockdown-btn"),
    aiEnableBtn: document.getElementById("ai-enable-btn"),

    ollamaControl: document.getElementById("ollama-control"),
    ollamaDot: document.getElementById("ollama-status-dot"),
    ollamaText: document.getElementById("ollama-status-text"),
    ollamaToggleBtn: document.getElementById("ollama-toggle-btn"),

    guardianDot: document.getElementById("guardian-status-dot"),
    guardianText: document.getElementById("guardian-status-text"),
    guardianLastCheck: document.getElementById("guardian-last-check"),
    guardianRunBtn: document.getElementById("guardian-run-btn"),
    guardianHistory: document.getElementById("guardian-history"),

    filterCategory: document.getElementById("sec-filter-category"),
    filterSeverity: document.getElementById("sec-filter-severity"),
    filterResolved: document.getElementById("sec-filter-resolved"),
    activityList: document.getElementById("sec-activity-list"),
    activityMoreBtn: document.getElementById("sec-activity-more-btn"),
    activityEmpty: document.getElementById("sec-activity-empty"),
  };

  if (!els.dashboard) return; // this file only ever loads on admin-security.html

  // Last-fetched aggregate status — what "Copy System Snapshot" reads
  // from. Deliberately not re-fetched when the snapshot button is
  // clicked: the snapshot describes what's already on screen, not a
  // fresh round of requests (see the plan's "avoid excessive requests").
  let lastStatus = null;
  let activityCursor = null;
  let ollamaActionInFlight = false;
  let ollamaControlUnavailable = false;

  const STATUS_LABELS = {
    HEALTHY: "Healthy",
    WARNING: "Warning",
    FAILED: "Failed",
    CRITICAL: "Critical",
    UNAVAILABLE: "Unavailable",
    NOT_CONFIGURED: "Not configured",
  };
  const STATUS_CLASSES = {
    HEALTHY: "sec-status-healthy",
    WARNING: "sec-status-warning",
    FAILED: "sec-status-failed",
    CRITICAL: "sec-status-critical",
    UNAVAILABLE: "sec-status-unavailable",
    NOT_CONFIGURED: "sec-status-unconfigured",
  };
  const SYSTEM_LABELS = {
    backend: "Backend / API",
    database: "Database",
    storage: "Storage",
    ai: "AI",
    guardian: "Guardian",
    integrity: "Integrity",
    ollama: "Ollama",
    resend: "Resend",
    tavily: "Tavily",
    railway: "Railway",
    github: "GitHub Actions",
    sentry: "Sentry",
    frontend: "Frontend",
  };
  // Fixed display order — object key order from the API is an
  // implementation detail, not something the UI should depend on.
  const SYSTEM_ORDER = ["frontend", "backend", "database", "storage", "ai", "guardian", "integrity", "ollama", "resend", "tavily", "railway", "github", "sentry"];

  function statusLabel(status) {
    return STATUS_LABELS[status] || "Unknown";
  }

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(
      () => {
        if (!btn) return;
        const original = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = original; }, 1500);
      },
      () => { if (btn) btn.textContent = "Copy failed"; }
    );
  }

  // ---------- Overall status + system grid ----------

  function renderOverall(status) {
    els.overallDot.classList.remove(...Object.values(STATUS_CLASSES));
    els.overallDot.classList.add(STATUS_CLASSES[status.overall] || "sec-status-unavailable");
    els.overallValue.textContent = statusLabel(status.overall);
  }

  function renderSystemsGrid(systems) {
    els.systemsGrid.innerHTML = SYSTEM_ORDER.filter((key) => systems[key]).map((key) => {
      const s = systems[key];
      const cls = STATUS_CLASSES[s.status] || "sec-status-unavailable";
      return `
        <div class="sec-system-card">
          <span class="sec-system-dot ${cls}" aria-hidden="true"></span>
          <div>
            <div class="sec-system-name">${escapeHtml(SYSTEM_LABELS[key] || key)}</div>
            <div class="sec-system-status">${escapeHtml(statusLabel(s.status))}</div>
            ${s.detail ? `<div class="sec-system-detail">${escapeHtml(s.detail)}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  // ---------- Production Version + Version Consistency ----------

  function renderVersion(version) {
    const sha = version.commitSha;
    els.versionBody.innerHTML = sha
      ? `
        <div class="sec-version-row">
          <span class="sec-version-label">Production Commit</span>
          <span class="sec-version-value sec-copyable" data-copy="${escapeHtml(sha)}" title="Click to copy full SHA">${escapeHtml(version.shortSha)}</span>
        </div>
        <div class="sec-version-row"><span class="sec-version-label">Branch</span><span class="sec-version-value">${escapeHtml(version.branch || "unknown")}</span></div>
        <div class="sec-version-row"><span class="sec-version-label">Environment</span><span class="sec-version-value">${escapeHtml(version.environment)}</span></div>
        <div class="sec-version-row"><span class="sec-version-label">Integrity</span><span class="sec-version-value">${version.integrityOk ? "Verified" : "⚠ Drift detected"}</span></div>
        <p class="sec-version-note">package.json version (${escapeHtml(version.packageJsonVersion)}) is not a release identifier — this app is versioned by commit, not semver.</p>
      `
      : `<p class="sec-version-note">No commit SHA available — this only appears when running on Railway (RAILWAY_GIT_COMMIT_SHA).</p>`;

    els.versionBody.querySelectorAll(".sec-copyable").forEach((el) => {
      el.addEventListener("click", () => copyToClipboard(el.dataset.copy, el));
    });
  }

  function renderConsistency(vc) {
    if (!vc.railway) {
      els.consistencyBody.innerHTML = `<p class="sec-version-note">Only the running application's own commit is known — configure RAILWAY_API_TOKEN to compare against what Railway actually has deployed.</p>`;
      return;
    }
    const rows = [
      ["Git / Running Application", vc.git],
      ["Railway", vc.railway],
      ["Integrity", vc.integrity],
    ];
    els.consistencyBody.innerHTML = `
      ${vc.consistent ? '<p class="sec-consistency-ok">✓ Production is running the expected version.</p>' : '<p class="sec-consistency-mismatch">⚠ Version mismatch — see below. This can mean a rollback, a deployment in progress, or stale metadata; not necessarily a problem.</p>'}
      ${rows.map(([label, value]) => `<div class="sec-version-row"><span class="sec-version-label">${escapeHtml(label)}</span><span class="sec-version-value">${escapeHtml(value == null ? "unknown" : String(value))}</span></div>`).join("")}
    `;
  }

  // ---------- Critical events ----------

  function renderCriticalEvents(events) {
    const critical = (events || []).filter((e) => e.severity === "CRITICAL" && !e.acknowledgedAt);
    if (critical.length === 0) {
      els.criticalPanel.hidden = true;
      return;
    }
    els.criticalPanel.hidden = false;
    els.criticalList.innerHTML = critical.map((e) => `
      <div class="sec-critical-item">
        <div class="sec-critical-title">${escapeHtml(e.description || e.eventType)}</div>
        <div class="sec-critical-meta">${escapeHtml(new Date(e.createdAt).toLocaleString())} — acknowledgement required before AI can be re-enabled</div>
        <button class="btn btn-ghost security-event-ack-btn" data-event-id="${e.id}" type="button">Acknowledge</button>
      </div>
    `).join("");
  }

  // ---------- AI Control Center (moved from admin.html, unchanged logic) ----------

  function renderAiControlStatus(state) {
    els.aiControlDot.classList.remove("is-enabled", "is-disabled", "is-lockdown");
    const classByState = { ENABLED: "is-enabled", DISABLED: "is-disabled", LOCKDOWN: "is-lockdown" };
    if (classByState[state.state]) els.aiControlDot.classList.add(classByState[state.state]);
    els.aiControlText.textContent = `AI: ${state.state}`;
    els.aiControlReason.textContent = state.reason || "";
    const isEnabled = state.state === "ENABLED";
    els.aiDisableBtn.hidden = !isEnabled;
    els.aiLockdownBtn.hidden = !isEnabled;
    els.aiEnableBtn.hidden = isEnabled;
  }

  async function refreshAiControlPanel() {
    try {
      const state = await getAiControlState();
      renderAiControlStatus(state);
    } catch (err) {
      els.aiControlText.textContent = "AI: unavailable";
      els.aiControlReason.textContent = "";
    }
  }

  function initAiControlPanel() {
    els.aiDisableBtn.addEventListener("click", async () => {
      if (!window.confirm("Disable all AI features? Every AI operation will be rejected until re-enabled.")) return;
      try {
        await disableAi("Disabled from the Security Center.");
        await Promise.all([refreshAiControlPanel(), refreshStatus()]);
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      }
    });

    els.aiLockdownBtn.addEventListener("click", async () => {
      if (!window.confirm("LOCK DOWN all AI features? This is the same state an automatic security incident would trigger, and re-enabling will require acknowledging it.")) return;
      try {
        await lockdownAi("Manually locked down from the Security Center.");
        await Promise.all([refreshAiControlPanel(), refreshStatus()]);
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      }
    });

    els.aiEnableBtn.addEventListener("click", async () => {
      const currentReason = els.aiControlReason.textContent;
      if (!window.confirm(`Re-enable AI?\n\nIt was disabled because: ${currentReason || "(no reason recorded)"}\n\nOnly do this once you're confident it's safe to resume.`)) return;
      try {
        await enableAi("Re-enabled from the Security Center.");
        await Promise.all([refreshAiControlPanel(), refreshStatus()]);
      } catch (err) {
        if (err.blockingEvent) {
          els.adminSub.textContent = `Cannot re-enable: acknowledge security event #${err.blockingEvent.id} (${err.blockingEvent.eventType}) first — see Critical Events above.`;
        } else {
          els.adminSub.textContent = err.message;
        }
        if (!isAdminLoggedIn()) render();
      }
    });

    els.criticalList.addEventListener("click", async (e) => {
      const btn = e.target.closest(".security-event-ack-btn[data-event-id]");
      if (!btn) return;
      const id = Number(btn.dataset.eventId);
      btn.disabled = true;
      try {
        await acknowledgeSecurityEvent(id);
        await Promise.all([refreshAiControlPanel(), refreshStatus()]);
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
        btn.disabled = false;
      }
    });
  }

  // ---------- Ollama remote control (moved from admin.html) ----------

  function setOllamaUi({ configured, running }) {
    if (!els.ollamaControl) return;
    if (!configured) {
      els.ollamaControl.hidden = true;
      return;
    }
    els.ollamaControl.hidden = false;
    els.ollamaDot.classList.remove("is-running", "is-stopped");
    els.ollamaDot.classList.add(running ? "is-running" : "is-stopped");
    els.ollamaText.textContent = `Ollama: ${running ? "running" : "stopped"}`;
    els.ollamaToggleBtn.hidden = false;
    els.ollamaToggleBtn.textContent = running ? "Stop" : "Start";
    els.ollamaToggleBtn.dataset.running = String(running);
  }

  async function refreshOllamaStatus() {
    if (ollamaControlUnavailable || !els.ollamaControl || ollamaActionInFlight) return;
    try {
      const result = await getOllamaStatus();
      if (!result.configured) {
        ollamaControlUnavailable = true;
        setOllamaUi({ configured: false });
        return;
      }
      setOllamaUi({ configured: true, running: result.running });
    } catch (err) {
      if (els.ollamaControl) {
        els.ollamaControl.hidden = false;
        els.ollamaDot.classList.remove("is-running");
        els.ollamaDot.classList.add("is-stopped");
        els.ollamaText.textContent = "Ollama: unreachable";
        els.ollamaToggleBtn.hidden = true;
      }
      if (!isAdminLoggedIn()) render();
    }
  }

  function initOllamaControl() {
    if (!els.ollamaToggleBtn) return;
    els.ollamaToggleBtn.addEventListener("click", async () => {
      if (ollamaActionInFlight) return;
      const wasRunning = els.ollamaToggleBtn.dataset.running === "true";
      ollamaActionInFlight = true;
      els.ollamaToggleBtn.disabled = true;
      els.ollamaToggleBtn.textContent = wasRunning ? "Stopping…" : "Starting…";
      try {
        if (wasRunning) await stopOllamaRemote();
        else await startOllamaRemote();
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      } finally {
        ollamaActionInFlight = false;
        els.ollamaToggleBtn.disabled = false;
        await refreshOllamaStatus();
      }
    });
  }

  // ---------- Guardian diagnostics panel (moved from admin.html, unchanged logic) ----------

  function renderGuardianStatus(overall, lastCheckIso) {
    els.guardianDot.classList.remove("is-healthy", "is-warning", "is-failed");
    const classByStatus = { HEALTHY: "is-healthy", WARNING: "is-warning", FAILED: "is-failed" };
    if (classByStatus[overall]) els.guardianDot.classList.add(classByStatus[overall]);
    // "Diagnostics Check" not "Guardian" — the systems grid above already
    // has a "Guardian" card folding in integrity too; this panel reports
    // something narrower and point-in-time (dependency reachability as of
    // the last manual/scheduled Run Guardian Check, persisted with
    // history), and using the same word for both read as the page
    // contradicting itself (caught in a real browser screenshot during
    // review — one said Warning, the other Critical, simultaneously).
    els.guardianText.textContent = `Diagnostics check: ${statusLabel(overall)}`;
    els.guardianLastCheck.textContent = lastCheckIso ? `Last checked ${new Date(lastCheckIso).toLocaleString()}` : "";
  }

  function renderGuardianHistory(rows) {
    if (!rows || rows.length === 0) {
      els.guardianHistory.hidden = true;
      els.guardianHistory.innerHTML = "";
      return;
    }
    els.guardianHistory.hidden = false;
    els.guardianHistory.innerHTML = rows
      .map((r) => `<div class="guardian-history-item"><span class="guardian-history-time">${escapeHtml(new Date(r.createdAt).toLocaleString())}</span><span>${escapeHtml(r.status)} — ${escapeHtml(r.summary || "")}</span></div>`)
      .join("");
  }

  async function refreshGuardianPanel() {
    try {
      const rows = await getGuardianHistory(5);
      renderGuardianHistory(rows);
      if (rows.length > 0) {
        renderGuardianStatus(rows[0].status, rows[0].createdAt);
        return;
      }
      const diagnostics = await getGuardianDiagnostics();
      renderGuardianStatus(diagnostics.overall, null);
    } catch (err) {
      els.guardianText.textContent = "Guardian: unavailable";
      els.guardianLastCheck.textContent = "";
    }
  }

  function initGuardianPanel() {
    els.guardianRunBtn.addEventListener("click", async () => {
      els.guardianRunBtn.disabled = true;
      const original = els.guardianRunBtn.textContent;
      els.guardianRunBtn.textContent = "Running…";
      try {
        const result = await runGuardianCheck();
        renderGuardianStatus(result.status, result.createdAt);
        const rows = await getGuardianHistory(5);
        renderGuardianHistory(rows);
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      } finally {
        els.guardianRunBtn.disabled = false;
        els.guardianRunBtn.textContent = original;
      }
    });
  }

  // ---------- Deployment history ----------

  async function refreshDeployments() {
    try {
      const result = await getSecurityDeployments(10);
      if (!result.railway.available) {
        els.deploymentsBody.innerHTML = `<p class="sec-version-note">${escapeHtml(result.railway.configured ? (result.railway.detail || "Railway deployment information unavailable.") : "Configure RAILWAY_API_TOKEN to see real deployment history here.")}</p>`;
        return;
      }
      if (result.deployments.length === 0) {
        els.deploymentsBody.innerHTML = `<p class="sec-version-note">No deployments found.</p>`;
        return;
      }
      els.deploymentsBody.innerHTML = `
        <table class="sec-deployments-table">
          <thead><tr><th>Status</th><th>Created</th><th>CI</th><th>Deployment ID</th></tr></thead>
          <tbody>
            ${result.deployments.map((d) => `
              <tr>
                <td>${escapeHtml(d.status || "unknown")}</td>
                <td>${d.createdAt ? escapeHtml(new Date(d.createdAt).toLocaleString()) : "—"}</td>
                <td>${d.ci && d.ci.available ? escapeHtml((d.ci.runs[0] && d.ci.runs[0].conclusion) || d.ci.runs[0]?.status || "unknown") : "—"}</td>
                <td class="sec-copyable" data-copy="${escapeHtml(d.id)}" title="Click to copy">${escapeHtml((d.id || "").slice(0, 8))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
      els.deploymentsBody.querySelectorAll(".sec-copyable").forEach((el) => {
        el.addEventListener("click", () => copyToClipboard(el.dataset.copy, el));
      });
    } catch (err) {
      els.deploymentsBody.innerHTML = `<p class="sec-version-note">Couldn't load deployment history: ${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------- Activity feed ----------

  function currentFilters() {
    return {
      category: els.filterCategory.value,
      severity: els.filterSeverity.value,
      resolved: els.filterResolved.value,
    };
  }

  function renderActivityItem(e) {
    const sevClass = `sev-${(e.severity || "").toLowerCase()}`;
    const ackBtn = e.acknowledgedAt
      ? `<span class="security-event-time">acknowledged</span>`
      : `<button class="btn btn-ghost security-event-ack-btn" data-event-id="${e.id}" type="button">Acknowledge</button>`;
    return `
      <div class="security-event-item">
        <span class="security-event-severity ${sevClass}">${escapeHtml(e.severity)}</span>
        <span class="sec-activity-category">${escapeHtml(e.category)}</span>
        <span class="security-event-time">${escapeHtml(new Date(e.createdAt).toLocaleString())}</span>
        <span>${escapeHtml(e.eventType)} — ${escapeHtml(e.description || "")}</span>
        ${ackBtn}
      </div>
    `;
  }

  async function loadActivityPage(reset) {
    if (reset) {
      activityCursor = null;
      els.activityList.innerHTML = "";
    }
    const filters = currentFilters();
    const page = await getSecurityEventsPage({
      ...filters,
      limit: 25,
      cursorCreatedAt: activityCursor ? activityCursor.createdAt : undefined,
      cursorId: activityCursor ? activityCursor.id : undefined,
    });
    els.activityList.insertAdjacentHTML("beforeend", page.events.map(renderActivityItem).join(""));
    activityCursor = page.nextCursor;
    els.activityMoreBtn.hidden = !page.nextCursor;
    els.activityEmpty.hidden = !(reset && page.events.length === 0);
  }

  function initActivityFeed() {
    [els.filterCategory, els.filterSeverity, els.filterResolved].forEach((el) => {
      el.addEventListener("change", () => loadActivityPage(true));
    });
    els.activityMoreBtn.addEventListener("click", () => loadActivityPage(false));
    els.activityList.addEventListener("click", async (e) => {
      const btn = e.target.closest(".security-event-ack-btn[data-event-id]");
      if (!btn) return;
      const id = Number(btn.dataset.eventId);
      btn.disabled = true;
      try {
        await acknowledgeSecurityEvent(id);
        loadActivityPage(true);
        refreshStatus();
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
        btn.disabled = false;
      }
    });
  }

  // ---------- System Snapshot ----------

  function buildSnapshotText() {
    if (!lastStatus) return "System status hasn't loaded yet.";
    const s = lastStatus;
    const lines = [
      "SECURITY SYSTEM SNAPSHOT",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      "APPLICATION",
      `Overall status: ${statusLabel(s.overall)}`,
      `Commit: ${s.version.commitSha || "unknown"}`,
      `Branch: ${s.version.branch || "unknown"}`,
      `Environment: ${s.version.environment}`,
      `Integrity: ${s.version.integrityOk ? "Verified" : "DRIFT DETECTED"}`,
      "",
      "SYSTEM STATUS",
      ...SYSTEM_ORDER.filter((k) => s.systems[k]).map((k) => `${SYSTEM_LABELS[k]}: ${statusLabel(s.systems[k].status)}${s.systems[k].detail ? ` — ${s.systems[k].detail}` : ""}`),
      "",
      "AI CONTROL",
      `State: ${s.aiControl.state}`,
      `Reason: ${s.aiControl.reason || "—"}`,
      "",
      "VERSION CONSISTENCY",
      `Consistent: ${s.versionConsistency.consistent ? "Yes" : "No — see Railway/Git values above"}`,
    ];
    return lines.join("\n");
  }

  function initSnapshot() {
    els.snapshotBtn.addEventListener("click", () => copyToClipboard(buildSnapshotText(), els.snapshotBtn));
    els.snapshotJsonBtn.addEventListener("click", () => copyToClipboard(JSON.stringify(lastStatus, null, 2), els.snapshotJsonBtn));
  }

  // ---------- Bootstrap ----------

  async function refreshStatus() {
    try {
      const status = await getSecurityStatus();
      lastStatus = status;
      renderOverall(status);
      renderSystemsGrid(status.systems);
      renderVersion(status.version);
      renderConsistency(status.versionConsistency);
      els.adminSub.textContent = `Overall status: ${statusLabel(status.overall)}.`;
    } catch (err) {
      els.overallValue.textContent = "Unavailable";
      els.adminSub.textContent = err.message;
      if (!isAdminLoggedIn()) render();
    }

    // Critical events pulled from the same unfiltered recent-events read
    // the old panel used — separate from the paginated activity feed
    // below, since this needs to always be visible regardless of
    // whatever filters are currently applied to that feed.
    try {
      const events = await getSecurityEvents(20);
      renderCriticalEvents(events);
    } catch (err) {
      // non-fatal — the rest of the page still works
    }
  }

  async function render() {
    if (!isAdminLoggedIn()) {
      els.dashboard.hidden = true;
      els.gate.hidden = false;
      return;
    }
    els.gate.hidden = true;
    els.dashboard.hidden = false;
    await refreshStatus();
    refreshAiControlPanel();
    refreshOllamaStatus();
    refreshGuardianPanel();
    refreshDeployments();
    loadActivityPage(true);
  }

  function init() {
    initCommon();
    initAiControlPanel();
    initOllamaControl();
    initGuardianPanel();
    initActivityFeed();
    initSnapshot();

    els.btnLogin.addEventListener("click", () => openModal("login"));
    els.btnLogout.addEventListener("click", async () => {
      await requestServerLogout();
      logoutAdmin();
      render();
    });

    window.addEventListener("studio:admin-auth-change", render);

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
