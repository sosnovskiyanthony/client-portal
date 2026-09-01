// Consent-gated Google Analytics loader. Deliberately never loads GA (and
// never sets any GA cookie) until the visitor explicitly accepts — the
// previous version of this site loaded the GA snippet unconditionally on
// every page load with no consent mechanism at all, which is a real
// GDPR/ePrivacy problem for any business with EU/UK visitors.
//
// The measurement ID is read from a <meta name="ga-measurement-id"> tag
// (server-injected by server.js's templateFileContents(), only when
// GA_MEASUREMENT_ID is actually set — see config/env.js) rather than an
// inline <script>, so this stays compatible with a strict
// script-src 'self' https://www.googletagmanager.com CSP with no
// 'unsafe-inline' exception (see server.js's Content-Security-Policy header).
(() => {
  const CONSENT_KEY = "studio:analytics-consent"; // "granted" | "denied"

  function getConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (err) {
      return null; // private browsing / storage blocked — treat as undecided, never assume consent
    }
  }

  function setConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch (err) {
      // Storage unavailable — the banner will just reappear next visit.
      // Not loading GA is always the safe failure here, not the reverse.
    }
  }

  function loadGA(measurementId) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", measurementId);
  }

  function initConsentBanner(measurementId) {
    const banner = document.getElementById("consent-banner");
    if (!banner) return;

    const existing = getConsent();
    if (existing === "granted") {
      loadGA(measurementId);
      return;
    }
    if (existing === "denied") {
      return; // already declined — don't ask again, don't load GA
    }

    banner.hidden = false;

    document.getElementById("consent-accept-btn").addEventListener("click", () => {
      setConsent("granted");
      banner.hidden = true;
      loadGA(measurementId);
    });

    document.getElementById("consent-decline-btn").addEventListener("click", () => {
      setConsent("denied");
      banner.hidden = true;
    });
  }

  function init() {
    const meta = document.querySelector('meta[name="ga-measurement-id"]');
    const measurementId = meta ? meta.content.trim() : "";
    if (!measurementId) return; // analytics not configured for this deployment — nothing to gate
    initConsentBanner(measurementId);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
