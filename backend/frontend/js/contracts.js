(() => {
  const STATUS_LABELS = {
    draft: "Draft",
    needs_review: "Needs Review",
    ready_for_approval: "Ready for Approval",
    approved: "Approved",
    sent: "Sent",
    signed: "Signed",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  const els = {
    gate: document.getElementById("admin-gate"),
    btnLogin: document.getElementById("btn-admin-login"),
    btnLogout: document.getElementById("btn-admin-logout"),
    listView: document.getElementById("contracts-list-view"),
    listSub: document.getElementById("contracts-sub"),
    search: document.getElementById("contracts-search"),
    statusFilters: document.getElementById("contracts-status-filters"),
    tableBody: document.getElementById("contracts-table-body"),
    pagination: document.getElementById("contracts-pagination"),
    builderView: document.getElementById("contract-builder-view"),
    builderNumber: document.getElementById("builder-contract-number"),
    builderSub: document.getElementById("builder-sub"),
    builderActions: document.getElementById("builder-header-actions"),
    builderContent: document.getElementById("contract-builder-content"),
  };

  let currentStatus = "all";
  let currentSearch = "";
  let currentPage = 1;
  let searchDebounceHandle = null;

  // The feature catalog rarely changes mid-session — fetched once, reused
  // across every builder load, rather than re-fetched on every navigation.
  let featureCatalogCache = null;

  function getContractIdFromUrl() {
    const id = new URLSearchParams(window.location.search).get("contract");
    const n = Number(id);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function formatMoney(amount, currency) {
    if (amount === null || amount === undefined) return "—";
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(amount);
    } catch (err) {
      return `${amount} ${currency || ""}`.trim();
    }
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  async function render() {
    if (!isAdminLoggedIn()) {
      els.gate.hidden = false;
      els.listView.hidden = true;
      els.builderView.hidden = true;
      return;
    }
    els.gate.hidden = true;

    const contractId = getContractIdFromUrl();
    if (contractId) {
      els.listView.hidden = true;
      els.builderView.hidden = false;
      await loadBuilder(contractId);
    } else {
      els.builderView.hidden = true;
      els.listView.hidden = false;
      await loadList();
    }
  }

  // ---------- List view ----------

  async function loadList() {
    els.listSub.textContent = "Loading…";
    try {
      const data = await listContracts({ status: currentStatus, search: currentSearch, page: currentPage });
      renderTable(data.contracts);
      renderPagination(data.pagination);
      els.listSub.textContent = `${data.pagination.total} contract${data.pagination.total === 1 ? "" : "s"}`;
    } catch (err) {
      els.listSub.textContent = err.message;
      if (!isAdminLoggedIn()) render();
    }
  }

  function renderTable(contracts) {
    if (contracts.length === 0) {
      els.tableBody.innerHTML = `<tr><td colspan="6" class="contracts-empty">No contracts match this view.</td></tr>`;
      return;
    }
    els.tableBody.innerHTML = contracts
      .map(
        (c) => `
      <tr class="contracts-row" data-id="${c.id}" tabindex="0">
        <td class="contracts-number">${escapeHtml(c.contractNumber)}</td>
        <td>${escapeHtml(c.clientName || "—")}</td>
        <td>${escapeHtml(c.projectName || "—")}</td>
        <td>${escapeHtml(formatMoney(c.price, c.currency))}</td>
        <td><span class="contract-status-badge contract-status-${escapeHtml(c.status)}">${escapeHtml(STATUS_LABELS[c.status] || c.status)}</span></td>
        <td>${escapeHtml(formatDate(c.updatedAt))}</td>
      </tr>`
      )
      .join("");

    els.tableBody.querySelectorAll(".contracts-row").forEach((row) => {
      const go = () => {
        window.location.href = `admin-contracts.html?contract=${row.dataset.id}`;
      };
      row.addEventListener("click", go);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") go();
      });
    });
  }

  function renderPagination(pagination) {
    if (pagination.totalPages <= 1) {
      els.pagination.innerHTML = "";
      return;
    }
    const buttons = [];
    for (let p = 1; p <= pagination.totalPages; p++) {
      buttons.push(`<button class="pill ${p === pagination.page ? "selected" : ""}" data-page="${p}" type="button">${p}</button>`);
    }
    els.pagination.innerHTML = buttons.join("");
    els.pagination.querySelectorAll("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentPage = Number(btn.dataset.page);
        loadList();
      });
    });
  }

  function initListControls() {
    els.statusFilters.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill[data-status]");
      if (!btn) return;
      els.statusFilters.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
      btn.classList.add("selected");
      currentStatus = btn.dataset.status;
      currentPage = 1;
      loadList();
    });

    els.search.addEventListener("input", () => {
      clearTimeout(searchDebounceHandle);
      searchDebounceHandle = setTimeout(() => {
        currentSearch = els.search.value;
        currentPage = 1;
        loadList();
      }, 300);
    });
  }

  // ---------- Builder view ----------

  let activeContract = null;
  let activeSelectedFeatures = [];
  let activeVersions = [];

  async function loadBuilder(id) {
    els.builderSub.textContent = "Loading…";
    try {
      const [detail, catalog] = await Promise.all([
        getContractDetail(id),
        featureCatalogCache ? Promise.resolve(featureCatalogCache) : listContractFeatureCatalog(),
      ]);
      featureCatalogCache = catalog;
      activeContract = detail.contract;
      activeSelectedFeatures = detail.selectedFeatures;
      activeVersions = detail.versions;
      renderBuilder();
    } catch (err) {
      els.builderSub.textContent = err.message;
      if (!isAdminLoggedIn()) render();
    }
  }

  function renderBuilderHeader() {
    els.builderNumber.textContent = activeContract.contractNumber;
    els.builderSub.innerHTML = `<span class="contract-status-badge contract-status-${escapeHtml(activeContract.status)}">${escapeHtml(STATUS_LABELS[activeContract.status] || activeContract.status)}</span> · Updated ${escapeHtml(formatDate(activeContract.updatedAt))}`;
    els.builderActions.innerHTML = `<button class="btn btn-ghost" id="btn-delete-contract" type="button" ${activeContract.finalizedAt ? "disabled" : ""}>Delete</button>`;
    const deleteBtn = document.getElementById("btn-delete-contract");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!window.confirm(`Permanently delete ${activeContract.contractNumber}? This can't be undone.`)) return;
        try {
          await deleteContract(activeContract.id);
          window.location.href = "admin-contracts.html";
        } catch (err) {
          els.builderSub.textContent = err.message;
        }
      });
    }
  }

  function flashSaved(buttonEl, label = "Save") {
    const original = buttonEl.textContent;
    buttonEl.textContent = "Saved";
    buttonEl.disabled = true;
    setTimeout(() => {
      buttonEl.textContent = label;
      buttonEl.disabled = false;
    }, 1400);
  }

  function renderBuilder() {
    renderBuilderHeader();

    els.builderContent.innerHTML = `
      ${renderClientSection()}
      ${renderProjectSection()}
      ${renderScopeSection()}
      ${renderPricingSection()}
      ${renderPaymentTermsSection()}
      ${renderTimelineSection()}
      ${renderRevisionsSection()}
      ${renderResponsibilitiesSection()}
      ${renderCustomTermsSection()}
      ${renderReviewSection()}
      ${renderGenerationSection()}
    `;

    wireClientSection();
    wireProjectSection();
    wireScopeSection();
    wirePricingSection();
    wirePaymentTermsSection();
    wireTimelineSection();
    wireRevisionsSection();
    wireResponsibilitiesSection();
    wireCustomTermsSection();
    wireReviewSection();
    wireGenerationSection();
    loadVersionHistory();
  }

  function sectionCard(title, bodyHtml, { footnote } = {}) {
    return `
      <div class="contract-section">
        <h2 class="contract-section-title">${escapeHtml(title)}</h2>
        ${footnote ? `<p class="contract-section-footnote">${escapeHtml(footnote)}</p>` : ""}
        ${bodyHtml}
      </div>
    `;
  }

  // ---- Client Information ----
  function renderClientSection() {
    const c = activeContract;
    return sectionCard(
      "Client Information",
      `
      <p class="contract-imported-note">Name and email were imported from the originating submission — everything here is editable before it becomes part of the contract.</p>
      <div class="contract-field-grid">
        <label class="contract-field"><span>Client name</span><input type="text" id="cf-clientName" value="${escapeHtml(c.clientName || "")}" /></label>
        <label class="contract-field"><span>Company</span><input type="text" id="cf-clientCompany" value="${escapeHtml(c.clientCompany || "")}" /></label>
        <label class="contract-field"><span>Email</span><input type="email" id="cf-clientEmail" value="${escapeHtml(c.clientEmail || "")}" /></label>
        <label class="contract-field"><span>Phone</span><input type="text" id="cf-clientPhone" value="${escapeHtml(c.clientPhone || "")}" /></label>
        <label class="contract-field contract-field-wide"><span>Address</span><input type="text" id="cf-clientAddress" value="${escapeHtml(c.clientAddress || "")}" /></label>
      </div>
      <button class="btn btn-primary" id="btn-save-client" type="button">Save Client Information</button>
    `
    );
  }
  function wireClientSection() {
    document.getElementById("btn-save-client").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        activeContract = await updateContract(activeContract.id, {
          clientName: document.getElementById("cf-clientName").value.trim(),
          clientCompany: document.getElementById("cf-clientCompany").value.trim(),
          clientEmail: document.getElementById("cf-clientEmail").value.trim(),
          clientPhone: document.getElementById("cf-clientPhone").value.trim(),
          clientAddress: document.getElementById("cf-clientAddress").value.trim(),
        });
        flashSaved(btn, "Save Client Information");
        renderBuilderHeader();
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  // ---- Project Information ----
  function renderProjectSection() {
    const c = activeContract;
    return sectionCard(
      "Project Information",
      `
      <div class="contract-field-grid">
        <label class="contract-field contract-field-wide"><span>Project name</span><input type="text" id="cf-projectName" value="${escapeHtml(c.projectName || "")}" /></label>
        <label class="contract-field"><span>Project type</span><input type="text" id="cf-projectType" value="${escapeHtml(c.projectType || "")}" placeholder="e.g. Marketing site, E-commerce" /></label>
        <label class="contract-field contract-field-wide"><span>Description</span><textarea id="cf-projectDescription" rows="3">${escapeHtml(c.projectDescription || "")}</textarea></label>
      </div>
      <button class="btn btn-primary" id="btn-save-project" type="button">Save Project Information</button>
    `
    );
  }
  function wireProjectSection() {
    document.getElementById("btn-save-project").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        activeContract = await updateContract(activeContract.id, {
          projectName: document.getElementById("cf-projectName").value.trim(),
          projectType: document.getElementById("cf-projectType").value.trim(),
          projectDescription: document.getElementById("cf-projectDescription").value.trim(),
        });
        flashSaved(btn, "Save Project Information");
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  // ---- Scope of Work ----
  function isFeatureSelected(category, name) {
    return activeSelectedFeatures.some((f) => f.category === category && f.name === name && !f.isCustom);
  }

  function renderScopeSection() {
    const byCategory = featureCatalogCache ? featureCatalogCache.byCategory : {};
    const categoriesHtml = Object.keys(byCategory)
      .map(
        (category) => `
        <div class="scope-category">
          <h3 class="scope-category-title">${escapeHtml(category)}</h3>
          <div class="scope-checklist">
            ${byCategory[category]
              .map(
                (f) => `
              <label class="scope-checkbox">
                <input type="checkbox" data-category="${escapeHtml(f.category)}" data-name="${escapeHtml(f.name)}" data-wording="${escapeHtml(f.defaultWording || "")}" data-price="${f.defaultPrice ?? ""}" ${isFeatureSelected(f.category, f.name) ? "checked" : ""} />
                <span>${escapeHtml(f.name)}</span>
              </label>`
              )
              .join("")}
          </div>
        </div>`
      )
      .join("");

    const customFeatures = activeSelectedFeatures.filter((f) => f.isCustom);
    const customHtml = customFeatures.length
      ? `<div class="scope-custom-list">
          ${customFeatures
            .map(
              (f) => `
            <div class="scope-custom-item" data-row-id="${f.id}">
              <span>${escapeHtml(f.name)}${f.price ? ` — ${escapeHtml(formatMoney(f.price, activeContract.currency))}` : ""}</span>
              <button class="btn btn-ghost btn-small" data-remove-custom="${f.id}" type="button">Remove</button>
            </div>`
            )
            .join("")}
        </div>`
      : "";

    return sectionCard(
      "Scope of Work",
      `
      <p class="contract-section-footnote">Only what's explicitly checked here becomes part of the contract's scope. Anything not checked is out of scope by default — no feature is ever assumed included.</p>
      ${categoriesHtml}
      <h3 class="scope-category-title">Custom Features</h3>
      ${customHtml}
      <div class="scope-custom-form">
        <input type="text" id="cf-custom-name" placeholder="Feature name" />
        <input type="number" id="cf-custom-price" placeholder="Price (optional)" min="0" step="0.01" />
        <input type="text" id="cf-custom-notes" placeholder="Notes (optional)" />
        <button class="btn btn-ghost" id="btn-add-custom-feature" type="button">+ Add Custom Feature</button>
      </div>
      <button class="btn btn-primary" id="btn-save-scope" type="button">Save Scope of Work</button>
    `
    );
  }

  function wireScopeSection() {
    document.getElementById("btn-save-scope").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const checked = Array.from(document.querySelectorAll(".scope-checkbox input[type=checkbox]:checked"));
      const catalogFeatures = checked.map((el) => ({
        category: el.dataset.category,
        name: el.dataset.name,
        wording: el.dataset.wording || null,
        price: el.dataset.price ? Number(el.dataset.price) : null,
        isCustom: false,
      }));
      const customFeatures = activeSelectedFeatures
        .filter((f) => f.isCustom)
        .map((f) => ({ category: f.category, name: f.name, description: f.description, wording: f.wording, price: f.price, notes: f.notes, isCustom: true }));

      try {
        activeSelectedFeatures = await setContractFeatures(activeContract.id, [...catalogFeatures, ...customFeatures]);
        flashSaved(btn, "Save Scope of Work");
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });

    document.getElementById("btn-add-custom-feature").addEventListener("click", async () => {
      const name = document.getElementById("cf-custom-name").value.trim();
      if (!name) return;
      const price = document.getElementById("cf-custom-price").value;
      const notes = document.getElementById("cf-custom-notes").value.trim();
      try {
        await addCustomContractFeature(activeContract.id, {
          category: "Custom",
          name,
          price: price ? Number(price) : null,
          notes: notes || null,
        });
        const detail = await getContractDetail(activeContract.id);
        activeSelectedFeatures = detail.selectedFeatures;
        rerenderSection("scope", renderScopeSection, wireScopeSection);
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });

    document.querySelectorAll("[data-remove-custom]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await removeContractFeature(activeContract.id, Number(btn.dataset.removeCustom));
          const detail = await getContractDetail(activeContract.id);
          activeSelectedFeatures = detail.selectedFeatures;
          rerenderSection("scope", renderScopeSection, wireScopeSection);
        } catch (err) {
          els.builderSub.textContent = err.message;
        }
      });
    });
  }

  // Re-renders just one section's DOM node in place (by data-section
  // marker) rather than the whole builder — used after an action that
  // changes a section's own data mid-edit (adding/removing a custom
  // feature) so the admin doesn't lose focus/scroll position elsewhere.
  function rerenderSection(name, renderFn, wireFn) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderFn();
    const newNode = wrapper.firstElementChild;
    const oldNode = els.builderContent.querySelectorAll(".contract-section")[sectionIndex(name)];
    oldNode.replaceWith(newNode);
    wireFn();
  }
  const SECTION_ORDER = ["client", "project", "scope", "pricing", "payment", "timeline", "revisions", "responsibilities", "terms"];
  function sectionIndex(name) {
    return SECTION_ORDER.indexOf(name);
  }

  // ---- Pricing ----
  function renderPricingSection() {
    const c = activeContract;
    const submissionPriceNote = "";
    return sectionCard(
      "Pricing",
      `
      ${submissionPriceNote}
      <div class="contract-field-grid">
        <label class="contract-field"><span>Agreed price</span><input type="number" id="cf-price" min="0" step="0.01" value="${c.price ?? ""}" /></label>
        <label class="contract-field"><span>Currency</span><input type="text" id="cf-currency" value="${escapeHtml(c.currency || "USD")}" maxlength="3" style="text-transform:uppercase" /></label>
        <label class="contract-field"><span>Deposit %</span><input type="number" id="cf-depositPercentage" min="0" max="100" step="1" value="${c.depositPercentage ?? ""}" /></label>
        <label class="contract-field"><span>Deposit amount</span><input type="number" id="cf-depositAmount" min="0" step="0.01" value="${c.depositAmount ?? ""}" readonly /></label>
        <label class="contract-field"><span>Remaining balance</span><input type="number" id="cf-remainingBalance" min="0" step="0.01" value="${c.remainingBalance ?? ""}" readonly /></label>
      </div>
      <button class="btn btn-primary" id="btn-save-pricing" type="button">Save Pricing</button>
    `
    );
  }
  function wirePricingSection() {
    function recalc() {
      const price = Number(document.getElementById("cf-price").value) || 0;
      const pct = Number(document.getElementById("cf-depositPercentage").value) || 0;
      const depositAmount = Math.round(((price * pct) / 100) * 100) / 100;
      document.getElementById("cf-depositAmount").value = depositAmount || "";
      document.getElementById("cf-remainingBalance").value = price ? Math.round((price - depositAmount) * 100) / 100 : "";
    }
    document.getElementById("cf-price").addEventListener("input", recalc);
    document.getElementById("cf-depositPercentage").addEventListener("input", recalc);

    document.getElementById("btn-save-pricing").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const price = document.getElementById("cf-price").value;
      const depositPercentage = document.getElementById("cf-depositPercentage").value;
      const currency = document.getElementById("cf-currency").value.trim().toUpperCase() || "USD";
      try {
        activeContract = await updateContract(activeContract.id, {
          price: price ? Number(price) : null,
          currency,
          depositPercentage: depositPercentage ? Number(depositPercentage) : null,
          depositAmount: Number(document.getElementById("cf-depositAmount").value) || null,
          remainingBalance: Number(document.getElementById("cf-remainingBalance").value) || null,
        });
        flashSaved(btn, "Save Pricing");
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  // ---- Payment Terms ----
  function renderPaymentTermsSection() {
    const pt = activeContract.paymentTerms || {};
    return sectionCard(
      "Payment Terms",
      `
      <div class="contract-field-grid">
        <label class="contract-field contract-field-wide"><span>Payment schedule</span><textarea id="cf-pt-schedule" rows="2" placeholder="e.g. 50% deposit to begin, 50% due on delivery">${escapeHtml(pt.schedule || "")}</textarea></label>
        <label class="contract-field"><span>Payment method</span><input type="text" id="cf-pt-method" value="${escapeHtml(pt.method || "")}" placeholder="e.g. Bank transfer, Stripe invoice" /></label>
        <label class="contract-field"><span>Due dates</span><input type="text" id="cf-pt-dueDates" value="${escapeHtml(pt.dueDates || "")}" placeholder="e.g. Net 15" /></label>
        <label class="contract-field contract-field-wide"><span>Late payment terms</span><textarea id="cf-pt-late" rows="2">${escapeHtml(pt.latePaymentTerms || "")}</textarea></label>
      </div>
      <button class="btn btn-primary" id="btn-save-payment-terms" type="button">Save Payment Terms</button>
    `
    );
  }
  function wirePaymentTermsSection() {
    document.getElementById("btn-save-payment-terms").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        activeContract = await updateContract(activeContract.id, {
          paymentTerms: {
            schedule: document.getElementById("cf-pt-schedule").value.trim(),
            method: document.getElementById("cf-pt-method").value.trim(),
            dueDates: document.getElementById("cf-pt-dueDates").value.trim(),
            latePaymentTerms: document.getElementById("cf-pt-late").value.trim(),
          },
        });
        flashSaved(btn, "Save Payment Terms");
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  // ---- Timeline ----
  function toDateInputValue(value) {
    if (!value) return "";
    return new Date(value).toISOString().slice(0, 10);
  }
  function renderTimelineSection() {
    const c = activeContract;
    return sectionCard(
      "Timeline",
      `
      <p class="contract-section-footnote">These are estimates, not guaranteed deadlines — client delays (late content, late feedback) can shift them.</p>
      <div class="contract-field-grid">
        <label class="contract-field"><span>Start date</span><input type="date" id="cf-startDate" value="${toDateInputValue(c.startDate)}" /></label>
        <label class="contract-field"><span>Estimated completion</span><input type="date" id="cf-estimatedCompletionDate" value="${toDateInputValue(c.estimatedCompletionDate)}" /></label>
      </div>
      <button class="btn btn-primary" id="btn-save-timeline" type="button">Save Timeline</button>
    `
    );
  }
  function wireTimelineSection() {
    document.getElementById("btn-save-timeline").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        activeContract = await updateContract(activeContract.id, {
          startDate: document.getElementById("cf-startDate").value || null,
          estimatedCompletionDate: document.getElementById("cf-estimatedCompletionDate").value || null,
        });
        flashSaved(btn, "Save Timeline");
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  // ---- Revisions ----
  function renderRevisionsSection() {
    const c = activeContract;
    return sectionCard(
      "Revisions",
      `
      <div class="contract-field-grid">
        <label class="contract-field"><span>Included revisions</span><input type="number" id="cf-includedRevisions" min="0" step="1" value="${c.includedRevisions ?? ""}" /></label>
        <label class="contract-field"><span>Additional revision rate</span><input type="number" id="cf-additionalRevisionRate" min="0" step="0.01" value="${c.additionalRevisionRate ?? ""}" /></label>
        <label class="contract-field"><span>Additional work rate</span><input type="number" id="cf-additionalWorkRate" min="0" step="0.01" value="${c.additionalWorkRate ?? ""}" /></label>
      </div>
      <button class="btn btn-primary" id="btn-save-revisions" type="button">Save Revisions</button>
    `
    );
  }
  function wireRevisionsSection() {
    document.getElementById("btn-save-revisions").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const included = document.getElementById("cf-includedRevisions").value;
      try {
        activeContract = await updateContract(activeContract.id, {
          includedRevisions: included ? Number(included) : null,
          additionalRevisionRate: Number(document.getElementById("cf-additionalRevisionRate").value) || null,
          additionalWorkRate: Number(document.getElementById("cf-additionalWorkRate").value) || null,
        });
        flashSaved(btn, "Save Revisions");
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  // ---- Client Responsibilities ----
  function renderResponsibilitiesSection() {
    const list = Array.isArray(activeContract.clientResponsibilities) ? activeContract.clientResponsibilities : [];
    return sectionCard(
      "Client Responsibilities",
      `
      <p class="contract-section-footnote">One responsibility per line — e.g. "Provide final content and images", "Approve designs within 5 business days".</p>
      <textarea id="cf-responsibilities" rows="5" class="contract-textarea-wide">${escapeHtml(list.join("\n"))}</textarea>
      <button class="btn btn-primary" id="btn-save-responsibilities" type="button">Save Client Responsibilities</button>
    `
    );
  }
  function wireResponsibilitiesSection() {
    document.getElementById("btn-save-responsibilities").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const lines = document
        .getElementById("cf-responsibilities")
        .value.split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      try {
        activeContract = await updateContract(activeContract.id, { clientResponsibilities: lines });
        flashSaved(btn, "Save Client Responsibilities");
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  // ---- Additional Terms ----
  function renderCustomTermsSection() {
    return sectionCard(
      "Additional Terms",
      `
      <textarea id="cf-customTerms" rows="6" class="contract-textarea-wide" placeholder="Any specific provisions that should appear in the contract (IP ownership, confidentiality, cancellation terms, etc.)">${escapeHtml(activeContract.customTerms || "")}</textarea>
      <button class="btn btn-primary" id="btn-save-terms" type="button">Save Additional Terms</button>
    `
    );
  }
  function wireCustomTermsSection() {
    document.getElementById("btn-save-terms").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        activeContract = await updateContract(activeContract.id, {
          customTerms: document.getElementById("cf-customTerms").value.trim(),
        });
        flashSaved(btn, "Save Additional Terms");
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  // ---- AI Review (Task 1) ----
  const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
  let reviewInFlight = false;
  let reviewTickHandle = null;

  function renderReviewWarnings(reviewResult) {
    if (!reviewResult) return "";
    const sorted = [...reviewResult.warnings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
    const warningsHtml = sorted.length
      ? `<ul class="review-warning-list">${sorted
          .map((w) => `<li class="review-warning review-severity-${escapeHtml(w.severity)}"><span class="review-severity-badge">${escapeHtml(w.severity)}</span> ${escapeHtml(w.message)}</li>`)
          .join("")}</ul>`
      : `<p class="contract-section-footnote">No gaps found.</p>`;
    const conflictsHtml = reviewResult.conflicts.length
      ? `<h3 class="scope-category-title">Conflicts</h3><ul class="review-warning-list">${reviewResult.conflicts
          .map((c) => `<li class="review-warning review-severity-error"><span class="review-severity-badge">conflict</span> ${escapeHtml(c.field)}: ${escapeHtml(c.description)}</li>`)
          .join("")}</ul>`
      : "";
    return `
      <div class="review-result ${reviewResult.ready ? "review-ready" : "review-not-ready"}">
        <p class="review-ready-line">${reviewResult.ready ? "✓ Ready to draft" : "✗ Not ready — resolve the items below first"}</p>
        ${warningsHtml}
        ${conflictsHtml}
      </div>
    `;
  }

  function renderReviewSection() {
    const reviewedNote = activeContract.reviewedAt ? `Last reviewed ${formatDate(activeContract.reviewedAt)}` : "Not yet reviewed.";
    return sectionCard(
      "AI Review",
      `
      <p class="contract-section-footnote">Checks the data above for missing information and conflicts before drafting — it never changes anything itself. AI-generated content must be reviewed and approved before use.</p>
      <p class="contract-section-footnote" id="review-meta">${escapeHtml(reviewedNote)}</p>
      <button class="btn btn-primary" id="btn-run-review" type="button">Run AI Review</button>
      <div id="review-result-container">${renderReviewWarnings(activeContract.reviewResult)}</div>
    `
    );
  }

  function wireReviewSection() {
    document.getElementById("btn-run-review").addEventListener("click", async (e) => {
      if (reviewInFlight) return;
      const btn = e.currentTarget;
      reviewInFlight = true;
      const startTime = Date.now();
      btn.disabled = true;
      btn.textContent = "Reviewing… 0:00";

      reviewTickHandle = setInterval(() => {
        const s = Math.floor((Date.now() - startTime) / 1000);
        btn.textContent = `Reviewing… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      }, 1000);

      try {
        activeContract = await reviewContractWithAi(activeContract.id);
        document.getElementById("review-result-container").innerHTML = renderReviewWarnings(activeContract.reviewResult);
        document.getElementById("review-meta").textContent = `Last reviewed ${formatDate(activeContract.reviewedAt)}`;
      } catch (err) {
        els.builderSub.textContent = err.message;
      } finally {
        clearInterval(reviewTickHandle);
        reviewInFlight = false;
        btn.disabled = false;
        btn.textContent = "Run AI Review";
      }
    });
  }

  // ---- AI Generation (Task 2), editing, version history ----
  let generateInFlight = false;
  let generateTickHandle = null;

  function renderGeneratedSections(content) {
    if (!content || !Array.isArray(content.sections) || content.sections.length === 0) {
      return `<p class="contract-section-footnote">No draft yet — run AI Review first (recommended), then Generate Draft.</p>`;
    }
    return content.sections
      .map(
        (s, i) => `
        <div class="draft-section">
          <label class="contract-field"><span>${escapeHtml(s.title)}</span>
            <textarea class="draft-section-content" data-key="${escapeHtml(s.key)}" data-title="${escapeHtml(s.title)}" rows="4">${escapeHtml(s.content)}</textarea>
          </label>
        </div>`
      )
      .join("");
  }

  function renderGenerationSection() {
    return sectionCard(
      "Contract Draft",
      `
      <p class="contract-section-footnote">AI-generated content must be reviewed and approved before use — this is a draft, not a finished contract, until you explicitly approve it.</p>
      <div class="draft-actions">
        <button class="btn btn-primary" id="btn-generate-draft" type="button">${activeContract.generatedContent ? "Regenerate Draft" : "Generate Draft"}</button>
        <button class="btn btn-ghost" id="btn-save-draft-edits" type="button" ${activeContract.generatedContent ? "" : "disabled"}>Save Edits</button>
      </div>
      <div id="draft-sections-container">${renderGeneratedSections(activeContract.generatedContent)}</div>
      <h3 class="scope-category-title" style="margin-top:20px">Version History</h3>
      <div id="version-history-container"><p class="contract-section-footnote">Loading…</p></div>
    `
    );
  }

  function wireGenerationSection() {
    document.getElementById("btn-generate-draft").addEventListener("click", async (e) => {
      if (generateInFlight) return;
      const btn = e.currentTarget;
      generateInFlight = true;
      const startTime = Date.now();
      btn.disabled = true;
      const label = activeContract.generatedContent ? "Regenerate Draft" : "Generate Draft";
      btn.textContent = "Generating… 0:00";

      generateTickHandle = setInterval(() => {
        const s = Math.floor((Date.now() - startTime) / 1000);
        btn.textContent = `Generating… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      }, 1000);

      try {
        activeContract = await generateContractWithAi(activeContract.id);
        document.getElementById("draft-sections-container").innerHTML = renderGeneratedSections(activeContract.generatedContent);
        document.getElementById("btn-save-draft-edits").disabled = false;
        renderBuilderHeader();
        loadVersionHistory();
      } catch (err) {
        els.builderSub.textContent = err.message;
      } finally {
        clearInterval(generateTickHandle);
        generateInFlight = false;
        btn.disabled = false;
        btn.textContent = activeContract.generatedContent ? "Regenerate Draft" : "Generate Draft";
      }
    });

    document.getElementById("btn-save-draft-edits").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const sections = Array.from(document.querySelectorAll(".draft-section-content")).map((el) => ({
        key: el.dataset.key,
        title: el.dataset.title,
        content: el.value,
      }));
      try {
        activeContract = await saveContractContent(activeContract.id, sections);
        flashSaved(btn, "Save Edits");
        loadVersionHistory();
      } catch (err) {
        els.builderSub.textContent = err.message;
      }
    });
  }

  const VERSION_SOURCE_LABELS = { ai_generated: "AI Generated", admin_edited: "Edited by Admin", final: "Final" };

  async function loadVersionHistory() {
    const container = document.getElementById("version-history-container");
    if (!container) return;
    try {
      const versions = await getContractVersions(activeContract.id);
      if (versions.length === 0) {
        container.innerHTML = `<p class="contract-section-footnote">No versions yet.</p>`;
        return;
      }
      container.innerHTML = versions
        .map(
          (v) => `
        <div class="version-item">
          <span class="version-number">Version ${v.versionNumber}</span>
          <span class="version-source">${escapeHtml(VERSION_SOURCE_LABELS[v.source] || v.source)}</span>
          <span class="version-date">${escapeHtml(formatDate(v.createdAt))}</span>
        </div>`
        )
        .join("");
    } catch (err) {
      container.innerHTML = `<p class="contract-section-footnote">${escapeHtml(err.message)}</p>`;
    }
  }

  function init() {
    initCommon();
    initListControls();

    els.btnLogin.addEventListener("click", () => openModal("login"));
    els.btnLogout.addEventListener("click", () => {
      logoutAdmin();
      render();
    });

    window.addEventListener("studio:admin-auth-change", render);

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
