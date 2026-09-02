(() => {
  // Shared by ai-integration.html/app-building.html/web-management.html —
  // same identical body as web-design-services.js's own init, just used by
  // three pages instead of duplicating this exact 3-line function three
  // times for content that has zero page-specific logic.
  function init() {
    initCommon();
    initMagneticCards();
    initAccordion();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
