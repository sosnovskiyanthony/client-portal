// Guardian's static-analysis layer — defect detection, not style enforcement.
// Deliberately just eslint:recommended: no Prettier, no stylistic rules, no
// repo-wide reformatting. See guardian/README.md for the reasoning and for
// how to add or relax a rule.
"use strict";

const js = require("@eslint/js");

module.exports = [
  {
    ignores: ["node_modules/**", "frontend/**/vendor/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "writable",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        fetch: "readonly",
        globalThis: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      // Local intake-form free-text often flows through unused destructured
      // fields in tests/fixtures — warn, don't block, and allow the
      // conventional "prefix with _ to mean intentionally unused" escape.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      // eslint:recommended as of ESLint 10 added this rule as an error. It's
      // a real, worthwhile finding (rethrowing without `{ cause: err }` loses
      // the original stack trace) but this codebase has ~15 pre-existing,
      // intentional "catch a raw fetch/network failure, throw a cleaner
      // user-facing message" call sites (see frontend/js/common.js's fetch
      // wrappers) that all trip it. Fixing 15 unrelated call sites isn't in
      // scope for the change that introduced linting — see guardian/README.md.
      // Downgraded to warn (visible, non-blocking) rather than fixed in bulk
      // or silently disabled; new code is still expected to pass `cause`.
      "preserve-caught-error": "warn",
    },
  },
  {
    // Browser globals for the vanilla-JS frontend — a separate global set
    // from the Node backend above, matching this project's existing
    // "server and browser code never share a module system" convention.
    files: ["frontend/js/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        crypto: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        navigator: "readonly",
        location: "readonly",
        URLSearchParams: "readonly",
        FormData: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        MutationObserver: "readonly",
        IntersectionObserver: "readonly",
        AbortController: "readonly",
        alert: "readonly",
        confirm: "readonly",
        history: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // frontend/js/common.js's top-level declarations, as globals for every
    // OTHER frontend script (excluded here — common.js is the file that
    // declares them, not a consumer of them, so it must not see its own
    // exports as pre-existing globals or ESLint flags every declaration as
    // "already defined"/no-redeclare). This is a no-module-system,
    // multiple-<script>-tags-sharing-one-`window` frontend (see
    // frontend/*.html) — common.js is always loaded before every
    // page-specific script and its functions/consts are real, intentional
    // cross-file globals, not undeclared variables. ESLint can't infer
    // script load order across files on its own, so this list is the
    // deliberate alternative to disabling `no-undef` for the whole frontend
    // and losing real typo detection.
    files: ["frontend/js/**/*.js"],
    ignores: ["frontend/js/common.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        commonEls: "readonly",
        mouse: "readonly",
        HOVER_SELECTOR: "readonly",
        TEXT_SELECTOR: "readonly",
        escapeHtml: "readonly",
        FIELD_LABELS: "readonly",
        SERVICE_SLUGS: "readonly",
        SERVICE_LABELS: "readonly",
        initSpotlight: "readonly",
        initCursor: "readonly",
        initCoordReadout: "readonly",
        attachMagneticTilt: "readonly",
        panelFor: "readonly",
        initMagneticCards: "readonly",
        initAccordion: "readonly",
        summaryRow: "readonly",
        DRAFT_PREFIX: "readonly",
        DRAFT_MAX_AGE_MS: "readonly",
        saveDraft: "readonly",
        clearDraft: "readonly",
        loadDraft: "readonly",
        formatDraftAge: "readonly",
        initDraftBanner: "readonly",
        hydrateFieldSelectors: "readonly",
        hydrateTextInputs: "readonly",
        syncTextInputsFromDom: "readonly",
        createSectionNavigator: "readonly",
        ADMIN_TOKEN_KEY: "readonly",
        isAdminLoggedIn: "readonly",
        getAdminToken: "readonly",
        loginAdmin: "readonly",
        logoutAdmin: "readonly",
        requestServerLogout: "readonly",
        INTAKE_ENDPOINTS: "readonly",
        saveSubmission: "readonly",
        fetchSubmissions: "readonly",
        updateSubmissionStatus: "readonly",
        analyzeSubmission: "readonly",
        draftEmail: "readonly",
        upsertOutcome: "readonly",
        exportSubmissionsCsv: "readonly",
        getAssetSignedUrl: "readonly",
        deleteSubmission: "readonly",
        deleteAsset: "readonly",
        cleanupOrphanedAssets: "readonly",
        getOllamaStatus: "readonly",
        postOllamaControl: "readonly",
        startOllamaRemote: "readonly",
        stopOllamaRemote: "readonly",
        getGuardianDiagnostics: "readonly",
        runGuardianCheck: "readonly",
        getGuardianHistory: "readonly",
        getAiControlState: "readonly",
        disableAi: "readonly",
        lockdownAi: "readonly",
        enableAi: "readonly",
        getSecurityEvents: "readonly",
        acknowledgeSecurityEvent: "readonly",
        getSecurityStatus: "readonly",
        getSecurityEventsPage: "readonly",
        getSecurityDeployments: "readonly",
        getAnalysisProgress: "readonly",
        getEmailDraftProgress: "readonly",
        contractFetch: "readonly",
        listContracts: "readonly",
        getContractDetail: "readonly",
        createContractFromSubmission: "readonly",
        updateContract: "readonly",
        deleteContract: "readonly",
        setContractFeatures: "readonly",
        addCustomContractFeature: "readonly",
        removeContractFeature: "readonly",
        getContractAuditLog: "readonly",
        listContractFeatureCatalog: "readonly",
        reviewContractWithAi: "readonly",
        getContractReviewProgress: "readonly",
        generateContractWithAi: "readonly",
        getContractGenerationProgress: "readonly",
        saveContractContent: "readonly",
        getContractVersions: "readonly",
        generateContractPdf: "readonly",
        getContractPdfUrl: "readonly",
        approveContract: "readonly",
        finalizeContract: "readonly",
        setContractStatus: "readonly",
        draftContractEmail: "readonly",
        sendContractEmail: "readonly",
        initMenu: "readonly",
        renderMenu: "readonly",
        openMenu: "readonly",
        closeMenu: "readonly",
        SIGNUP_CONTENT: "readonly",
        modalTriggerEl: "readonly",
        getFocusableElements: "readonly",
        initModal: "readonly",
        openModal: "readonly",
        renderSignupModal: "readonly",
        renderLoginModal: "readonly",
        closeModal: "readonly",
        initCommon: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // common.js's entire purpose is declaring functions/consts consumed by
    // sibling <script> tags (see the block above) — from this file's own
    // perspective almost everything it declares looks "unused", since
    // nothing here calls its own exports. no-undef still applies normally.
    files: ["frontend/js/common.js"],
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", vars: "local" }],
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        globalThis: "readonly",
      },
    },
  },
];
