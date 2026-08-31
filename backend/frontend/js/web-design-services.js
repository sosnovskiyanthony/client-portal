(() => {
  function initTilt() {
    document.querySelectorAll(".bento-card").forEach(attachMagneticTilt);
  }

  function init() {
    initCommon();
    initTilt();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
