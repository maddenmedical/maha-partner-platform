// Single source of truth for the Privacy Policy / Terms of Use version,
// shared between the frontend (legalContent.ts, which surfaces the same
// string as `updated`) and the backend (routes.ts, which stamps it onto
// users.legalAcceptedVersion at registration/acknowledgment time).
//
// Bump this whenever the Policy/Terms change materially. Any signed-in user
// whose stored legalAcceptedVersion doesn't match gets the one-time
// acknowledgment modal before they can continue — see App.tsx's
// LegalAcknowledgmentGate and Privacy Policy §11 ("Changes to this Policy").
export const CURRENT_LEGAL_VERSION = "12 September 2026";
