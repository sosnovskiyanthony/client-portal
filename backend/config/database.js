const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const env = require("./env");

const isLocalHost = /localhost|127\.0\.0\.1/.test(env.databaseUrl);

// Matches DUMMY_HASH's cost factor in controllers/authController.js — they
// must stay equal, or a nonexistent-email login attempt (compared against
// the dummy hash) would finish measurably faster/slower than a real one
// (compared against a hash made with this cost), reopening the timing
// side-channel that dummy hash exists to close.
const BCRYPT_COST = 12;

const pool = new Pool({
  connectionString: env.databaseUrl,
  // Supabase (and most hosted Postgres) requires SSL; local dev Postgres
  // doesn't have it configured, so we skip it automatically for localhost.
  ssl: isLocalHost ? false : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      client_name TEXT,
      email TEXT,
      project_details JSONB,
      flexible_payment_preference BOOLEAN,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // ADD COLUMN IF NOT EXISTS, not just the CREATE TABLE above — that only
  // applies to a brand-new database. This is what actually reaches an
  // existing submissions table (local dev, and production once deployed)
  // that predates this column.
  await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();`);

  // Token revocation (see middleware/auth.js, controllers/authController.js's
  // logout). A JWT is otherwise stateless — this column is what makes
  // "log out" actually invalidate a token server-side, not just clear it
  // client-side. Every JWT this app issues now carries the token_version
  // that was current at sign time; authenticate() rejects a token whose
  // version doesn't match the user's current value. Bumping it (logout, or
  // a future "log out everywhere") invalidates every previously-issued
  // token at once — there's exactly one admin account, so there's no
  // per-session granularity to preserve; "log out" meaning "kill every
  // outstanding session" is the correct behavior here, not a limitation.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;`);

  // The three new services (AI Integration / App Building / Web Management)
  // need a lead to be filterable under more than one service at once — a
  // single `type` column can't express "this submission is both AI
  // Integration and App Building." `type` stays exactly as it's always been
  // (web-design|seo|contact for existing submissions, 'services' for the
  // new unified multi-select intake — see routes/intake.js); this array is
  // the actual multi-service membership, queried with the `@>`/`= ANY`
  // containment operators (models/Submission.js), never an ORM concept.
  // Nullable and unbackfilled by default — existing web-design/seo rows get
  // backfilled below (one-time, idempotent — only ever touches rows that
  // still have services IS NULL, so it's safe to run on every boot);
  // contact submissions are deliberately left NULL, since a general inquiry
  // isn't a "service" selection in this filtering sense.
  await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS services TEXT[];`);
  await pool.query(`
    UPDATE submissions
    SET services = ARRAY[type]
    WHERE services IS NULL AND type IN ('web-design', 'seo');
  `);

  // Supports the admin dashboard's actual query patterns: filtering by type
  // and sorting newest-first for pagination (see models/Submission.js).
  await pool.query(`CREATE INDEX IF NOT EXISTS submissions_type_idx ON submissions (type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON submissions (created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS submissions_services_idx ON submissions USING GIN (services);`);

  // One AI analysis per submission (re-analyze overwrites the existing row
  // rather than accumulating history — see services/aiAnalysis.js). `outcome`
  // is reserved for future manually-entered actual-project data (final scope,
  // timeline, hours, price, features delivered, outcome) so historical rows
  // can eventually feed a predictive dataset — nothing populates it yet, and
  // no UI exists to edit it in this pass; it's just schema headroom.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submission_analyses (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT,
      model TEXT,
      prompt_version TEXT,
      result JSONB,
      error TEXT,
      outcome JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Manually-entered, post-hoc project data — separate from
  // submission_analyses.outcome (which is AI-analysis-specific and only
  // ever applies to web-design submissions). This table is general-purpose:
  // any submission type can have a recorded outcome, since an SEO or even a
  // contact inquiry can become real paying work too. This is the actual
  // seed of the "future predictive dataset" the AI system was built to
  // eventually feed — nothing populates it automatically; it's filled in by
  // hand once a project's real trajectory is known.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_outcomes (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
      outcome TEXT,
      final_scope TEXT,
      actual_timeline TEXT,
      quoted_price NUMERIC,
      final_price NUMERIC,
      features_delivered JSONB,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // AI-drafted client outreach emails — one per submission, same
  // pending/processing/completed/failed lifecycle as submission_analyses
  // (see models/EmailDraft.js), since drafting also makes a real AI call
  // that can fail or hang the same way. Only ever populated once an analysis
  // exists and completed (see ai/aiService.js's draftEmail).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_drafts (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      provider TEXT,
      model TEXT,
      prompt_version TEXT,
      subject TEXT,
      body TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // AI chat interface — lets the admin have a multi-turn conversation about
  // a submission's analysis (see models/SubmissionChat.js, ai/chatPrompt.js).
  // One row per submission (like submission_analyses/email_drafts), but
  // holds a growing array rather than a single overwritten result — each
  // element is { role: "admin"|"assistant"|"analysis", content, createdAt }.
  // A "analysis" role entry's content is a full AnalysisSchema-shaped
  // object (produced by pasting raw client text into the chat and asking
  // for an analysis) — kept inline in the thread for context, but never
  // written to submission_analyses until the admin explicitly saves it
  // (see chatController.saveChatAnalysis).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submission_chats (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
      messages JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Contracts feature — see ai/README.md's "Contracts" section (once
  // written) for the full workflow. Deliberately separate from
  // submission_analyses/email_drafts' 1:1-per-submission pattern: a
  // re-negotiated deal can produce more than one contract for the same
  // submission, so submission_id is NOT unique here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_number_counters (
      year INTEGER PRIMARY KEY,
      next_number INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Admin-editable master template — the legal section skeleton is owned by
  // the business (and should be reviewed by real legal counsel), never
  // invented by the AI. body_template is guidance text describing what each
  // section should cover, fed to the AI generation prompt alongside the
  // admin-approved contract data — not literal boilerplate injected verbatim.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT false,
      sections JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Admin-managed feature/service catalog — deliberately NOT hardcoded into
  // the AI generation prompt (see ai/contractPrompt.js). "active = false" is
  // how a feature is retired, never a hard DELETE, so a past contract's
  // contract_selected_features snapshot (which copies name/description/
  // wording at selection time) is never affected by a later catalog edit.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_features (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      default_wording TEXT,
      default_price NUMERIC,
      active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contracts (
      id SERIAL PRIMARY KEY,
      contract_number TEXT NOT NULL UNIQUE,
      submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      template_id INTEGER REFERENCES contract_templates(id),
      client_name TEXT,
      client_email TEXT,
      client_company TEXT,
      client_phone TEXT,
      client_address TEXT,
      project_name TEXT,
      project_type TEXT,
      project_description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      price NUMERIC,
      currency TEXT NOT NULL DEFAULT 'USD',
      deposit_amount NUMERIC,
      deposit_percentage NUMERIC,
      remaining_balance NUMERIC,
      payment_terms JSONB,
      start_date DATE,
      estimated_completion_date DATE,
      included_revisions INTEGER,
      additional_revision_rate NUMERIC,
      additional_work_rate NUMERIC,
      client_responsibilities JSONB,
      custom_terms TEXT,
      scope_snapshot JSONB,
      review_result JSONB,
      reviewed_at TIMESTAMPTZ,
      generated_content JSONB,
      final_content JSONB,
      pdf_storage_path TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      approved_at TIMESTAMPTZ,
      finalized_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      viewed_at TIMESTAMPTZ,
      signed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS contracts_submission_id_idx ON contracts (submission_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts (status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS contracts_created_at_idx ON contracts (created_at DESC);`);
  // ADD COLUMN IF NOT EXISTS, not just the CREATE TABLE above — that only
  // applies to a brand-new database. review_result/reviewed_at were added
  // after contracts already existed in dev (same reasoning as
  // submissions.updated_at above), and this is what actually reaches an
  // existing table.
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS review_result JSONB;`);
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;`);

  // name/category/description/wording are snapshotted here at selection
  // time (not just a bare feature_id reference) so a later edit to the
  // catalog row never retroactively changes what a past contract's scope
  // actually said.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_selected_features (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      feature_id INTEGER REFERENCES contract_features(id) ON DELETE SET NULL,
      is_custom BOOLEAN NOT NULL DEFAULT false,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      wording TEXT,
      price NUMERIC,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS contract_selected_features_contract_id_idx ON contract_selected_features (contract_id);`);

  // A 'final' version is never overwritten — finalizing a contract always
  // inserts a new row rather than mutating an existing one.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_versions (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      source TEXT NOT NULL,
      content JSONB NOT NULL,
      change_note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (contract_id, version_number)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS contract_versions_contract_id_idx ON contract_versions (contract_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_audit_log (
      id SERIAL PRIMARY KEY,
      contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      actor_user_id INTEGER REFERENCES users(id),
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS contract_audit_log_contract_id_idx ON contract_audit_log (contract_id);`);

  // BrindLeaf Guardian's production diagnostics history (see
  // controllers/guardianController.js, models/GuardianCheck.js) — one row
  // per admin-triggered "Run Guardian Check". Deliberately lightweight:
  // per-dependency configured/reachable status and a short summary, never
  // secret values or full request/response bodies. Same idempotent
  // CREATE TABLE IF NOT EXISTS convention as every other table above, no
  // migration framework.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guardian_checks (
      id SERIAL PRIMARY KEY,
      check_type TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      commit_sha TEXT,
      findings JSONB,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS guardian_checks_created_at_idx ON guardian_checks (created_at DESC);`);

  // Guardian's AI safety control plane (see guardian/aiControl.js). Append-
  // only, on purpose — never UPDATEd. "Current state" is always just the
  // most recent row (ORDER BY created_at DESC LIMIT 1), so the full history
  // of every enable/disable/lockdown transition (who/what triggered it, and
  // why) is free, auditable, and can never be silently overwritten. Seeded
  // with one ENABLED row below so "the table has zero rows" can never be
  // confused with "the table/DB is unreachable" — aiControl.js treats a
  // genuine query failure (not merely an empty result) as the fail-closed
  // case.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_control_state (
      id SERIAL PRIMARY KEY,
      state TEXT NOT NULL,
      reason TEXT,
      source TEXT NOT NULL,
      actor_user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS ai_control_state_created_at_idx ON ai_control_state (created_at DESC);`);
  await pool.query(`
    INSERT INTO ai_control_state (state, reason, source)
    SELECT 'ENABLED', 'Initial state on first boot.', 'system'
    WHERE NOT EXISTS (SELECT 1 FROM ai_control_state);
  `);

  // Guardian's security/audit event log (see guardian/securityEvents.js).
  // Serves two roles deliberately merged into one table rather than two
  // near-duplicates: routine AI-operation audit entries (severity INFO) and
  // genuine security incidents (WARNING/HIGH/CRITICAL) are the same
  // underlying concept — "something happened, here's the evidence" — just
  // at different severities. Never stores secrets/tokens/full prompts or
  // responses; metadata is small, structured, and identifier-based only.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_events (
      id SERIAL PRIMARY KEY,
      severity TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      source TEXT,
      resource_type TEXT,
      resource_id TEXT,
      description TEXT,
      metadata JSONB,
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON security_events (created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS security_events_severity_idx ON security_events (severity);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS security_events_event_type_idx ON security_events (event_type);`);

  await seedContractTemplate();
  await seedContractFeatures();

  // The admin account is fully driven by ADMIN_EMAIL/ADMIN_PASSWORD — there's
  // no in-app "change password" flow, so on every startup we reconcile the
  // stored admin to match those env vars, not just seed it once. That way
  // updating ADMIN_PASSWORD and redeploying is enough to actually change it.
  const { rows } = await pool.query(
    "SELECT id, email, password_hash FROM users WHERE role = 'admin' LIMIT 1"
  );

  if (rows.length === 0) {
    const passwordHash = bcrypt.hashSync(env.adminPassword, BCRYPT_COST);
    await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
      [env.adminEmail, passwordHash]
    );
    console.log(`Seeded admin user: ${env.adminEmail}`);
  } else {
    const admin = rows[0];
    const emailChanged = admin.email !== env.adminEmail;
    const passwordChanged = !bcrypt.compareSync(env.adminPassword, admin.password_hash);

    if (emailChanged || passwordChanged) {
      const passwordHash = passwordChanged ? bcrypt.hashSync(env.adminPassword, BCRYPT_COST) : admin.password_hash;
      await pool.query("UPDATE users SET email = $1, password_hash = $2 WHERE id = $3", [
        env.adminEmail,
        passwordHash,
        admin.id,
      ]);
      const changed = [emailChanged && "email", passwordChanged && "password"].filter(Boolean).join(", ");
      console.log(`Synced admin user (${changed} changed): ${env.adminEmail}`);
    }
  }
}

// The ~20 standard legal sections a real contract needs, as guidance for
// the AI drafting prompt (ai/contractPrompt.js) — never literal boilerplate
// injected verbatim. Owned by the business, editable by the admin via the
// template CRUD endpoints; this seed only ever runs once (skipped if any
// template row already exists), so an admin's later edits are never
// silently reverted by a redeploy.
const DEFAULT_TEMPLATE_SECTIONS = [
  { key: "parties", title: "Parties", body_template: "Identify the two parties to this agreement: the service provider (the business) and the client (name, company, and contact details from the approved client information)." },
  { key: "project_description", title: "Project Description", body_template: "Describe the project in professional terms, grounded only in the approved project name/type/description — do not add scope details not present elsewhere in the approved data." },
  { key: "scope_of_work", title: "Scope of Work", body_template: "List, explicitly and individually, every approved included feature/service by name. State clearly that anything not explicitly listed here is out of scope and requires a separate change order — never a vague phrase like 'includes all requested features.'" },
  { key: "deliverables", title: "Deliverables", body_template: "State the concrete deliverables implied directly by the approved scope of work — do not invent deliverables beyond what the selected features establish." },
  { key: "client_responsibilities", title: "Client Responsibilities", body_template: "List the approved client responsibilities (e.g. providing content, credentials, timely feedback) exactly as approved — do not add responsibilities not present in the approved data." },
  { key: "timeline", title: "Timeline", body_template: "State the approved start date and estimated completion date. Make clear these are estimates, not guaranteed deadlines, and note that client delays (e.g. late content/feedback) can shift them." },
  { key: "pricing", title: "Pricing", body_template: "State the approved total price and currency exactly as approved. Never state a different figure than the approved price." },
  { key: "payment_terms", title: "Payment Terms", body_template: "State the approved deposit amount/percentage, remaining balance, payment schedule, due dates, and payment method exactly as approved." },
  { key: "equity_compensation", title: "Equity Compensation", body_template: "If the approved payment terms include an equity/stake percentage and description, describe that arrangement exactly as approved — never invent a percentage, vesting schedule, valuation, or company name not present in the approved data. If no equity arrangement is approved, state plainly that compensation under this Contract is cash-only." },
  { key: "revisions", title: "Revisions", body_template: "State the approved number of included revisions and the approved additional-revision rate. Do not invent a revision count or rate not present in the approved data." },
  { key: "additional_work", title: "Additional Work", body_template: "State the approved additional-work rate and that work outside the defined scope of work is billed separately at that rate." },
  { key: "hosting", title: "Hosting", body_template: "Describe hosting-related terms only if a hosting-related feature was approved in the scope of work; otherwise state hosting is not included in this agreement." },
  { key: "maintenance", title: "Maintenance", body_template: "Describe maintenance-related terms only if a maintenance-related feature was approved in the scope of work; otherwise state maintenance is not included in this agreement." },
  { key: "third_party_services", title: "Third-Party Services", body_template: "List any approved third-party integrations (e.g. payment processors, analytics, scheduling tools) from the scope of work, and note the client is responsible for that service's own terms/costs unless stated otherwise in the approved data." },
  { key: "intellectual_property", title: "Intellectual Property", body_template: "State IP ownership terms only as given in the approved custom terms — do not invent an IP transfer/licensing arrangement not present in the approved data." },
  { key: "confidentiality", title: "Confidentiality", body_template: "State confidentiality terms only as given in the approved custom terms — do not invent obligations not present in the approved data." },
  { key: "cancellation_termination", title: "Cancellation/Termination", body_template: "State cancellation/termination terms only as given in the approved custom terms — do not invent conditions not present in the approved data." },
  { key: "limitation_of_liability", title: "Limitation of Liability", body_template: "State liability terms only as given in the approved custom terms — do not invent a liability cap or disclaimer not present in the approved data." },
  { key: "dispute_resolution", title: "Dispute Resolution", body_template: "State dispute-resolution terms only as given in the approved custom terms — do not invent an arbitration/mediation process not present in the approved data." },
  { key: "governing_law", title: "Governing Law", body_template: "State the governing jurisdiction only as given in the approved custom terms or client address — do not invent a jurisdiction not present in the approved data." },
  { key: "acceptance", title: "Acceptance", body_template: "A short statement that by signing below, both parties agree to the terms of this agreement as stated above." },
  { key: "signatures", title: "Signatures", body_template: "A signature block for both the service provider and the client, with name, title, and date fields for each." },
];

async function seedContractTemplate() {
  const { rows } = await pool.query("SELECT id FROM contract_templates LIMIT 1");
  if (rows.length > 0) return;
  await pool.query(
    "INSERT INTO contract_templates (name, is_active, sections) VALUES ($1, true, $2)",
    ["Standard Web Design Contract", JSON.stringify(DEFAULT_TEMPLATE_SECTIONS)]
  );
  console.log("Seeded default contract template.");
}

// Starter catalog from the feature spec — deliberately admin-editable
// afterward (see contractFeatureController.js), never hardcoded into the AI
// prompt. "Other" isn't seeded as a real row on purpose: it's the cue for
// the admin to add a custom feature instead, not a selectable catalog item.
const DEFAULT_CONTRACT_FEATURES = [
  ["Website Pages", ["Homepage", "About", "Services", "Contact", "FAQ", "Blog", "Portfolio", "Pricing", "Landing Pages"]],
  ["Functionality", ["Contact Form", "Booking System", "Newsletter", "User Accounts", "Customer Portal", "Search", "Reviews/Testimonials", "E-commerce", "Payment Processing", "Membership System", "File Uploads"]],
  ["Integrations", ["Google Analytics", "Google Search Console", "Stripe", "PayPal", "Calendly", "Mailchimp", "HubSpot", "Social Media"]],
  ["SEO", ["Basic On-Page SEO", "Metadata", "Sitemap", "Robots.txt", "Google Search Console Setup", "Schema Markup", "Keyword Research"]],
  ["Hosting & Maintenance", ["Domain Setup", "Hosting", "SSL", "Backups", "Security Monitoring", "Maintenance"]],
];

async function seedContractFeatures() {
  const { rows } = await pool.query("SELECT id FROM contract_features LIMIT 1");
  if (rows.length > 0) return;
  let sortOrder = 0;
  for (const [category, names] of DEFAULT_CONTRACT_FEATURES) {
    for (const name of names) {
      await pool.query(
        "INSERT INTO contract_features (category, name, active, sort_order) VALUES ($1, $2, true, $3)",
        [category, name, sortOrder]
      );
      sortOrder += 1;
    }
  }
  console.log(`Seeded ${sortOrder} default contract features.`);
}

module.exports = { pool, init };
