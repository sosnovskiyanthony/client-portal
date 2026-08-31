(() => {
  function initTilt() {
    document.querySelectorAll(".bento-card").forEach(attachMagneticTilt);
  }

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
    initTilt();
    initAccordion();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
