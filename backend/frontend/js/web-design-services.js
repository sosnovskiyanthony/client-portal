(() => {
  // initMagneticCards and initAccordion are the shared versions in
  // common.js (also used by web-design.js/seo.js, and home.js respectively)
  // — this file used to keep its own identically-bodied copies (the
  // magnetic-tilt one under a different name, initTilt).

  function init() {
    initCommon();
    initMagneticCards();
    initAccordion();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
