(() => {
  // Shared by terms-of-service.html/privacy-policy.html/cookie-policy.html —
  // static legal copy with zero page-specific interactive logic, so this
  // just wires up the shared chrome (cursor, spotlight, coord readout,
  // menu) that every other page's own script calls initCommon() for.
  document.addEventListener("DOMContentLoaded", initCommon);
})();
