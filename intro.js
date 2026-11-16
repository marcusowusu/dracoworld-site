(() => {
  const root = document.documentElement;
  const params = new URLSearchParams(window.location.search);
  const previewMode = params.get("intro-preview") === "desktop";
  const accountEntry = ["account", "invite", "reset_token", "verified"]
    .some((key) => params.has(key));

  if (
    (!previewMode && window.location.pathname !== "/" && window.location.pathname !== "/index.html")
    || (window.location.hash && window.location.hash !== "#top")
    || accountEntry
    || (!previewMode && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) {
    return;
  }

  if (!previewMode) {
    try {
      if (window.sessionStorage.getItem("dracoworld-intro-seen")) return;
      window.sessionStorage.setItem("dracoworld-intro-seen", "1");
    } catch {
      return;
    }
  }

  root.dataset.intro = "active";
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const previousThemeColor = themeColor?.content;
  if (themeColor) themeColor.content = "#090909";
  let autoExitTimer;
  let exitTimer;

  const finishIntro = () => {
    if (root.dataset.intro !== "active") return;
    root.dataset.intro = "leaving";
    window.clearTimeout(exitTimer);
    window.clearTimeout(autoExitTimer);
    exitTimer = window.setTimeout(() => {
      delete root.dataset.intro;
      document.querySelector(".cinematic-intro")?.setAttribute("aria-hidden", "true");
      if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
      document.querySelector(".site-header .brand")?.focus({ preventScroll: true });
    }, 550);
  };

  document.addEventListener("DOMContentLoaded", () => {
    const intro = document.querySelector(".cinematic-intro");
    const skipButton = intro?.querySelector(".intro-skip");
    const continueButton = intro?.querySelector(".intro-continue");
    if (!intro || !skipButton || !continueButton) {
      finishIntro();
      return;
    }

    intro.setAttribute("aria-hidden", "false");
    skipButton.addEventListener("click", finishIntro);
    continueButton.addEventListener("click", finishIntro);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        finishIntro();
      } else if (event.key === "Tab") {
        if (event.shiftKey && document.activeElement === skipButton) {
          event.preventDefault();
          continueButton.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === continueButton) {
          event.preventDefault();
          skipButton.focus({ preventScroll: true });
        }
      }
    });
    continueButton.focus({ preventScroll: true });
    if (!previewMode) autoExitTimer = window.setTimeout(finishIntro, 4450);
  }, { once: true });
})();
