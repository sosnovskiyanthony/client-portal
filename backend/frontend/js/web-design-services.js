(() => {
  // initMagneticCards is the shared version in common.js (also used by
  // web-design.js/seo.js) — this file used to keep its own identically-
  // bodied copy under a different name (initTilt).

  function initAccordion() {
    const items = Array.from(document.querySelectorAll(".accordion-item"));

    items.forEach((item) => {
      const btn = item.querySelector(".accordion-question");

      btn.addEventListener("click", () => {
        const isOpen = item.classList.contains("open");

        items.forEach((other) => {
          if (other === item) return;
          other.classList.remove("open");
          other.querySelector(".accordion-question").setAttribute("aria-expanded", "false");
        });

        item.classList.toggle("open", !isOpen);
        btn.setAttribute("aria-expanded", String(!isOpen));
      });
    });
  }

  function init() {
    initCommon();
    initMagneticCards();
    initAccordion();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
