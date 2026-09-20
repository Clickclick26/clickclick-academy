/* Microsoft Clarity: click heatmaps, scroll maps and session recordings.

   Loads only after the visitor allows analytics cookies (see cookies.js).
   Set CLARITY_PROJECT_ID to the project id from clarity.microsoft.com.
   While it is empty nothing loads, so the site is safe to ship either way. */
(function () {
  const CLARITY_PROJECT_ID = "ylc6v3exh7";

  if (!CLARITY_PROJECT_ID) return;

  let loaded = false;

  function loadClarity() {
    if (loaded) return;
    loaded = true;
    (function (c, l, a, r, i, t, y) {
      c[a] =
        c[a] ||
        function () {
          (c[a].q = c[a].q || []).push(arguments);
        };
      t = l.createElement(r);
      t.async = 1;
      t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0];
      y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", CLARITY_PROJECT_ID);
  }

  function stopClarity() {
    if (!loaded) return;
    if (typeof window.clarity === "function") window.clarity("stop");
  }

  function apply(consent) {
    if (consent && consent.analytics) loadClarity();
    else stopClarity();
  }

  // cookies.js fires this once on load with the stored choice, and again on every change.
  document.addEventListener("cc-consent", function (e) {
    apply(e.detail);
  });

  // Covers the case where a stored choice already exists before this file runs.
  if (window.ccConsent && window.ccConsent.allowsAnalytics()) loadClarity();
})();
