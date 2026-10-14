const year = document.querySelector("#year");

if (year) {
  year.textContent = new Date().getFullYear();
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealElements = document.querySelectorAll(".reveal");

if (!reduceMotion && "IntersectionObserver" in window && revealElements.length > 0) {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

  revealElements.forEach((element) => revealObserver.observe(element));
  document.body.classList.add("motion-ready");
}

const heroSlides = document.querySelectorAll(".hero-image");
const slideIndex = document.querySelector(".image-label-index");

if (!reduceMotion && heroSlides.length > 1) {
  let activeSlide = 0;

  window.setInterval(() => {
    if (document.hidden) {
      return;
    }

    activeSlide = (activeSlide + 1) % heroSlides.length;
    heroSlides.forEach((slide, index) => {
      const isActive = index === activeSlide;
      slide.classList.toggle("is-active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });

    if (slideIndex) {
      slideIndex.textContent = `0${activeSlide + 1} / 0${heroSlides.length}`;
    }
  }, 4000);
}
