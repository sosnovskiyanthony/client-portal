(() => {
  // initAccordion is the shared version in common.js (also used by
  // web-design-services.js) — this file used to keep its own identically-
  // bodied copy.

  function init() {
    initCommon();
    initAccordion();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
