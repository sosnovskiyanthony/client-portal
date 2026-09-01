// Builds the single "approved contract data" payload both AI tasks see —
// ai/contractReviewPrompt.js (Task 1: completeness/conflict check) and
// ai/contractPrompt.js (Task 2: drafting). One shared shape, one place
// that decides what's in scope, so the two tasks can never silently drift
// apart on what "approved data" actually means.
//
// Deliberately narrow: only fields the admin has explicitly set on the
// contract itself (see models/Contract.js) and the features they've
// explicitly selected (models/ContractSelectedFeature.js) — never the raw
// submission free-text, never an internal id, never anything the client
// wrote that hasn't already passed through this shape. This is what makes
// "client-submitted text is data, never instructions" enforceable: by the
// time anything reaches here, it has already been through the admin's own
// review and explicit save action.
function buildApprovedContractData(contract, selectedFeatures) {
  return {
    client: {
      name: contract.clientName || null,
      company: contract.clientCompany || null,
      email: contract.clientEmail || null,
      phone: contract.clientPhone || null,
      address: contract.clientAddress || null,
    },
    project: {
      name: contract.projectName || null,
      type: contract.projectType || null,
      description: contract.projectDescription || null,
    },
    scope_of_work: (selectedFeatures || []).map((f) => ({
      category: f.category,
      name: f.name,
      description: f.description || null,
      wording: f.wording || null,
      price: f.price,
      is_custom: f.isCustom,
    })),
    pricing: {
      price: contract.price,
      currency: contract.currency || "USD",
    },
    payment_terms: {
      deposit_amount: contract.depositAmount,
      deposit_percentage: contract.depositPercentage,
      remaining_balance: contract.remainingBalance,
      schedule: (contract.paymentTerms && contract.paymentTerms.schedule) || null,
      method: (contract.paymentTerms && contract.paymentTerms.method) || null,
      due_dates: (contract.paymentTerms && contract.paymentTerms.dueDates) || null,
      late_payment_terms: (contract.paymentTerms && contract.paymentTerms.latePaymentTerms) || null,
      // Optional equity-in-lieu-of-cash arrangement — null/null for a
      // normal cash-only deal. Never invented by the AI; only ever set by
      // the admin explicitly typing a percentage/description in the
      // builder (see frontend/js/contracts.js's Payment Terms section).
      equity_percentage: (contract.paymentTerms && contract.paymentTerms.equityPercentage) ?? null,
      equity_description: (contract.paymentTerms && contract.paymentTerms.equityDescription) || null,
    },
    timeline: {
      start_date: contract.startDate || null,
      estimated_completion_date: contract.estimatedCompletionDate || null,
    },
    revisions: {
      included_revisions: contract.includedRevisions,
      additional_revision_rate: contract.additionalRevisionRate,
      additional_work_rate: contract.additionalWorkRate,
    },
    client_responsibilities: Array.isArray(contract.clientResponsibilities) ? contract.clientResponsibilities : [],
    custom_terms: contract.customTerms || null,
  };
}

module.exports = { buildApprovedContractData };
